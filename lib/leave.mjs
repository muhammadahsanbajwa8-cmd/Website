/**
 * The annual leave optimiser.
 *
 * The question it answers: "I have N days of paid leave. Which days do I book
 * to spend the most time away from work?"
 *
 * The whole thing rests on one observation. A day off is worth more when it is
 * next to other days off, because the value to a person is the length of the
 * unbroken run, not the count of days. Booking the Friday after a Thursday
 * public holiday costs one day and buys four. Booking a Wednesday in a week
 * with nothing else in it costs one day and buys one.
 *
 * So: enumerate every unbroken run of days off that could be bought, price each
 * one in leave days, and pick the set that buys the most time within budget.
 * That last step is a knapsack, and the year is small enough to solve it
 * exactly rather than greedily — 365 days by 40 leave days is nothing.
 *
 * No Node APIs here: the browser runs this module directly, so the planner a
 * visitor drives is the same code that rendered the page.
 */

import {
  MONTH_NAMES,
  addDays,
  daysInYear,
  formatLong,
  iso,
  isWeekend,
  utc,
} from './dates.mjs';

/**
 * How to spend the budget. The optimiser's arithmetic does not change; what
 * changes is which runs it is allowed to consider.
 *
 * This matters more than it looks. Maximising total days off alone always
 * favours a scatter of long weekends, because bridging a single Friday is the
 * cheapest trade on the board. Someone saving for a fortnight abroad wants the
 * opposite, and no amount of arithmetic can tell you which of them you are.
 */
export const STRATEGIES = {
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    blurb: 'One proper trip, then long weekends with what is left.',
    minLength: 3,
    maxCost: 2,
    /**
     * Balanced cannot be expressed as a single set of limits, and pretending
     * otherwise produced a planner whose first two options gave identical
     * answers. Left to itself the optimiser always buys long weekends, because
     * bridging one Friday is the best trade on the board and stays the best
     * trade until the budget runs out. So balanced is solved in two passes:
     * reserve part of the budget for a trip long enough to be worth packing
     * for, then spend the remainder the greedy way.
     */
    reserve: 0.6,
  },
  'long-weekends': {
    id: 'long-weekends',
    label: 'Long weekends',
    blurb: 'Many short escapes. The cheapest possible use of every day.',
    minLength: 3,
    maxCost: 2,
  },
  'long-breaks': {
    id: 'long-breaks',
    label: 'Proper holidays',
    blurb: 'Fewer, longer trips — nothing shorter than a week.',
    minLength: 7,
    maxCost: 10,
  },
};

export const DEFAULT_STRATEGY = 'balanced';
export const MAX_BUDGET = 40;

/** Longest run worth considering. Nobody bridges five weeks. */
const MAX_RUN = 32;

/**
 * @param {number} year
 * @param {Array<{date: string, name: string, national?: boolean}>} holidays
 * @param {{
 *   budget?: number,
 *   strategy?: keyof STRATEGIES,
 *   includeRegional?: boolean,
 *   after?: string|null,
 * }} [options]
 */
export function planLeave(year, holidays = [], options = {}) {
  const strategy = STRATEGIES[options.strategy] || STRATEGIES[DEFAULT_STRATEGY];
  const budget = clamp(Math.round(Number(options.budget) || 0), 0, MAX_BUDGET);
  const includeRegional = Boolean(options.includeRegional);

  const total = daysInYear(year);
  const first = utc(year, 1, 1);
  const dateAt = (index) => addDays(first, index);
  const indexOf = (isoDate) => {
    const [y, m, d] = isoDate.split('-').map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - first.getTime()) / 86400000);
  };

  // --- The year as a strip of days ------------------------------------------

  const off = new Uint8Array(total);
  const holidayAt = new Array(total).fill(null);

  for (let i = 0; i < total; i += 1) if (isWeekend(dateAt(i))) off[i] = 1;

  for (const holiday of holidays) {
    if (!includeRegional && holiday.national === false) continue;
    const index = indexOf(holiday.date);
    if (index < 0 || index >= total) continue;
    off[index] = 1;
    if (!holidayAt[index]) holidayAt[index] = holiday;
  }

  // Working days before each index, so the cost of any run is one subtraction.
  const workingBefore = new Int32Array(total + 1);
  for (let i = 0; i < total; i += 1) workingBefore[i + 1] = workingBefore[i] + (off[i] ? 0 : 1);
  const costOf = (start, end) => workingBefore[end + 1] - workingBefore[start];

  // Public holidays before each index, used only to break ties.
  const holidaysBefore = new Int32Array(total + 1);
  for (let i = 0; i < total; i += 1) {
    holidaysBefore[i + 1] = holidaysBefore[i] + (holidayAt[i] ? 1 : 0);
  }
  const holidaysIn = (start, end) => holidaysBefore[end + 1] - holidaysBefore[start];

  /**
   * What a run is worth to the optimiser.
   *
   * Days off come first and nothing outranks them, so the plan is still the
   * mathematically best one. But equal-length runs are extremely common — every
   * spare Monday in the year buys the same three days — and left to chance the
   * planner would hand back "book a Monday in November" as though that were a
   * finding. Among equals, prefer the run built on a public holiday: it is the
   * one the visitor came here to be told about.
   */
  const HOLIDAY_TIEBREAK = 64; // larger than any run length, so it can never outweigh a day
  const scoreOf = (start, end, length) => length * HOLIDAY_TIEBREAK + holidaysIn(start, end);

  const earliest = options.after ? Math.max(0, indexOf(options.after)) : 0;

  let candidateCount = 0;

  /**
   * One pass of the optimiser.
   *
   * @param {{minLength: number, maxCost: number, budget: number, taken?: Uint8Array}} limits
   * @returns {Array<object>} the runs it chose, in date order
   */
  function solve({ minLength, maxCost, budget: allowance, taken }) {
    if (allowance < 1) return [];

    // --- Every run that could be bought -------------------------------------
    //
    // A run is maximal by construction: the day before it and the day after it
    // are working days left unbooked. Anything else is the same run described
    // badly, and would let the optimiser count one break as two.

    const candidatesFrom = Array.from({ length: total }, () => []);

    for (let start = earliest; start < total; start += 1) {
      if (start > 0 && off[start - 1]) continue; // not the true beginning of a run
      const limit = Math.min(total - 1, start + MAX_RUN - 1);

      for (let end = start; end <= limit; end += 1) {
        if (end < total - 1 && off[end + 1]) continue; // not the true end of a run
        const cost = costOf(start, end);
        if (cost < 1 || cost > maxCost || cost > allowance) continue;
        const length = end - start + 1;
        if (length < minLength) continue;
        // A later pass must not overlap or touch what an earlier one booked,
        // or two breaks would run together into one the plan never described.
        if (taken && overlaps(taken, start, end, total)) continue;
        candidatesFrom[start].push({ start, end, length, cost, score: scoreOf(start, end, length) });
        candidateCount += 1;
      }
    }

    // --- Knapsack over the year ----------------------------------------------
    //
    // best[i][b] is the best score obtainable from day i onwards with b leave
    // days left — days off first, holiday-anchored runs preferred among equals.
    // Solved backwards so each state reads only states that are already known.

    const width = allowance + 1;
    const best = new Int32Array((total + 2) * width);
    const at = (day, left) => day * width + left;

    for (let day = total - 1; day >= 0; day -= 1) {
      for (let left = 0; left <= allowance; left += 1) {
        let value = best[at(day + 1, left)]; // skip this day
        for (const run of candidatesFrom[day]) {
          if (run.cost > left) continue;
          // Resume two days later: the day straight after a run is an unbooked
          // working day, so nothing can start there anyway.
          const after = Math.min(total, run.end + 2);
          const gained = run.score + best[at(after, left - run.cost)];
          if (gained > value) value = gained;
        }
        best[at(day, left)] = value;
      }
    }

    // --- Walk the answer back out --------------------------------------------

    const chosenRuns = [];
    let day = 0;
    let left = allowance;
    while (day < total) {
      const target = best[at(day, left)];
      if (target === best[at(day + 1, left)]) {
        day += 1;
        continue;
      }
      const chosen = candidatesFrom[day].find((run) => {
        if (run.cost > left) return false;
        const after = Math.min(total, run.end + 2);
        return run.score + best[at(after, left - run.cost)] === target;
      });
      if (!chosen) {
        day += 1;
        continue;
      }
      chosenRuns.push(chosen);
      left -= chosen.cost;
      day = Math.min(total, chosen.end + 2);
    }
    return chosenRuns;
  }

  // --- Run the passes this strategy asks for ---------------------------------

  let runs;
  if (strategy.reserve && budget >= 6) {
    const trip = STRATEGIES['long-breaks'];
    const reserved = Math.round(budget * strategy.reserve);
    const first_ = solve({ minLength: trip.minLength, maxCost: trip.maxCost, budget: reserved });

    const taken = new Uint8Array(total);
    let spent = 0;
    for (const run of first_) {
      for (let i = run.start; i <= run.end; i += 1) taken[i] = 1;
      spent += run.cost;
    }

    const rest = solve({
      minLength: strategy.minLength,
      maxCost: strategy.maxCost,
      budget: budget - spent,
      taken,
    });
    runs = [...first_, ...rest].sort((a, b) => a.start - b.start);
  } else {
    runs = solve({ minLength: strategy.minLength, maxCost: strategy.maxCost, budget });
  }

  const breaks = runs.map((run) => describeRun(run, { dateAt, off, holidayAt }));
  const leaveUsed = breaks.reduce((sum, item) => sum + item.cost, 0);
  const daysOff = breaks.reduce((sum, item) => sum + item.length, 0);

  return {
    year,
    strategy: strategy.id,
    budget,
    includeRegional,
    breaks,
    leaveUsed,
    leaveLeft: budget - leaveUsed,
    daysOff,
    /** Days off per leave day spent — the number that makes the case. */
    multiplier: leaveUsed ? daysOff / leaveUsed : 0,
    longest: breaks.reduce((max, item) => Math.max(max, item.length), 0),
    candidateCount,
    /** Public holidays swallowed by a weekend, so the year starts a day down. */
    holidaysLost: holidays.filter((holiday) => {
      if (!includeRegional && holiday.national === false) return false;
      const index = indexOf(holiday.date);
      return index >= 0 && index < total && isWeekend(dateAt(index));
    }).length,
  };
}

/** Does [start, end] touch or overlap anything already booked? */
function overlaps(taken, start, end, total) {
  const from = Math.max(0, start - 1);
  const to = Math.min(total - 1, end + 1);
  for (let i = from; i <= to; i += 1) if (taken[i]) return true;
  return false;
}

/** Turn a chosen run into something a page can print. */
function describeRun(run, { dateAt, off, holidayAt }) {
  const book = [];
  const holidaysInside = [];
  let weekendDays = 0;

  for (let i = run.start; i <= run.end; i += 1) {
    const date = dateAt(i);
    if (!off[i]) {
      book.push(iso(date));
      continue;
    }
    if (holidayAt[i]) holidaysInside.push({ date: iso(date), name: holidayAt[i].name });
    else weekendDays += 1;
  }

  const from = dateAt(run.start);
  const to = dateAt(run.end);

  return {
    from: iso(from),
    to: iso(to),
    fromLong: formatLong(from),
    toLong: formatLong(to),
    length: run.length,
    cost: run.cost,
    book,
    holidays: holidaysInside,
    weekendDays,
    month: MONTH_NAMES[from.getUTCMonth()],
    /** How many days off each booked day bought. */
    multiplier: run.length / run.cost,
  };
}

/**
 * One sentence explaining why a break is worth what it costs. Written from the
 * run itself rather than a template bank, so it says something true about that
 * particular week rather than something vague about all of them.
 */
export function describeBreak(item) {
  const parts = [];
  const days = (count, one = 'day', many = 'days') =>
    `${count} ${count === 1 ? one : many}`;

  parts.push(
    `Book ${days(item.cost)} and you are away for ${days(item.length)}, ${item.fromLong} to ${item.toLong}.`,
  );

  if (item.holidays.length === 1) {
    parts.push(`${item.holidays[0].name} does the heavy lifting.`);
  } else if (item.holidays.length > 1) {
    parts.push(
      `Two public holidays sit inside it — ${item.holidays
        .map((holiday) => holiday.name)
        .join(' and ')} — which is why it comes so cheap.`,
    );
  } else {
    parts.push('It works purely off the weekends either side.');
  }

  if (item.multiplier >= 4) parts.push('That is the best trade in the year.');
  else if (item.multiplier >= 3) parts.push('Three days off or better for every day booked.');

  return parts.join(' ');
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export default planLeave;
