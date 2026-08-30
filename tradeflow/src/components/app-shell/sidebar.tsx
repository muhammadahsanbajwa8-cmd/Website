'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Icon, cn, icons } from '@/components/ui';
import { Logo } from '@/components/marketing';
import { NAV_GROUPS, QUICK_ACTIONS, isActive, type NavItem } from './nav';

export interface ShellNav {
  groups: { heading: string; items: NavItem[] }[];
  quickActions: { href: string; label: string; icon: string }[];
}

/**
 * Desktop navigation. Fixed, always visible, and grouped so the four sections
 * of the business read as four sections rather than eighteen links.
 */
export function Sidebar({ nav, businessName }: { nav: ShellNav; businessName: string }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-[var(--line-subtle)] bg-[var(--surface-card)] lg:flex"
    >
      <div className="flex h-16 shrink-0 items-center border-b border-[var(--line-subtle)] px-5">
        <Link href="/dashboard" aria-label="TradeFlow dashboard">
          <Logo size="sm" />
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {nav.quickActions.length > 0 ? (
          <div className="mb-4 px-1">
            <NewMenu actions={nav.quickActions} />
          </div>
        ) : null}

        {nav.groups.map((group) => (
          <div key={group.heading} className="mb-5 last:mb-0">
            <div className="mb-1.5 px-3 text-[0.7rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              {group.heading}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-[0.625rem] px-3 py-2 text-sm font-medium transition-colors',
                        active
                          ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                          : 'text-[var(--text-default)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-strong)]'
                      )}
                    >
                      <Icon path={item.icon} size={18} className="shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-[var(--line-subtle)] px-5 py-3">
        <div className="truncate text-xs text-[var(--text-muted)]" title={businessName}>
          {businessName}
        </div>
      </div>
    </nav>
  );
}

function NewMenu({ actions }: { actions: { href: string; label: string; icon: string }[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center justify-center gap-2 rounded-[0.625rem] bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-on)] transition-colors hover:bg-[var(--accent-hover)]"
      >
        <Icon path={icons.plus} size={18} />
        New
      </button>

      {open ? (
        <>
          {/* Click-away layer, so the menu closes without a document listener. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div
            role="menu"
            className="absolute left-0 right-0 top-full z-20 mt-1 animate-scale-in overflow-hidden rounded-[0.625rem] border border-[var(--line-subtle)] bg-[var(--surface-raised)] py-1 shadow-[var(--shadow-pop)]"
          >
            {actions.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-3.5 py-2 text-sm text-[var(--text-default)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-strong)]"
              >
                <Icon path={action.icon} size={16} className="text-[var(--text-muted)]" />
                {action.label}
              </Link>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * The phone bar. Four destinations and a "More" sheet, with the plus button in
 * the middle where a thumb reaches it.
 */
export function MobileNav({ nav }: { nav: ShellNav }) {
  const pathname = usePathname();
  const [sheet, setSheet] = useState<'none' | 'more' | 'new'>('none');

  const all = nav.groups.flatMap((group) => group.items);
  // Dashboard, Jobs, [New], Tasks, More — the five things a person on site
  // reaches for. Everything else is one tap away behind More.
  const primary = all.filter((item) => item.primaryMobile).slice(0, 3);
  const rest = all.filter((item) => !primary.includes(item));

  return (
    <>
      {sheet !== 'none' ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setSheet('none')}
            className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[75vh] animate-in overflow-y-auto rounded-t-2xl border-t border-[var(--line-subtle)] bg-[var(--surface-card)] pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-2">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--line-default)]" />
            <div className="px-2 pb-2">
              {(sheet === 'new' ? nav.quickActions : rest).map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setSheet('none')}
                  className="flex items-center gap-3 rounded-[0.625rem] px-4 py-3.5 text-[0.95rem] font-medium text-[var(--text-default)] hover:bg-[var(--surface-sunken)]"
                >
                  <Icon path={item.icon} size={20} className="text-[var(--text-muted)]" />
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line-subtle)] bg-[var(--surface-card)] pb-[env(safe-area-inset-bottom)] lg:hidden no-print"
      >
        <ul className="grid grid-cols-5">
          {primary.slice(0, 2).map((item) => (
            <MobileTab key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}

          <li className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => setSheet(sheet === 'new' ? 'none' : 'new')}
              aria-label="Create something new"
              aria-expanded={sheet === 'new'}
              className="-mt-5 flex items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-on)] shadow-[var(--shadow-raised)]"
              style={{ height: '3.25rem', width: '3.25rem' }}
            >
              <Icon path={icons.plus} size={24} />
            </button>
          </li>

          {primary.slice(2, 3).map((item) => (
            <MobileTab key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}

          <li>
            <button
              type="button"
              onClick={() => setSheet(sheet === 'more' ? 'none' : 'more')}
              aria-expanded={sheet === 'more'}
              className="flex w-full flex-col items-center gap-1 py-2.5 text-[0.65rem] font-medium text-[var(--text-muted)]"
            >
              <Icon path={icons.menu} size={20} />
              More
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}

function MobileTab({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex flex-col items-center gap-1 py-2.5 text-[0.65rem] font-medium',
          active ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
        )}
      >
        <Icon path={item.icon} size={20} />
        {item.label}
      </Link>
    </li>
  );
}
