/**
 * Holiday data source: Nager.Date, with an on-disk cache and a computed
 * fallback.
 *
 * Resolution order for any request:
 *   1. a fresh cache entry            (no network call at all)
 *   2. the live API                   (result written to cache)
 *   3. a stale cache entry            (network failed, old data is still data)
 *   4. computed rules in fallback.mjs (no data at all, but never an empty site)
 *
 * That ordering is what makes `npm run build` succeed with the network
 * unplugged, and what makes a repeat build near-instant.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { coverageOf, fallbackCountries, fallbackHolidays, hasFallback } from './fallback.mjs';

const HOUR = 3600_000;

/** @param {{apiBase: string, cacheDir: string, offline?: boolean}} options */
export function createSource(options) {
  const apiBase = options.apiBase;
  const cacheDir = options.cacheDir;
  const offline = Boolean(options.offline);
  const currentYear = new Date().getUTCFullYear();

  const stats = { live: 0, cache: 0, computed: 0, missing: 0, errors: [] };
  let networkDown = offline;

  async function readCache(key) {
    const file = path.join(cacheDir, `${key}.json`);
    if (!existsSync(file)) return null;
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      return { data: parsed.data, fetchedAt: parsed.fetchedAt || 0 };
    } catch {
      return null;
    }
  }

  async function writeCache(key, data) {
    await mkdir(cacheDir, { recursive: true });
    const file = path.join(cacheDir, `${key}.json`);
    await writeFile(file, JSON.stringify({ fetchedAt: Date.now(), data }, null, 0));
  }

  async function fetchJSON(url) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(12_000),
          headers: { accept: 'application/json', 'user-agent': 'holiday-board/1.0 (+static build)' },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        lastError = error;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 750));
      }
    }
    throw lastError;
  }

  /**
   * Cache-first fetch.
   * @param {string} key cache file name
   * @param {string} url
   * @param {number} ttlHours how long a cache entry counts as fresh
   */
  async function load(key, url, ttlHours) {
    const cached = await readCache(key);
    const fresh = cached && Date.now() - cached.fetchedAt < ttlHours * HOUR;
    if (fresh || (cached && networkDown)) {
      stats.cache += 1;
      return { data: cached.data, origin: 'cache' };
    }
    if (networkDown) return { data: null, origin: 'none' };

    try {
      const data = await fetchJSON(url);
      await writeCache(key, data);
      stats.live += 1;
      return { data, origin: 'live' };
    } catch (error) {
      if (stats.errors.length < 5) stats.errors.push(`${url}: ${error.message}`);
      // One failure is a blip; the first failure is enough to stop hammering a
      // dead network for the remaining few thousand requests.
      networkDown = true;
      if (cached) {
        stats.cache += 1;
        return { data: cached.data, origin: 'cache' };
      }
      return { data: null, origin: 'none' };
    }
  }

  /** Nager's holiday shape, reduced to what the site needs. */
  function normalise(rows) {
    if (!Array.isArray(rows)) return [];
    return rows
      .map((row) => ({
        date: String(row.date).slice(0, 10),
        name: row.name || row.localName || 'Public holiday',
        localName: row.localName && row.localName !== row.name ? row.localName : null,
        type: Array.isArray(row.types) && row.types.length ? row.types[0] : row.type || 'Public',
        national: row.global !== false,
      }))
      .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  return {
    stats,

    /** @returns {Promise<Array<{code: string, apiName: string}>>} */
    async availableCountries() {
      const { data } = await load('countries', `${apiBase}/AvailableCountries`, 24 * 7);
      if (Array.isArray(data) && data.length) {
        return data.map((row) => ({ code: row.countryCode, apiName: row.name }));
      }
      // No list available: publish exactly the countries we can compute.
      return fallbackCountries().map((code) => ({ code, apiName: null }));
    },

    /**
     * @returns {Promise<{holidays: Array, origin: 'live'|'cache'|'computed'|'none'}>}
     */
    async holidays(year, code) {
      // Past years are settled; current and future years move.
      const ttl = year < currentYear ? 24 * 30 : 12;
      const { data, origin } = await load(
        `holidays-${year}-${code}`,
        `${apiBase}/PublicHolidays/${year}/${code}`,
        ttl,
      );
      const rows = normalise(data);
      // Upstream data is a published list, so it is treated as complete.
      if (rows.length) return { holidays: rows, origin, coverage: 'api' };

      const computed = fallbackHolidays(code, year);
      if (computed && computed.length) {
        stats.computed += 1;
        // 'full' is a complete statutory rule set; 'core' is the principal
        // national holidays only, and the pages must say so.
        return { holidays: computed, origin: 'computed', coverage: coverageOf(code) };
      }
      stats.missing += 1;
      return { holidays: [], origin: 'none', coverage: null };
    },

    hasComputedRules: hasFallback,
    get networkDown() {
      return networkDown;
    },
  };
}
