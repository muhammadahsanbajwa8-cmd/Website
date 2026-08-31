import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Can Business A read Business B's data? No.
 *
 * That answer rests on the database, not on the application, so this file
 * reads the migrations and checks the guarantee directly:
 *
 *   1. every table exists with row level security enabled AND forced,
 *   2. every policy predicate bottoms out in app_is_member/app_has_role,
 *   3. no policy is open to `public` or `anon`, and none uses `true`,
 *   4. the membership predicate itself is scoped to auth.uid(),
 *   5. the definer functions the customer portal uses take a token, never an id,
 *   6. nothing in the app hands a business id to the AI as a tool argument.
 *
 * A live end-to-end check against a real database is in tenancy.live.test.ts;
 * this file needs no database and runs on every commit.
 */

const MIGRATIONS = join(import.meta.dirname, '..', 'supabase', 'migrations');
const SRC = join(import.meta.dirname, '..', 'src');

const sql = (file: string) => readFileSync(join(MIGRATIONS, file), 'utf8');

const ALL_SQL = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => sql(name))
  .join('\n');

/** Every `create table` in the migrations, in file order. */
function createdTables(): string[] {
  return [...ALL_SQL.matchAll(/create table if not exists (\w+)/gi)].map((m) => m[1]);
}

/** The tables named in an `alter table … enable row level security` loop. */
function rlsProtectedTables(): Set<string> {
  const names = new Set<string>();

  // The loops list their tables in an array literal before the execute.
  for (const block of ALL_SQL.split(/do \$\$/i).slice(1)) {
    if (!/enable row level security/i.test(block)) continue;
    const array = block.match(/array\[([\s\S]*?)\]/i);
    if (!array) continue;
    for (const quoted of array[1].matchAll(/'([\w]+)'/g)) names.add(quoted[1]);
  }

  // …and any stated one at a time.
  for (const direct of ALL_SQL.matchAll(/alter table (\w+) enable row level security/gi)) {
    names.add(direct[1]);
  }
  return names;
}

describe('row level security covers every table', () => {
  const tables = createdTables();
  const protectedTables = rlsProtectedTables();

  it('found the schema', () => {
    expect(tables.length).toBeGreaterThan(30);
  });

  it.each(createdTables())('%s has RLS enabled', (table) => {
    expect(protectedTables.has(table)).toBe(true);
  });

  it('forces RLS, so even the table owner is subject to the policies', () => {
    const forced = new Set<string>();
    for (const block of ALL_SQL.split(/do \$\$/i).slice(1)) {
      if (!/force row level security/i.test(block)) continue;
      const array = block.match(/array\[([\s\S]*?)\]/i);
      if (!array) continue;
      for (const quoted of array[1].matchAll(/'([\w]+)'/g)) forced.add(quoted[1]);
    }
    for (const direct of ALL_SQL.matchAll(/alter table (\w+) force row level security/gi)) {
      forced.add(direct[1]);
    }
    for (const table of createdTables()) {
      expect(forced.has(table), `${table} does not force RLS`).toBe(true);
    }
  });

  it('keeps the migration honest with a self-check that fails the deploy', () => {
    // 0003 and 0005 each end with a block that raises if a table slipped
    // through without a policy. Without it, adding a table to 0001 and
    // forgetting 0003 would be a silent tenancy hole.
    expect(sql('0003_rls.sql')).toMatch(/raise exception/i);
    expect(sql('0005_ai_brain.sql')).toMatch(/raise exception/i);
  });
});

describe('every policy predicate is a membership test', () => {
  // Policy bodies, whether written directly or built inside a format() string.
  const predicates = [
    ...ALL_SQL.matchAll(/create policy [\s\S]*?(?=;\s*(?:\n|$)|'\s*,)/gi),
  ].map((m) => m[0]);

  it('found the policies', () => {
    expect(predicates.length).toBeGreaterThan(50);
  });

  it.each(
    predicates.map((body) => [
      (body.match(/create policy %?I? ?(\w+)?/i)?.[1] ?? body.slice(0, 60)).trim(),
      body,
    ])
  )('%s is scoped to the caller', (_name, body) => {
    const scoped =
      /app_is_member\(/.test(body) ||
      /app_has_role\(/.test(body) ||
      /app_business_ids\(\)/.test(body) ||
      // Rows that belong to a person rather than a business: your own profile,
      // your own notification. Those are scoped to auth.uid() directly.
      /auth\.uid\(\)/.test(body) ||
      // The stock report templates, which have no business_id and are read-only.
      /business_id is null/.test(body);

    expect(scoped, `unscoped policy: ${body.slice(0, 200)}`).toBe(true);
  });

  it('grants nothing to public, and nothing to anon', () => {
    for (const body of predicates) {
      expect(body, `policy open to public: ${body.slice(0, 120)}`).not.toMatch(/\bto public\b/i);
      expect(body, `policy open to anon: ${body.slice(0, 120)}`).not.toMatch(/\bto anon\b/i);
    }
    // anon is stripped of table privileges outright.
    expect(ALL_SQL).toMatch(/revoke all on all tables in schema public from anon/i);
  });

  it('never uses `using (true)`', () => {
    for (const body of predicates) {
      expect(body).not.toMatch(/using\s*\(\s*true\s*\)/i);
      expect(body).not.toMatch(/with check\s*\(\s*true\s*\)/i);
    }
  });
});

describe('the membership predicate itself', () => {
  const functions = sql('0002_functions.sql');
  const body = functions.slice(functions.indexOf('function app_is_member'));

  it('is defined against the caller, not against an argument alone', () => {
    expect(body).toMatch(/tm\.business_id = target/);
    expect(body).toMatch(/tm\.user_id = auth\.uid\(\)/);
  });

  it('ignores removed and unaccepted memberships', () => {
    expect(body).toMatch(/tm\.deleted_at is null/);
    expect(body).toMatch(/tm\.accepted_at is not null/);
  });

  it('pins its search_path, so it cannot be shadowed', () => {
    // A SECURITY DEFINER function without a pinned search_path can be made to
    // call an attacker's team_members from a schema earlier on the path.
    const definers = [...ALL_SQL.matchAll(/security definer[\s\S]{0,200}?as \$\$/gi)];
    expect(definers.length).toBeGreaterThan(5);
    for (const definer of definers) {
      expect(definer[0], `definer without search_path: ${definer[0].slice(0, 120)}`).toMatch(
        /set search_path/i
      );
    }
  });
});

describe('the customer portal', () => {
  const functions = sql('0002_functions.sql');

  it('is reached by token, never by id', () => {
    for (const name of ['public_quote_by_token', 'public_invoice_by_token', 'public_quote_respond']) {
      const signature = functions.slice(functions.indexOf(`function ${name}`)).slice(0, 200);
      expect(signature, `${name} should take a token`).toMatch(/token/i);
      // No argument named like an id: a customer cannot walk the ids.
      expect(signature).not.toMatch(/\bp?_?business_id\b/);
    }
  });

  it('gives anon execute on exactly those three functions and nothing else', () => {
    const grants = [...ALL_SQL.matchAll(/grant execute on function ([\w.]+)\([^)]*\) to ([^;]+);/gi)]
      .filter((m) => /anon/.test(m[2]))
      .map((m) => m[1]);

    expect(new Set(grants)).toEqual(
      new Set(['public_quote_by_token', 'public_quote_respond', 'public_invoice_by_token'])
    );
  });
});

describe('the AI cannot be argued into another tenant', () => {
  const tools = readFileSync(join(SRC, 'lib', 'ai', 'tools.ts'), 'utf8');

  it('exposes no tool that accepts a business id', () => {
    // The whole defence: business_id is closed over from the session, so there
    // is no argument the model can produce that reaches another business. Any
    // property key naming a business would undo it.
    const schemas = tools.slice(tools.indexOf('READ_TOOLS'), tools.indexOf('export async function runTool'));
    expect(schemas.length).toBeGreaterThan(1000);

    const keys = [...schemas.matchAll(/[{,]\s*(\w+):\s*\{\s*type:/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(5);
    for (const key of keys) {
      expect(key, `tool argument "${key}" names a business`).not.toMatch(/business/i);
    }
  });

  it('runs every tool against the business the session established', () => {
    // Each executor closes over one id, taken from the context, and every
    // filter uses that binding rather than anything the model supplied.
    expect(tools).toMatch(/const businessId = context\.businessId;/);

    const filters = [...tools.matchAll(/\.eq\('business_id',\s*([^)]+)\)/g)].map((m) => m[1].trim());
    expect(filters.length).toBeGreaterThan(5);
    for (const argument of filters) {
      expect(argument, `a tool filtered on ${argument}`).toBe('businessId');
    }

    // And the one RPC, too.
    for (const call of tools.matchAll(/\.rpc\('\w+',\s*\{\s*target:\s*([^,}]+)/g)) {
      expect(call[1].trim()).toBe('businessId');
    }

    // Nothing reads an id out of the model's input.
    expect(tools).not.toMatch(/input\.business/i);
  });
});

describe('server code never trusts an id from the URL on its own', () => {
  /** Every .ts/.tsx file under src. */
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.tsx?$/.test(full) ? [full] : [];
    });
  }

  const files = walk(SRC);

  it('establishes the session before reading a record, on every page and action', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (!source.includes("from('")) continue;
      // Files that legitimately have no session: the public portal (token
      // based), the telephony webhooks (signature based), and the libraries
      // those two call.
      if (/[/\\](q|i)[/\\]\[token\]/.test(file)) continue;
      if (/[/\\]api[/\\]voice[/\\]/.test(file)) continue;
      // The service-role modules. None of them can have a session — a phone
      // caller has no JWT, and a mailbox sync runs on a schedule — so each
      // instead binds itself to one business id taken from a row the caller
      // already established. That is asserted positively rather than skipped:
      // see "the AI cannot be argued into another tenant" below, and
      // "what the sync is allowed to do" in mailbox.test.ts.
      if (/[/\\]lib[/\\](voice|ai)[/\\]/.test(file)) continue;
      if (/[/\\]lib[/\\]email[/\\](sync|oauth)\.ts$/.test(file)) continue;
      if (/[/\\]auth[/\\]|[/\\]\(auth\)[/\\]|onboarding|invite/.test(file)) continue;
      if (/supabase[/\\](server|admin|client)\.ts$/.test(file)) continue;
      if (/lib[/\\](session|storage|demo|documents|report-pdf|pickers|query)\.ts$/.test(file)) continue;

      const hasSession =
        /requireCapability\(|requireBusiness\(|getBusinessSession\(|session\.business\.id/.test(source);
      if (!hasSession) offenders.push(file.replace(SRC, 'src'));
    }

    expect(offenders, `these query the database without establishing a session:\n${offenders.join('\n')}`)
      .toEqual([]);
  });

  it('filters every query by the session business as well as trusting RLS', () => {
    // Belt and braces. RLS is the boundary; this is so that a mistake in a
    // page fails loudly rather than widely — and so a person who belongs to two
    // businesses can never be shown a row from the one they are not in.
    const offenders: string[] = [];

    // Tables with no business_id column of their own.
    const UNSCOPED = ['profiles', 'report_templates', 'work_log_workers', 'job_assignments'];

    for (const file of files) {
      if (!/[/\\]app[/\\]\(app\)[/\\]/.test(file)) continue;
      // Comments are removed first: a semicolon inside one would otherwise
      // look like the end of the statement.
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

      for (const match of source.matchAll(/\.from\('(\w+)'\)/g)) {
        const table = match[1];
        if (UNSCOPED.includes(table)) continue;
        // The businesses row is its own tenant: it is keyed by id.
        if (table === 'businesses') {
          const rest = source.slice(match.index, source.indexOf(';', match.index) + 1);
          if (/\.eq\('id', session\.business\.id\)/.test(rest)) continue;
        }

        // The whole chained statement, up to the semicolon or the comma that
        // separates it from the next entry in a Promise.all.
        const rest = source.slice(match.index);
        const end = rest.search(/;|\n\s*\),?\n|\n\s{0,6}\),/);
        const statement = rest.slice(0, end === -1 ? 600 : end);

        const writes = /\.insert\(|\.upsert\(/.test(statement);
        const scoped = writes
          ? // An insert scopes itself by setting business_id on the row —
            // either inline, or through a values object built just above.
            /business_id/.test(statement) || /business_id: session\.business\.id/.test(source)
          : /business_id/.test(statement);

        if (!scoped) offenders.push(`${file.replace(SRC, 'src')} → ${table}`);
      }
    }

    expect(offenders, `unscoped queries:\n${offenders.join('\n')}`).toEqual([]);
  });
});
