/**
 * Date arithmetic for the holiday generator.
 *
 * Every date in this codebase is a Date pinned to UTC midnight. Nothing here
 * reads the host timezone, so a build in Auckland and a build in Los Angeles
 * produce byte-identical output.
 */

export const MS_PER_DAY = 86400000;

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Day-of-week constants (JS convention: Sunday is 0). */
export const SUN = 0;
export const MON = 1;
export const TUE = 2;
export const WED = 3;
export const THU = 4;
export const FRI = 5;
export const SAT = 6;

/** Build a UTC date. Month is 1-12 so the rule tables read like a calendar. */
export function utc(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day));
}

/** 'YYYY-MM-DD'. */
export function iso(date) {
  return date.toISOString().slice(0, 10);
}

/** Parse 'YYYY-MM-DD' (or an ISO timestamp) as UTC midnight. */
export function parseISO(text) {
  const [year, month, day] = String(text).slice(0, 10).split('-').map(Number);
  return utc(year, month, day);
}

export function addDays(date, days) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** Whole days from `a` to `b`; negative when `b` precedes `a`. */
export function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/** Day of week, Sunday = 0. */
export function dayOfWeek(date) {
  return date.getUTCDay();
}

/** Day of week with Monday = 0, which is how the planner grid is laid out. */
export function mondayIndex(date) {
  return (date.getUTCDay() + 6) % 7;
}

export function isWeekend(date) {
  const d = date.getUTCDay();
  return d === SAT || d === SUN;
}

export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function daysInYear(year) {
  return isLeapYear(year) ? 366 : 365;
}

/**
 * Easter Sunday in the Gregorian calendar, by the Meeus/Jones/Butcher
 * algorithm. Valid for any Gregorian year.
 */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

/** A date a fixed number of days from Easter Sunday (Good Friday is -2). */
export function easterOffset(year, offset) {
  return addDays(easterSunday(year), offset);
}

/**
 * Orthodox Easter Sunday, as observed in the Gregorian calendar.
 *
 * The Julian computus gives the date in the Julian calendar; adding the
 * Julian-Gregorian gap converts it. The gap is 13 days from 1900 to 2099 and
 * 14 days from 2100, which is what the correction below tracks.
 */
export function orthodoxEasterSunday(year) {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const century = Math.floor(year / 100);
  const gap = century - Math.floor(century / 4) - 2;
  return addDays(utc(year, month, day), gap);
}

/** A date a fixed number of days from Orthodox Easter Sunday. */
export function orthodoxEasterOffset(year, offset) {
  return addDays(orthodoxEasterSunday(year), offset);
}

/**
 * The nth occurrence of a weekday in a month.
 * `n` counts from the start when positive and from the end when negative,
 * so -1 is "last Monday in May".
 */
export function nthWeekdayOfMonth(year, month, weekday, n) {
  if (n > 0) {
    const first = utc(year, month, 1);
    const offset = (weekday - first.getUTCDay() + 7) % 7;
    return utc(year, month, 1 + offset + (n - 1) * 7);
  }
  const lastDay = daysInMonth(year, month);
  const last = utc(year, month, lastDay);
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return utc(year, month, lastDay - offset + (n + 1) * 7);
}

/** The given weekday on or before `date` (Canada's Victoria Day rule). */
export function weekdayOnOrBefore(date, weekday) {
  const back = (date.getUTCDay() - weekday + 7) % 7;
  return addDays(date, -back);
}

/** The given weekday on or after `date`. */
export function weekdayOnOrAfter(date, weekday) {
  const forward = (weekday - date.getUTCDay() + 7) % 7;
  return addDays(date, forward);
}

/** Every day from `start` to `end`, inclusive. */
export function eachDay(start, end) {
  const out = [];
  for (let d = start; d.getTime() <= end.getTime(); d = addDays(d, 1)) out.push(d);
  return out;
}

/** Every day of a calendar year. */
export function eachDayOfYear(year) {
  return eachDay(utc(year, 1, 1), utc(year, 12, 31));
}

/** Weekdays (Mon-Fri) in a calendar year, ignoring holidays. */
export function weekdaysInYear(year) {
  let count = 0;
  for (const day of eachDayOfYear(year)) if (!isWeekend(day)) count += 1;
  return count;
}

/**
 * Business days between two dates: weekdays minus the supplied holidays.
 *
 * @param {Date} start
 * @param {Date} end
 * @param {Set<string>} holidays ISO date strings to exclude
 * @param {{inclusiveEnd?: boolean}} options end date counts by default
 */
export function businessDays(start, end, holidays = new Set(), options = {}) {
  const inclusiveEnd = options.inclusiveEnd !== false;
  const last = inclusiveEnd ? end : addDays(end, -1);
  const result = {
    calendarDays: 0,
    weekendDays: 0,
    holidayDays: 0,
    businessDays: 0,
    holidaysRemoved: [],
  };
  if (last.getTime() < start.getTime()) return result;

  for (let d = start; d.getTime() <= last.getTime(); d = addDays(d, 1)) {
    result.calendarDays += 1;
    if (isWeekend(d)) {
      result.weekendDays += 1;
      continue;
    }
    const key = iso(d);
    if (holidays.has(key)) {
      result.holidayDays += 1;
      result.holidaysRemoved.push(key);
      continue;
    }
    result.businessDays += 1;
  }
  return result;
}

/** 'Monday 5 January 2026'. */
export function formatLong(date) {
  return `${WEEKDAY_NAMES[date.getUTCDay()]} ${date.getUTCDate()} ${
    MONTH_NAMES[date.getUTCMonth()]
  } ${date.getUTCFullYear()}`;
}

/** '5 Jan 2026'. */
export function formatShort(date) {
  return `${date.getUTCDate()} ${MONTH_SHORT[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Today at UTC midnight. */
export function todayUTC(now = new Date()) {
  return utc(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
}
