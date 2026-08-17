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
import { BROWSER_MODULES } from './lib/browser-modules.mjs';
import { compareCountries } from './lib/compare.mjs';
import { countryInfo, flagEmoji } from './lib/countries.mjs';
import { eachDayOfYear, formatLong, iso, parseISO, todayUTC } from './lib/dates.mjs';
import { annotate, createEventSource, describeContext } from './lib/events.mjs';
import { demoCountries, demoEvents } from './lib/events-demo.mjs';
import { detailedCountries, fallbackCountries } from './lib/fallback.mjs';
import { enableSection, url, withoutAds } from './lib/html.mjs';
import { createSource } from './lib/source.mjs';
import { nextHolidayAcrossYears, yearStats } from './lib/stats.mjs';
import { teamOverlap } from './lib/team.mjs';
import { renderCompareIndex, renderComparePair } from './lib/pages/compare.mjs';
import { renderCalculator, renderCountryHub, renderYearPage } from './lib/pages/country.mjs';
import { renderCountryEvents, renderEventsHub } from './lib/pages/events.mjs';
import { renderLeavePlanner } from './lib/pages/leave.mjs';
import { renderTeam } from './lib/pages/team.mjs';
import {
  renderAbout,
  renderCountriesIndex,
  renderHome,
  renderPrivacy,
  renderToday,
} from './lib/pages/site.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const offline = process.argv.includes('--offline') || process.env.OFFLINE === '1';
const eventsDemo = process.argv.includes('--events-demo');
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

// Every link and asset on the site is written from the domain root, so a host
// that serves the site from a sub-folder — a GitHub Pages project site, for
// instance — would load the first page and 404 its stylesheet and every link.
// Better to say so at build time than to leave someone staring at a broken site.
if (new URL(config.url).pathname !== '/') {
  log(
    `\n  WARNING: url is '${config.url}', which has a path.\n` +
      `  This site links from the domain root, so it must be served at the root of a\n` +
      `  domain or subdomain — example.com or site.pages.dev, not example.com/site.\n` +
      `  See DEPLOY.md.\n`,
  );
}

const available = await source.availableCountries();
log(`  countries listed: ${available.length}`);

const countries = await pool(available, 8, async (entry) => {
  const info = countryInfo(entry.code);
  const byYear = {};
  const origins = {};
  let total = 0;
  let coverage = null;

  for (const year of years) {
    const { holidays, origin, coverage: yearCoverage } = await source.holidays(year, entry.code);
    byYear[year] = holidays;
    origins[year] = origin;
    total += holidays.length;
    // The weakest coverage across the range is what the country pages claim.
    if (yearCoverage === 'core' || coverage === null) coverage = yearCoverage;
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
    coverage,
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

// --- 1b. Events ---------------------------------------------------------------

/**
 * Events are the one optional source here: they need an API key, so a build
 * without one produces no event pages rather than empty ones or invented ones.
 */
const eventSource = createEventSource({
  apiBase: config.events.apiBase,
  apiKey: process.env[config.events.apiKeyEnv] || '',
  cacheDir: path.resolve(root, config.cacheDir),
  offline,
  windowDays: config.events.windowDays,
  perCategory: config.events.perCategory,
});

const wanted = config.events.countries.length
  ? config.events.countries.map((code) => code.toUpperCase())
  : published.map((country) => country.code);

const eventCountries = [];
if (eventsDemo) {
  log('  events:        SAMPLE DATA (--events-demo) — invented listings, marked noindex');
} else if (!eventSource.enabled) {
  log(
    `  events:        skipped (${
      offline ? 'offline build' : 'no TICKETMASTER_API_KEY set'
    }) — no event pages generated`,
  );
}

if (eventsDemo || eventSource.enabled) {
  for (const country of published) {
    if (!wanted.includes(country.code)) continue;

    const buckets = eventsDemo
      ? demoCountries().includes(country.code)
        ? demoEvents(country.code, config.events)
        : null
      : await eventSource.forCountry(country.code);
    if (!buckets) continue;

    // Tie every listing back to that country's calendar.
    const holidaysByDate = new Map();
    for (const year of years) {
      for (const holiday of country.byYear[year]) holidaysByDate.set(holiday.date, holiday);
    }

    const byCategory = {};
    for (const key of ['concerts', 'comedy', 'events']) {
      byCategory[key] = annotate(buckets[key] || [], holidaysByDate);
    }
    const all = [...byCategory.concerts, ...byCategory.comedy, ...byCategory.events].sort((a, b) =>
      a.date === b.date ? a.name.localeCompare(b.name, 'en') : a.date < b.date ? -1 : 1,
    );

    country.events = {
      all,
      ...byCategory,
      // Built once per country: the per-listing detail needs to know what else
      // is on nearby, which only makes sense across the whole set.
      describe: describeContext(all, {
        countryName: country.name,
        today: todayISO,
        holidaysByDate,
      }),
      counts: {
        all: all.length,
        concerts: byCategory.concerts.length,
        comedy: byCategory.comedy.length,
        events: byCategory.events.length,
      },
    };
    eventCountries.push(country);
  }

  if (eventCountries.length) {
    enableSection('events');
    const listings = eventCountries.reduce((sum, country) => sum + country.events.counts.all, 0);
    log(
      `  events:        ${listings} listings across ${eventCountries.length} countries` +
        (eventsDemo ? ' (sample)' : ` · live ${eventSource.stats.live} · cache ${eventSource.stats.cache}`),
    );
    if (eventSource.stats.errors.length) log(`  events note:   ${eventSource.stats.errors[0]}`);
  }
}

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

  await write(
    url.leave(country.code),
    renderLeavePlanner({
      country,
      years,
      byYear: country.byYear,
      currentYear,
      today: todayISO,
    }),
  );

  if (country.events) {
    // "all" always; the named streams only when they have something in them,
    // so there is no such thing as an empty comedy page.
    for (const view of ['all', 'concerts', 'comedy']) {
      const events = view === 'all' ? country.events.all : country.events[view];
      if (view !== 'all' && !events.length) continue;
      const render = () =>
        renderCountryEvents({
          country,
          view,
          events,
          counts: country.events.counts,
          currentYear,
          demo: eventsDemo,
          context: country.events.describe,
        });
      // Invented listings are never monetised, so a demo build cannot put ad
      // code next to content that is not real.
      await write(url.countryEvents(country.code, view), eventsDemo ? withoutAds(render) : render());
    }
  }
});
log(`  country pages: ${pageCount}`);

if (eventCountries.length) {
  const renderHub = () =>
    renderEventsHub({
      countries: eventCountries.map((country) => ({
        code: country.code,
        name: country.name,
        flag: country.flag,
        counts: country.events.counts,
        next: country.events.all[0] || null,
      })),
      demo: eventsDemo,
      today: todayISO,
    });
  await write(url.events(), eventsDemo ? withoutAds(renderHub) : renderHub());
}

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

// --- 4b. Comparison ----------------------------------------------------------

/** The handful of listings the comparison shows, small enough to embed. */
const eventsForCompare = (country) =>
  country.events
    ? {
        counts: country.events.counts,
        list: country.events.all.slice(0, 6).map((event) => ({
          date: event.date,
          name: event.name,
          venue: event.venue,
          city: event.city,
          holiday: event.holiday ? event.holiday.name : null,
        })),
      }
    : null;

/** One country shaped for compareCountries(), for a single year. */
const forCompare = (country, year) => ({
  code: country.code,
  name: country.name,
  flag: country.flag,
  holidays: country.byYear[year],
  stats: country.statsByYear[year],
  events: eventsForCompare(country),
});

// Pre-render every pairing of the featured countries. Any other pairing is
// built in the browser by the same modules, so coverage is not limited to
// what is on disk.
const featuredForPairs = config.featured
  .map((code) => published.find((country) => country.code === code.toUpperCase()))
  .filter(Boolean);

const pairs = [];
for (let i = 0; i < featuredForPairs.length; i += 1) {
  for (let j = i + 1; j < featuredForPairs.length; j += 1) {
    const [a, b] = [featuredForPairs[i], featuredForPairs[j]].sort((x, y) =>
      x.code < y.code ? -1 : 1,
    );
    pairs.push({ a, b });
  }
}

const pairSummaries = [];
for (const { a, b } of pairs) {
  const result = compareCountries(forCompare(a, currentYear), forCompare(b, currentYear), currentYear);
  await write(url.pair(a.code, b.code), renderComparePair({ result, years, today: todayISO }));
  pairSummaries.push({ a, b, shared: result.shared.length });
}

await write(
  url.compare(),
  renderCompareIndex({
    countries: published,
    years,
    currentYear,
    pairs: pairSummaries.map((pair) => ({
      a: { ...pair.a, stats: pair.a.statsByYear[currentYear] },
      b: { ...pair.b, stats: pair.b.statsByYear[currentYear] },
      shared: pair.shared,
    })),
  }),
);

// --- 4c. Team overlap ---------------------------------------------------------

// A realistic default line-up rather than an arbitrary one: three countries on
// three continents, which is what makes the problem visible in the first place.
const teamDefaults = ['US', 'GB', 'IN']
  .map((code) => published.find((country) => country.code === code))
  .filter(Boolean);
const teamMembers = (
  teamDefaults.length >= 2 ? teamDefaults : published.slice(0, 3)
).map((country) => ({
  code: country.code,
  name: country.name,
  flag: country.flag,
  holidays: country.byYear[currentYear],
}));

await write(
  url.team(),
  renderTeam({
    countries: published,
    overlap: teamOverlap(currentYear, teamMembers, { today: todayISO }),
    years,
    currentYear,
    today: todayISO,
    defaultCodes: teamMembers.map((member) => member.code),
  }),
);

// Per-country data for the browser-side comparison: one small file each, so a
// visitor downloads two countries rather than the whole world.
await mkdir(path.join(outDir, 'data'), { recursive: true });
for (const country of published) {
  await writeFile(
    path.join(outDir, 'data', `${country.code}.json`),
    JSON.stringify({
      code: country.code,
      name: country.name,
      flag: country.flag,
      region: country.region,
      events: eventsForCompare(country),
      years: Object.fromEntries(
        years.map((year) => [
          year,
          { holidays: country.byYear[year], stats: country.statsByYear[year] },
        ]),
      ),
    }),
  );
}

// The comparison pages import these straight from the browser.
for (const relative of BROWSER_MODULES) {
  const destination = path.join(outDir, 'assets', 'mjs', relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(path.resolve(root, relative), destination);
}

const generatedAt = `${formatLong(today)} (UTC)`;
await write(
  url.about(),
  renderAbout({
    countries: published.length,
    years,
    generatedAt,
    computedCountries: detailedCountries().map((code) => countryInfo(code).name),
    coreCount: fallbackCountries().length - detailedCountries().length,
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
  // Rendered through the same layout so a 404 still looks like the site, and
  // carries the country finder so the visitor can get where they meant to go.
  // Pair URLs are alphabetical (/compare/de-vs-fr/, never fr-vs-de), so this is
  // also where someone who typed the pair the other way round lands.
  return withoutAds(() => renderCountriesIndex({ countries: published, year: currentYear, years }))
    .replace('<h1>Every country we hold data for</h1>', '<h1>That page is not on the board</h1>')
    .replace(
      /<p class="lede hero__lede">[\s\S]*?<\/p>/,
      `<p class="lede hero__lede">The address you asked for is not here. Search for a country below,
        <a href="${url.compare()}">compare two countries</a>, or go back to the
        <a href="${url.home()}">home page</a>.</p>`,
    )
    .replace(/<title>[^<]*<\/title>/, '<title>Page not found</title>')
    .replace(
      /<meta name="description" content="[^"]*">/,
      '<meta name="description" content="That page was not found. Search for a country, compare two countries, or start from the home page.">',
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
  { loc: url.compare(), priority: '0.8', changefreq: 'weekly' },
  { loc: url.team(), priority: '0.8', changefreq: 'weekly' },
  { loc: url.countries(), priority: '0.8', changefreq: 'weekly' },
  { loc: url.about(), priority: '0.3', changefreq: 'monthly' },
  { loc: url.privacy(), priority: '0.2', changefreq: 'yearly' },
];
for (const { a, b } of pairs) {
  sitemapEntries.push({ loc: url.pair(a.code, b.code), priority: '0.7', changefreq: 'weekly' });
}

// Sample listings are noindex, so they stay out of the sitemap entirely.
if (eventCountries.length && !eventsDemo) {
  sitemapEntries.push({ loc: url.events(), priority: '0.8', changefreq: 'daily' });
  for (const country of eventCountries) {
    sitemapEntries.push({
      loc: url.countryEvents(country.code, 'all'),
      priority: '0.7',
      changefreq: 'daily',
    });
    for (const view of ['concerts', 'comedy']) {
      if (country.events.counts[view]) {
        sitemapEntries.push({
          loc: url.countryEvents(country.code, view),
          priority: '0.6',
          changefreq: 'daily',
        });
      }
    }
  }
}
for (const country of published) {
  sitemapEntries.push({ loc: url.country(country.code), priority: '0.8', changefreq: 'weekly' });
  sitemapEntries.push({ loc: url.calculator(country.code), priority: '0.7', changefreq: 'monthly' });
  sitemapEntries.push({ loc: url.leave(country.code), priority: '0.7', changefreq: 'monthly' });
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
log(`  comparisons:   ${pairs.length} pre-rendered pairs · any pairing in the browser`);
log(`  sitemap urls:  ${sitemapEntries.length}`);
log(`  ads.txt:       ${publisherId ? 'generated' : 'placeholder (no publisher ID)'}`);
log(`  output:        ${path.relative(process.cwd(), outDir)}/`);
log(`  built in ${seconds}s\n`);
