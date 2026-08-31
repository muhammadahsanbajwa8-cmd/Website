'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { audit, recordActivity, requireCapability } from '@/lib/session';
import { fieldErrors, inviteSchema } from '@/lib/validation';
import { describeError, fail, invalid, ok, type ActionState } from '@/lib/action-state';
import { assignableRoles, roleLabel, type TeamRole } from '@/lib/permissions';
import { env } from '@/lib/env';
import { htmlBody, sendAndRecord } from '@/lib/email/send';
import { moneyToCents } from '@/lib/money';

/**
 * The team.
 *
 * An invitation is a row in `team_members` with no `user_id` and a token. When
 * someone signs up with that address, the trigger in migration 0002 claims the
 * row — so the invitation works whether they follow the link or simply create
 * an account with the address it was sent to.
 */

export async function inviteMemberAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('team.manage');

  const parsed = inviteSchema.safeParse({
    email: formData.get('email'),
    fullName: formData.get('fullName'),
    role: formData.get('role'),
    phone: formData.get('phone'),
    hourlyRateCents: moneyToCents(formData.get('hourlyRate') as string),
  });
  if (!parsed.success) return invalid(fieldErrors(parsed.error));

  // An admin cannot mint an owner; only an owner can.
  if (!assignableRoles(session.role).includes(parsed.data.role as TeamRole)) {
    return fail(`Your role cannot assign the ${roleLabel(parsed.data.role as TeamRole)} role.`);
  }

  const supabase = await createClient();
  const token = randomBytes(24).toString('base64url');

  const { data: member, error } = await supabase
    .from('team_members')
    .insert({
      business_id: session.business.id,
      email: parsed.data.email,
      full_name: parsed.data.fullName ?? null,
      role: parsed.data.role,
      phone: parsed.data.phone ?? null,
      hourly_rate_cents: parsed.data.hourlyRateCents || null,
      invite_token: token,
      invited_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !member) {
    if ((error as { code?: string })?.code === '23505') {
      return fail('Someone with that email address is already on the team.');
    }
    return fail(describeError(error));
  }

  const inviteUrl = `${env.appUrl}/invite/${token}`;
  const paragraphs = [
    `${session.profile?.full_name ?? session.email} has invited you to join ${session.business.name} on TradeFlow.`,
    `You will join as ${roleLabel(parsed.data.role as TeamRole)}.`,
    'Open the link below to set up your account. It only works for this email address.',
  ];

  const { result } = await sendAndRecord(session, {
    to: [parsed.data.email],
    subject: `Join ${session.business.name} on TradeFlow`,
    text: `${paragraphs.join('\n\n')}\n\n${inviteUrl}`,
    html: htmlBody(session.business.name, paragraphs, { label: 'Accept the invitation', url: inviteUrl }),
  });

  await recordActivity(session, {
    verb: 'invited',
    summary: `${parsed.data.email} invited as ${roleLabel(parsed.data.role as TeamRole)}`,
    entityType: 'team_member',
    entityId: member.id,
  });
  await audit(session.business.id, {
    action: 'team.invite',
    entityType: 'team_member',
    entityId: member.id,
    detail: { email: parsed.data.email, role: parsed.data.role },
  });

  revalidatePath('/team');

  if (!result.delivered) {
    return ok(
      `Invitation created. Email delivery is not configured, so send them this link yourself: ${inviteUrl}`,
      { inviteUrl }
    );
  }
  return ok(`Invitation sent to ${parsed.data.email}.`, { inviteUrl });
}

export async function changeRoleAction(formData: FormData): Promise<void> {
  const session = await requireCapability('team.manage');
  const id = String(formData.get('id') ?? '');
  const role = String(formData.get('role') ?? '') as TeamRole;
  if (!id || !assignableRoles(session.role).includes(role)) return;

  const supabase = await createClient();

  // Never let the last owner be demoted — the business would be unmanageable.
  const { data: member } = await supabase
    .from('team_members')
    .select('role, full_name, email')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .maybeSingle();

  if (member?.role === 'owner' && role !== 'owner') {
    const { count } = await supabase
      .from('team_members')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', session.business.id)
      .eq('role', 'owner')
      .is('deleted_at', null);
    if ((count ?? 0) <= 1) return;
  }

  await supabase
    .from('team_members')
    .update({ role })
    .eq('id', id)
    .eq('business_id', session.business.id);

  await audit(session.business.id, {
    action: 'team.role_change',
    entityType: 'team_member',
    entityId: id,
    detail: { from: member?.role, to: role },
  });

  revalidatePath('/team');
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const session = await requireCapability('team.manage');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const supabase = await createClient();
  const { data: member } = await supabase
    .from('team_members')
    .select('role, user_id, full_name, email')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .maybeSingle();

  if (!member) return;
  // You cannot remove yourself, and you cannot remove the last owner.
  if (member.user_id === session.userId) return;
  if (member.role === 'owner') {
    const { count } = await supabase
      .from('team_members')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', session.business.id)
      .eq('role', 'owner')
      .is('deleted_at', null);
    if ((count ?? 0) <= 1) return;
  }

  await supabase
    .from('team_members')
    .update({ deleted_at: new Date().toISOString(), invite_token: null })
    .eq('id', id)
    .eq('business_id', session.business.id);

  await recordActivity(session, {
    verb: 'removed',
    summary: `${member.full_name ?? member.email} removed from the team`,
    entityType: 'team_member',
    entityId: id,
  });
  await audit(session.business.id, {
    action: 'team.remove',
    entityType: 'team_member',
    entityId: id,
  });

  revalidatePath('/team');
}

/** Redeem an invitation. Runs as a definer function; see migration 0002. */
export async function acceptInviteAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  if (!token) redirect('/login');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);

  const { data: businessId, error } = await supabase.rpc('accept_team_invite', { p_token: token });

  if (error || !businessId) {
    redirect(`/invite/${token}?error=${encodeURIComponent(error?.message ?? 'failed')}`);
  }

  await audit(businessId, {
    action: 'team.invite_accepted',
    detail: { userId: user.id },
  });

  redirect('/dashboard');
}
