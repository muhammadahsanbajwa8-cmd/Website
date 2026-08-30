import { redirect } from 'next/navigation';
import { getSession, getBusinessSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { roleLabel } from '@/lib/permissions';
import { NAV_GROUPS, QUICK_ACTIONS } from '@/components/app-shell/nav';
import { MobileNav, Sidebar, type ShellNav } from '@/components/app-shell/sidebar';
import { Topbar, type TopbarNotification } from '@/components/app-shell/topbar';
import { switchBusinessAction } from '@/app/onboarding/actions';
import { signOutAction } from '@/app/(auth)/actions';
import { markNotificationsReadAction } from './actions';

/**
 * The application shell.
 *
 * Every page under it can assume a signed-in user who belongs to a business,
 * because this layout redirects otherwise. The navigation is filtered by role
 * here, once, rather than in each page.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.memberships.length === 0) redirect('/onboarding');

  const businessSession = await getBusinessSession();
  if (!businessSession) redirect('/onboarding');

  const supabase = await createClient();
  const { data: notifications } = await supabase
    .from('notifications')
    .select('id, title, body, link, severity, created_at, read_at')
    .eq('business_id', businessSession.business.id)
    .eq('user_id', session.userId)
    .order('created_at', { ascending: false })
    .limit(15);

  const list = (notifications ?? []) as TopbarNotification[];
  const unreadCount = list.filter((n) => !n.read_at).length;

  const nav: ShellNav = {
    groups: NAV_GROUPS.map((group) => ({
      heading: group.heading,
      items: group.items.filter((item) => businessSession.can(item.capability)),
    })).filter((group) => group.items.length > 0),
    quickActions: QUICK_ACTIONS.filter((action) => businessSession.can(action.capability)).map(
      ({ href, label, icon }) => ({ href, label, icon })
    ),
  };

  return (
    <div className="min-h-screen bg-[var(--surface-page)]">
      <Sidebar nav={nav} businessName={businessSession.business.name} />

      <div className="lg:pl-60">
        <Topbar
          businessName={businessSession.business.name}
          businesses={session.memberships.map((m) => ({
            id: m.businessId,
            name: m.businessName,
            role: roleLabel(m.role),
          }))}
          activeBusinessId={businessSession.business.id}
          userName={session.profile?.full_name ?? session.email}
          userEmail={session.email}
          roleLabel={roleLabel(businessSession.role)}
          notifications={list}
          unreadCount={unreadCount}
          switchBusiness={switchBusinessAction}
          markNotificationsRead={markNotificationsReadAction}
          signOut={signOutAction}
        />

        {/* The bottom padding clears the phone tab bar. */}
        <main id="main" className="px-4 pb-28 pt-6 sm:px-6 lg:pb-10">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>

      <MobileNav nav={nav} />
    </div>
  );
}
