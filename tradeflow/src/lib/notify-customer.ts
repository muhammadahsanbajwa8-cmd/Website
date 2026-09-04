import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Telling the customer.
 *
 * A customer with a login has a bell of their own, and the things worth
 * ringing it for are the things that happened to them: a report written up, an
 * invoice settled, a payment that did not go through.
 *
 * It runs with the service role for one reason: the link between a customer
 * and the person who signs in for them lives in `customer_users`, and the
 * caller is sometimes a webhook with no session at all. It reads that one
 * table, scoped to the business and customer it was given, and writes nothing
 * but notification rows.
 */
export async function notifyCustomer(
  businessId: string,
  customerId: string | null,
  notification: {
    kind: string;
    title: string;
    body?: string | null;
    link?: string | null;
    severity?: 'info' | 'success' | 'warning' | 'danger';
  }
): Promise<void> {
  if (!customerId) return;

  try {
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
        kind: notification.kind,
        title: notification.title,
        body: notification.body ?? null,
        link: notification.link ?? null,
        severity: notification.severity ?? 'info',
      }))
    );
  } catch {
    // A notification that cannot be written is never the reason an invoice
    // fails to settle or a report fails to send.
  }
}
