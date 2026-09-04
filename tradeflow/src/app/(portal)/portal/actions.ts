'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { ACTIVE_PORTAL_COOKIE, requireCustomer, getPortalLinks } from '@/lib/customer-session';
import { audit } from '@/lib/session';
import { describeError, fail, ok, type ActionState } from '@/lib/action-state';

/**
 * Everything a customer can do.
 *
 * Short list, on purpose. Ask for work, send a message, correct their own
 * details, open one of their documents. Each one goes through a definer
 * function that starts from `auth.uid()`, so an id typed into a form belonging
 * to somebody else is refused by the database rather than by this file.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Look at a different business's account. */
export async function switchPortalAction(formData: FormData): Promise<void> {
  const linkId = String(formData.get('linkId') ?? '');
  const links = await getPortalLinks();
  if (!links.some((link) => link.linkId === linkId)) return;

  const store = await cookies();
  store.set(ACTIVE_PORTAL_COOKIE, linkId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect('/portal');
}

export async function markPortalNotificationsReadAction(): Promise<void> {
  const session = await requireCustomer();
  const supabase = await createClient();
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', session.userId)
    .is('read_at', null);
  revalidatePath('/portal', 'layout');
}

// --- asking for work --------------------------------------------------------

export async function createRequestAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCustomer();

  const description = String(formData.get('description') ?? '').trim();
  const serviceId = String(formData.get('serviceId') ?? '').trim();
  const preferredDate = String(formData.get('preferredDate') ?? '').trim();
  const preferredWindow = String(formData.get('preferredWindow') ?? '').trim();
  const siteAddress = String(formData.get('siteAddress') ?? '').trim();

  if (description.length < 5) {
    return fail('Tell us a little about the work — a sentence is plenty.', {
      description: ['Please describe what you need done.'],
    });
  }

  if (preferredDate && Number.isNaN(Date.parse(preferredDate))) {
    return fail('That date did not make sense.', { preferredDate: ['Pick a date from the calendar.'] });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('portal_create_request', {
    p_business: session.link.businessId,
    p_customer: session.link.customerId,
    p_service: serviceId || null,
    p_description: description,
    p_preferred_date: preferredDate || null,
    p_preferred_window: preferredWindow || null,
    p_site_address: siteAddress || null,
  });

  if (error) return fail(describeError(error));

  await audit(session.link.businessId, {
    action: 'portal.request.create',
    entityType: 'lead',
    entityId: (data as unknown as string) ?? null,
    detail: { customerId: session.link.customerId },
  });

  revalidatePath('/portal/bookings');
  revalidatePath('/portal');
  return ok(
    `Thanks — ${session.link.businessName} has your request and will be in touch. You can follow it under Bookings.`
  );
}

// --- talking ----------------------------------------------------------------

export async function sendMessageAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCustomer();
  const body = String(formData.get('body') ?? '').trim();
  const jobId = String(formData.get('jobId') ?? '').trim();

  if (!body) return fail('Write a message first.', { body: ['Say something to send.'] });
  if (body.length > 5000) {
    return fail('That message is too long — 5000 characters is the limit.', {
      body: ['Shorten it a little.'],
    });
  }

  const supabase = await createClient();
  const { error } = await supabase.from('messages').insert({
    business_id: session.link.businessId,
    customer_id: session.link.customerId,
    job_id: jobId || null,
    sender: 'customer',
    author_id: session.userId,
    author_label: session.profile?.full_name ?? session.link.customerName,
    body,
  });

  if (error) return fail(describeError(error));

  await notifyBusinessOfMessage(session.link.businessId, session.link.customerName, body);

  revalidatePath('/portal/messages');
  return ok('Sent. Replies appear here and in your notifications.');
}

/**
 * A message needs to reach the people who can answer it.
 *
 * The customer's own client cannot read `team_members`, so this runs with the
 * service role — the one place in the portal that does. It writes
 * notifications and nothing else, and only for the business the customer is
 * already talking to.
 */
async function notifyBusinessOfMessage(
  businessId: string,
  customerName: string,
  body: string
): Promise<void> {
  const { createAdminClient } = await import('@/lib/supabase/admin');
  const admin = createAdminClient();
  const { data: staff } = await admin
    .from('team_members')
    .select('user_id')
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .not('user_id', 'is', null)
    .in('role', ['owner', 'admin', 'manager']);

  if (!staff?.length) return;

  await admin.from('notifications').insert(
    staff.map((member) => ({
      business_id: businessId,
      user_id: member.user_id,
      kind: 'message.customer',
      title: `Message from ${customerName}`,
      body: body.slice(0, 160),
      link: '/messages',
      severity: 'info' as const,
    }))
  );
}

// --- their own details ------------------------------------------------------

export async function updateMyDetailsAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCustomer();

  const email = String(formData.get('email') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();

  if (email && !EMAIL_PATTERN.test(email)) {
    return fail('That email address does not look right.', {
      email: ['Check for a typo — it needs an @ and a domain.'],
    });
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('portal_update_customer', {
    p_customer: session.link.customerId,
    p_email: email || null,
    p_phone: phone || null,
    p_address_line1: String(formData.get('addressLine1') ?? '').trim() || null,
    p_address_line2: String(formData.get('addressLine2') ?? '').trim() || null,
    p_suburb: String(formData.get('suburb') ?? '').trim() || null,
    p_state: String(formData.get('state') ?? '').trim() || null,
    p_postcode: String(formData.get('postcode') ?? '').trim() || null,
  });

  if (error) return fail(describeError(error));

  // The name on the login is the customer's own, and separate from the record
  // the business keeps.
  const fullName = String(formData.get('fullName') ?? '').trim();
  if (fullName) {
    await supabase.from('profiles').update({ full_name: fullName }).eq('id', session.userId);
  }

  revalidatePath('/portal/account');
  revalidatePath('/portal', 'layout');
  return ok('Saved. Your details are up to date.');
}

// --- opening a document -----------------------------------------------------

/**
 * Hand the customer to the page a document already has.
 *
 * The token is minted by the database after checking the document is theirs,
 * so this action cannot be used to open anything else — an id that is not
 * theirs comes back null and lands on the portal.
 */
export async function openDocumentAction(formData: FormData): Promise<void> {
  await requireCustomer();
  const kind = String(formData.get('kind') ?? '');
  const id = String(formData.get('id') ?? '');
  if (!['invoice', 'quote', 'report'].includes(kind)) redirect('/portal');

  const supabase = await createClient();
  const { data } = await supabase.rpc('portal_document_token', { p_kind: kind, p_id: id });
  const token = (data as unknown as string | null) ?? null;

  if (!token) {
    redirect(kind === 'report' ? '/portal/reports?error=missing' : '/portal/documents?error=missing');
  }
  redirect(kind === 'invoice' ? `/i/${token}` : kind === 'quote' ? `/q/${token}` : `/r/${token}`);
}
