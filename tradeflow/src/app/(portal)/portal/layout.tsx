import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getCustomerSession } from '@/lib/customer-session';
import { createClient } from '@/lib/supabase/server';
import { signOutAction } from '@/app/(auth)/actions';
import { PortalShell, type PortalNotification } from '@/components/portal/shell';
import { icons } from '@/components/ui';
import { switchPortalAction, markPortalNotificationsReadAction } from './actions';

export const metadata = {
  title: { default: 'Your account', template: '%s · Your account' },
  robots: { index: false },
};

/**
 * The portal shell.
 *
 * A signed-in customer, one business at a time. Someone who is staff and not a
 * customer is sent to the application; someone who is neither is sent to sign
 * in. The counts on the tabs are read here so every page below can be a plain
 * server component with one query of its own.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const portal = await getCustomerSession();
  if (!portal) {
    // Staff who wandered in; otherwise a signed-in user with no account here.
    redirect(session.memberships.length > 0 ? '/dashboard' : '/onboarding?new=1');
  }

  const supabase = await createClient();

  const [{ data: notifications }, { count: unreadMessages }, { data: dueInvoices }] =
    await Promise.all([
      supabase
        .from('notifications')
        .select('id, title, body, link, severity, created_at, read_at')
        .eq('user_id', session.userId)
        .eq('business_id', portal.link.businessId)
        .order('created_at', { ascending: false })
        .limit(15),
      supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', portal.link.businessId)
        .eq('customer_id', portal.link.customerId)
        .eq('sender', 'business')
        .is('read_by_customer_at', null)
        .is('deleted_at', null),
      supabase
        .from('invoices')
        .select('id')
        .eq('business_id', portal.link.businessId)
        .eq('customer_id', portal.link.customerId)
        .is('deleted_at', null)
        .in('status', ['sent', 'viewed', 'partially_paid', 'overdue']),
    ]);

  const list = (notifications ?? []) as PortalNotification[];
  const unreadCount = list.filter((n) => !n.read_at).length;

  const items = [
    { href: '/portal', label: 'Home', icon: icons.dashboard },
    { href: '/portal/bookings', label: 'Bookings', icon: icons.calendar },
    { href: '/portal/services', label: 'Services', icon: icons.jobs },
    { href: '/portal/reports', label: 'Reports', icon: icons.reports },
    { href: '/portal/documents', label: 'Documents', icon: icons.documents },
    {
      href: '/portal/payments',
      label: 'Payments',
      icon: icons.money,
      badge: dueInvoices?.length ?? 0,
    },
    {
      href: '/portal/messages',
      label: 'Messages',
      icon: icons.emails,
      badge: unreadMessages ?? 0,
    },
    { href: '/portal/account', label: 'Account', icon: icons.settings },
  ];

  return (
    <PortalShell
      items={items}
      mobileHrefs={['/portal', '/portal/bookings', '/portal/reports', '/portal/payments']}
      businessName={portal.link.businessName}
      businesses={portal.links.map((link) => ({ linkId: link.linkId, name: link.businessName }))}
      activeLinkId={portal.link.linkId}
      userName={session.profile?.full_name ?? portal.link.customerName}
      userEmail={session.email}
      notifications={list}
      unreadCount={unreadCount}
      switchBusiness={switchPortalAction}
      markNotificationsRead={markPortalNotificationsReadAction}
      signOut={signOutAction}
    >
      {children}
    </PortalShell>
  );
}
