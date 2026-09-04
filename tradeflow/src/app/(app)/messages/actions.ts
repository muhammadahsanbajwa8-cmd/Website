'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { audit, recordActivity, requireCapability } from '@/lib/session';
import { describeError, fail, ok, type ActionState } from '@/lib/action-state';

/**
 * Replying to a customer.
 *
 * The reply is written as the signed-in staff member — the policy insists the
 * sender is `business` and that they are a member of it — and the customer is
 * notified so the answer does not sit unread in a portal nobody opened.
 */
export async function replyToCustomerAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('customers.view');
  const customerId = String(formData.get('customerId') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();

  if (!customerId) return fail('That conversation was not found.');
  if (!body) return fail('Write a reply first.', { body: ['Say something to send.'] });
  if (body.length > 5000) {
    return fail('That reply is too long — 5000 characters is the limit.', {
      body: ['Shorten it a little.'],
    });
  }

  const supabase = await createClient();
  const { error } = await supabase.from('messages').insert({
    business_id: session.business.id,
    customer_id: customerId,
    sender: 'business',
    author_id: session.userId,
    author_label: session.profile?.full_name ?? session.business.name,
    body,
    read_by_business_at: new Date().toISOString(),
  });

  if (error) return fail(describeError(error));

  // Anything the customer sent is answered now, so it stops being unread.
  await supabase
    .from('messages')
    .update({ read_by_business_at: new Date().toISOString() })
    .eq('business_id', session.business.id)
    .eq('customer_id', customerId)
    .eq('sender', 'customer')
    .is('read_by_business_at', null);

  await notifyCustomer(session.business.id, customerId, session.business.name, body);

  await recordActivity(session, {
    verb: 'replied',
    summary: 'Replied to the customer in their account',
    entityType: 'customer',
    entityId: customerId,
    customerId,
  });
  await audit(session.business.id, {
    action: 'message.reply',
    entityType: 'customer',
    entityId: customerId,
  });

  revalidatePath(`/messages/${customerId}`);
  revalidatePath('/messages');
  return ok('Sent. It is in their account now.');
}

/**
 * Tell the customer they have a reply.
 *
 * `customer_users` holds the user ids of people who can sign in for this
 * customer, and staff cannot read the auth user behind them — so this one
 * write goes through the service role, scoped to this customer at this
 * business and writing nothing but the notification.
 */
async function notifyCustomer(
  businessId: string,
  customerId: string,
  businessName: string,
  body: string
): Promise<void> {
  const admin = createAdminClient();
  const { data: links } = await admin
    .from('customer_users')
    .select('user_id')
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .is('deleted_at', null)
    .not('user_id', 'is', null);

  if (!links?.length) return;

  await admin.from('notifications').insert(
    links.map((link) => ({
      business_id: businessId,
      user_id: link.user_id,
      kind: 'message.business',
      title: `${businessName} replied`,
      body: body.slice(0, 160),
      link: '/portal/messages',
      severity: 'info' as const,
    }))
  );
}

/** Opening a thread is reading it. */
export async function markThreadReadAction(customerId: string): Promise<void> {
  const session = await requireCapability('customers.view');
  const supabase = await createClient();
  await supabase
    .from('messages')
    .update({ read_by_business_at: new Date().toISOString() })
    .eq('business_id', session.business.id)
    .eq('customer_id', customerId)
    .eq('sender', 'customer')
    .is('read_by_business_at', null);
}
