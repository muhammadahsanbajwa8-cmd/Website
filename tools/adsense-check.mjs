#!/usr/bin/env node
/**
 * Check a built site against the things that actually get AdSense
 * applications rejected, before you apply.
 *
 *   npm run build && npm run adsense:check
 *
 * This is not a guarantee of approval — nobody can give you that, and anyone
 * who says otherwise is selling something. It checks the mechanical stuff a
 * reviewer will see immediately: placeholder text left in the config, ads on
 * pages that must not carry them, missing policy pages, sample data left in a
 * production build, and pages too thin to justify an ad.
 *
 * Exit code 0 means nothing blocking was found.
 */

import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import config from '../site.config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.resolve(root, config.outDir);

const write = (line = '') => process.stdout.write(`${line}\n`);

if (!existsSync(path.join(dist, 'index.html'))) {
  write(`\n  No build in ${config.outDir}/. Run \`npm run build\` first.\n`);
  process.exit(1);
}

const problems = [];
const warnings = [];
const passes = [];

const fail = (what, why) => problems.push({ what, why });
const warn = (what, why) => warnings.push({ what, why });
const pass = (what) => passes.push(what);

async function walk(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full)));
    else if (entry.name.endsWith('.html')) found.push(full);
  }
  return found;
}

const files = (await walk(dist)).filter((file) => path.basename(file) !== 'preview.html');
const route = (file) => `/${path.relative(dist, file).replace(/index\.html$/, '').split(path.sep).join('/')}`;

// --- 1. Configuration a reviewer would see -----------------------------------

if (/example($|\/|\.)/.test(new URL(config.url).hostname) || config.url.includes('example')) {
  fail(
    'Site URL is still a placeholder',
    `site.config.mjs has url: '${config.url}'. Canonical tags, the sitemap and Open Graph all point at a domain you do not own. Set it to your real domain and rebuild.`,
  );
} else {
  pass(`Canonical domain is set (${config.url})`);
}

if (config.contactEmail.includes('example')) {
  fail(
    'Contact address is still a placeholder',
    `site.config.mjs has contactEmail: '${config.contactEmail}'. Reviewers check that a contact route exists and works. Use an address you can receive mail at.`,
  );
} else {
  pass('Contact address is set');
}

if (!config.url.startsWith('https://')) {
  fail('Site URL is not HTTPS', 'AdSense expects the site to be served over HTTPS.');
}

// --- 2. Policy pages ----------------------------------------------------------

for (const [route_, label] of [
  ['/privacy/', 'Privacy policy'],
  ['/about/', 'About page'],
]) {
  const file = path.join(dist, route_.slice(1), 'index.html');
  if (!existsSync(file)) {
    fail(`${label} is missing`, `${route_} was not generated. AdSense looks for both.`);
    continue;
  }
  const text = (await readFile(file, 'utf8')).replace(/<[^>]+>/g, ' ');
  if (text.split(/\s+/).length < 200) {
    warn(`${label} is short`, `${route_} has little text; reviewers read these two pages closely.`);
  } else {
    pass(`${label} present and substantial`);
  }
}

const privacy = await readFile(path.join(dist, 'privacy/index.html'), 'utf8').catch(() => '');
for (const [needle, what] of [
  ['AdSense', 'the ad network by name'],
  ['cookie', 'cookies'],
  ['aboutads.info', 'the opt-out route'],
]) {
  if (!new RegExp(needle, 'i').test(privacy)) {
    warn('Privacy policy is incomplete', `It does not mention ${what}.`);
  }
}

// --- 3. Ads where they must not be -------------------------------------------

const adOn = (html) => /class="ad ad--/.test(html) || /adsbygoogle/.test(html);

const notFound = path.join(dist, '404.html');
if (existsSync(notFound) && adOn(await readFile(notFound, 'utf8'))) {
  fail(
    'The 404 page carries ads',
    'Ads on error pages are against AdSense policy — the page has no content of its own.',
  );
} else {
  pass('No ads on the 404 page');
}

const sampled = [];
const noindexed = [];
const thin = [];

for (const file of files) {
  const html = await readFile(file, 'utf8');
  const here = route(file);

  if (/not a real listing|Sample listings\./.test(html)) sampled.push(here);
  if (/name="robots" content="noindex"/.test(html)) {
    noindexed.push(here);
    if (adOn(html)) fail(`Ads on a noindex page (${here})`, 'A page not fit to index is not fit to monetise.');
  }

  // Rough word count of the visible text, ignoring markup and scripts.
  const text = html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (adOn(html) && text.split(' ').length < 220) thin.push({ route: here, words: text.split(' ').length });
}

if (sampled.length) {
  fail(
    `${sampled.length} pages contain sample data`,
    'This build was made with --events-demo. Invented listings must never be deployed to a site carrying ads. Rebuild without that flag.',
  );
} else {
  pass('No sample data in the build');
}

if (thin.length) {
  warn(
    `${thin.length} pages with ads carry little text`,
    `Thinnest: ${thin
      .sort((a, b) => a.words - b.words)
      .slice(0, 3)
      .map((page) => `${page.route} (${page.words} words)`)
      .join(', ')}. Reviewers reject sites whose pages exist mainly to hold ads.`,
  );
} else {
  pass('Every page carrying ads has substantial content');
}

// --- 4. ads.txt and the publisher ID -----------------------------------------

const publisherId = config.adsense.publisherId.trim();
const adsTxt = await readFile(path.join(dist, 'ads.txt'), 'utf8').catch(() => '');

if (!publisherId) {
  pass('No publisher ID yet — ad slots render as placeholders, which is correct before approval');
  if (/adsbygoogle/.test(await readFile(path.join(dist, 'index.html'), 'utf8'))) {
    fail('Ad code is present without a publisher ID', 'Something is serving ad code it should not.');
  }
} else {
  if (!adsTxt.includes(publisherId.replace(/^ca-/, ''))) {
    fail('ads.txt does not match the publisher ID', 'Rebuild after setting adsense.publisherId.');
  } else {
    pass('ads.txt matches the publisher ID');
  }
  const missing = Object.entries(config.adsense.slots).filter(([, id]) => !id);
  if (missing.length) {
    warn(
      `${missing.length} ad slots have no ID`,
      `${missing.map(([name]) => name).join(', ')} will render as placeholders.`,
    );
  }
}

// --- 5. Crawlability ----------------------------------------------------------

const robots = await readFile(path.join(dist, 'robots.txt'), 'utf8').catch(() => '');
if (/Disallow: \/\s*$/m.test(robots)) {
  fail('robots.txt blocks the whole site', 'Google cannot review what it cannot crawl.');
} else {
  pass('robots.txt allows crawling');
}

const sitemap = await readFile(path.join(dist, 'sitemap.xml'), 'utf8').catch(() => '');
if (!sitemap) {
  fail('No sitemap.xml', 'Submit one in Search Console; indexing makes review smoother.');
} else {
  const leaked = noindexed.filter((here) => sitemap.includes(`${here}</loc>`));
  if (leaked.length) {
    fail(`${leaked.length} noindex pages are in the sitemap`, `First: ${leaked[0]}`);
  } else {
    pass(`Sitemap present (${(sitemap.match(/<url>/g) || []).length} URLs), no noindex pages in it`);
  }
}

if (!/assets\/consent\.js/.test(await readFile(path.join(dist, 'index.html'), 'utf8'))) {
  warn('No consent banner on the home page', 'EEA/UK traffic needs a certified CMP regardless.');
} else {
  pass('Consent banner is present');
}

// --- Report -------------------------------------------------------------------

write(`\n  AdSense readiness — ${files.length} pages in ${config.outDir}/\n`);
for (const item of passes) write(`  ok    ${item}`);
if (warnings.length) {
  write('');
  for (const item of warnings) {
    write(`  warn  ${item.what}`);
    write(`        ${item.why}`);
  }
}
if (problems.length) {
  write('');
  for (const item of problems) {
    write(`  FIX   ${item.what}`);
    write(`        ${item.why}`);
  }
}

write('');
if (problems.length) {
  write(`  ${problems.length} blocking ${problems.length === 1 ? 'issue' : 'issues'} to fix before applying.\n`);
  process.exit(1);
}
write(
  `  Nothing blocking found${warnings.length ? `, ${warnings.length} thing${warnings.length === 1 ? '' : 's'} worth a look` : ''}.`,
);
write('  Approval is still Google\'s call: they weigh the usefulness of the');
write('  content itself, which no script can measure.\n');
