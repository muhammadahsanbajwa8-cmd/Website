'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Avatar, Icon, cn, icons } from '@/components/ui';
import { ThemeToggle } from '@/components/ui/client';
import { formatRelative } from '@/lib/format';

/**
 * The customer's shell.
 *
 * Deliberately not the staff one. A customer has eight places to go, not
 * forty, and none of them is called an "entity" or a "record": the words on
 * these tabs are the words they would use on the phone — bookings, reports,
 * payments. On a phone the five they reach for most sit in a thumb-height bar
 * along the bottom; the rest are behind Menu.
 */

export interface PortalNavItem {
  href: string;
  label: string;
  icon: string;
  /** A small count on the tab — unread messages, invoices due. */
  badge?: number;
}

export interface PortalNotification {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  severity: 'info' | 'success' | 'warning' | 'danger';
  created_at: string;
  read_at: string | null;
}

export interface PortalShellProps {
  items: PortalNavItem[];
  /** Which of the tabs get a place in the phone's bottom bar. */
  mobileHrefs: string[];
  businessName: string;
  businesses: { linkId: string; name: string }[];
  activeLinkId: string;
  userName: string;
  userEmail: string;
  notifications: PortalNotification[];
  unreadCount: number;
  switchBusiness: (formData: FormData) => Promise<void>;
  markNotificationsRead: () => Promise<void>;
  signOut: () => Promise<void>;
  children: React.ReactNode;
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/portal') return pathname === '/portal';
  return pathname === href || pathname.startsWith(`${href}/`);
}

const SEVERITY_DOT: Record<string, string> = {
  info: 'bg-[var(--info)]',
  success: 'bg-[var(--ok)]',
  warning: 'bg-[var(--warn)]',
  danger: 'bg-[var(--bad)]',
};

export function PortalShell(props: PortalShellProps) {
  const pathname = usePathname();
  const [menu, setMenu] = useState<'none' | 'account' | 'bell' | 'business' | 'more'>('none');
  const close = () => setMenu('none');

  const primary = props.items.filter((item) => props.mobileHrefs.includes(item.href));
  const secondary = props.items.filter((item) => !props.mobileHrefs.includes(item.href));

  return (
    <div className="min-h-screen bg-[var(--surface-page)]">
      <header className="sticky top-0 z-20 border-b border-[var(--line-subtle)] bg-[var(--surface-page)]/90 backdrop-blur-md no-print">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/portal" className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.6rem] bg-[var(--accent)] text-[var(--accent-on)]">
              <Icon path={icons.building} size={17} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-[var(--text-strong)]">
                {props.businessName}
              </span>
              <span className="block text-xs text-[var(--text-muted)]">Your account</span>
            </span>
          </Link>

          {props.businesses.length > 1 ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenu(menu === 'business' ? 'none' : 'business')}
                aria-expanded={menu === 'business'}
                aria-label="Switch business"
                className="flex h-9 w-9 items-center justify-center rounded-[0.625rem] text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-strong)]"
              >
                <Icon path={icons.chevronDown} size={16} />
              </button>
              {menu === 'business' ? (
                <Dropdown onClose={close} align="left" width="w-72">
                  <div className="px-3.5 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    You are a customer of
                  </div>
                  {props.businesses.map((business) => (
                    <form key={business.linkId} action={props.switchBusiness}>
                      <input type="hidden" name="linkId" value={business.linkId} />
                      <button
                        type="submit"
                        className={cn(
                          'w-full truncate px-3.5 py-2.5 text-left text-sm hover:bg-[var(--surface-sunken)]',
                          business.linkId === props.activeLinkId
                            ? 'font-medium text-[var(--accent)]'
                            : 'text-[var(--text-default)]'
                        )}
                      >
                        {business.name}
                      </button>
                    </form>
                  ))}
                </Dropdown>
              ) : null}
            </div>
          ) : null}

          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setMenu(menu === 'bell' ? 'none' : 'bell');
                  if (menu !== 'bell' && props.unreadCount > 0) void props.markNotificationsRead();
                }}
                aria-expanded={menu === 'bell'}
                aria-label={
                  props.unreadCount > 0
                    ? `Notifications, ${props.unreadCount} unread`
                    : 'Notifications'
                }
                className="relative flex h-10 w-10 items-center justify-center rounded-[0.625rem] text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-strong)]"
              >
                <Icon path={icons.bell} size={18} />
                {props.unreadCount > 0 ? (
                  <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--bad)] px-1 text-[0.6rem] font-semibold text-white">
                    {props.unreadCount > 9 ? '9+' : props.unreadCount}
                  </span>
                ) : null}
              </button>

              {menu === 'bell' ? (
                <Dropdown onClose={close} align="right" width="w-80 sm:w-96">
                  <div className="px-3.5 py-2.5 text-sm font-semibold text-[var(--text-strong)]">
                    Notifications
                  </div>
                  {props.notifications.length === 0 ? (
                    <p className="px-3.5 pb-4 text-sm text-[var(--text-muted)]">
                      Nothing yet. When a report is sent, a visit is booked or a payment goes
                      through, you will hear about it here.
                    </p>
                  ) : (
                    <ul className="max-h-96 overflow-y-auto border-t border-[var(--line-subtle)]">
                      {props.notifications.map((notification) => {
                        const body = (
                          <div className="flex gap-3 px-3.5 py-3">
                            <span
                              aria-hidden
                              className={cn(
                                'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                                SEVERITY_DOT[notification.severity] ?? SEVERITY_DOT.info
                              )}
                            />
                            <div className="min-w-0">
                              <div
                                className={cn(
                                  'text-sm',
                                  notification.read_at
                                    ? 'text-[var(--text-default)]'
                                    : 'font-medium text-[var(--text-strong)]'
                                )}
                              >
                                {notification.title}
                              </div>
                              {notification.body ? (
                                <div className="mt-0.5 line-clamp-2 text-xs text-[var(--text-muted)]">
                                  {notification.body}
                                </div>
                              ) : null}
                              <div className="mt-1 text-xs text-[var(--text-muted)]">
                                {formatRelative(notification.created_at)}
                              </div>
                            </div>
                          </div>
                        );
                        return (
                          <li
                            key={notification.id}
                            className="border-b border-[var(--line-subtle)] last:border-b-0"
                          >
                            {notification.link ? (
                              <Link
                                href={notification.link}
                                onClick={close}
                                className="block hover:bg-[var(--surface-sunken)]"
                              >
                                {body}
                              </Link>
                            ) : (
                              body
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Dropdown>
              ) : null}
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setMenu(menu === 'account' ? 'none' : 'account')}
                aria-expanded={menu === 'account'}
                aria-label="Account menu"
                className="flex items-center gap-2 rounded-[0.625rem] p-1.5 hover:bg-[var(--surface-sunken)]"
              >
                <Avatar name={props.userName} size={30} />
              </button>

              {menu === 'account' ? (
                <Dropdown onClose={close} align="right" width="w-64">
                  <div className="border-b border-[var(--line-subtle)] px-3.5 py-3">
                    <div className="truncate text-sm font-medium text-[var(--text-strong)]">
                      {props.userName}
                    </div>
                    <div className="truncate text-xs text-[var(--text-muted)]">
                      {props.userEmail}
                    </div>
                  </div>
                  <Link
                    href="/portal/account"
                    onClick={close}
                    className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-[var(--text-default)] hover:bg-[var(--surface-sunken)]"
                  >
                    <Icon path={icons.customers} size={16} className="text-[var(--text-muted)]" />
                    Your details
                  </Link>
                  <form action={props.signOut} className="border-t border-[var(--line-subtle)]">
                    <button
                      type="submit"
                      className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-[var(--text-default)] hover:bg-[var(--surface-sunken)]"
                    >
                      <Icon path={icons.logout} size={16} className="text-[var(--text-muted)]" />
                      Sign out
                    </button>
                  </form>
                </Dropdown>
              ) : null}
            </div>
          </div>
        </div>

        {/* The full set, on anything wider than a phone. */}
        <nav aria-label="Your account" className="mx-auto hidden max-w-6xl gap-1 px-4 sm:px-6 md:flex">
          {props.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(pathname, item.href) ? 'page' : undefined}
              className={cn(
                'relative flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                isActive(pathname, item.href)
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-strong)]'
              )}
            >
              <Icon path={item.icon} size={16} />
              {item.label}
              {item.badge ? (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--bad)] px-1 text-[0.6rem] font-semibold text-white">
                  {item.badge > 9 ? '9+' : item.badge}
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 md:pb-12">
        {props.children}
      </main>

      {/* The phone bar. */}
      <nav
        aria-label="Your account"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-[var(--line-subtle)] bg-[var(--surface-card)] pb-[env(safe-area-inset-bottom)] md:hidden no-print"
      >
        {primary.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(pathname, item.href) ? 'page' : undefined}
            className={cn(
              'relative flex flex-col items-center gap-0.5 py-2.5 text-[0.68rem] font-medium',
              isActive(pathname, item.href) ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
            )}
          >
            <Icon path={item.icon} size={20} />
            {item.label}
            {item.badge ? (
              <span className="absolute right-1/4 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--bad)] px-1 text-[0.6rem] font-semibold text-white">
                {item.badge > 9 ? '9+' : item.badge}
              </span>
            ) : null}
          </Link>
        ))}

        <button
          type="button"
          onClick={() => setMenu(menu === 'more' ? 'none' : 'more')}
          aria-expanded={menu === 'more'}
          className={cn(
            'flex flex-col items-center gap-0.5 py-2.5 text-[0.68rem] font-medium',
            menu === 'more' ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
          )}
        >
          <Icon path={icons.menu} size={20} />
          Menu
        </button>
      </nav>

      {menu === 'more' ? (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={close}
            className="fixed inset-0 z-30 cursor-default bg-black/30 md:hidden"
          />
          <div className="fixed inset-x-0 bottom-0 z-40 rounded-t-[1.25rem] border-t border-[var(--line-subtle)] bg-[var(--surface-raised)] pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-2 shadow-[var(--shadow-pop)] md:hidden">
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-[var(--line-strong)]" />
            {secondary.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={close}
                className="flex items-center gap-3 px-5 py-3.5 text-sm text-[var(--text-default)] hover:bg-[var(--surface-sunken)]"
              >
                <Icon path={item.icon} size={18} className="text-[var(--text-muted)]" />
                {item.label}
                {item.badge ? (
                  <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--bad)] px-1.5 text-xs font-semibold text-white">
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            ))}
            <form action={props.signOut} className="border-t border-[var(--line-subtle)]">
              <button
                type="submit"
                className="flex w-full items-center gap-3 px-5 py-3.5 text-left text-sm text-[var(--text-default)]"
              >
                <Icon path={icons.logout} size={18} className="text-[var(--text-muted)]" />
                Sign out
              </button>
            </form>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Dropdown({
  children,
  onClose,
  align,
  width,
}: {
  children: React.ReactNode;
  onClose: () => void;
  align: 'left' | 'right';
  width: string;
}) {
  return (
    <>
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 z-10 cursor-default"
      />
      <div
        className={cn(
          'absolute top-full z-20 mt-1.5 animate-scale-in overflow-hidden rounded-[0.75rem]',
          'border border-[var(--line-subtle)] bg-[var(--surface-raised)] py-1 shadow-[var(--shadow-pop)]',
          align === 'right' ? 'right-0' : 'left-0',
          width
        )}
      >
        {children}
      </div>
    </>
  );
}
