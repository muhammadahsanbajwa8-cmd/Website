/**
 * Holiday overlap across a distributed team.
 *
 * The problem it solves is mundane and constant: you schedule something for a
 * Tuesday, and it turns out to be Golden Week in Japan, or the day after Diwali
 * in India, and half the people you needed are not there. One calendar per
 * country does not answer it, because the answer is about the intersection.
 *
 * So this counts three different things, which people confuse:
 *
 *   fully staffed   a working day everywhere — the days you can actually
 *                   expect the whole team
 *   partial         a working day somewhere and a holiday somewhere else —
 *                   the days that quietly go wrong
 *   everyone off    a public holiday in every country at once — rarer than
 *                   people expect, and worth knowing about
 *
 * No Node APIs: the browser runs this module directly.
 */

import { MONTH_NAMES, eachDayOfYear, iso, isWeekend } from './dates.mjs';

export const MAX_MEMBERS = 6;

/**
 * @param {number} year
 * @param {Array<{
 *   code: string, name: string, flag?: string,
 *   holidays: Array<{date: string, name: string, national?: boolean}>,
 * }>} members
 * @param {{includeRegional?: boolean, today?: string|null}} [options]
 */
export function teamOverlap(year, members, options = {}) {
  const includeRegional = Boolean(options.includeRegional);
  const today = options.today || null;

  const sides = members.slice(0, MAX_MEMBERS).map((member) => {
    const map = new Map();
    for (const holiday of member.holidays || []) {
      if (!includeRegional && holiday.national === false) continue;
      if (!map.has(holiday.date)) map.set(holiday.date, holiday);
    }
    return { code: member.code, name: member.name, flag: member.flag || '', holidays: map };
  });

  const absences = [];
  const everyoneOff = [];
  const monthly = MONTH_NAMES.map((name) => ({ month: name, absences: 0, workingDays: 0 }));

  let fullyStaffed = 0;
  let partial = 0;
  let weekdays = 0;

  for (const date of eachDayOfYear(year)) {
    if (isWeekend(date)) continue;
    const key = iso(date);
    const month = date.getUTCMonth();
    weekdays += 1;
    monthly[month].workingDays += 1;

    const away = sides.filter((side) => side.holidays.has(key));

    if (!away.length) {
      fullyStaffed += 1;
      continue;
    }

    partial += 1;
    monthly[month].absences += 1;

    const entry = {
      date: key,
      month: MONTH_NAMES[month],
      away: away.map((side) => ({
        code: side.code,
        name: side.name,
        flag: side.flag,
        holiday: side.holidays.get(key).name,
      })),
      present: sides.filter((side) => !side.holidays.has(key)).map((side) => side.code),
      everyone: away.length === sides.length,
      past: Boolean(today && key < today),
    };
    absences.push(entry);
    if (entry.everyone) everyoneOff.push(entry);
  }

  // The month with the fewest disrupted days is the one to put the workshop in.
  const ranked = monthly
    .map((month, index) => ({
      ...month,
      index,
      rate: month.workingDays ? month.absences / month.workingDays : 0,
    }))
    .sort((a, b) => a.rate - b.rate || a.index - b.index);

  return {
    year,
    sides,
    includeRegional,
    absences,
    everyoneOff,
    monthly,
    weekdays,
    fullyStaffed,
    partial,
    /** Share of the working year with everybody actually available. */
    coverage: weekdays ? fullyStaffed / weekdays : 0,
    clearestMonth: ranked[0] || null,
    busiestMonth: ranked.at(-1) || null,
    perMember: sides.map((side) => ({
      code: side.code,
      name: side.name,
      flag: side.flag,
      holidays: side.holidays.size,
      weekdayHolidays: [...side.holidays.keys()].filter((key) => {
        const [y, m, d] = key.split('-').map(Number);
        return !isWeekend(new Date(Date.UTC(y, m - 1, d)));
      }).length,
    })),
  };
}

/**
 * The longest stretches with nobody away — where a sprint, a launch or a
 * workshop actually fits.
 *
 * @param {ReturnType<typeof teamOverlap>} overlap
 * @param {number} [limit]
 */
export function clearRuns(overlap, limit = 5) {
  const blocked = new Set(overlap.absences.map((entry) => entry.date));
  const runs = [];
  let current = null;

  for (const date of eachDayOfYear(overlap.year)) {
    if (isWeekend(date)) continue;
    const key = iso(date);
    if (blocked.has(key)) {
      current = null;
      continue;
    }
    if (!current) {
      current = { from: key, to: key, workingDays: 1 };
      runs.push(current);
    } else {
      current.to = key;
      current.workingDays += 1;
    }
  }

  return runs
    .sort((a, b) => b.workingDays - a.workingDays || (a.from < b.from ? -1 : 1))
    .slice(0, limit);
}

export default teamOverlap;
