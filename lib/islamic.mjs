/**
 * Tabular (arithmetic) Islamic calendar.
 *
 * Eid al-Fitr and Eid al-Adha are the principal public holidays across much of
 * the world, so leaving them out would make those countries' pages wrong in the
 * way that matters most. They cannot be computed exactly: the Hijri months
 * begin on the sighting of the new moon, which varies by country and is
 * confirmed only days ahead.
 *
 * What this module gives is the arithmetic calendar — the standard Kuwaiti
 * civil reckoning — which lands within a day or two of the observed date. Every
 * date it produces is marked as an estimate all the way through to the page, so
 * a reader is never told a date is settled when it is not.
 */

import { utc } from './dates.mjs';

/** Julian Day Number for a date in the tabular Islamic calendar. */
export function islamicToJDN(year, month, day) {
  return (
    Math.ceil(29.5 * (month - 1)) +
    (year - 1) * 354 +
    Math.floor((3 + 11 * year) / 30) +
    day +
    1948439
  );
}

/** Julian Day Number for a Gregorian date. */
export function gregorianToJDN(year, month, day) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

/** Gregorian date for a Julian Day Number. */
export function jdnToGregorian(jdn) {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    year: 100 * b + d - 4800 + Math.floor(m / 10),
    month: m + 3 - 12 * Math.floor(m / 10),
    day: e - Math.floor((153 * m + 2) / 5) + 1,
  };
}

/** The Hijri year a Gregorian date falls in, approximately. */
export function hijriYearOf(gregorianYear) {
  return Math.floor((gregorianYear - 622) * (33 / 32)) + 1;
}

/**
 * Every occurrence of one Hijri month-and-day inside a Gregorian year.
 *
 * A Hijri year is about eleven days shorter than a Gregorian one, so a given
 * Hijri date can fall twice in the same Gregorian year — Ramadan began twice in
 * 2030, for instance. Returning an array rather than a single date is what
 * keeps those years correct.
 *
 * @returns {Date[]} UTC dates, in order
 */
export function hijriInGregorianYear(gregorianYear, hijriMonth, hijriDay) {
  const found = [];
  const start = hijriYearOf(gregorianYear) - 1;
  for (let hijriYear = start; hijriYear <= start + 2; hijriYear += 1) {
    const { year, month, day } = jdnToGregorian(islamicToJDN(hijriYear, hijriMonth, hijriDay));
    if (year === gregorianYear) found.push(utc(year, month, day));
  }
  return found.sort((a, b) => a - b);
}

/** Named Hijri dates used by the rule tables. */
export const HIJRI = {
  newYear: { month: 1, day: 1, name: 'Islamic New Year' },
  ashura: { month: 1, day: 10, name: 'Ashura' },
  mawlid: { month: 3, day: 12, name: "Prophet's Birthday" },
  isra: { month: 7, day: 27, name: 'Isra and Miraj' },
  ramadanStart: { month: 9, day: 1, name: 'First day of Ramadan' },
  eidAlFitr: { month: 10, day: 1, name: 'Eid al-Fitr' },
  eidAlAdha: { month: 12, day: 10, name: 'Eid al-Adha' },
};
