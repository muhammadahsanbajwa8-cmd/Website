#!/usr/bin/env node
/**
 * Build the site.
 *
 *   node build.mjs             fetch what it can, cache it, generate everything
 *   node build.mjs --offline   no network at all: cache first, then computed rules
 *
 * Output is a plain dist/ folder of HTML, CSS and JS.
 */

import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import config from './site.config.mjs';
import { countryInfo, flagEmoji } from './lib/countries.mjs';
import { eachDayOfYear, formatLong, iso, parseISO, todayUTC } from './lib/dates.mjs';
import { fallbackCountries } from './lib/fallback.mjs';
import { url } from './lib/html.mjs';
import { createSource } from './lib/source.mjs';
import { nextHolidayAcrossYears, yearStats } from './lib/stats.mjs';
import { renderCalculator, renderCountryHub, renderYearPage } from './lib/pages/country.mjs';
import {
  renderAbout,
  renderCountriesIndex,
  renderHome,
  renderPrivacy,
  renderToday,
} from './lib/pages/site.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const offline = process.argv.includes('--offline') || process.env.OFFLINE === '1';
const outDir = path.resolve(root, config.outDir);

const now = new Date();
const today = todayUTC(now);
const todayISO = iso(today);
const currentYear = today.getUTCFullYear();
const years = [];
for (let year = currentYear - config.years.back; year <= currentYear + config.years.ahead; year += 1) {
  years.push(year);
}

const started = Date.now();
let pageCount = 0;

async function write(pathname, contents) {
  const file = pathname.endsWith('/')
    ? path.join(outDir, pathname, 'index.html')
    : path.join(outDir, pathname);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
  pageCount += 1;
}

/** Run async work with a bounded number in flight. */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(runners);
  return results;
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

// --- 1. Data -----------------------------------------------------------------

log(`\n${config.name} — building ${years[0]}–${years.at(-1)}${offline ? ' (offline)' : ''}`);

const source = createSource({
  apiBase: config.apiBase,
  cacheDir: path.resolve(root, config.cacheDir),
  offline,
});

const available = await source.availableCountries();
log(`  countries listed: ${available.length}`);

const countries = await pool(available, 8, async (entry) => {
  const info = countryInfo(entry.code);
  const byYear = {};
  const origins = {};
  let total = 0;

  for (const year of years) {
    const { holidays, origin } = await source.holidays(year, entry.code);
    byYear[year] = holidays;
    origins[year] = origin;
    total += holidays.length;
  }
  if (!total) return null;

  const statsByYear = Object.fromEntries(
    years.map((year) => [year, yearStats(year, byYear[year], now)]),
  );

  return {
    ...info,
    name: info.name || entry.apiName || entry.code,
    flag: flagEmoji(entry.code),
    byYear,
    origins,
    statsByYear,
    next: nextHolidayAcrossYears(byYear, now),
  };
});

const published = countries.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'en'));
if (!published.length) {
  throw new Error('No holiday data available from any source — refusing to publish an empty site.');
}
log(
  `  data resolved: ${published.length} countries · live ${source.stats.live} · cache ${source.stats.cache} · computed ${source.stats.computed}`,
);
if (source.stats.errors.length) log(`  network notes: ${source.stats.errors[0]}`);

// --- 2. Fresh output ---------------------------------------------------------

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// --- 3. Country pages --------------------------------------------------------

await pool(published, 16, async (country) => {
  for (const year of years) {
    await write(
      url.year(country.code, year),
      renderYearPage({
        country,
        year,
        holidays: country.byYear[year],
        stats: country.statsByYear[year],
        years,
        origin: country.origins[year],
        today: todayISO,
      }),
    );
  }

  await write(
    url.country(country.code),
    renderCountryHub({
      country,
      years,
      byYear: country.byYear,
      statsByYear: country.statsByYear,
      next: country.next,
      currentYear,
      today: todayISO,
    }),
  );

  await write(
    url.calculator(country.code),
    renderCalculator({ country, years, byYear: country.byYear, today: todayISO }),
  );
});
log(`  country pages: ${pageCount}`);

// --- 4. Home, index, today ---------------------------------------------------

const heatCounts = new Map();
for (const country of published) {
  for (const holiday of country.byYear[currentYear]) {
    if (holiday.national === false) continue;
    heatCounts.set(holiday.date, (heatCounts.get(holiday.date) || 0) + 1);
  }
}
const peakCount = Math.max(0, ...heatCounts.values());
const heat = new Map();
for (const day of eachDayOfYear(currentYear)) {
  const key = iso(day);
  const count = heatCounts.get(key) || 0;
  if (count) heat.set(key, Math.min(1, 0.18 + 0.82 * (count / peakCount)));
}
const peakDate = [...heatCounts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];

const onDay = (dateISO) =>
  published
    .map((country) => {
      const holiday = (country.byYear[Number(dateISO.slice(0, 4))] || []).find(
        (entry) => entry.date === dateISO,
      );
      return holiday ? { country, holiday } : null;
    })
    .filter(Boolean);

const todayEntries = onDay(todayISO);
const tomorrowEntries = onDay(iso(new Date(today.getTime() + 86400000)));

const upcoming = published
  .flatMap((country) =>
    years.flatMap((year) =>
      (country.byYear[year] || [])
        .filter((holiday) => holiday.date > todayISO)
        .map((holiday) => ({ country, holiday })),
    ),
  )
  .sort((a, b) =>
    a.holiday.date < b.holiday.date
      ? -1
      : a.holiday.date > b.holiday.date
        ? 1
        : a.country.name.localeCompare(b.country.name, 'en'),
  )
  .slice(0, 25);

await write(
  url.home(),
  renderHome({
    countries: published,
    featured: pickFeatured(published),
    heat,
    peak: peakDate
      ? { date: formatLong(parseISO(peakDate[0])), count: peakDate[1] }
      : { date: null, count: 0 },
    year: currentYear,
    today: todayISO,
    todayCount: todayEntries.length,
    years,
  }),
);

await write(url.countries(), renderCountriesIndex({ countries: published, year: currentYear, years }));

await write(
  url.today(),
  renderToday({
    today: todayISO,
    entries: todayEntries,
    tomorrow: tomorrowEntries,
    upcoming,
    countryCount: published.length,
  }),
);

const generatedAt = `${formatLong(today)} (UTC)`;
await write(
  url.about(),
  renderAbout({
    countries: published.length,
    years,
    generatedAt,
    computedCountries: fallbackCountries().map((code) => countryInfo(code).name),
  }),
);
await write(url.privacy(), renderPrivacy({ generatedAt }));
await write('404.html', notFoundPage());

function pickFeatured(list) {
  const wanted = config.featured
    .map((code) => list.find((country) => country.code === code.toUpperCase()))
    .filter(Boolean);
  const filler = list.filter((country) => !wanted.includes(country));
  return [...wanted, ...filler].slice(0, 8).map((country) => ({
    ...country,
    stats: country.statsByYear[currentYear],
  }));
}

function notFoundPage() {
  // Rendered through the same layout so a 404 still looks like the site.
  return renderCountriesIndex({ countries: published, year: currentYear, years })
    .replace(
      '<h1>Every country we hold data for</h1>',
      '<h1>That page is not on the board</h1>',
    )
    .replace(
      /<title>[^<]*<\/title>/,
      '<title>Page not found</title>',
    );
}

// --- 5. Machine-readable files ----------------------------------------------

await writeFile(
  path.join(outDir, 'countries.json'),
  JSON.stringify(
    {
      generated: new Date().toISOString(),
      years,
      countries: published.map((country) => ({
        code: country.code,
        name: country.name,
        region: country.region,
        flag: country.flag,
        url: url.country(country.code),
      })),
    },
    null,
    0,
  ),
);

const sitemapEntries = [
  { loc: url.home(), priority: '1.0', changefreq: 'daily' },
  { loc: url.today(), priority: '0.9', changefreq: 'daily' },
  { loc: url.countries(), priority: '0.8', changefreq: 'weekly' },
  { loc: url.about(), priority: '0.3', changefreq: 'monthly' },
  { loc: url.privacy(), priority: '0.2', changefreq: 'yearly' },
];
for (const country of published) {
  sitemapEntries.push({ loc: url.country(country.code), priority: '0.8', changefreq: 'weekly' });
  sitemapEntries.push({ loc: url.calculator(country.code), priority: '0.7', changefreq: 'monthly' });
  for (const year of years) {
    // The current year is the page people actually search for; past years decay.
    const priority =
      year === currentYear ? '0.9' : year > currentYear ? '0.6' : year === currentYear - 1 ? '0.4' : '0.2';
    sitemapEntries.push({
      loc: url.year(country.code, year),
      priority,
      changefreq: year >= currentYear ? 'weekly' : 'yearly',
    });
  }
}

const lastmod = todayISO;
await writeFile(
  path.join(outDir, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries
  .map(
    (entry) =>
      `  <url><loc>${url.absolute(entry.loc)}</loc><lastmod>${lastmod}</lastmod><changefreq>${
        entry.changefreq
      }</changefreq><priority>${entry.priority}</priority></url>`,
  )
  .join('\n')}
</urlset>
`,
);

await writeFile(
  path.join(outDir, 'robots.txt'),
  `User-agent: *
Allow: /

Sitemap: ${url.absolute('/sitemap.xml')}
`,
);

const publisherId = config.adsense.publisherId.trim();
await writeFile(
  path.join(outDir, 'ads.txt'),
  publisherId
    ? `google.com, ${publisherId.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`
    : `# No AdSense publisher ID configured.\n# Set adsense.publisherId in site.config.mjs and rebuild to generate this file.\n`,
);

// --- 6. Assets ---------------------------------------------------------------

await cp(path.resolve(root, 'assets'), path.join(outDir, 'assets'), { recursive: true });

// --- 7. Report ---------------------------------------------------------------

const seconds = ((Date.now() - started) / 1000).toFixed(1);
log(`  total pages:   ${pageCount}`);
log(`  sitemap urls:  ${sitemapEntries.length}`);
log(`  ads.txt:       ${publisherId ? 'generated' : 'placeholder (no publisher ID)'}`);
log(`  output:        ${path.relative(process.cwd(), outDir)}/`);
log(`  built in ${seconds}s\n`);
