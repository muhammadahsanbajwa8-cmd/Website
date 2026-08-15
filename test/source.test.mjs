import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createSource } from '../lib/source.mjs';

/**
 * A stand-in for the Nager.Date API, so the live path (fetch, normalise, cache,
 * reuse, degrade) is exercised for real rather than mocked.
 */
function startApi() {
  let requests = 0;
  let mode = 'ok';
  const server = http.createServer((req, res) => {
    requests += 1;
    if (mode === 'error') {
      res.writeHead(503).end('nope');
      return;
    }
    if (req.url === '/AvailableCountries') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ countryCode: 'US', name: 'United States' }, { countryCode: 'ZZ', name: 'Zedland' }]));
      return;
    }
    if (req.url.startsWith('/PublicHolidays/2026/US')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify([
          // Deliberately out of order, with the shape the real API returns.
          {
            date: '2026-07-03',
            localName: 'Independence Day',
            name: 'Independence Day',
            countryCode: 'US',
            global: true,
            types: ['Public'],
          },
          {
            date: '2026-01-01',
            localName: "New Year's Day",
            name: "New Year's Day",
            countryCode: 'US',
            global: true,
            types: ['Public'],
          },
          {
            date: '2026-04-03',
            localName: 'Good Friday',
            name: 'Good Friday',
            countryCode: 'US',
            global: false,
            counties: ['US-TX'],
            types: ['Optional'],
          },
        ]),
      );
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('[]');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done)),
        get requests() {
          return requests;
        },
        fail() {
          mode = 'error';
        },
        recover() {
          mode = 'ok';
        },
      });
    });
  });
}

test('live fetch, normalise, cache, then serve from cache', async (t) => {
  const api = await startApi();
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'hb-cache-'));
  t.after(async () => {
    await api.close();
    await rm(cacheDir, { recursive: true, force: true });
  });

  const source = createSource({ apiBase: api.base, cacheDir });

  const countries = await source.availableCountries();
  assert.deepEqual(
    countries.map((c) => c.code),
    ['US', 'ZZ'],
  );

  const first = await source.holidays(2026, 'US');
  assert.equal(first.origin, 'live');
  // Sorted by date, and reduced to the site's own shape.
  assert.deepEqual(
    first.holidays.map((h) => h.date),
    ['2026-01-01', '2026-04-03', '2026-07-03'],
  );
  assert.equal(first.holidays[0].name, "New Year's Day");
  assert.equal(first.holidays[1].national, false, 'global:false becomes regional');
  assert.equal(first.holidays[1].type, 'Optional');
  assert.equal(first.holidays[2].national, true);

  const cached = await readdir(cacheDir);
  assert.ok(cached.includes('holidays-2026-US.json'));
  assert.ok(cached.includes('countries.json'));

  // A second source over the same cache must not touch the network.
  const before = api.requests;
  const second = createSource({ apiBase: api.base, cacheDir });
  const repeat = await second.holidays(2026, 'US');
  assert.equal(repeat.origin, 'cache');
  assert.equal(api.requests, before, 'no request was made');
  assert.deepEqual(repeat.holidays, first.holidays);
});

test('a dead API falls back to stale cache, then to computed rules', async (t) => {
  const api = await startApi();
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'hb-cache-'));
  t.after(async () => {
    await api.close();
    await rm(cacheDir, { recursive: true, force: true });
  });

  // Warm the cache while the API is healthy.
  const warm = createSource({ apiBase: api.base, cacheDir });
  await warm.holidays(2026, 'US');

  // Now break it and force a revalidation by asking a source that treats the
  // entry as stale (a fresh source with a zero-length TTL is not exposed, so
  // ask for a year that was never cached instead).
  api.fail();
  const broken = createSource({ apiBase: api.base, cacheDir });

  const uncached = await broken.holidays(2027, 'US');
  assert.equal(uncached.origin, 'computed', 'no cache, no API: compute the dates');
  assert.ok(uncached.holidays.length >= 10);
  assert.ok(uncached.holidays.every((h) => h.date.startsWith('2027-')));

  const stillCached = await broken.holidays(2026, 'US');
  assert.equal(stillCached.origin, 'cache', 'existing cache still serves');
  assert.ok(broken.networkDown);
});

test('offline mode never touches the network', async (t) => {
  const api = await startApi();
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'hb-cache-'));
  t.after(async () => {
    await api.close();
    await rm(cacheDir, { recursive: true, force: true });
  });

  const source = createSource({ apiBase: api.base, cacheDir, offline: true });
  const countries = await source.availableCountries();
  assert.equal(api.requests, 0);
  // With no cache, the published list is exactly what can be computed.
  assert.ok(countries.length >= 8);
  assert.ok(countries.some((c) => c.code === 'GB'));

  const result = await source.holidays(2026, 'GB');
  assert.equal(api.requests, 0);
  assert.equal(result.origin, 'computed');
  assert.equal(result.holidays[0].date, '2026-01-01');
});

test('a country with neither data nor rules yields nothing, not an empty shell', async (t) => {
  const api = await startApi();
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'hb-cache-'));
  t.after(async () => {
    await api.close();
    await rm(cacheDir, { recursive: true, force: true });
  });

  const source = createSource({ apiBase: api.base, cacheDir });
  const result = await source.holidays(2026, 'ZZ');
  assert.equal(result.origin, 'none');
  assert.deepEqual(result.holidays, []);
  assert.equal(source.stats.missing, 1);
});
