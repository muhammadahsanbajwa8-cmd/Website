'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Avatar, Icon, badgeTone, cn, icons } from '@/components/ui';
import { ThemeToggle } from '@/components/ui/client';
import { formatRelative } from '@/lib/format';
import { Logo } from '@/components/marketing';

export interface TopbarNotification {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  severity: 'info' | 'success' | 'warning' | 'danger';
  created_at: string;
  read_at: string | null;
}

export interface TopbarProps {
  businessName: string;
  businesses: { id: string; name: string; role: string }[];
  activeBusinessId: string;
  userName: string;
  userEmail: string;
  roleLabel: string;
  notifications: TopbarNotification[];
  unreadCount: number;
  switchBusiness: (formData: FormData) => Promise<void>;
  markNotificationsRead: () => Promise<void>;
  signOut: () => Promise<void>;
}

export function Topbar(props: TopbarProps) {
  const [menu, setMenu] = useState<'none' | 'account' | 'bell' | 'business'>('none');
  const close = () => setMenu('none');

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-[var(--line-subtle)] bg-[var(--surface-page)]/90 px-4 backdrop-blur-md sm:px-6 lg:pl-6 no-print">
      <Link href="/dashboard" className="lg:hidden" aria-label="TradeFlow dashboard">
        <Logo size="sm" />
      </Link>

      {/* Business switcher, only worth showing to someone in more than one. */}
      <div className="relative ml-auto lg:ml-0 lg:mr-auto">
        {props.businesses.length > 1 ? (
          <>
            <button
              type="button"
              onClick={() => setMenu(menu === 'business' ? 'none' : 'business')}
              aria-expanded={menu === 'business'}
              className="hidden max-w-[16rem] items-center gap-2 rounded-[0.625rem] px-3 py-2 text-sm font-medium text-[var(--text-strong)] hover:bg-[var(--surface-sunken)] lg:flex"
            >
              <Icon path={icons.building} size={16} className="shrink-0 text-[var(--text-muted)]" />
              <span className="truncate">{props.businessName}</span>
              <Icon path={icons.chevronDown} size={14} className="shrink-0 text-[var(--text-muted)]" />
            </button>

            {menu === 'business' ? (
              <Dropdown onClose={close} align="left" width="w-72">
                <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  Your businesses
                </div>
                {props.businesses.map((business) => (
                  <form key={business.id} action={props.switchBusiness}>
                    <input type="hidden" name="businessId" value={business.id} />
                    <button
                      type="submit"
                      className={cn(
                        'flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-sm hover:bg-[var(--surface-sunken)]',
                        business.id === props.activeBusinessId
                          ? 'font-medium text-[var(--accent)]'
                          : 'text-[var(--text-default)]'
                      )}
                    >
                      <span className="min-w-0 truncate">{business.name}</span>
                      <span className="shrink-0 text-xs text-[var(--text-muted)]">
                        {business.role}
                      </span>
                    </button>
                  </form>
                ))}
                <div className="mt-1 border-t border-[var(--line-subtle)] pt-1">
                  <Link
                    href="/onboarding"
                    onClick={close}
                    className="flex items-center gap-2 px-3.5 py-2.5 text-sm text-[var(--text-default)] hover:bg-[var(--surface-sunken)]"
                  >
                    <Icon path={icons.plus} size={15} />
                    Add another business
                  </Link>
                </div>
              </Dropdown>
            ) : null}
          </>
        ) : (
          <span className="hidden truncate text-sm font-medium text-[var(--text-strong)] lg:block">
            {props.businessName}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <ThemeToggle />

        {/* Notifications */}
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
              <div className="flex items-center justify-between px-3.5 py-2.5">
                <span className="text-sm font-semibold text-[var(--text-strong)]">
                  Notifications
                </span>
                {props.notifications.length > 0 ? (
                  <span className="text-xs text-[var(--text-muted)]">
                    {props.unreadCount} unread
                  </span>
                ) : null}
              </div>

              {props.notifications.length === 0 ? (
                <p className="px-3.5 pb-4 pt-1 text-sm text-[var(--text-muted)]">
                  Nothing yet. Accepted quotes, overdue invoices and tasks falling due will
                  show up here.
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
                            badgeTone(notification.severity)
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

        {/* Account */}
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
                <div className="truncate text-xs text-[var(--text-muted)]">{props.userEmail}</div>
                <div className="mt-1.5 inline-flex rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
                  {props.roleLabel} · {props.businessName}
                </div>
              </div>

              <Link
                href="/settings/profile"
                onClick={close}
                className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-[var(--text-default)] hover:bg-[var(--surface-sunken)]"
              >
                <Icon path={icons.customers} size={16} className="text-[var(--text-muted)]" />
                Your profile
              </Link>
              <Link
                href="/settings"
                onClick={close}
                className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-[var(--text-default)] hover:bg-[var(--surface-sunken)]"
              >
                <Icon path={icons.settings} size={16} className="text-[var(--text-muted)]" />
                Business settings
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
    </header>
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
