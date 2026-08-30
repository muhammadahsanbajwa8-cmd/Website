/**
 * Role capabilities.
 *
 * This module decides what the interface offers. It is NOT what enforces
 * access — row level security in migration 0003 is, and it is written from the
 * same table. Hiding a button is a courtesy; the database is the boundary.
 *
 * tests/permissions.test.ts checks this table against the policies in the SQL
 * so the two cannot drift apart unnoticed.
 */

export type TeamRole = 'owner' | 'admin' | 'manager' | 'worker' | 'accountant';

export const TEAM_ROLES: { value: TeamRole; label: string; blurb: string }[] = [
  { value: 'owner', label: 'Owner', blurb: 'Everything, including billing and deleting the business.' },
  { value: 'admin', label: 'Admin', blurb: 'Everything except transferring ownership.' },
  { value: 'manager', label: 'Manager', blurb: 'Runs jobs, quotes and invoices. Cannot manage the team or settings.' },
  { value: 'worker', label: 'Worker', blurb: 'Jobs, reports, photos, timesheets and receipts. Sees no pricing.' },
  { value: 'accountant', label: 'Accountant', blurb: 'Invoices, payments and expenses. Read-only on the field work.' },
];

export type Capability =
  | 'business.view'
  | 'business.edit'
  | 'business.delete'
  | 'team.view'
  | 'team.manage'
  | 'customers.view'
  | 'customers.edit'
  | 'customers.delete'
  | 'leads.view'
  | 'leads.edit'
  | 'jobs.view'
  | 'jobs.edit'
  | 'jobs.delete'
  | 'tasks.view'
  | 'tasks.edit'
  | 'worklogs.view'
  | 'worklogs.edit'
  | 'photos.view'
  | 'photos.edit'
  | 'reports.view'
  | 'reports.edit'
  | 'documents.view'
  | 'documents.edit'
  | 'estimates.view'
  | 'estimates.edit'
  | 'quotes.view'
  | 'quotes.edit'
  | 'quotes.send'
  | 'invoices.view'
  | 'invoices.edit'
  | 'invoices.send'
  | 'payments.view'
  | 'payments.edit'
  | 'expenses.viewAll'
  | 'expenses.create'
  | 'expenses.edit'
  | 'materials.view'
  | 'materials.edit'
  | 'suppliers.view'
  | 'suppliers.edit'
  | 'emails.view'
  | 'emails.send'
  | 'ai.use'
  | 'audit.view'
  | 'dashboard.financials';

const ALL: Capability[] = [
  'business.view', 'business.edit', 'business.delete',
  'team.view', 'team.manage',
  'customers.view', 'customers.edit', 'customers.delete',
  'leads.view', 'leads.edit',
  'jobs.view', 'jobs.edit', 'jobs.delete',
  'tasks.view', 'tasks.edit',
  'worklogs.view', 'worklogs.edit',
  'photos.view', 'photos.edit',
  'reports.view', 'reports.edit',
  'documents.view', 'documents.edit',
  'estimates.view', 'estimates.edit',
  'quotes.view', 'quotes.edit', 'quotes.send',
  'invoices.view', 'invoices.edit', 'invoices.send',
  'payments.view', 'payments.edit',
  'expenses.viewAll', 'expenses.create', 'expenses.edit',
  'materials.view', 'materials.edit',
  'suppliers.view', 'suppliers.edit',
  'emails.view', 'emails.send',
  'ai.use', 'audit.view', 'dashboard.financials',
];

const CAPABILITIES: Record<TeamRole, Capability[]> = {
  owner: ALL,

  admin: ALL.filter((c) => c !== 'business.delete'),

  // Runs the work and the money on it, but not the company: no team changes,
  // no business settings, no audit log.
  manager: ALL.filter(
    (c) =>
      !['business.edit', 'business.delete', 'team.manage', 'audit.view'].includes(c)
  ),

  // On the tools. Everything needed to record a day's work, and no pricing at
  // all: matching the financial-table policies, which exclude this role.
  worker: [
    'business.view',
    'team.view',
    'customers.view',
    'jobs.view', 'jobs.edit',
    'tasks.view', 'tasks.edit',
    'worklogs.view', 'worklogs.edit',
    'photos.view', 'photos.edit',
    'reports.view', 'reports.edit',
    'documents.view', 'documents.edit',
    'expenses.create',
    'materials.view',
    'emails.view',
    'ai.use',
  ],

  // The books. Sees the field work to code it correctly, changes none of it.
  accountant: [
    'business.view',
    'team.view',
    'customers.view',
    'leads.view',
    'jobs.view',
    'tasks.view',
    'worklogs.view',
    'photos.view',
    'reports.view',
    'documents.view', 'documents.edit',
    'estimates.view',
    'quotes.view',
    'invoices.view', 'invoices.edit', 'invoices.send',
    'payments.view', 'payments.edit',
    'expenses.viewAll', 'expenses.create', 'expenses.edit',
    'materials.view',
    'suppliers.view', 'suppliers.edit',
    'emails.view', 'emails.send',
    'ai.use',
    'dashboard.financials',
  ],
};

export function can(role: TeamRole | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return CAPABILITIES[role]?.includes(capability) ?? false;
}

export function capabilitiesFor(role: TeamRole): readonly Capability[] {
  return CAPABILITIES[role] ?? [];
}

/** Roles that may read priced records — the same set as `app_finance()` in SQL. */
export const FINANCE_ROLES: TeamRole[] = ['owner', 'admin', 'manager', 'accountant'];
/** Same set as `app_managers()`. */
export const MANAGER_ROLES: TeamRole[] = ['owner', 'admin', 'manager'];
/** Same set as `app_admins()`. */
export const ADMIN_ROLES: TeamRole[] = ['owner', 'admin'];

export function roleLabel(role: TeamRole | null | undefined): string {
  return TEAM_ROLES.find((r) => r.value === role)?.label ?? 'Unknown';
}

/** An admin may assign any role below their own; only an owner makes an owner. */
export function assignableRoles(actor: TeamRole | null | undefined): TeamRole[] {
  if (actor === 'owner') return ['owner', 'admin', 'manager', 'worker', 'accountant'];
  if (actor === 'admin') return ['admin', 'manager', 'worker', 'accountant'];
  return [];
}
