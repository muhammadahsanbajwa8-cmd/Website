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
  MON,
  SAT,
  SUN,
  THU,
  addDays,
  easterOffset,
  iso,
  isWeekend,
  nthWeekdayOfMonth,
  utc,
  weekdayOnOrBefore,
} from './dates.mjs';

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

/** Country codes the fallback can compute. */
export function fallbackCountries() {
  return Object.keys(RULES).sort();
}

export function hasFallback(code) {
  return Object.prototype.hasOwnProperty.call(RULES, String(code || '').toUpperCase());
}

/** Resolve one rule to its unobserved date, or null if it did not apply. */
function baseDate(rule, year) {
  if (rule.from && year < rule.from) return null;
  if (rule.until && year > rule.until) return null;
  if (typeof rule.on === 'function') return rule.on(year);
  if (typeof rule.easter === 'number') return easterOffset(year, rule.easter);
  if (rule.weekday !== undefined) return nthWeekdayOfMonth(year, rule.month, rule.weekday, rule.nth);
  return utc(year, rule.month, rule.day);
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
  const spec = RULES[code];
  const entries = [];
  for (const rule of spec.rules) {
    const date = baseDate(rule, year);
    if (date) entries.push({ rule, date });
  }
  entries.sort((a, b) => a.date - b.date);

  const taken = new Set();
  const out = [];
  for (const { rule, date } of entries) {
    const strategy = rule.observe === undefined ? spec.observe : rule.observe;
    let observed = date;
    if (strategy === 'us') observed = shiftUS(date);
    else if (strategy === 'substitute') observed = shiftSubstitute(date, taken);

    const moved = observed.getTime() !== date.getTime();
    taken.add(iso(observed));
    out.push({
      date: iso(observed),
      name: moved && spec.suffix ? `${rule.name} ${spec.suffix}` : rule.name,
      type: rule.type || 'Public',
      national: rule.national !== false,
      observedFrom: moved ? iso(date) : null,
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
  if (!RULES[key]) return null;
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
