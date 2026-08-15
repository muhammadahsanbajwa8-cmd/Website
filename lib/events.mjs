/**
 * Live events: concerts, comedy and everything else on sale.
 *
 * Source is the Ticketmaster Discovery API, which needs a free key. That makes
 * it different from every other source here in one important way: it can be
 * absent. When it is, the site simply has no event pages — nothing is invented
 * to fill the gap.
 *
 * Responses are cached like the holiday data, but with a short life: a concert
 * listing is stale in hours, not months.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { MONTH_NAMES, WEEKDAY_NAMES, addDays, iso, isWeekend, parseISO, todayUTC } from './dates.mjs';

/** The three streams the site publishes, and how to ask for each. */
export const CATEGORIES = [
  {
    key: 'concerts',
    label: 'Concerts',
    singular: 'concert',
    query: { segmentName: 'Music' },
    blurb: 'gigs, tours and festivals on sale now',
  },
  {
    key: 'comedy',
    label: 'Comedy',
    singular: 'comedy show',
    query: { classificationName: 'Comedy' },
    blurb: 'stand-up, tours and club nights',
  },
  {
    key: 'events',
    label: 'Other events',
    singular: 'event',
    query: { segmentName: 'Arts & Theatre,Sports,Family' },
    blurb: 'theatre, sport, family shows and the rest',
  },
];

export const CATEGORY_KEYS = CATEGORIES.map((category) => category.key);
export const categoryByKey = (key) => CATEGORIES.find((category) => category.key === key);

/** Ticketmaster's classification tree, reduced to one of our three streams. */
export function classify(event) {
  const classification = (event.classifications || []).find((entry) => entry.primary !== false) ||
    (event.classifications || [])[0] || {};
  const segment = classification.segment?.name || '';
  const genre = classification.genre?.name || '';
  if (genre === 'Comedy' || classification.subGenre?.name === 'Comedy') return 'comedy';
  if (segment === 'Music') return 'concerts';
  return 'events';
}

/** Reduce one Discovery API event to what the site actually shows. */
export function normalise(event) {
  const venue = event._embedded?.venues?.[0] || {};
  const start = event.dates?.start || {};
  const status = event.dates?.status?.code || 'onsale';
  const date = String(start.localDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const classification = (event.classifications || []).find((entry) => entry.primary !== false) ||
    (event.classifications || [])[0] || {};

  return {
    id: String(event.id || `${date}-${event.name}`),
    name: event.name || 'Untitled event',
    url: typeof event.url === 'string' && /^https:\/\//.test(event.url) ? event.url : null,
    date,
    time: start.timeTBA || start.noSpecificTime ? null : (start.localTime || '').slice(0, 5) || null,
    venue: venue.name || null,
    city: venue.city?.name || null,
    country: venue.country?.countryCode || null,
    category: classify(event),
    genre: classification.genre?.name || null,
    status,
  };
}

/** Sort by date, then time, then name, so a rebuild is byte-stable. */
function order(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const timeA = a.time || '99:99';
  const timeB = b.time || '99:99';
  if (timeA !== timeB) return timeA < timeB ? -1 : 1;
  return a.name.localeCompare(b.name, 'en');
}

/**
 * @param {{apiBase: string, apiKey: string, cacheDir: string, offline?: boolean,
 *          windowDays: number, perCategory: number}} options
 */
export function createEventSource(options) {
  const enabled = Boolean(options.apiKey) && !options.offline;
  const stats = { live: 0, cache: 0, empty: 0, errors: [] };
  let networkDown = false;
  let lastRequest = 0;

  const today = todayUTC();
  const window = {
    start: `${iso(today)}T00:00:00Z`,
    end: `${iso(addDays(today, options.windowDays))}T23:59:59Z`,
  };

  async function readCache(key) {
    const file = path.join(options.cacheDir, `${key}.json`);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      return null;
    }
  }

  async function writeCache(key, data) {
    await mkdir(options.cacheDir, { recursive: true });
    await writeFile(path.join(options.cacheDir, `${key}.json`), JSON.stringify({ fetchedAt: Date.now(), data }));
  }

  /** Ticketmaster allows five requests a second; stay comfortably under it. */
  async function throttle() {
    const wait = 220 - (Date.now() - lastRequest);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequest = Date.now();
  }

  async function fetchPage(category, countryCode) {
    const params = new URLSearchParams({
      apikey: options.apiKey,
      countryCode,
      size: String(Math.min(options.perCategory, 200)),
      sort: 'date,asc',
      startDateTime: window.start,
      endDateTime: window.end,
      ...category.query,
    });
    await throttle();
    const response = await fetch(`${options.apiBase}/events.json?${params}`, {
      signal: AbortSignal.timeout(15_000),
      headers: { accept: 'application/json' },
    });
    if (response.status === 429) throw new Error('rate limited');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  return {
    enabled,
    stats,

    /**
     * Upcoming events for one country, bucketed by category.
     * @returns {Promise<{concerts: Array, comedy: Array, events: Array, origin: string} | null>}
     */
    async forCountry(countryCode) {
      if (!enabled) return null;

      const buckets = { concerts: [], comedy: [], events: [] };
      let origin = 'cache';
      let found = 0;

      for (const category of CATEGORIES) {
        const key = `events-${countryCode}-${category.key}-${iso(today)}`;
        let payload = await readCache(key);

        if (!payload && !networkDown) {
          try {
            const data = await fetchPage(category, countryCode);
            payload = { data };
            await writeCache(key, data);
            stats.live += 1;
            origin = 'live';
          } catch (error) {
            if (stats.errors.length < 5) stats.errors.push(`${countryCode}/${category.key}: ${error.message}`);
            // A rate limit or an outage should not take the whole build down.
            if (/rate limited|HTTP 5|fetch failed|timeout/i.test(error.message)) networkDown = true;
            payload = null;
          }
        } else if (payload) {
          stats.cache += 1;
        }

        const raw = payload?.data?._embedded?.events || [];
        const rows = raw
          .map(normalise)
          .filter(Boolean)
          .filter((event) => event.status !== 'cancelled')
          // Trust our own classification over which endpoint answered.
          .filter((event) => event.category === category.key || category.key === 'events');

        buckets[category.key] = rows.sort(order).slice(0, options.perCategory);
        found += buckets[category.key].length;
      }

      if (!found) {
        stats.empty += 1;
        return null;
      }
      return { ...buckets, origin };
    },
  };
}

// --- Presentation helpers ----------------------------------------------------

/**
 * Tie events back to the rest of the site: flag the ones landing on a public
 * holiday or a weekend, which is exactly what changes transport and opening
 * hours around a gig.
 */
export function annotate(events, holidaysByDate) {
  return events.map((event) => {
    const day = parseISO(event.date);
    const holiday = holidaysByDate.get(event.date) || null;
    return {
      ...event,
      weekday: WEEKDAY_NAMES[day.getUTCDay()],
      weekend: isWeekend(day),
      holiday: holiday ? { name: holiday.name, national: holiday.national !== false } : null,
    };
  });
}

/** Group a sorted event list into months, then days. */
export function groupByMonth(events) {
  const months = [];
  for (const event of events) {
    const key = event.date.slice(0, 7);
    let month = months[months.length - 1];
    if (!month || month.key !== key) {
      month = {
        key,
        label: `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`,
        days: [],
        count: 0,
      };
      months.push(month);
    }
    let day = month.days[month.days.length - 1];
    if (!day || day.date !== event.date) {
      day = { date: event.date, weekday: event.weekday, weekend: event.weekend, holiday: event.holiday, events: [] };
      month.days.push(day);
    }
    day.events.push(event);
    month.count += 1;
  }
  return months;
}

/** Headline numbers for a country's event pages. */
export function eventStats(events) {
  const cities = new Set();
  const genres = new Map();
  let onHolidays = 0;

  for (const event of events) {
    if (event.city) cities.add(event.city);
    if (event.genre) genres.set(event.genre, (genres.get(event.genre) || 0) + 1);
    if (event.holiday) onHolidays += 1;
  }

  const topGenres = [...genres.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return {
    total: events.length,
    cities: cities.size,
    onHolidays,
    first: events[0] || null,
    last: events[events.length - 1] || null,
    topGenres: topGenres.map(([name, count]) => ({ name, count })),
  };
}
