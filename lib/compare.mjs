/**
 * Trip-planning comparison between two countries.
 *
 * Everything here is derived from the holiday lists the site already holds:
 * when both countries are off at once, where the long weekends fall, which
 * single days off buy a four-day break, and which months are quiet.
 *
 * This module is pure ESM with no Node APIs, because the browser imports it
 * too — the interactive comparison on /compare/ runs the same code as the
 * pre-rendered pair pages, so the two can never disagree.
 */

import {
  MONTH_NAMES,
  MONTH_SHORT,
  WEEKDAY_NAMES,
  addDays,
  daysBetween,
  eachDayOfYear,
  formatShort,
  iso,
  isWeekend,
  parseISO,
} from './dates.mjs';

const isNational = (holiday) => holiday.national !== false;

/** Runs of consecutive non-working days: weekends plus national holidays. */
export function offRuns(year, holidays) {
  const byDate = new Map(holidays.filter(isNational).map((holiday) => [holiday.date, holiday]));
  const runs = [];
  let current = null;

  for (const day of eachDayOfYear(year)) {
    const key = iso(day);
    const holiday = byDate.get(key);
    if (isWeekend(day) || holiday) {
      if (!current) current = { start: key, end: key, days: 0, holidays: [] };
      current.end = key;
      current.days += 1;
      if (holiday) current.holidays.push(holiday);
    } else if (current) {
      runs.push(current);
      current = null;
    }
  }
  if (current) runs.push(current);
  return runs;
}

/** Breaks of three days or more that a public holiday actually created. */
export function longWeekends(runs) {
  return runs
    .filter((run) => run.days >= 3 && run.holidays.length > 0)
    .map((run) => ({
      ...run,
      label: `${formatShort(parseISO(run.start))} – ${formatShort(parseISO(run.end))}`,
      names: run.holidays.map((holiday) => holiday.name),
    }));
}

/**
 * One or two working days that would join two runs into a long break —
 * the "take Friday off and get nine days" trick.
 */
export function bridges(runs) {
  const out = [];
  for (let i = 0; i < runs.length - 1; i += 1) {
    const gap = daysBetween(parseISO(runs[i].end), parseISO(runs[i + 1].start)) - 1;
    if (gap < 1 || gap > 2) continue;

    const total = runs[i].days + gap + runs[i + 1].days;
    // Worth naming only when the days booked buy a real break: at least four
    // days away, and at least three more days than you spent.
    if (total < 4 || total < gap + 3) continue;
    if (!runs[i].holidays.length && !runs[i + 1].holidays.length) continue;

    out.push({
      start: runs[i].start,
      end: runs[i + 1].end,
      totalDays: total,
      daysOff: gap,
      bridge: Array.from({ length: gap }, (_, index) =>
        iso(addDays(parseISO(runs[i].end), index + 1)),
      ),
      holidays: [...runs[i].holidays, ...runs[i + 1].holidays],
      label: `${formatShort(parseISO(runs[i].start))} – ${formatShort(parseISO(runs[i + 1].end))}`,
    });
  }
  return out.sort((a, b) => b.totalDays - a.totalDays || (a.start < b.start ? -1 : 1));
}

/** Calendar overlap of two date ranges, or null. */
function overlap(a, b) {
  const start = a.start > b.start ? a.start : b.start;
  const end = a.end < b.end ? a.end : b.end;
  if (start > end) return null;
  return { start, end, days: daysBetween(parseISO(start), parseISO(end)) + 1 };
}

/**
 * Compare two countries for one year.
 *
 * @param {{code: string, name: string, flag?: string, holidays: Array, stats: object}} a
 * @param {{code: string, name: string, flag?: string, holidays: Array, stats: object}} b
 * @param {number} year
 */
export function compareCountries(a, b, year) {
  const aDates = new Map(a.holidays.map((holiday) => [holiday.date, holiday]));
  const bDates = new Map(b.holidays.map((holiday) => [holiday.date, holiday]));

  const shared = [];
  const onlyA = [];
  const onlyB = [];

  for (const [date, holiday] of aDates) {
    const match = bDates.get(date);
    if (match) {
      shared.push({
        date,
        weekday: WEEKDAY_NAMES[parseISO(date).getUTCDay()],
        weekend: isWeekend(parseISO(date)),
        a: holiday,
        b: match,
        sameName: holiday.name === match.name,
      });
    } else {
      onlyA.push(holiday);
    }
  }
  for (const [date, holiday] of bDates) {
    if (!aDates.has(date)) onlyB.push(holiday);
  }

  const sortByDate = (x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0);
  shared.sort(sortByDate);
  onlyA.sort(sortByDate);
  onlyB.sort(sortByDate);

  const runsA = offRuns(year, a.holidays);
  const runsB = offRuns(year, b.holidays);
  const longA = longWeekends(runsA);
  const longB = longWeekends(runsB);
  const bridgesA = bridges(runsA);
  const bridgesB = bridges(runsB);

  // Windows where both countries are on a long break at the same time.
  const sharedBreaks = [];
  for (const breakA of longA) {
    for (const breakB of longB) {
      const window = overlap(breakA, breakB);
      if (window && window.days >= 3) {
        sharedBreaks.push({
          ...window,
          label: `${formatShort(parseISO(window.start))} – ${formatShort(parseISO(window.end))}`,
          names: [...new Set([...breakA.names, ...breakB.names])],
        });
      }
    }
  }

  const months = MONTH_NAMES.map((name, index) => {
    const month = index + 1;
    const key = `${year}-${String(month).padStart(2, '0')}-`;
    return {
      month,
      name,
      short: MONTH_SHORT[index],
      a: a.holidays.filter((holiday) => holiday.date.startsWith(key)).length,
      b: b.holidays.filter((holiday) => holiday.date.startsWith(key)).length,
    };
  });

  const quietest = months.reduce((best, month) =>
    month.a + month.b < best.a + best.b ? month : best,
  );
  const busiest = months.reduce((best, month) =>
    month.a + month.b > best.a + best.b ? month : best,
  );

  return {
    year,
    a: summarise(a, { runs: runsA, long: longA, bridges: bridgesA }),
    b: summarise(b, { runs: runsB, long: longB, bridges: bridgesB }),
    shared,
    onlyA,
    onlyB,
    months,
    quietest,
    busiest,
    sharedBreaks: dedupeWindows(sharedBreaks),
    highlights: highlights(a, b, {
      year,
      shared,
      longA,
      longB,
      quietest,
      busiest,
      bridgesA,
      bridgesB,
    }),
  };
}

function summarise(country, extras) {
  return {
    code: country.code,
    name: country.name,
    flag: country.flag || '',
    stats: country.stats,
    holidays: country.holidays,
    // Present only when the build had event listings for this country.
    events: country.events || null,
    longWeekends: extras.long,
    bridges: extras.bridges,
    offDays: extras.runs.reduce((sum, run) => sum + run.days, 0),
  };
}

function dedupeWindows(windows) {
  const seen = new Set();
  return windows
    .filter((window) => {
      const key = `${window.start}|${window.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((x, y) => (x.start < y.start ? -1 : 1));
}

/**
 * The short verdicts shown at the top of a comparison. Each one is a fact
 * with a number in it and somewhere to click, never an opinion about which
 * country is nicer.
 */
function highlights(a, b, data) {
  const out = [];
  const diff = a.stats.total - b.stats.total;

  out.push(
    diff === 0
      ? {
          key: 'holidays',
          headline: `Both get ${a.stats.total} public holidays`,
          detail: `${a.name} and ${b.name} each have ${a.stats.total} public holidays in ${data.year}.`,
        }
      : {
          key: 'holidays',
          headline: `${diff > 0 ? a.name : b.name} has ${Math.abs(diff)} more ${
            Math.abs(diff) === 1 ? 'public holiday' : 'public holidays'
          }`,
          detail: `${a.name} ${a.stats.total}, ${b.name} ${b.stats.total} in ${data.year}.`,
        },
  );

  const workDiff = a.stats.workingDays - b.stats.workingDays;
  out.push({
    key: 'working-days',
    headline:
      workDiff === 0
        ? `Both work ${a.stats.workingDays} days`
        : `${workDiff < 0 ? a.name : b.name} works ${Math.abs(workDiff)} ${
            Math.abs(workDiff) === 1 ? 'day' : 'days'
          } fewer`,
    detail: `${a.name} ${a.stats.workingDays} working days, ${b.name} ${b.stats.workingDays}.`,
  });

  out.push({
    key: 'shared',
    headline: data.shared.length
      ? `${data.shared.length} ${data.shared.length === 1 ? 'day' : 'days'} off in common`
      : 'No holidays in common',
    detail: data.shared.length
      ? `Both countries are on holiday on the same date ${data.shared.length} ${
          data.shared.length === 1 ? 'time' : 'times'
        } in ${data.year}${
          data.shared.length ? `, starting ${formatShort(parseISO(data.shared[0].date))}` : ''
        }.`
      : `No date in ${data.year} is a public holiday in both countries — useful if you need one side working while you travel the other.`,
  });

  out.push({
    key: 'long-weekends',
    headline:
      data.longA.length === data.longB.length
        ? `${data.longA.length} long weekends each`
        : `${data.longA.length > data.longB.length ? a.name : b.name} gets more long weekends`,
    detail: `${a.name} ${data.longA.length}, ${b.name} ${data.longB.length} breaks of three days or more.`,
  });

  const bestBridge = [...data.bridgesA, ...data.bridgesB].sort(
    (x, y) => y.totalDays - x.totalDays,
  )[0];
  if (bestBridge) {
    const owner = data.bridgesA.includes(bestBridge) ? a : b;
    out.push({
      key: 'bridge',
      headline: `${bestBridge.daysOff} ${
        bestBridge.daysOff === 1 ? 'day' : 'days'
      } off buys ${bestBridge.totalDays} in ${owner.name}`,
      detail: `Book ${bestBridge.bridge
        .map((date) => formatShort(parseISO(date)))
        .join(' and ')} for a ${bestBridge.totalDays}-day run, ${bestBridge.label}.`,
    });
  }

  out.push({
    key: 'quiet',
    headline: `${data.quietest.name} is the quietest month`,
    detail: `${data.quietest.name} has ${data.quietest.a + data.quietest.b} public ${
      data.quietest.a + data.quietest.b === 1 ? 'holiday' : 'holidays'
    } across both countries; ${data.busiest.name} has ${data.busiest.a + data.busiest.b}.`,
  });

  return out;
}
