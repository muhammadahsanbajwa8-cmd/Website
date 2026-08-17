/**
 * The computed facts that make a year page a page rather than a table dump.
 * Everything here is derived from the holiday list, so no two country-years
 * carry the same numbers.
 */

import {
  MONTH_NAMES,
  WEEKDAY_NAMES,
  addDays,
  daysInYear,
  eachDayOfYear,
  formatLong,
  iso,
  isWeekend,
  parseISO,
  utc,
  weekdaysInYear,
} from './dates.mjs';

/**
 * @param {number} year
 * @param {Array<{date: string, name: string, national: boolean}>} holidays
 * @param {Date} [today] reference point for "next holiday"
 */
export function yearStats(year, holidays, today = new Date()) {
  const inYear = holidays.filter((h) => h.date.startsWith(`${year}-`));
  const nationals = inYear.filter((h) => h.national !== false);

  const holidayDates = new Set(inYear.map((h) => h.date));
  const nationalWeekdayDates = new Set(
    nationals.filter((h) => !isWeekend(parseISO(h.date))).map((h) => h.date),
  );

  const weekendHolidays = inYear
    .map((h) => ({ ...h, weekday: WEEKDAY_NAMES[parseISO(h.date).getUTCDay()] }))
    .filter((h) => isWeekend(parseISO(h.date)));

  const weekdays = weekdaysInYear(year);
  const workingDays = weekdays - nationalWeekdayDates.size;

  // Longest run of consecutive days carrying no public holiday at all.
  let longest = { days: 0, from: null, to: null };
  let runStart = null;
  let runLength = 0;
  const closeRun = (end) => {
    if (runLength > longest.days) {
      longest = { days: runLength, from: iso(runStart), to: iso(end) };
    }
    runStart = null;
    runLength = 0;
  };
  for (const day of eachDayOfYear(year)) {
    if (holidayDates.has(iso(day))) {
      if (runLength) closeRun(addDays(day, -1));
      continue;
    }
    if (!runLength) runStart = day;
    runLength += 1;
  }
  if (runLength) closeRun(utc(year, 12, 31));

  // Per-month counts, used by the month strip on the year page.
  const byMonth = MONTH_NAMES.map((name, index) => ({
    name,
    month: index + 1,
    count: inYear.filter((h) => Number(h.date.slice(5, 7)) === index + 1).length,
  }));
  const busiestMonth = byMonth.reduce((a, b) => (b.count > a.count ? b : a), byMonth[0]);

  const todayISO = iso(
    utc(today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate()),
  );
  const next = inYear.find((h) => h.date >= todayISO) || null;

  return {
    year,
    total: inYear.length,
    nationalCount: nationals.length,
    regionalCount: inYear.length - nationals.length,
    calendarDays: daysInYear(year),
    weekdays,
    workingDays,
    /** National holidays actually subtracted from the working-day count. */
    nationalWeekdayCount: nationalWeekdayDates.size,
    weekendHolidayCount: weekendHolidays.length,
    weekendHolidays,
    longestGap: longest,
    byMonth,
    busiestMonth,
    nextHoliday: next
      ? { ...next, when: formatLong(parseISO(next.date)), daysAway: daysFrom(todayISO, next.date) }
      : null,
    holidayDates: [...holidayDates].sort(),
  };
}

function daysFrom(fromISO, toISO) {
  return Math.round((parseISO(toISO).getTime() - parseISO(fromISO).getTime()) / 86400000);
}

/** Next holiday from today, looking across several years of data. */
export function nextHolidayAcrossYears(byYear, today = new Date()) {
  const todayISO = iso(utc(today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate()));
  const years = Object.keys(byYear)
    .map(Number)
    .sort((a, b) => a - b);
  for (const year of years) {
    const found = byYear[year].find((h) => h.date >= todayISO);
    if (found) {
      return {
        ...found,
        year,
        when: formatLong(parseISO(found.date)),
        daysAway: daysFrom(todayISO, found.date),
      };
    }
  }
  return null;
}
