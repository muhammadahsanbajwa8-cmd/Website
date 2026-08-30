import { icons } from '@/components/ui';
import type { Capability } from '@/lib/permissions';

/**
 * The navigation, declared once.
 *
 * Each entry names the capability that reveals it, so a worker's sidebar has
 * no Invoices link and an accountant's has no Team link — without either page
 * having to think about it.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  capability: Capability;
  /** Shown in the phone's bottom bar rather than behind "More". */
  primaryMobile?: boolean;
}

export const NAV_GROUPS: { heading: string; items: NavItem[] }[] = [
  {
    heading: 'Work',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: icons.dashboard, capability: 'business.view', primaryMobile: true },
      { href: '/jobs', label: 'Jobs', icon: icons.jobs, capability: 'jobs.view', primaryMobile: true },
      { href: '/tasks', label: 'Tasks', icon: icons.tasks, capability: 'tasks.view', primaryMobile: true },
      { href: '/reports', label: 'Reports', icon: icons.reports, capability: 'reports.view' },
      { href: '/timesheets', label: 'Timesheets', icon: icons.clock, capability: 'worklogs.view' },
    ],
  },
  {
    heading: 'Customers',
    items: [
      { href: '/customers', label: 'Customers', icon: icons.customers, capability: 'customers.view' },
      { href: '/leads', label: 'Leads', icon: icons.leads, capability: 'leads.view' },
      { href: '/emails', label: 'Emails', icon: icons.emails, capability: 'emails.view' },
    ],
  },
  {
    heading: 'Money',
    items: [
      { href: '/estimates', label: 'Estimates', icon: icons.estimates, capability: 'estimates.view' },
      { href: '/quotes', label: 'Quotes', icon: icons.quotes, capability: 'quotes.view' },
      { href: '/invoices', label: 'Invoices', icon: icons.invoices, capability: 'invoices.view' },
      { href: '/expenses', label: 'Expenses', icon: icons.expenses, capability: 'expenses.create' },
      { href: '/materials', label: 'Materials', icon: icons.materials, capability: 'materials.view' },
    ],
  },
  {
    heading: 'Business',
    items: [
      { href: '/documents', label: 'Documents', icon: icons.documents, capability: 'documents.view' },
      { href: '/assistant', label: 'Assistant', icon: icons.ai, capability: 'ai.use' },
      { href: '/team', label: 'Team', icon: icons.team, capability: 'team.view' },
      { href: '/settings', label: 'Settings', icon: icons.settings, capability: 'business.view' },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** Quick-create targets offered by the "New" button and the mobile plus. */
export const QUICK_ACTIONS: { href: string; label: string; icon: string; capability: Capability }[] = [
  { href: '/jobs/new', label: 'New job', icon: icons.jobs, capability: 'jobs.edit' },
  { href: '/quotes/new', label: 'New quote', icon: icons.quotes, capability: 'quotes.edit' },
  { href: '/invoices/new', label: 'New invoice', icon: icons.invoices, capability: 'invoices.edit' },
  { href: '/estimates/new', label: 'New estimate', icon: icons.estimates, capability: 'estimates.edit' },
  { href: '/reports/new', label: 'New report', icon: icons.reports, capability: 'reports.edit' },
  { href: '/timesheets/new', label: 'Log hours', icon: icons.clock, capability: 'worklogs.edit' },
  { href: '/expenses/new', label: 'Add expense', icon: icons.expenses, capability: 'expenses.create' },
  { href: '/customers/new', label: 'New customer', icon: icons.customers, capability: 'customers.edit' },
  { href: '/leads/new', label: 'New lead', icon: icons.leads, capability: 'leads.edit' },
  { href: '/tasks/new', label: 'New task', icon: icons.tasks, capability: 'tasks.edit' },
];

/** Is `href` the section the current path belongs to? */
export function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}
