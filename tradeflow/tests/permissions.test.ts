import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ADMIN_ROLES,
  FINANCE_ROLES,
  MANAGER_ROLES,
  TEAM_ROLES,
  assignableRoles,
  can,
  capabilitiesFor,
  roleLabel,
  type TeamRole,
} from '@/lib/permissions';

/**
 * The capability table and the policies must say the same thing.
 *
 * `src/lib/permissions.ts` decides what the interface offers; the policies in
 * `0003_rls.sql` decide what the database allows. If they drift, a person sees
 * a button that then fails, or — much worse — the interface hides something the
 * database would have let them do and nobody notices the policy is too loose.
 *
 * So this file reads the SQL and compares.
 */

const RLS = readFileSync(
  join(import.meta.dirname, '..', 'supabase', 'migrations', '0003_rls.sql'),
  'utf8'
);

/** The roles named in an `app_*()` role-set function. */
function roleSet(name: string): TeamRole[] {
  const match = RLS.match(new RegExp(`function ${name}\\(\\)[\\s\\S]*?array\\[([^\\]]+)\\]`, 'i'));
  if (!match) throw new Error(`${name}() not found in 0003_rls.sql`);
  return [...match[1].matchAll(/'(\w+)'/g)].map((m) => m[1] as TeamRole);
}

describe('the role sets agree with the SQL', () => {
  it('app_admins()', () => {
    expect(roleSet('app_admins')).toEqual(ADMIN_ROLES);
  });

  it('app_managers()', () => {
    expect(roleSet('app_managers')).toEqual(MANAGER_ROLES);
  });

  it('app_finance()', () => {
    expect(roleSet('app_finance')).toEqual(FINANCE_ROLES);
  });

  it('leaves the worker out of every financial set', () => {
    // The one that matters: a labourer with an app login must not be able to
    // read what the job was quoted at.
    expect(roleSet('app_finance')).not.toContain('worker');
    expect(roleSet('app_managers')).not.toContain('worker');
    expect(roleSet('app_admins')).not.toContain('worker');
  });

  it('names every role the application knows about', () => {
    const known = new Set(TEAM_ROLES.map((role) => role.value));
    for (const role of [...roleSet('app_finance'), ...roleSet('app_managers')]) {
      expect(known.has(role), `SQL names a role the app does not have: ${role}`).toBe(true);
    }
  });
});

describe('the interface hides exactly what the database refuses', () => {
  const FINANCIAL: [string, ...string[]] = [
    'estimates.view',
    'quotes.view',
    'invoices.view',
    'payments.view',
  ];

  it('offers priced work only to the roles in app_finance()', () => {
    const finance = new Set(roleSet('app_finance'));
    for (const role of TEAM_ROLES.map((r) => r.value)) {
      for (const capability of FINANCIAL) {
        const offered = can(role, capability as never);
        expect(
          offered,
          `${role} is ${offered ? 'offered' : 'denied'} ${capability}, but the policy says otherwise`
        ).toBe(finance.has(role));
      }
    }
  });

  it('offers business settings only to the roles in app_admins()', () => {
    const admins = new Set(roleSet('app_admins'));
    for (const role of TEAM_ROLES.map((r) => r.value)) {
      expect(can(role, 'business.edit'), `${role} / business.edit`).toBe(admins.has(role));
      expect(can(role, 'team.manage'), `${role} / team.manage`).toBe(admins.has(role));
      expect(can(role, 'audit.view'), `${role} / audit.view`).toBe(admins.has(role));
    }
  });

  it('lets only an owner delete the business', () => {
    expect(can('owner', 'business.delete')).toBe(true);
    expect(can('admin', 'business.delete')).toBe(false);
    expect(can('manager', 'business.delete')).toBe(false);
  });
});

describe('what each role can do', () => {
  it('gives a worker the field, and nothing priced', () => {
    for (const allowed of [
      'jobs.edit',
      'reports.edit',
      'worklogs.edit',
      'photos.edit',
      'expenses.create',
      'tasks.edit',
    ] as const) {
      expect(can('worker', allowed), `worker should have ${allowed}`).toBe(true);
    }
    for (const denied of [
      'quotes.view',
      'quotes.edit',
      'invoices.view',
      'estimates.view',
      'payments.view',
      'dashboard.financials',
      'expenses.viewAll',
      'team.manage',
      'business.edit',
      'customers.edit',
    ] as const) {
      expect(can('worker', denied), `worker should not have ${denied}`).toBe(false);
    }
  });

  it('gives an accountant the books, and read-only on the field', () => {
    for (const allowed of ['invoices.edit', 'payments.edit', 'expenses.viewAll', 'jobs.view'] as const) {
      expect(can('accountant', allowed), `accountant should have ${allowed}`).toBe(true);
    }
    for (const denied of ['jobs.edit', 'reports.edit', 'quotes.edit', 'team.manage'] as const) {
      expect(can('accountant', denied), `accountant should not have ${denied}`).toBe(false);
    }
  });

  it('gives a manager the work and the money, but not the company', () => {
    expect(can('manager', 'quotes.edit')).toBe(true);
    expect(can('manager', 'invoices.send')).toBe(true);
    expect(can('manager', 'jobs.delete')).toBe(true);
    expect(can('manager', 'team.manage')).toBe(false);
    expect(can('manager', 'business.edit')).toBe(false);
  });

  it('gives an owner everything', () => {
    const everything = capabilitiesFor('owner');
    for (const role of TEAM_ROLES.map((r) => r.value)) {
      for (const capability of capabilitiesFor(role)) {
        expect(everything, `owner is missing ${capability}`).toContain(capability);
      }
    }
  });

  it('refuses a missing role outright', () => {
    expect(can(null, 'jobs.view')).toBe(false);
    expect(can(undefined, 'business.view')).toBe(false);
  });

  it('never lets a role hand out more than it holds', () => {
    for (const actor of TEAM_ROLES.map((r) => r.value)) {
      for (const assignable of assignableRoles(actor)) {
        // An admin may make another admin, but nobody may make an owner except
        // an owner: promotion never exceeds the promoter.
        if (assignable === 'owner') expect(actor).toBe('owner');
      }
    }
    expect(assignableRoles('manager')).toEqual([]);
    expect(assignableRoles('worker')).toEqual([]);
    expect(assignableRoles('accountant')).toEqual([]);
    expect(assignableRoles(null)).toEqual([]);
  });

  it('labels every role', () => {
    for (const role of TEAM_ROLES) expect(roleLabel(role.value)).toBe(role.label);
    expect(roleLabel(null)).toBe('Unknown');
  });
});

describe('the navigation follows the same table', () => {
  it('asks for a capability on every entry', async () => {
    const { ALL_NAV_ITEMS, QUICK_ACTIONS } = await import('@/components/app-shell/nav');
    for (const item of [...ALL_NAV_ITEMS, ...QUICK_ACTIONS]) {
      expect(item.capability, `${item.href} has no capability`).toBeTruthy();
      // And the capability must be one a role can actually hold.
      const heldBySomeone = TEAM_ROLES.some((role) => can(role.value, item.capability));
      expect(heldBySomeone, `${item.href} asks for a capability no role has`).toBe(true);
    }
  });

  it('shows a worker no pricing anywhere in the navigation', async () => {
    const { ALL_NAV_ITEMS } = await import('@/components/app-shell/nav');
    const visible = ALL_NAV_ITEMS.filter((item) => can('worker', item.capability)).map((i) => i.href);
    expect(visible).not.toContain('/quotes');
    expect(visible).not.toContain('/invoices');
    expect(visible).not.toContain('/estimates');
    expect(visible).toContain('/jobs');
    expect(visible).toContain('/reports');
  });
});
