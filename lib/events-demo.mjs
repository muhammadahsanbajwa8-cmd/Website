/**
 * Sample listings for `--events-demo`.
 *
 * Every act, venue and promoter here is invented, and the pages that show them
 * carry a banner and a noindex tag. This exists so the event pages can be seen
 * and reviewed before anyone has an API key — it must never stand in for real
 * listings on a deployed site.
 */

import { addDays, iso, todayUTC } from './dates.mjs';

const ACTS = {
  concerts: [
    ['The Paper Lanterns', 'Indie'],
    ['Nightbus Choir', 'Alternative'],
    ['Marta Vey', 'Pop'],
    ['Silver Kestrel', 'Rock'],
    ['Foil & Fern', 'Folk'],
    ['Broadcast Signal', 'Electronic'],
    ['The Long Weekend', 'Indie'],
    ['Otto Lindqvist Trio', 'Jazz'],
    ['Kettle Drum Society', 'Classical'],
    ['Low Tide Radio', 'Electronic'],
  ],
  comedy: [
    ['Dara Nunn: Half Measures', 'Comedy'],
    ['Priya Anand: Notes to Self', 'Comedy'],
    ['The Wednesday Club', 'Comedy'],
    ['Sam Okoro: Loud Neighbours', 'Comedy'],
    ['Two Chairs Improv', 'Comedy'],
    ['Late Shift Stand-Up', 'Comedy'],
  ],
  events: [
    ['Municipal Ballet: Winter Suite', 'Dance'],
    ['City XI vs Harbour United', 'Football'],
    ['Planetarium Late', 'Family'],
    ['The Glass Ceiling — a new play', 'Theatre'],
    ['Winter Print Fair', 'Family'],
  ],
};

const VENUES = [
  'Rathaus Hall',
  'The Old Exchange',
  'Riverside Arena',
  'Studio Two',
  'The Corn Loft',
  'Northgate Theatre',
];

const CITIES = {
  DE: ['Berlin', 'Munich', 'Hamburg', 'Cologne'],
  GB: ['London', 'Manchester', 'Glasgow', 'Bristol'],
  US: ['New York', 'Chicago', 'Austin', 'Seattle'],
  FR: ['Paris', 'Lyon', 'Marseille', 'Lille'],
  CA: ['Toronto', 'Montreal', 'Vancouver', 'Calgary'],
  AU: ['Sydney', 'Melbourne', 'Brisbane', 'Perth'],
  IE: ['Dublin', 'Cork', 'Galway', 'Limerick'],
  IN: ['Mumbai', 'Delhi', 'Bengaluru', 'Chennai'],
};

const TIMES = ['19:00', '19:30', '20:00', '20:30', '18:00', null];

/** Deterministic pseudo-random, so a rebuild does not reshuffle the samples. */
function seeded(seed) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

/** Same shape as createEventSource().forCountry(), with invented content. */
export function demoEvents(countryCode, options = {}) {
  const cities = CITIES[countryCode];
  if (!cities) return null;

  const perCategory = Math.min(options.perCategory || 24, 24);
  const today = todayUTC();
  const random = seeded(countryCode.charCodeAt(0) * 977 + countryCode.charCodeAt(1) * 31);

  const buckets = {};
  for (const [category, acts] of Object.entries(ACTS)) {
    const rows = [];
    const count = category === 'concerts' ? perCategory : Math.ceil(perCategory / 2);
    for (let i = 0; i < count; i += 1) {
      const [name, genre] = acts[Math.floor(random() * acts.length)];
      const offset = 1 + Math.floor(random() * (options.windowDays || 90));
      const city = cities[Math.floor(random() * cities.length)];
      rows.push({
        id: `demo-${countryCode}-${category}-${i}`,
        name,
        url: null, // never a fake link
        date: iso(addDays(today, offset)),
        time: TIMES[Math.floor(random() * TIMES.length)],
        venue: VENUES[Math.floor(random() * VENUES.length)],
        city,
        country: countryCode,
        category,
        genre,
        status: 'onsale',
        demo: true,
      });
    }
    buckets[category] = rows.sort((a, b) =>
      a.date === b.date ? a.name.localeCompare(b.name, 'en') : a.date < b.date ? -1 : 1,
    );
  }

  return { ...buckets, origin: 'demo' };
}

export function demoCountries() {
  return Object.keys(CITIES);
}
