import 'server-only';

import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { can, type Capability, type TeamRole } from '@/lib/permissions';
import type { Business, Profile, TeamMember } from '@/lib/database.types';

export const ACTIVE_BUSINESS_COOKIE = 'tf_business';

export interface Membership {
  businessId: string;
  role: TeamRole;
  teamMemberId: string;
  businessName: string;
}

export interface Session {
  userId: string;
  email: string;
  profile: Profile | null;
  memberships: Membership[];
}

export interface BusinessSession extends Session {
  business: Business;
  role: TeamRole;
  teamMemberId: string;
  can: (capability: Capability) => boolean;
}

/**
 * The signed-in user and every business they belong to.
 *
 * `cache()` scopes the result to one request, so a page that calls this from a
 * layout, a header and three sections issues one round trip rather than five.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: members }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase
      .from('team_members')
      .select('id, business_id, role')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .not('accepted_at', 'is', null),
  ]);

  const businessIds = (members ?? []).map((m) => m.business_id);
  const { data: businesses } = businessIds.length
    ? await supabase.from('businesses').select('id, name').in('id', businessIds)
    : { data: [] as { id: string; name: string }[] };

  const names = new Map((businesses ?? []).map((b) => [b.id, b.name]));

  const memberships: Membership[] = (members ?? [])
    .map((row) => {
      const businessName = names.get(row.business_id);
      if (!businessName) return null;
      return {
        businessId: row.business_id,
        role: row.role as TeamRole,
        teamMemberId: row.id,
        businessName,
      };
    })
    .filter((m): m is Membership => m !== null)
    .sort((a, b) => a.businessName.localeCompare(b.businessName));

  return {
    userId: user.id,
    email: user.email ?? profile?.email ?? '',
    profile: (profile as Profile | null) ?? null,
    memberships,
  };
});

/** The session, or a redirect to sign in. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

/**
 * The session plus the business currently being worked in.
 *
 * The active business is held in a cookie so it survives navigation, but it is
 * always checked against the user's actual memberships — a hand-edited cookie
 * naming someone else's business falls back to the user's own.
 */
export const getBusinessSession = cache(async (): Promise<BusinessSession | null> => {
  const session = await getSession();
  if (!session) return null;
  if (session.memberships.length === 0) return null;

  const cookieStore = await cookies();
  const requested = cookieStore.get(ACTIVE_BUSINESS_COOKIE)?.value;
  const membership =
    session.memberships.find((m) => m.businessId === requested) ?? session.memberships[0]!;

  const supabase = await createClient();
  const { data: business } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', membership.businessId)
    .maybeSingle();

  if (!business) return null;

  return {
    ...session,
    business: business as Business,
    role: membership.role,
    teamMemberId: membership.teamMemberId,
    can: (capability: Capability) => can(membership.role, capability),
  };
});

/**
 * The workhorse. Every page and server action inside the app shell starts
 * here: it guarantees a signed-in user with a business, and hands back the
 * role so the page can decide what to offer.
 */
export async function requireBusiness(): Promise<BusinessSession> {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.memberships.length === 0) redirect('/onboarding');
  const businessSession = await getBusinessSession();
  if (!businessSession) redirect('/onboarding');
  return businessSession;
}

/**
 * As above, and refuses if the role cannot do the thing. Used by server
 * actions; row level security is still the real boundary, but failing here
 * gives the user a sentence instead of a Postgres error.
 */
export async function requireCapability(capability: Capability): Promise<BusinessSession> {
  const session = await requireBusiness();
  if (!session.can(capability)) {
    throw new PermissionError(
      `Your role (${session.role}) cannot do that. Ask an owner or admin.`
    );
  }
  return session;
}

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}

/** Read-only check for conditional rendering; never throws. */
export async function hasCapability(capability: Capability): Promise<boolean> {
  const session = await getBusinessSession();
  return session ? session.can(capability) : false;
}

// --- audit ------------------------------------------------------------------

export interface AuditEntry {
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  outcome?: 'allowed' | 'denied' | 'error';
  detail?: Record<string, unknown> | null;
}

/**
 * Append to the audit log.
 *
 * Written with the service role because the log is append-only for everyone
 * else, and because it must record a denial even when the denial was "you are
 * not a member of that business" — a case where the user's own client would
 * be blocked from writing the row.
 */
export async function audit(
  businessId: string | null,
  entry: AuditEntry,
  actor?: { id: string | null; email: string | null }
): Promise<void> {
  try {
    const session = actor ? null : await getSession();
    const headerList = await headers();
    const forwarded = headerList.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0]!.trim() : null;

    await createAdminClient()
      .from('audit_logs')
      .insert({
        business_id: businessId,
        actor_id: actor?.id ?? session?.userId ?? null,
        actor_email: actor?.email ?? session?.email ?? null,
        action: entry.action,
        entity_type: entry.entityType ?? null,
        entity_id: entry.entityId ?? null,
        outcome: entry.outcome ?? 'allowed',
        ip_address: ip && /^[0-9a-fA-F.:]+$/.test(ip) ? ip : null,
        user_agent: headerList.get('user-agent'),
        detail: (entry.detail ?? null) as never,
      });
  } catch {
    // The audit log must never be the reason an operation fails. A write that
    // cannot land is dropped rather than propagated.
  }
}

// --- activity timeline ------------------------------------------------------

export interface ActivityEntry {
  verb: string;
  summary: string;
  entityType: string;
  entityId?: string | null;
  jobId?: string | null;
  customerId?: string | null;
  quoteId?: string | null;
  invoiceId?: string | null;
  meta?: Record<string, unknown> | null;
}

/** Add a line to the human-readable timeline. Runs as the user, under RLS. */
export async function recordActivity(
  session: BusinessSession,
  entry: ActivityEntry
): Promise<void> {
  const supabase = await createClient();
  await supabase.from('activities').insert({
    business_id: session.business.id,
    actor_id: session.userId,
    actor_label: session.profile?.full_name ?? session.email,
    verb: entry.verb,
    summary: entry.summary,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    job_id: entry.jobId ?? null,
    customer_id: entry.customerId ?? null,
    quote_id: entry.quoteId ?? null,
    invoice_id: entry.invoiceId ?? null,
    meta: (entry.meta ?? null) as never,
  });
}

// --- notifications ----------------------------------------------------------

/** Notify the people who should hear about something. */
export async function notifyRoles(
  session: BusinessSession,
  roles: TeamRole[],
  notification: {
    kind: string;
    title: string;
    body?: string | null;
    link?: string | null;
    severity?: 'info' | 'success' | 'warning' | 'danger';
  }
): Promise<void> {
  const supabase = await createClient();
  const { data: recipients } = await supabase
    .from('team_members')
    .select('user_id')
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .not('user_id', 'is', null)
    .in('role', roles);

  if (!recipients?.length) return;

  await supabase.from('notifications').insert(
    recipients.map((r) => ({
      business_id: session.business.id,
      user_id: r.user_id,
      kind: notification.kind,
      title: notification.title,
      body: notification.body ?? null,
      link: notification.link ?? null,
      severity: notification.severity ?? 'info',
    }))
  );
}

export type { TeamMember };
