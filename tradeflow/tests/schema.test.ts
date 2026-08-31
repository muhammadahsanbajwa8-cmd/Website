import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The row types and the migrations describe the same database.
 *
 * `database.types.ts` is written by hand rather than generated, which is the
 * right trade for a project that has to run without the Supabase CLI — but it
 * means a column added to the SQL and forgotten in the types would only show up
 * as a runtime undefined. This file compares the two.
 */

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const ALL_SQL = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'))
  .join('\n');

const TYPES = readFileSync(join(ROOT, 'src', 'lib', 'database.types.ts'), 'utf8');

/** Column names declared in a `create table` body. */
function columnsOf(table: string): string[] {
  const start = ALL_SQL.indexOf(`create table if not exists ${table} (`);
  if (start === -1) throw new Error(`no create table for ${table}`);

  let depth = 0;
  let end = start;
  for (let i = ALL_SQL.indexOf('(', start); i < ALL_SQL.length; i += 1) {
    if (ALL_SQL[i] === '(') depth += 1;
    if (ALL_SQL[i] === ')') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  const body = ALL_SQL.slice(ALL_SQL.indexOf('(', start) + 1, end);

  return body
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').trim())
    .filter(Boolean)
    // Table-level constraints are not columns.
    .filter((line) => !/^(constraint|primary key|unique|check|foreign key|exclude)\b/i.test(line))
    .map((line) => line.match(/^(\w+)/)?.[1])
    .filter((name): name is string => Boolean(name))
    // A continuation line of a multi-line column definition starts with a
    // keyword rather than a new name.
    .filter(
      (name) =>
        !['references', 'default', 'not', 'null', 'on', 'generated', 'or', 'and'].includes(name)
    );
}

/** The table → type map at the bottom of database.types.ts. */
function tableMap(): Record<string, string> {
  const block = TYPES.slice(
    TYPES.indexOf('type TableRows = {'),
    TYPES.indexOf('type TableDefinition')
  );
  const map: Record<string, string> = {};
  for (const line of block.matchAll(/^\s*(\w+):\s*(\w+);/gm)) map[line[1]] = line[2];
  return map;
}

/** Every property name reachable on a row type, following `A & B & {…}`. */
function propertiesOf(typeName: string, seen = new Set<string>()): Set<string> {
  if (seen.has(typeName)) return new Set();
  seen.add(typeName);

  const declaration = TYPES.match(
    new RegExp(`^(?:export )?(?:type|interface) ${typeName}\\b[\\s\\S]*?\\n\\}`, 'm')
  );
  if (!declaration) return new Set();

  const source = declaration[0];
  const names = new Set<string>();

  // Inherited shapes: `export type Job = BusinessOwned & SoftDeletable & {`.
  const head = source.slice(0, source.indexOf('{'));
  for (const parent of head.matchAll(/\b([A-Z]\w+)\b/g)) {
    if (parent[1] === typeName) continue;
    for (const name of propertiesOf(parent[1], seen)) names.add(name);
  }

  for (const property of source.matchAll(/^\s{2}(\w+)\??:/gm)) names.add(property[1]);
  return names;
}

describe('every table has a row type', () => {
  const map = tableMap();
  const tables = [...ALL_SQL.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]);

  it('found both sides', () => {
    expect(tables.length).toBeGreaterThan(30);
    expect(Object.keys(map).length).toBe(tables.length);
  });

  it.each(tables)('%s', (table) => {
    expect(map[table], `${table} is missing from TableRows`).toBeTruthy();
  });

  it('has no row type for a table that does not exist', () => {
    for (const table of Object.keys(map)) {
      expect(tables, `TableRows names ${table}, which no migration creates`).toContain(table);
    }
  });
});

describe('the row types carry every column', () => {
  const map = tableMap();

  // Columns deliberately absent from the row types. The encrypted mailbox
  // tokens are revoked from `select` for `authenticated` in 0003, so no row
  // type should offer them: only the service role ever reads them.
  const WITHHELD: Record<string, string[]> = {
    email_accounts: ['refresh_token_enc', 'access_token_enc'],
  };

  it.each(Object.entries(map))('%s', (table, typeName) => {
    const columns = columnsOf(table).filter(
      (column) => !(WITHHELD[table] ?? []).includes(column)
    );
    const properties = propertiesOf(typeName);

    expect(columns.length, `parsed no columns for ${table}`).toBeGreaterThan(2);
    expect(properties.size, `parsed no properties for ${typeName}`).toBeGreaterThan(2);

    const missing = columns.filter((column) => !properties.has(column));
    expect(missing, `${typeName} is missing: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('money and time are stored in whole units', () => {
  it('keeps every amount in integer cents', () => {
    // A float would round differently in Postgres and in JavaScript, and the
    // difference would show up on an invoice. Amounts are bigint cents; the
    // column name says so.
    const floats = [
      ...ALL_SQL.matchAll(
        /^\s*(\w*(?:amount|price|total|cost|cents|paid|due|balance)\w*)\s+(numeric|real|double precision|float\w*)/gim
      ),
    ];
    expect(floats.map((m) => m[1])).toEqual([]);
  });

  it('names every money column so its unit is unmistakable', () => {
    // Only inside a create table body: a function's `returns bigint`, its
    // parameters and its local declarations are not columns.
    const columns = [
      ...ALL_SQL.matchAll(/create table if not exists \w+ \(([\s\S]*?)\n\);/g),
    ].flatMap((table) => [...table[1].matchAll(/^\s*(\w+)\s+bigint/gim)].map((m) => m[1]));

    expect(columns.length).toBeGreaterThan(20);
    for (const column of columns) {
      expect(
        /_cents$|_milli$|_bp$|count|minutes|position|bytes|size/.test(column),
        `bigint column "${column}" does not say what it holds`
      ).toBe(true);
    }
  });

  it('keeps quantities in thousandths', () => {
    expect(ALL_SQL).toMatch(/quantity_milli/);
  });
});

describe('the shape of the schema', () => {
  const tables = [...ALL_SQL.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]);

  // The tables the brief named, by the names it used.
  const REQUIRED = [
    'businesses', 'team_members', 'customers', 'contacts', 'leads', 'jobs', 'job_tasks',
    'job_notes', 'job_photos', 'job_documents', 'estimates', 'estimate_items', 'quotes',
    'quote_items', 'quote_versions', 'invoices', 'invoice_items', 'payments', 'expenses',
    'materials', 'suppliers', 'work_logs', 'reports', 'report_templates', 'report_photos',
    'email_accounts', 'email_threads', 'emails', 'email_attachments', 'notifications',
    'activities', 'audit_logs',
  ];

  it.each(REQUIRED)('has %s', (table) => {
    expect(tables).toContain(table);
  });

  it('gives every business-owned table a foreign key to businesses', () => {
    const missing: string[] = [];
    for (const table of tables) {
      if (['businesses', 'profiles', 'industry_profiles'].includes(table)) continue;
      const columns = columnsOf(table);
      if (!columns.includes('business_id')) missing.push(table);
    }
    // report_templates carries a nullable business_id for the stock templates.
    expect(missing).toEqual([]);

    const references = [...ALL_SQL.matchAll(/business_id\s+uuid[^,\n]*references businesses\(id\)/g)];
    expect(references.length).toBeGreaterThan(30);
  });

  it('timestamps every table that a person edits', () => {
    for (const table of tables) {
      // number_sequences is a counter, not a record: one row per business per
      // document kind, holding the last number issued.
      if (table === 'number_sequences') continue;
      const columns = columnsOf(table);
      expect(columns, `${table} has no created_at`).toContain('created_at');
    }
  });

  it('soft-deletes everything a person can remove, so nothing is lost', () => {
    // Deleting a customer in the interface must not take their invoices with
    // them: the row is stamped, not removed.
    for (const table of [
      'customers', 'jobs', 'quotes', 'invoices', 'estimates', 'reports', 'leads',
      'materials', 'suppliers', 'expenses', 'work_logs', 'job_tasks', 'team_members',
    ]) {
      expect(columnsOf(table), `${table} has no deleted_at`).toContain('deleted_at');
    }
  });

  it('indexes the tenancy column, so a tenant filter is never a scan', () => {
    const indexed = new Set(
      [...ALL_SQL.matchAll(/create index if not exists \w+ on (\w+) \(business_id/g)].map((m) => m[1])
    );
    const busy = ['jobs', 'customers', 'quotes', 'invoices', 'reports', 'emails', 'activities'];
    for (const table of busy) {
      expect(indexed.has(table), `${table} has no index on business_id`).toBe(true);
    }
  });
});
