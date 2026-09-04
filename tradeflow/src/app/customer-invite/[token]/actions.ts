'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { audit } from '@/lib/session';
import { ACTIVE_PORTAL_COOKIE } from '@/lib/customer-session';

/**
 * Claiming a customer invitation.
 *
 * The token is checked inside `accept_customer_invite()`, which refuses one
 * that has already been claimed by somebody else and clears it once used —
 * so a link that leaks after the fact opens nothing.
 */
export async function acceptCustomerInviteAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  if (!token) redirect('/login');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/customer-invite/${token}`)}`);

  const { data: customerId, error } = await supabase.rpc('accept_customer_invite', {
    p_token: token,
  });

  if (error || !customerId) {
    const reason =
      error?.message === 'invitation already used'
        ? 'That invitation has already been used by another account.'
        : (error?.message ?? 'That invitation could not be opened.');
    redirect(`/customer-invite/${token}?error=${encodeURIComponent(reason)}`);
  }

  // Land them on the account they just accepted, not whichever came first.
  const { data: links } = await supabase
    .from('customer_users')
    .select('id')
    .eq('customer_id', customerId)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .limit(1);

  if (links?.[0]) {
    const store = await cookies();
    store.set(ACTIVE_PORTAL_COOKIE, links[0].id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  await audit(null, {
    action: 'customer.invite_accepted',
    entityType: 'customer',
    entityId: customerId,
    detail: { userId: user.id },
  });

  redirect('/portal');
}
