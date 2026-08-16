/**
 * Offline fallback: public holidays computed from statutory rules.
 *
 * This is what keeps `npm run build` honest when the network is unavailable or
 * the upstream API is down. Nothing here is a per-year date list — every date
 * is derived from a rule (fixed date, nth weekday of month, or an offset from
 * Easter Sunday), so the output stays correct for any year you ask for.
 *
 * Coverage is deliberately national-level only. Regional and state holidays,
 * and holidays set by lunar or observational calendars, are not computed here;
 * see the "Limits of the data" section of the README.
 */

import {
  FRI,
  MONTH_NAMES,
  WEEKDAY_NAMES,
  MON,
  SAT,
  SUN,
  THU,
  addDays,
  easterOffset,
  iso,
  isWeekend,
  nthWeekdayOfMonth,
  orthodoxEasterOffset,
  utc,
  weekdayOnOrBefore,
} from './dates.mjs';
import { hijriInGregorianYear } from './islamic.mjs';
import { WORLD_RULES } from './world.mjs';

/**
 * Observance strategies for a holiday that lands on a weekend.
 *  'us'         Saturday moves back to Friday, Sunday forward to Monday.
 *  'substitute' Moves forward to the next weekday that is not already taken.
 *  null         Not moved.
 */

const RULES = {
  US: {
    observe: 'us',
    suffix: '(observed)',
    rules: [
      { name: "New Year's Day", month: 1, day: 1 },
      { name: 'Martin Luther King, Jr. Day', month: 1, weekday: MON, nth: 3, from: 1986 },
      { name: "Washington's Birthday", month: 2, weekday: MON, nth: 3 },
      { name: 'Memorial Day', month: 5, weekday: MON, nth: -1 },
      { name: 'Juneteenth National Independence Day', month: 6, day: 19, from: 2021 },
      { name: 'Independence Day', month: 7, day: 4 },
      { name: 'Labor Day', month: 9, weekday: MON, nth: 1 },
      { name: 'Columbus Day', month: 10, weekday: MON, nth: 2 },
      { name: 'Veterans Day', month: 11, day: 11 },
      { name: 'Thanksgiving Day', month: 11, weekday: THU, nth: 4 },
      { name: 'Christmas Day', month: 12, day: 25 },
    ],
  },

  // England and Wales. Scotland and Northern Ireland differ; see README.
  GB: {
    observe: 'substitute',
    suffix: '(substitute day)',
    rules: [
      { name: "New Year's Day", month: 1, day: 1, type: 'Bank' },
      { name: 'Good Friday', easter: -2, observe: null, type: 'Bank' },
      { name: 'Easter Monday', easter: 1, observe: null, type: 'Bank' },
      { name: 'Early May bank holiday', month: 5, weekday: MON, nth: 1, type: 'Bank' },
      { name: 'Spring bank holiday', month: 5, weekday: MON, nth: -1, type: 'Bank' },
      { name: 'Summer bank holiday', month: 8, weekday: MON, nth: -1, type: 'Bank' },
      { name: 'Christmas Day', month: 12, day: 25, type: 'Bank' },
      { name: 'Boxing Day', month: 12, day: 26, type: 'Bank' },
    ],
  },

  AU: {
    observe: 'substitute',
    suffix: '(observed)',
    rules: [
      { name: "New Year's Day", month: 1, day: 1 },
      { name: 'Australia Day', month: 1, day: 26 },
      { name: 'Good Friday', easter: -2, observe: null },
      { name: 'Easter Saturday', easter: -1, observe: null, national: false },
      { name: 'Easter Monday', easter: 1, observe: null },
      { name: 'Anzac Day', month: 4, day: 25, observe: null },
      { name: "King's Birthday", month: 6, weekday: MON, nth: 2, national: false },
      { name: 'Christmas Day', month: 12, day: 25 },
      { name: 'Boxing Day', month: 12, day: 26 },
    ],
  },

  // Canadian federal statutory holidays.
  CA: {
    observe: 'substitute',
    suffix: '(observed)',
    rules: [
      { name: "New Year's Day", month: 1, day: 1 },
      { name: 'Good Friday', easter: -2, observe: null },
      { name: 'Victoria Day', on: (year) => weekdayOnOrBefore(utc(year, 5, 24), MON) },
      { name: 'Canada Day', month: 7, day: 1 },
      { name: 'Labour Day', month: 9, weekday: MON, nth: 1 },
      {
        name: 'National Day for Truth and Reconciliation',
        month: 9,
        day: 30,
        from: 2021,
        national: false,
      },
      { name: 'Thanksgiving', month: 10, weekday: MON, nth: 2 },
      { name: 'Remembrance Day', month: 11, day: 11, national: false },
      { name: 'Christmas Day', month: 12, day: 25 },
      { name: 'Boxing Day', month: 12, day: 26, national: false },
    ],
  },

  // Holidays observed in every German state. State holidays are not included.
  DE: {
    observe: null,
    rules: [
      { name: "New Year's Day", month: 1, day: 1 },
      { name: 'Good Friday', easter: -2 },
      { name: 'Easter Monday', easter: 1 },
      { name: 'Labour Day', month: 5, day: 1 },
      { name: 'Ascension Day', easter: 39 },
      { name: 'Whit Monday', easter: 50 },
      { name: 'German Unity Day', month: 10, day: 3 },
      { name: 'Christmas Day', month: 12, day: 25 },
      { name: 'St. Stephen’s Day', month: 12, day: 26 },
    ],
  },

  FR: {
    observe: null,
    rules: [
      { name: "New Year's Day", month: 1, day: 1 },
      { name: 'Easter Monday', easter: 1 },
      { name: 'Labour Day', month: 5, day: 1 },
      { name: 'Victory in Europe Day', month: 5, day: 8 },
      { name: 'Ascension Day', easter: 39 },
      { name: 'Whit Monday', easter: 50 },
      { name: 'Bastille Day', month: 7, day: 14 },
      { name: 'Assumption of Mary', month: 8, day: 15 },
      { name: "All Saints' Day", month: 11, day: 1 },
      { name: 'Armistice Day', month: 11, day: 11 },
      { name: 'Christmas Day', month: 12, day: 25 },
    ],
  },

  IE: {
    observe: 'substitute',
    suffix: '(observed)',
    rules: [
      { name: "New Year's Day", month: 1, day: 1 },
      {
        // Since 2023: 1 February when that is a Friday, otherwise the first
        // Monday in February.
        name: "St. Brigid's Day",
        from: 2023,
        on: (year) => {
          const first = utc(year, 2, 1);
          return first.getUTCDay() === FRI ? first : nthWeekdayOfMonth(year, 2, MON, 1);
        },
        observe: null,
      },
      { name: "St. Patrick's Day", month: 3, day: 17 },
      { name: 'Easter Monday', easter: 1, observe: null },
      { name: 'May Day', month: 5, weekday: MON, nth: 1 },
      { name: 'June Holiday', month: 6, weekday: MON, nth: 1 },
      { name: 'August Holiday', month: 8, weekday: MON, nth: 1 },
      { name: 'October Holiday', month: 10, weekday: MON, nth: -1 },
      { name: 'Christmas Day', month: 12, day: 25 },
      { name: "St. Stephen's Day", month: 12, day: 26 },
    ],
  },

  // Gazetted holidays observed nationwide. India's many lunar-calendar and
  // state holidays are not computed; see README.
  IN: {
    observe: null,
    rules: [
      { name: 'Republic Day', month: 1, day: 26 },
      { name: 'Good Friday', easter: -2 },
      { name: 'Independence Day', month: 8, day: 15 },
      { name: 'Gandhi Jayanti', month: 10, day: 2 },
      { name: 'Christmas Day', month: 12, day: 25 },
    ],
  },
};

/**
 * Every country the site can compute without a network.
 *
 * The eight sets above are `full`: complete national lists including each
 * country's own weekend-observance law. The rest, from lib/world.mjs, are
 * `core`: the principal national holidays only. Pages say which they are
 * looking at, because a working-day count from a core set is an upper bound.
 */
const ALL_RULES = { ...WORLD_RULES, ...RULES };

/** Country codes the fallback can compute. */
export function fallbackCountries() {
  return Object.keys(ALL_RULES).sort();
}

/** Countries with a complete statutory rule set, not just the core holidays. */
export function detailedCountries() {
  return Object.keys(RULES).sort();
}

export function hasFallback(code) {
  return Object.prototype.hasOwnProperty.call(ALL_RULES, String(code || '').toUpperCase());
}

/** 'full', 'core', or null when nothing is computed for this country. */
export function coverageOf(code) {
  const key = String(code || '').toUpperCase();
  if (RULES[key]) return 'full';
  if (WORLD_RULES[key]) return 'core';
  return null;
}

/**
 * Resolve one rule to the dates it produces in a year.
 *
 * Most rules give exactly one date. Hijri rules can give none or two, because
 * a Hijri year is eleven days shorter than a Gregorian one, and can run for
 * several days.
 *
 * @returns {Array<{date: Date, name: string, estimated: boolean}>}
 */
const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth'];
const HIJRI_MONTHS = [
  'Muharram',
  'Safar',
  'Rabi al-Awwal',
  'Rabi al-Thani',
  'Jumada al-Awwal',
  'Jumada al-Thani',
  'Rajab',
  'Shaban',
  'Ramadan',
  'Shawwal',
  'Dhu al-Qadah',
  'Dhu al-Hijjah',
];

/**
 * How a holiday's date is arrived at, in a sentence.
 *
 * This is the half of "why is it on that day" that is always answerable: it
 * falls straight out of the rule, so it is true for every computed holiday
 * even where the glossary has nothing to say about the occasion itself.
 */
export function describeRule(rule) {
  if (rule.hijri) {
    const month = HIJRI_MONTHS[rule.hijri.month - 1] || `month ${rule.hijri.month}`;
    return (
      `Set by the Islamic calendar — ${rule.hijri.day} ${month}` +
      `${rule.span > 1 ? `, running ${rule.span} days` : ''}. That calendar is lunar, so the ` +
      `date moves about eleven days earlier in each Gregorian year, and the observed date ` +
      `depends on the sighting of the new moon.`
    );
  }
  if (typeof rule.easter === 'number') {
    if (rule.easter === 0) return 'Easter Sunday itself, which moves with the lunar cycle.';
    const days = Math.abs(rule.easter);
    return `Fixed relative to Easter: ${days} ${days === 1 ? 'day' : 'days'} ${
      rule.easter > 0 ? 'after' : 'before'
    } Easter Sunday, so it moves with Easter each year.`;
  }
  if (typeof rule.orthodoxEaster === 'number') {
    const days = Math.abs(rule.orthodoxEaster);
    return rule.orthodoxEaster === 0
      ? 'Orthodox Easter Sunday, calculated on the Julian calendar.'
      : `Fixed relative to Orthodox Easter: ${days} ${days === 1 ? 'day' : 'days'} ${
          rule.orthodoxEaster > 0 ? 'after' : 'before'
        } it. Orthodox Easter is calculated on the Julian calendar, so it usually falls later than the Western date.`;
  }
  if (rule.weekday !== undefined) {
    const day = WEEKDAY_NAMES[rule.weekday];
    const month = MONTH_NAMES[rule.month - 1];
    return rule.nth < 0
      ? `Always the last ${day} in ${month}, so the date changes each year but the day never does.`
      : `Always the ${ORDINALS[rule.nth] || `${rule.nth}th`} ${day} in ${month}, so the date changes each year but the day never does.`;
  }
  if (typeof rule.on === 'function') return 'Set by a rule of its own in the country’s law.';
  if (rule.month && rule.day) {
    return `A fixed date: ${rule.day} ${MONTH_NAMES[rule.month - 1]} every year.`;
  }
  return null;
}

function expandRule(rule, year) {
  if (rule.from && year < rule.from) return [];
  if (rule.until && year > rule.until) return [];

  const one = (date) => [{ date, name: rule.name, estimated: false }];

  if (rule.hijri) {
    const out = [];
    for (const start of hijriInGregorianYear(year, rule.hijri.month, rule.hijri.day)) {
      for (let day = 0; day < (rule.span || 1); day += 1) {
        out.push({ date: addDays(start, day), name: rule.name, estimated: true });
      }
    }
    return out;
  }
  if (typeof rule.on === 'function') return one(rule.on(year));
  if (typeof rule.easter === 'number') return one(easterOffset(year, rule.easter));
  if (typeof rule.orthodoxEaster === 'number') {
    return one(orthodoxEasterOffset(year, rule.orthodoxEaster));
  }
  if (rule.weekday !== undefined) {
    return one(nthWeekdayOfMonth(year, rule.month, rule.weekday, rule.nth));
  }
  return one(utc(year, rule.month, rule.day));
}

function shiftUS(date) {
  const day = date.getUTCDay();
  if (day === SAT) return addDays(date, -1);
  if (day === SUN) return addDays(date, 1);
  return date;
}

function shiftSubstitute(date, taken) {
  let moved = date;
  while (isWeekend(moved) || taken.has(iso(moved))) moved = addDays(moved, 1);
  return moved;
}

/** Compute one country's holidays for one calendar year, observance applied. */
function computeYear(code, year) {
  const spec = ALL_RULES[code];
  const entries = [];
  for (const rule of spec.rules) {
    for (const occurrence of expandRule(rule, year)) entries.push({ rule, ...occurrence });
  }
  entries.sort((a, b) => a.date - b.date);

  const taken = new Set();
  const out = [];
  for (const { rule, date, name, estimated } of entries) {
    const strategy = rule.observe === undefined ? spec.observe : rule.observe;
    let observed = date;
    if (strategy === 'us') observed = shiftUS(date);
    else if (strategy === 'substitute') observed = shiftSubstitute(date, taken);

    const moved = observed.getTime() !== date.getTime();
    taken.add(iso(observed));
    out.push({
      date: iso(observed),
      name: moved && spec.suffix ? `${name} ${spec.suffix}` : name,
      // How the date is arrived at — true for every computed holiday.
      basis: describeRule(rule),
      type: rule.type || 'Public',
      national: rule.national !== false,
      observedFrom: moved ? iso(date) : null,
      // Lunar dates cannot be settled in advance; say so rather than implying
      // a precision the calendar does not have.
      estimated,
    });
  }
  return out;
}

/**
 * Computed holidays for a country and year, in date order.
 * Neighbouring years are computed too, because an observance shift can push a
 * date across a year boundary (a Saturday 1 January is observed on 31 December
 * of the previous year in the United States).
 *
 * @returns {Array<{date: string, name: string, type: string, national: boolean}> | null}
 */
export function fallbackHolidays(code, year) {
  const key = String(code || '').toUpperCase();
  if (!ALL_RULES[key]) return null;
  const all = [
    ...computeYear(key, year - 1),
    ...computeYear(key, year),
    ...computeYear(key, year + 1),
  ];
  const prefix = `${year}-`;
  const seen = new Set();
  return all
    .filter((h) => h.date.startsWith(prefix))
    .filter((h) => {
      const key2 = `${h.date}|${h.name}`;
      if (seen.has(key2)) return false;
      seen.add(key2);
      return true;
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export { SUN, SAT };
