import test from 'node:test';
import assert from 'node:assert/strict';

import { compareCountries } from '../lib/compare.mjs';
import { countryInfo, flagEmoji, groupByRegion } from '../lib/countries.mjs';
import { compareBody, renderCompareIndex, renderComparePair } from '../lib/pages/compare.mjs';
import { fallbackHolidays } from '../lib/fallback.mjs';
import { esc, url } from '../lib/html.mjs';
import { yearRibbon } from '../lib/ribbon.mjs';
import { nextHolidayAcrossYears, yearStats } from '../lib/stats.mjs';
import { renderCalculator, renderCountryHub, renderYearPage } from '../lib/pages/country.mjs';
import { renderAbout, renderCountriesIndex, renderHome, renderPrivacy, renderToday } from '../lib/pages/site.mjs';

const YEARS = [2025, 2026, 2027, 2028, 2029, 2030];
const TODAY = '2026-08-15';

function buildCountry(code) {
  const info = countryInfo(code);
  const byYear = Object.fromEntries(YEARS.map((year) => [year, fallbackHolidays(code, year)]));
  return {
    ...info,
    flag: flagEmoji(code),
    byYear,
    origins: Object.fromEntries(YEARS.map((year) => [year, 'computed'])),
    statsByYear: Object.fromEntries(
      YEARS.map((year) => [year, yearStats(year, byYear[year], new Date(`${TODAY}T00:00:00Z`))]),
    ),
    next: nextHolidayAcrossYears(byYear, new Date(`${TODAY}T00:00:00Z`)),
  };
}

const US = buildCountry('US');
const GB = buildCountry('GB');

function yearPage(country, year) {
  return renderYearPage({
    country,
    year,
    holidays: country.byYear[year],
    stats: country.statsByYear[year],
    years: YEARS,
    origin: 'computed',
    today: TODAY,
  });
}

test('a year page carries the SEO tags it claims to', () => {
  const html = yearPage(US, 2026);
  assert.match(html, /<title>Public holidays in United States 2026[^<]*<\/title>/);
  assert.match(html, /<link rel="canonical" href="[^"]+\/us\/2026\/">/);
  assert.match(html, /<meta property="og:title"/);
  assert.match(html, /<meta property="og:url" content="[^"]+\/us\/2026\/">/);
  assert.match(html, /<meta name="description" content="[^"]{80,}">/);
});

test('the year page ships valid Dataset JSON-LD built from its own numbers', () => {
  const html = yearPage(US, 2026);
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.equal(blocks.length, 1);
  const parsed = JSON.parse(blocks[0][1]);
  const dataset = parsed.find((entry) => entry['@type'] === 'Dataset');
  const crumbs = parsed.find((entry) => entry['@type'] === 'BreadcrumbList');
  assert.ok(dataset && crumbs);
  assert.equal(dataset.spatialCoverage.identifier, 'US');
  assert.equal(dataset.temporalCoverage, '2026-01-01/2026-12-31');
  const holidays = dataset.variableMeasured.find((v) => v.name === 'Public holidays');
  assert.equal(holidays.value, US.statsByYear[2026].total);
  assert.equal(crumbs.itemListElement.length, 3);
});

test('meta descriptions differ between country-years', () => {
  const descriptions = new Set();
  for (const country of [US, GB]) {
    for (const year of YEARS) {
      const html = yearPage(country, year);
      descriptions.add(html.match(/<meta name="description" content="([^"]+)">/)[1]);
    }
  }
  assert.equal(descriptions.size, 12, 'every page describes its own numbers');
});

test('page numbers agree with the stats they came from', () => {
  const stats = GB.statsByYear[2027];
  const html = yearPage(GB, 2027);
  assert.match(html, new RegExp(`>${stats.total}<`));
  assert.match(html, new RegExp(`>${stats.workingDays.toLocaleString('en')}<`));
  assert.match(html, new RegExp(`>${stats.longestGap.days}<`));
  // Every holiday in the list reaches the table.
  for (const holiday of GB.byYear[2027]) assert.ok(html.includes(holiday.date), holiday.date);
});

test('user-supplied strings are escaped, not interpolated raw', () => {
  const hostile = {
    ...countryInfo('CI'),
    flag: flagEmoji('CI'),
    byYear: { 2026: [{ date: '2026-01-01', name: '<script>alert(1)</script>', national: true }] },
    origins: { 2026: 'live' },
  };
  hostile.statsByYear = { 2026: yearStats(2026, hostile.byYear[2026]) };
  const html = renderYearPage({
    country: hostile,
    year: 2026,
    holidays: hostile.byYear[2026],
    stats: hostile.statsByYear[2026],
    years: [2026],
    origin: 'live',
    today: TODAY,
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
  // An apostrophe in a real country name survives as an entity, not a broken attribute.
  assert.match(html, /C&#39;te|Côte/);
  assert.equal(esc(`"><img src=x onerror=y>`), '&quot;&gt;&lt;img src=x onerror=y&gt;');
});

test('the calculator embeds parseable holiday data for every published year', () => {
  const html = renderCalculator({ country: GB, years: YEARS, byYear: GB.byYear, today: TODAY });
  const payload = JSON.parse(
    html.match(/<script type="application\/json" id="holiday-data">([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, '<'),
  );
  assert.equal(payload.country, 'GB');
  assert.deepEqual(Object.keys(payload.holidays).map(Number), YEARS);
  assert.equal(payload.holidays[2027][0].date, '2027-01-01');
  assert.equal(payload.defaults.start, TODAY);
  assert.match(html, /id="calc-start"/);
  assert.match(html, /id="calc-end"/);
  assert.match(html, /assets\/calculator\.js/);
  assert.match(html, /<noscript>/);
});

test('embedded JSON cannot break out of its script element', () => {
  const country = {
    ...GB,
    byYear: { 2026: [{ date: '2026-01-01', name: '</script><script>alert(1)</script>', national: true }] },
  };
  const html = renderCalculator({ country, years: [2026], byYear: country.byYear, today: TODAY });
  assert.ok(!/<\/script><script>alert/.test(html));
  assert.match(html, /\\u003c\/script/);
});

test('the ribbon has one cell per day, aligned to a 37-column grid', () => {
  const html = yearRibbon(2028, { holidays: new Map(), today: TODAY }); // leap year
  const rows = html.match(/class="ribbon__row"/g) || [];
  assert.equal(rows.length, 12);
  const cells = html.match(/class="cell[^"]*"/g) || [];
  assert.equal(cells.length, 12 * 37, 'every row is padded to the same width');
  const pads = html.match(/cell--pad/g) || [];
  assert.equal(cells.length - pads.length, 366, '2028 is a leap year');
});

test('the ribbon marks holidays, weekends and today', () => {
  const holidays = new Map(GB.byYear[2026].map((h) => [h.date, h]));
  const html = yearRibbon(2026, { holidays, today: '2026-08-15' });
  assert.equal((html.match(/is-holiday/g) || []).length, GB.byYear[2026].length);
  assert.equal((html.match(/is-today/g) || []).length, 1);
  assert.ok((html.match(/is-weekend/g) || []).length > 100);
  assert.match(html, /role="img"/);
  assert.match(html, /aria-label="[^"]+"/);
});

test('the heat ribbon scales its cells and never emits a raw NaN', () => {
  const heat = new Map([
    ['2026-01-01', 1],
    ['2026-12-25', 0.5],
  ]);
  const html = yearRibbon(2026, { heat });
  assert.match(html, /--k:1\.000/);
  assert.match(html, /--k:0\.500/);
  assert.ok(!html.includes('NaN'));
});

test('every generated page is a complete, single-rooted document', () => {
  const shared = { countries: [US, GB], years: YEARS, year: 2026 };
  const pages = [
    yearPage(US, 2026),
    renderCountryHub({
      country: US,
      years: YEARS,
      byYear: US.byYear,
      statsByYear: US.statsByYear,
      next: US.next,
      currentYear: 2026,
      today: TODAY,
    }),
    renderCalculator({ country: US, years: YEARS, byYear: US.byYear, today: TODAY }),
    renderHome({
      ...shared,
      featured: [US, GB].map((c) => ({ ...c, stats: c.statsByYear[2026] })),
      heat: new Map([['2026-01-01', 1]]),
      peak: { date: 'Thursday 1 January 2026', count: 2 },
      today: TODAY,
      todayCount: 0,
    }),
    renderCountriesIndex(shared),
    renderToday({
      today: TODAY,
      entries: [{ country: US, holiday: US.byYear[2026][0] }],
      tomorrow: [],
      upcoming: [{ country: GB, holiday: GB.byYear[2026][0] }],
      countryCount: 2,
    }),
    renderAbout({ countries: 2, years: YEARS, generatedAt: 'today', computedCountries: ['United States'], coreCount: 187 }),
    renderPrivacy({ generatedAt: 'today' }),
  ];

  for (const html of pages) {
    assert.ok(html.startsWith('<!doctype html>'), 'has a doctype');
    assert.equal((html.match(/<html/g) || []).length, 1);
    assert.equal((html.match(/<\/html>/g) || []).length, 1);
    assert.equal((html.match(/<main/g) || []).length, 1);
    assert.equal((html.match(/<h1/g) || []).length, 1, 'exactly one h1');
    assert.match(html, /<a class="skip" href="#main">/);
    assert.match(html, /<link rel="canonical"/);
    assert.match(html, /class="ad ad--leaderboard/);
    assert.match(html, /class="ad ad--footer/);
    assert.ok(!html.includes('undefined'), 'no undefined leaked into the markup');
    assert.ok(!html.includes('[object Object]'));
    assert.ok(!/>\s*NaN\s*</.test(html));
  }
});

test('ad slots fall back to placeholders when no publisher ID is set', () => {
  const html = yearPage(US, 2026);
  // site.config.mjs ships with an empty publisher ID.
  assert.match(html, /ad--placeholder/);
  assert.ok(!html.includes('pagead2.googlesyndication.com'), 'no ad code on an unapproved site');
  assert.equal((html.match(/class="ad /g) || []).length, 3, 'three slots on the page');
});

test('privacy page names what actually happens on the page', () => {
  const html = renderPrivacy({ generatedAt: 'today' });
  for (const needle of ['AdSense', 'fonts.gstatic.com', 'hb-consent', 'never sent', 'CMP']) {
    assert.ok(html.includes(needle), `privacy policy mentions ${needle}`);
  }
});

test('URLs are lowercase and directory-shaped', () => {
  assert.equal(url.country('US'), '/us/');
  assert.equal(url.year('gb', 2026), '/gb/2026/');
  assert.equal(url.calculator('DE'), '/de/business-days-calculator/');
  assert.match(url.absolute('/us/'), /^https?:\/\/[^/]+\/us\/$/);
});

test('a pair has exactly one address, whichever order you ask for', () => {
  assert.equal(url.pair('US', 'GB'), '/compare/gb-vs-us/');
  assert.equal(url.pair('gb', 'us'), '/compare/gb-vs-us/');
  assert.equal(url.pair('DE', 'FR'), '/compare/de-vs-fr/');
  assert.equal(url.holiday('DE', '2026-12-25'), '/de/2026/#2026-12-25');
  assert.match(url.compareQuery('DE', 'FR', 2027), /^\/compare\/\?a=DE&b=FR&year=2027$/);
});

// --- Comparison pages ------------------------------------------------------

const COMPARISON = compareCountries(
  { code: 'US', name: 'United States', flag: '🇺🇸', holidays: US.byYear[2026], stats: US.statsByYear[2026] },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', holidays: GB.byYear[2026], stats: GB.statsByYear[2026] },
  2026,
);

test('a pair page carries its own SEO tags and Dataset JSON-LD', () => {
  const html = renderComparePair({ result: COMPARISON, years: YEARS, today: TODAY });
  assert.match(html, /<title>United States vs United Kingdom[^<]*<\/title>/);
  assert.match(html, /<link rel="canonical" href="[^"]+\/compare\/gb-vs-us\/">/);
  assert.match(html, /<meta name="description" content="[^"]{80,}">/);

  const parsed = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const dataset = parsed.find((entry) => entry['@type'] === 'Dataset');
  assert.equal(dataset.spatialCoverage.length, 2);
  assert.deepEqual(
    dataset.spatialCoverage.map((place) => place.identifier),
    ['US', 'GB'],
  );
  const sharedMeasure = dataset.variableMeasured.find((v) => v.name === 'Shared days off');
  assert.equal(sharedMeasure.value, COMPARISON.shared.length);
});

test('the pair page renders the comparison server-side, not only in the browser', () => {
  const html = renderComparePair({ result: COMPARISON, years: YEARS, today: TODAY });
  // Every number a visitor reads is in the HTML before any script runs.
  assert.match(html, /Head to head, 2026/);
  assert.match(html, /class="highlights"/);
  assert.match(html, /class="ribbon ribbon--twin"/);
  assert.ok(html.includes(String(US.statsByYear[2026].workingDays)));
  assert.ok(html.includes(String(GB.statsByYear[2026].workingDays)));
  for (const holiday of COMPARISON.shared) assert.ok(html.includes(holiday.date));
  // And it hands the browser what it needs to re-render another year.
  assert.match(html, /id="compare-body" data-a="US" data-b="GB" data-year="2026"/);
  assert.match(html, /<script type="module" src="\/assets\/compare\.js"><\/script>/);
});

test('comparison links point back into the site for research', () => {
  const body = compareBody(COMPARISON, { years: YEARS, today: TODAY });
  // Each country hub, each year page, each calculator, and every shared date.
  assert.ok(body.includes('href="/us/"'));
  assert.ok(body.includes('href="/gb/"'));
  assert.ok(body.includes('href="/us/2026/"'));
  assert.ok(body.includes('href="/gb/2026/"'));
  assert.ok(body.includes('href="/us/business-days-calculator/"'));
  assert.ok(body.includes('href="/gb/business-days-calculator/"'));
  for (const item of COMPARISON.shared) {
    assert.ok(body.includes(`href="/us/2026/#${item.date}"`), `${item.date} links to the US calendar`);
  }
});

test('the shared body carries no ad slots, because the browser injects it', () => {
  const body = compareBody(COMPARISON, { years: YEARS, today: TODAY });
  assert.ok(!body.includes('class="ad '), 'no ad markup inside the swappable region');
  assert.ok(!body.includes('adsbygoogle'));
  // The page shell around it still has all three.
  const html = renderComparePair({ result: COMPARISON, years: YEARS, today: TODAY });
  assert.equal((html.match(/class="ad /g) || []).length, 3);
});

test('year chips offer every published year and mark the current one', () => {
  const body = compareBody(COMPARISON, { years: YEARS, today: TODAY });
  for (const year of YEARS) assert.ok(body.includes(`data-year="${year}"`), `${year} chip`);
  assert.match(body, /data-year="2026" aria-current="page"/);
});

test('hostile country data cannot break out of the comparison markup', () => {
  const nasty = compareCountries(
    {
      code: 'US',
      name: '<script>alert(1)</script>',
      flag: '',
      holidays: [{ date: '2026-01-01', name: '"><img src=x onerror=y>', national: true }],
      stats: yearStats(2026, [{ date: '2026-01-01', name: 'x', national: true }]),
    },
    { code: 'GB', name: 'United Kingdom', flag: '', holidays: GB.byYear[2026], stats: GB.statsByYear[2026] },
    2026,
  );
  const body = compareBody(nasty, { years: [2026], today: TODAY });
  assert.ok(!body.includes('<script>alert(1)</script>'));
  assert.ok(!body.includes('<img src=x'));
  assert.match(body, /&lt;script&gt;|&lt;img/);
});

test('the comparison hub lists ready-made pairs and stays usable without JS', () => {
  const html = renderCompareIndex({
    countries: [
      { ...US, stats: US.statsByYear[2026] },
      { ...GB, stats: GB.statsByYear[2026] },
    ],
    years: YEARS,
    currentYear: 2026,
    pairs: [
      {
        a: { ...US, stats: US.statsByYear[2026] },
        b: { ...GB, stats: GB.statsByYear[2026] },
        shared: COMPARISON.shared.length,
      },
    ],
  });
  assert.match(html, /<title>Compare two countries[^<]*<\/title>/);
  assert.match(html, /<link rel="canonical" href="[^"]+\/compare\/">/);
  assert.match(html, /id="pick-a"/);
  assert.match(html, /id="pick-b"/);
  assert.match(html, /id="pick-year"/);
  assert.match(html, /<noscript>/);
  // The pre-built pairings are plain links, so they work with scripting off.
  assert.match(html, /href="\/compare\/gb-vs-us\/"/);
  assert.equal((html.match(/<h1/g) || []).length, 1);
});

test('every comparison page is a complete document', () => {
  for (const html of [
    renderComparePair({ result: COMPARISON, years: YEARS, today: TODAY }),
    renderCompareIndex({
      countries: [
        { ...US, stats: US.statsByYear[2026] },
        { ...GB, stats: GB.statsByYear[2026] },
      ],
      years: YEARS,
      currentYear: 2026,
      pairs: [],
    }),
  ]) {
    assert.ok(html.startsWith('<!doctype html>'));
    assert.equal((html.match(/<h1/g) || []).length, 1);
    assert.match(html, /<a class="skip" href="#main">/);
    assert.ok(!html.includes('undefined'));
    assert.ok(!html.includes('[object Object]'));
    assert.ok(!/>\s*NaN\s*</.test(html));
  }
});

test('countries group into regions in a stable order', () => {
  const groups = groupByRegion([countryInfo('ZW'), countryInfo('US'), countryInfo('FR'), countryInfo('AU')]);
  assert.deepEqual(
    groups.map(([region]) => region),
    ['Africa', 'Americas', 'Europe', 'Oceania'],
  );
});
