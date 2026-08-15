#!/usr/bin/env node
/**
 * Check that real event listings are reachable, before running a whole build.
 *
 *   npm run events:check            # the featured countries
 *   npm run events:check -- GB DE   # specific ones
 *
 * It uses the same source module the build uses, so a pass here means the
 * build will publish real listings — not a parallel code path that might
 * behave differently.
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import config from '../site.config.mjs';
import { createEventSource } from '../lib/events.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const key = process.env[config.events.apiKeyEnv] || '';

const write = (line = '') => process.stdout.write(`${line}\n`);

if (!key) {
  write(`
  No ${config.events.apiKeyEnv} is set, so the site has no real event listings.

  Event pages are the one part of this site that needs a key. Getting one is
  free and takes a couple of minutes:

    1. Sign up at https://developer.ticketmaster.com/
    2. Create an app; copy the Consumer Key it gives you
    3. export ${config.events.apiKeyEnv}=your-key
    4. npm run events:check      (this command, to confirm it works)
    5. npm run build             (publishes the real listings)

  On a host, set ${config.events.apiKeyEnv} as an environment variable in the
  build settings — Cloudflare Pages, Netlify and GitHub Actions all have a
  place for it. Do not commit the key.

  Until then the build simply generates no event pages. Nothing is invented to
  fill the gap; \`npm run build:offline -- --events-demo\` produces clearly
  labelled samples if you only want to look at the layout.
`);
  process.exit(1);
}

const requested = process.argv.slice(2).filter((arg) => /^[A-Za-z]{2}$/.test(arg));
const codes = (requested.length ? requested : config.events.countries.length ? config.events.countries : config.featured).map(
  (code) => code.toUpperCase(),
);

write(`\n  Checking real listings for ${codes.length} countries`);
write(`  key: ${config.events.apiKeyEnv} …${key.slice(-4)}\n`);

const source = createEventSource({
  apiBase: config.events.apiBase,
  apiKey: key,
  cacheDir: path.resolve(root, config.cacheDir),
  windowDays: config.events.windowDays,
  perCategory: config.events.perCategory,
});

let withListings = 0;
let total = 0;

for (const code of codes) {
  const buckets = await source.forCountry(code);
  if (!buckets) {
    write(`  ${code}   —  no listings returned`);
    continue;
  }
  const counts = {
    concerts: buckets.concerts.length,
    comedy: buckets.comedy.length,
    events: buckets.events.length,
  };
  const sum = counts.concerts + counts.comedy + counts.events;
  total += sum;
  withListings += 1;

  const example = buckets.concerts[0] || buckets.comedy[0] || buckets.events[0];
  write(
    `  ${code}   ${String(counts.concerts).padStart(3)} concerts · ` +
      `${String(counts.comedy).padStart(3)} comedy · ${String(counts.events).padStart(3)} other` +
      (example
        ? `   e.g. ${example.name}${example.venue ? ` at ${example.venue}` : ''}, ${example.date}`
        : ''),
  );
}

write('');
if (source.stats.errors.length) {
  write('  Problems reported by the API:');
  for (const error of source.stats.errors) write(`    ${error}`);
  write('');
  write('  A 401 means the key is wrong or not yet active — a new key can take a');
  write('  few minutes. A 429 means you are over the rate limit; wait and retry.');
  write('');
  process.exit(1);
}

if (!withListings) {
  write('  The API answered but returned nothing for these countries.');
  write('  Ticketmaster coverage is strongest in North America, the UK, Ireland,');
  write('  Australia and western Europe. Try: npm run events:check -- US GB DE\n');
  process.exit(1);
}

write(
  `  ✓ ${total} real listings across ${withListings} of ${codes.length} countries.` +
    `\n  Run \`npm run build\` to publish them.\n`,
);
