#!/usr/bin/env node
// ---------------------------------------------------------------------------
// setup — get from a fresh clone to a running application.
//
//   npm run setup
//
// It creates .env.local from .env.example if it is missing, then tells you
// exactly which values are still needed and where each one is found. Where a
// value is present it checks it actually works: the database is connected to,
// the migrations are applied, and the storage buckets are confirmed.
//
// Nothing here is guessed or invented. Four values genuinely cannot be created
// on your behalf — they belong to your Supabase project — and this script's
// job is to name them precisely and get out of the way.
// ---------------------------------------------------------------------------

import { existsSync, copyFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadEnv } from './env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envLocal = join(root, '.env.local');
const envExample = join(root, '.env.example');

const green = (text) => `\x1b[32m${text}\x1b[0m`;
const red = (text) => `\x1b[31m${text}\x1b[0m`;
const dim = (text) => `\x1b[2m${text}\x1b[0m`;
const bold = (text) => `\x1b[1m${text}\x1b[0m`;

console.log(bold('\nTradeFlow setup\n'));

// --- 1. the env file --------------------------------------------------------

if (!existsSync(envLocal)) {
  if (!existsSync(envExample)) {
    console.error(red('.env.example is missing. This clone is incomplete.'));
    process.exit(1);
  }
  copyFileSync(envExample, envLocal);
  console.log(`${green('created')} .env.local from .env.example`);
} else {
  console.log(`${green('found')}   .env.local`);
}

loadEnv();

// --- 2. what is required, and where it comes from ---------------------------

const REQUIRED = [
  {
    key: 'NEXT_PUBLIC_SUPABASE_URL',
    where: 'Supabase → Project Settings → Data API → Project URL',
  },
  {
    key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    where: 'Supabase → Project Settings → API Keys → anon / publishable',
  },
  {
    key: 'SUPABASE_SERVICE_ROLE_KEY',
    where: 'Supabase → Project Settings → API Keys → service_role (keep it server-side)',
  },
  {
    key: 'DATABASE_URL',
    where: 'Supabase → Project Settings → Database → Connection string → URI',
  },
];

const OPTIONAL = [
  {
    key: 'ANTHROPIC_API_KEY',
    what: 'the AI assistant, the email helper and the phone agent',
    where: 'console.anthropic.com → API keys',
  },
  {
    key: 'EMAIL_PROVIDER',
    what: 'actually delivering email (without it, mail is recorded but not sent)',
    where: 'set to `resend` with RESEND_API_KEY, or `smtp` with SMTP_URL',
  },
  {
    key: 'TWILIO_AUTH_TOKEN',
    what: 'answering the phone',
    where: 'twilio.com console → Account Info, plus a number pointed at /api/voice/incoming',
  },
  {
    key: 'GOOGLE_OAUTH_CLIENT_ID',
    what: 'connecting an existing Gmail mailbox',
    where: 'console.cloud.google.com → Credentials → OAuth client, redirect /api/email/google/callback',
  },
  {
    key: 'MICROSOFT_OAUTH_CLIENT_ID',
    what: 'connecting an existing Outlook mailbox',
    where: 'entra.microsoft.com → App registrations, redirect /api/email/microsoft/callback',
  },
  {
    key: 'TOKEN_ENCRYPTION_KEY',
    what: 'sealing mailbox tokens at rest — required before any mailbox can connect',
    where: 'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
  },
];

const missing = [];
const placeholder = (value) =>
  !value || value.startsWith('your-') || value.includes('YOUR-PROJECT') || value.trim() === '';

console.log(bold('\nRequired\n'));
for (const item of REQUIRED) {
  const value = process.env[item.key];
  if (placeholder(value)) {
    missing.push(item);
    console.log(`  ${red('missing')} ${item.key}`);
    console.log(`          ${dim(item.where)}`);
  } else {
    console.log(`  ${green('set')}     ${item.key}`);
  }
}

console.log(bold('\nOptional\n'));
for (const item of OPTIONAL) {
  const value = process.env[item.key];
  // `EMAIL_PROVIDER=log` is the default and means "record it, send nothing",
  // so it counts as unconfigured rather than set.
  const set = !placeholder(value) && !(item.key === 'EMAIL_PROVIDER' && value === 'log');
  console.log(`  ${set ? green('set  ') : dim('unset')}   ${item.key} ${dim(`— ${item.what}`)}`);
  if (!set) console.log(`          ${dim(item.where)}`);
}

if (missing.length) {
  console.log(
    `\n${red(`${missing.length} required value(s) still needed.`)} ` +
      `Open ${dim('.env.local')}, fill them in, and run ${bold('npm run setup')} again.\n`
  );
  console.log(dim('Everything optional can wait — the platform runs without any of it.\n'));
  process.exit(1);
}

// --- 3. the database --------------------------------------------------------

console.log(bold('\nDatabase\n'));

const { default: postgres } = await import('postgres');
const url = process.env.DATABASE_URL;
const sql = postgres(url, {
  max: 1,
  ssl: url.includes('localhost') || url.includes('127.0.0.1') ? false : 'require',
  onnotice: () => {},
  connect_timeout: 15,
});

let ok = true;
try {
  await sql`select 1`;
  console.log(`  ${green('ok')}      connected`);

  const [{ count }] = await sql`
    select count(*)::int as count from information_schema.tables
    where table_schema = 'public' and table_name = 'businesses'`;

  if (count === 0) {
    console.log(`  ${dim('..')}      applying migrations`);
    const result = spawnSync(process.execPath, [join(root, 'scripts', 'db-push.mjs')], {
      stdio: 'inherit',
      cwd: root,
    });
    ok = result.status === 0;
  } else {
    const applied = await sql`select count(*)::int as n from schema_migrations`.catch(() => [
      { n: 0 },
    ]);
    console.log(`  ${green('ok')}      schema present (${applied[0].n} migration(s) applied)`);
    console.log(`  ${dim('..')}      checking for anything new`);
    const result = spawnSync(process.execPath, [join(root, 'scripts', 'db-push.mjs')], {
      stdio: 'inherit',
      cwd: root,
    });
    ok = result.status === 0;
  }

  // Row level security is the tenancy boundary. If it is off anywhere, say so
  // loudly rather than letting the app run.
  const unprotected = await sql`
    select c.relname as table
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      and c.relname <> 'schema_migrations'`;

  if (unprotected.length) {
    ok = false;
    console.log(
      `  ${red('WARNING')} row level security is off on: ${unprotected.map((r) => r.table).join(', ')}`
    );
  } else {
    console.log(`  ${green('ok')}      row level security on every table`);
  }

  const buckets = await sql`select id from storage.buckets where id in ('photos','documents','logos','receipts')`;
  console.log(
    buckets.length === 4
      ? `  ${green('ok')}      storage buckets ready`
      : `  ${red('missing')} storage buckets (${buckets.length}/4) — re-run npm run db:push`
  );
} catch (error) {
  ok = false;
  console.log(`  ${red('failed')}  ${error.message}`);
  console.log(
    dim(
      '\n  If this is a connection error, check DATABASE_URL. Supabase gives two:\n' +
        '  use the direct connection (port 5432) for migrations, not the pooler.'
    )
  );
} finally {
  await sql.end({ timeout: 5 });
}

// --- 4. what to do next -----------------------------------------------------

if (!ok) {
  console.log(red('\nSetup did not finish cleanly. Fix the above and run it again.\n'));
  process.exit(1);
}

const example = readFileSync(envExample, 'utf8');
const aiReady = !placeholder(process.env.ANTHROPIC_API_KEY);

console.log(bold('\nReady\n'));
console.log('  npm run dev        start the app on http://localhost:3000');
console.log('  npm run db:seed    create a demo login with a business already in it');
console.log('  npm test           run the test suite');
console.log(
  aiReady
    ? '\n  The AI features are configured.\n'
    : dim(
        '\n  The AI features are off until ANTHROPIC_API_KEY is set. Everything else\n' +
          '  — jobs, quotes, invoices, reports, PDFs — works without it.\n'
      )
);

if (!example.includes('ANTHROPIC_MODEL')) {
  console.log(dim('  (.env.example looks out of date against this build.)\n'));
}
