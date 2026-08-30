#!/usr/bin/env node
// ---------------------------------------------------------------------------
// db-push — apply supabase/migrations/*.sql to the database in DATABASE_URL.
//
//   npm run db:push            apply everything not yet applied
//   npm run db:push -- --dry   list what would be applied
//   npm run db:reset           drop the public schema first, then apply all
//
// Each file runs inside one transaction and is recorded in
// public.schema_migrations with a checksum, so a file that changed after being
// applied is reported rather than silently skipped.
// ---------------------------------------------------------------------------

import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { loadEnv } from './env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'supabase', 'migrations');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry') || args.includes('--dry-run');
const reset = args.includes('--reset');

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'DATABASE_URL is not set.\n\n' +
      'Copy .env.example to .env.local and fill in DATABASE_URL, or run `npm run setup`.\n' +
      'Supabase project -> Settings -> Database -> Connection string -> URI.'
  );
  process.exit(1);
}

const sql = postgres(url, {
  max: 1,
  // Supabase's pooled connection string needs TLS; the direct one accepts it.
  ssl: url.includes('localhost') || url.includes('127.0.0.1') ? false : 'require',
  onnotice: (notice) => {
    if (notice.severity === 'NOTICE' && /already exists|skipping/i.test(notice.message)) return;
    console.log(`  · ${notice.message}`);
  },
});

const checksum = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

async function main() {
  if (reset) {
    if (!dryRun) {
      console.log('· dropping and recreating schema public');
      await sql.unsafe('drop schema if exists public cascade; create schema public;');
      await sql.unsafe(
        'grant usage on schema public to anon, authenticated, service_role; ' +
          'grant all on schema public to postgres;'
      );
    } else {
      console.log('· would drop and recreate schema public');
    }
  }

  await sql.unsafe(`
    create table if not exists schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    );
  `);

  const applied = new Map(
    (await sql`select name, checksum from schema_migrations`).map((r) => [r.name, r.checksum])
  );

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  if (files.length === 0) {
    console.error(`No .sql files in ${migrationsDir}`);
    process.exit(1);
  }

  let count = 0;
  for (const file of files) {
    const body = await readFile(join(migrationsDir, file), 'utf8');
    const sum = checksum(body);
    const previous = applied.get(file);

    if (previous === sum) {
      console.log(`  = ${file} (already applied)`);
      continue;
    }
    if (previous && previous !== sum) {
      console.warn(
        `  ! ${file} changed since it was applied (${previous} -> ${sum}). ` +
          'Re-running it; every migration in this project is written to be re-runnable.'
      );
    }
    if (dryRun) {
      console.log(`  + ${file} (would apply)`);
      count += 1;
      continue;
    }

    process.stdout.write(`  + ${file} `);
    const started = Date.now();
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`
          insert into schema_migrations (name, checksum)
          values (${file}, ${sum})
          on conflict (name) do update set checksum = excluded.checksum, applied_at = now()
        `;
      });
      console.log(`ok (${Date.now() - started}ms)`);
      count += 1;
    } catch (error) {
      console.log('FAILED');
      console.error(`\n${file} failed and was rolled back:\n  ${error.message}`);
      if (error.position) console.error(`  at character ${error.position}`);
      if (error.hint) console.error(`  hint: ${error.hint}`);
      process.exitCode = 1;
      return;
    }
  }

  console.log(
    dryRun
      ? `\n${count} migration(s) pending.`
      : `\n${count} migration(s) applied. Database is up to date.`
  );
}

try {
  await main();
} finally {
  await sql.end({ timeout: 5 });
}
