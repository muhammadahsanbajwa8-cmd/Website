import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  CATEGORIES,
  annotate,
  classify,
  createEventSource,
  describeContext,
  describeEvent,
  eventStats,
  groupByMonth,
  normalise,
} from '../lib/events.mjs';
import { demoCountries, demoEvents } from '../lib/events-demo.mjs';
import { fallbackHolidays } from '../lib/fallback.mjs';
import { url } from '../lib/html.mjs';
import { iso, todayUTC } from '../lib/dates.mjs';
import { renderCountryEvents, renderEventsHub } from '../lib/pages/events.mjs';

/** A Discovery API event, in the shape Ticketmaster actually returns. */
function tmEvent(overrides = {}) {
  return {
    name: 'Marta Vey',
    id: 'G5vYZ9abc',
    url: 'https://www.ticketmaster.de/event/12345',
    dates: {
      start: { localDate: '2026-09-12', localTime: '20:00:00', dateTime: '2026-09-12T18:00:00Z' },
      timezone: 'Europe/Berlin',
      status: { code: 'onsale' },
    },
    classifications: [
      {
        primary: true,
        segment: { id: 'KZFzniwnSyZfZ7v7nJ', name: 'Music' },
        genre: { id: 'KnvZfZ7vAeA', name: 'Rock' },
        subGenre: { name: 'Pop' },
      },
    ],
    _embedded: {
      venues: [
        {
          name: 'Rathaus Hall',
          city: { name: 'Berlin' },
          country: { name: 'Germany', countryCode: 'DE' },
        },
      ],
    },
    ...overrides,
  };
}

// --- Classification and normalisation ---------------------------------------

test('the three published streams are concerts, comedy and everything else', () => {
  assert.deepEqual(
    CATEGORIES.map((category) => category.key),
    ['concerts', 'comedy', 'events'],
  );
});

test('events are classified by their primary classification', () => {
  assert.equal(classify(tmEvent()), 'concerts');
  assert.equal(
    classify(
      tmEvent({
        classifications: [
          { primary: true, segment: { name: 'Arts & Theatre' }, genre: { name: 'Comedy' } },
        ],
      }),
    ),
    'comedy',
  );
  assert.equal(
    classify(
      tmEvent({
        classifications: [
          { primary: true, segment: { name: 'Arts & Theatre' }, genre: { name: 'Theatre' } },
        ],
      }),
    ),
    'events',
  );
  assert.equal(classify(tmEvent({ classifications: [] })), 'events');
  // A music event whose sub-genre is comedy is a comedy show.
  assert.equal(
    classify(
      tmEvent({
        classifications: [
          { primary: true, segment: { name: 'Music' }, genre: { name: 'Other' }, subGenre: { name: 'Comedy' } },
        ],
      }),
    ),
    'comedy',
  );
});

test('normalising keeps what the page shows and nothing else', () => {
  const event = normalise(tmEvent());
  assert.deepEqual(event, {
    id: 'G5vYZ9abc',
    name: 'Marta Vey',
    url: 'https://www.ticketmaster.de/event/12345',
    date: '2026-09-12',
    time: '20:00',
    venue: 'Rathaus Hall',
    city: 'Berlin',
    country: 'DE',
    category: 'concerts',
    genre: 'Rock',
    status: 'onsale',
  });
});

test('a to-be-announced time is null rather than a fake time', () => {
  const tba = normalise(
    tmEvent({ dates: { start: { localDate: '2026-09-12', timeTBA: true }, status: { code: 'onsale' } } }),
  );
  assert.equal(tba.time, null);
  const noTime = normalise(
    tmEvent({
      dates: { start: { localDate: '2026-09-12', noSpecificTime: true, localTime: '00:00:00' }, status: {} },
    }),
  );
  assert.equal(noTime.time, null);
});

test('unusable rows are dropped, not patched up', () => {
  assert.equal(normalise(tmEvent({ dates: { start: { dateTBA: true } } })), null);
  assert.equal(normalise(tmEvent({ dates: { start: { localDate: 'soon' } } })), null);
  // A missing venue is survivable; a missing date is not.
  const noVenue = normalise(tmEvent({ _embedded: {} }));
  assert.equal(noVenue.venue, null);
  assert.equal(noVenue.city, null);
});

test('only https ticket links are kept', () => {
  assert.equal(normalise(tmEvent({ url: 'javascript:alert(1)' })).url, null);
  assert.equal(normalise(tmEvent({ url: 'http://insecure.example' })).url, null);
  assert.equal(normalise(tmEvent({ url: undefined })).url, null);
});

// --- Tying events back to the calendar --------------------------------------

test('listings are flagged when they fall on a public holiday or a weekend', () => {
  const holidays = new Map(fallbackHolidays('DE', 2026).map((h) => [h.date, h]));
  const annotated = annotate(
    [
      { date: '2026-10-03', name: 'A' }, // German Unity Day, a Saturday
      { date: '2026-10-05', name: 'B' }, // Monday
      { date: '2026-10-10', name: 'C' }, // Saturday
    ],
    holidays,
  );
  assert.equal(annotated[0].holiday.name, 'German Unity Day');
  assert.equal(annotated[0].weekend, true);
  assert.equal(annotated[0].weekday, 'Saturday');
  assert.equal(annotated[1].holiday, null);
  assert.equal(annotated[1].weekend, false);
  assert.equal(annotated[2].holiday, null);
  assert.equal(annotated[2].weekend, true);
});

test('events group into months and days in order', () => {
  const events = annotate(
    [
      { date: '2026-09-12', name: 'One' },
      { date: '2026-09-12', name: 'Two' },
      { date: '2026-09-30', name: 'Three' },
      { date: '2026-10-01', name: 'Four' },
    ],
    new Map(),
  );
  const months = groupByMonth(events);
  assert.equal(months.length, 2);
  assert.equal(months[0].label, 'September 2026');
  assert.equal(months[0].count, 3);
  assert.equal(months[0].days.length, 2);
  assert.equal(months[0].days[0].events.length, 2);
  assert.equal(months[1].label, 'October 2026');
  assert.equal(months[1].days[0].date, '2026-10-01');
});

test('stats summarise a listing set', () => {
  const holidays = new Map(fallbackHolidays('DE', 2026).map((h) => [h.date, h]));
  const events = annotate(
    [
      { date: '2026-10-03', name: 'A', city: 'Berlin', genre: 'Rock' },
      { date: '2026-10-05', name: 'B', city: 'Berlin', genre: 'Rock' },
      { date: '2026-10-06', name: 'C', city: 'Munich', genre: 'Jazz' },
    ],
    holidays,
  );
  const stats = eventStats(events);
  assert.equal(stats.total, 3);
  assert.equal(stats.cities, 2);
  assert.equal(stats.onHolidays, 1);
  assert.equal(stats.first.name, 'A');
  assert.equal(stats.last.name, 'C');
  assert.deepEqual(stats.topGenres[0], { name: 'Rock', count: 2 });
});

// --- The source --------------------------------------------------------------

function startApi() {
  let requests = 0;
  let mode = 'ok';
  const server = http.createServer((req, res) => {
    requests += 1;
    if (mode === 'error') {
      res.writeHead(500).end('nope');
      return;
    }
    if (mode === 'ratelimit') {
      res.writeHead(429).end('slow down');
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    const segment = url.searchParams.get('segmentName') || url.searchParams.get('classificationName');
    const events =
      segment === 'Music'
        ? [tmEvent(), tmEvent({ id: 'cancelled', dates: { start: { localDate: '2026-09-20' }, status: { code: 'cancelled' } } })]
        : segment === 'Comedy'
          ? [
              tmEvent({
                id: 'comedy1',
                name: 'Dara Nunn: Half Measures',
                classifications: [{ primary: true, segment: { name: 'Arts & Theatre' }, genre: { name: 'Comedy' } }],
              }),
            ]
          : [
              tmEvent({
                id: 'play1',
                name: 'The Glass Ceiling',
                classifications: [{ primary: true, segment: { name: 'Arts & Theatre' }, genre: { name: 'Theatre' } }],
              }),
            ];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ _embedded: { events }, page: { totalElements: events.length } }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done)),
        get requests() {
          return requests;
        },
        fail: (kind) => {
          mode = kind;
        },
      }),
    );
  });
}

const sourceOptions = (base, cacheDir, extra = {}) => ({
  apiBase: base,
  apiKey: 'test-key',
  cacheDir,
  windowDays: 120,
  perCategory: 60,
  ...extra,
});

test('without an API key the source is off and returns nothing', async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'hb-events-'));
  const source = createEventSource(sourceOptions('http://127.0.0.1:1', cacheDir, { apiKey: '' }));
  assert.equal(source.enabled, false);
  assert.equal(await source.forCountry('DE'), null);
  await rm(cacheDir, { recursive: true, force: true });
});

test('an offline build never asks for events, even with a key', async (t) => {
  const api = await startApi();
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'hb-events-'));
  t.after(async () => {
    await api.close();
    await rm(cacheDir, { recursive: true, force: true });
  });

  const source = createEventSource(sourceOptions(api.base, cacheDir, { offline: true }));
  assert.equal(source.enabled, false);
  assert.equal(await source.forCountry('DE'), null);
  assert.equal(api.requests, 0);
});

test('a live fetch buckets by category, drops cancellations, and caches', async (t) => {
  const api = await startApi();
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'hb-events-'));
  t.after(async () => {
    await api.close();
    await rm(cacheDir, { recursive: true, force: true });
  });

  const source = createEventSource(sourceOptions(api.base, cacheDir));
  const result = await source.forCountry('DE');

  assert.equal(result.origin, 'live');
  assert.equal(result.concerts.length, 1, 'the cancelled show is dropped');
  assert.equal(result.concerts[0].name, 'Marta Vey');
  assert.equal(result.comedy.length, 1);
  assert.equal(result.comedy[0].category, 'comedy');
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].name, 'The Glass Ceiling');
  assert.equal(api.requests, 3, 'one request per category');

  // A second source over the same cache makes no further requests.
  const before = api.requests;
  const second = createEventSource(sourceOptions(api.base, cacheDir));
  const repeat = await second.forCountry('DE');
  assert.equal(api.requests, before);
  assert.deepEqual(repeat.concerts, result.concerts);
});

test('the cache key moves with the date, so listings cannot go stale', async (t) => {
  const api = await startApi();
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'hb-events-'));
  t.after(async () => {
    await api.close();
    await rm(cacheDir, { recursive: true, force: true });
  });

  const source = createEventSource(sourceOptions(api.base, cacheDir));
  await source.forCountry('DE');
  const { readdir } = await import('node:fs/promises');
  const cached = await readdir(cacheDir);
  assert.ok(cached.every((file) => file.includes(iso(todayUTC()))), 'cache files are dated');
});

test('an API outage yields no events rather than a failed build', async (t) => {
  const api = await startApi();
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'hb-events-'));
  t.after(async () => {
    await api.close();
    await rm(cacheDir, { recursive: true, force: true });
  });

  api.fail('error');
  const source = createEventSource(sourceOptions(api.base, cacheDir));
  assert.equal(await source.forCountry('DE'), null);
  assert.ok(source.stats.errors.length > 0);
  assert.equal(source.stats.empty, 1);
});

test('a rate limit stops the build asking for more', async (t) => {
  const api = await startApi();
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'hb-events-'));
  t.after(async () => {
    await api.close();
    await rm(cacheDir, { recursive: true, force: true });
  });

  api.fail('ratelimit');
  const source = createEventSource(sourceOptions(api.base, cacheDir));
  assert.equal(await source.forCountry('DE'), null);
  const afterFirst = api.requests;
  assert.equal(await source.forCountry('FR'), null);
  assert.equal(api.requests, afterFirst, 'no further requests once rate limited');
  assert.match(source.stats.errors[0], /rate limited/);
});

// --- The detail a visitor sees on clicking a listing -------------------------

const describeOne = (event, extra = {}) =>
  describeEvent(
    annotate([event], extra.holidays || new Map())[0],
    { countryName: 'Germany', today: '2026-08-15', sameCityThatWeek: 0, ...extra.context },
  );

test('a listing states when and where, without inventing either', () => {
  const [first] = describeOne({
    date: '2026-09-12',
    name: 'A Band',
    time: '20:00',
    venue: 'Rathaus Hall',
    city: 'Berlin',
  });
  assert.equal(first, 'Saturday 12 September 2026, from 20:00, at Rathaus Hall, Berlin.');

  const [noTime] = describeOne({ date: '2026-09-12', name: 'A Band', venue: 'Rathaus Hall', city: 'Berlin' });
  assert.match(noTime, /No start time has been published yet/);

  const [bare] = describeOne({ date: '2026-09-12', name: 'A Band' });
  assert.match(bare, /No venue or start time has been published yet/);
});

test('a listing on a public holiday explains what that means for getting there', () => {
  const holidays = new Map(fallbackHolidays('DE', 2026).map((h) => [h.date, h]));
  const lines = describeOne({ date: '2026-10-03', name: 'A Band', city: 'Berlin' }, { holidays });
  const text = lines.join(' ');
  assert.match(text, /German Unity Day, a public holiday in Germany/);
  assert.match(text, /reduced timetable/);
  // Hedged, because opening hours vary and the site does not know them.
  assert.match(text, /often|many/);
});

test('a listing the day before a holiday says so', () => {
  const holidays = new Map(fallbackHolidays('DE', 2026).map((h) => [h.date, h]));
  const context = { nextDayHoliday: holidays.get('2026-10-03') };
  const text = describeOne({ date: '2026-10-02', name: 'A Band' }, { holidays, context }).join(' ');
  assert.match(text, /The following day is German Unity Day/);
  assert.match(text, /costs you nothing the next morning/);
});

test('weekends and working days are distinguished', () => {
  assert.match(
    describeOne({ date: '2026-09-12', name: 'A' }).join(' '),
    /falls on a Saturday, so nobody needs to book time off/,
  );
  assert.match(
    describeOne({ date: '2026-09-15', name: 'A' }).join(' '),
    /falls on a Tuesday, an ordinary working day in Germany/,
  );
});

test('how far away it is, in the terms people use', () => {
  const away = (date) => describeOne({ date, name: 'A' }).join(' ');
  assert.match(away('2026-08-15'), /That is today\./);
  assert.match(away('2026-08-16'), /That is tomorrow\./);
  assert.match(away('2026-08-18'), /That is 3 days away\./);
  assert.match(away('2026-08-25'), /a little over a week away/);
  assert.match(away('2026-09-12'), /about 4 weeks away/);
  assert.match(away('2026-12-12'), /about 4 months away/);
});

test('nearby listings are counted, and the event itself is not counted twice', () => {
  const events = annotate(
    [
      { date: '2026-09-12', name: 'One', city: 'Berlin' },
      { date: '2026-09-14', name: 'Two', city: 'Berlin' },
      { date: '2026-09-15', name: 'Three', city: 'Berlin' },
      { date: '2026-09-14', name: 'Four', city: 'Munich' },
      { date: '2026-11-20', name: 'Five', city: 'Berlin' },
    ],
    new Map(),
  );
  const context = describeContext(events, {
    countryName: 'Germany',
    today: '2026-08-15',
    holidaysByDate: new Map(),
  });

  // Berlin has three in that week, so any one of them has two others.
  const berlin = describeEvent(events[1], context(events[1])).join(' ');
  assert.match(berlin, /2 other listings in Berlin fall in the same week/);

  // Munich has only the one, and a lone listing says nothing about neighbours.
  const munich = describeEvent(events[3], context(events[3])).join(' ');
  assert.ok(!/other listings? in Munich/.test(munich));

  // A different week is not counted.
  const later = describeEvent(events[4], context(events[4])).join(' ');
  assert.ok(!/other listings? in Berlin/.test(later));
});

test('the description never claims anything about the act itself', () => {
  // Everything said must be derivable from the date, the calendar and the
  // other listings — never from knowledge the site does not have.
  const lines = describeOne({
    date: '2026-09-12',
    name: 'An Act With A Long History',
    venue: 'Rathaus Hall',
    city: 'Berlin',
    genre: 'Rock',
    time: '20:00',
  });
  const text = lines.join(' ');
  for (const claim of ['popular', 'acclaimed', 'famous', 'tour', 'album', 'best', 'must-see']) {
    assert.ok(!new RegExp(claim, 'i').test(text), `does not claim "${claim}"`);
  }
});

// --- Sample data --------------------------------------------------------------

test('sample listings are marked as samples and carry no links', () => {
  const sample = demoEvents('DE', { windowDays: 90, perCategory: 12 });
  const all = [...sample.concerts, ...sample.comedy, ...sample.events];
  assert.ok(all.length > 0);
  assert.equal(sample.origin, 'demo');
  for (const event of all) {
    assert.equal(event.demo, true, 'every sample row is flagged');
    assert.equal(event.url, null, 'a sample must never carry a link');
    assert.ok(event.date > iso(todayUTC()), 'samples are upcoming');
  }
  assert.equal(demoEvents('ZZ'), null, 'only the listed countries have samples');
  assert.ok(demoCountries().includes('GB'));
});

test('sample listings are stable between runs', () => {
  assert.deepEqual(demoEvents('GB', { windowDays: 90 }), demoEvents('GB', { windowDays: 90 }));
});

// --- Pages --------------------------------------------------------------------

const COUNTRY = { code: 'DE', name: 'Germany', flag: '🇩🇪', region: 'Europe' };

function page(view, options = {}) {
  const holidays = new Map(fallbackHolidays('DE', 2026).map((h) => [h.date, h]));
  const events = annotate(
    [
      { date: '2026-10-03', name: 'Marta Vey', venue: 'Rathaus Hall', city: 'Berlin', genre: 'Rock', url: 'https://tickets.example/1', time: '20:00' },
      { date: '2026-10-05', name: 'Dara Nunn', venue: 'Studio Two', city: 'Munich', genre: 'Comedy', url: null, time: null },
    ],
    holidays,
  );
  return renderCountryEvents({
    country: COUNTRY,
    view,
    events,
    counts: { all: 2, concerts: 1, comedy: 1, events: 0 },
    currentYear: 2026,
    demo: false,
    ...options,
  });
}

test('an events page names itself the way people search', () => {
  assert.match(page('concerts'), /<title>Concerts in Germany[^<]*<\/title>/);
  assert.match(page('comedy'), /<title>Comedy shows in Germany[^<]*<\/title>/);
  assert.match(page('all'), /<title>What&#39;s on in Germany[^<]*<\/title>/);
  assert.match(page('all'), /<link rel="canonical" href="[^"]+\/de\/events\/">/);
  assert.match(page('concerts'), /<link rel="canonical" href="[^"]+\/de\/concerts\/">/);
});

test('a listing on a public holiday links to that date in the calendar', () => {
  const html = page('all');
  assert.ok(
    html.includes(
      `class="tag tag--national" href="${url.holiday('DE', '2026-10-03')}">German Unity Day`,
    ),
  );
  assert.ok(html.includes('Marta Vey'));
  assert.ok(html.includes('Rathaus Hall'));
});

test('ticket links leave the site safely, and a missing link is not invented', () => {
  const html = page('all');
  assert.match(html, /<a href="https:\/\/tickets\.example\/1" rel="noopener nofollow" target="_blank">Marta Vey<\/a>/);
  // The second listing has no URL, so it must render as plain text.
  assert.ok(!/href="[^"]*">Dara Nunn/.test(html));
  assert.ok(html.includes('Dara Nunn'));
});

test('real listings get Event markup; samples get noindex and none', () => {
  const real = page('all');
  const parsed = JSON.parse(real.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const list = parsed.find((entry) => entry['@type'] === 'ItemList');
  assert.equal(list.numberOfItems, 2);
  assert.equal(list.itemListElement[0].item['@type'], 'Event');
  assert.equal(list.itemListElement[0].item.startDate, '2026-10-03T20:00');
  assert.ok(!real.includes('noindex'));

  const demo = page('all', { demo: true });
  assert.match(demo, /<meta name="robots" content="noindex">/);
  assert.match(demo, /Sample listings/);
  assert.ok(!/"@type":\s*"Event"/.test(demo), 'invented listings are never marked up as events');
});

test('event pages are complete documents with the usual furniture', () => {
  for (const html of [page('all'), page('concerts'), page('comedy')]) {
    assert.ok(html.startsWith('<!doctype html>'));
    assert.equal((html.match(/<h1/g) || []).length, 1);
    assert.match(html, /class="ad ad--leaderboard/);
    assert.ok(!html.includes('undefined'));
    assert.ok(!html.includes('[object Object]'));
    assert.ok(!/>\s*NaN\s*</.test(html));
  }
});

test('hostile listing text cannot break the page', () => {
  const html = renderCountryEvents({
    country: COUNTRY,
    view: 'all',
    events: annotate([{ date: '2026-10-05', name: '<script>alert(1)</script>', venue: '"><b>x', city: null }], new Map()),
    counts: { all: 1, concerts: 0, comedy: 0, events: 0 },
    currentYear: 2026,
    demo: false,
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
  assert.ok(!html.includes('"><b>x'));
});

test('the hub lists only countries that actually have listings', () => {
  const html = renderEventsHub({
    countries: [
      {
        code: 'DE',
        name: 'Germany',
        flag: '🇩🇪',
        counts: { all: 12, concerts: 8, comedy: 3, events: 1 },
        next: { date: '2026-09-12', name: 'Marta Vey' },
      },
    ],
    demo: false,
    today: '2026-08-15',
  });
  assert.match(html, /<title>What&#39;s on[^<]*<\/title>/);
  assert.ok(html.includes(`href="${url.countryEvents('DE', 'all')}"`));
  assert.match(html, /12 listings · 8 concerts · 3 comedy/);
  assert.equal((html.match(/<h1/g) || []).length, 1);
});
