import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_BUDGET, STRATEGIES, describeBreak, planLeave } from '../lib/leave.mjs';
import { fallbackHolidays } from '../lib/fallback.mjs';
import { addDays, iso, isWeekend, parseISO, utc } from '../lib/dates.mjs';

const YEAR = 2026;
const us = () => fallbackHolidays('US', YEAR);
const de = () => fallbackHolidays('DE', YEAR);

/** Every date inside a break, inclusive. */
function span(item) {
  const out = [];
  for (let d = parseISO(item.from); iso(d) <= item.to; d = addDays(d, 1)) out.push(iso(d));
  return out;
}

test('it never spends more leave than it was given', () => {
  for (const budget of [0, 1, 3, 7, 10, 25, MAX_BUDGET]) {
    for (const strategy of Object.keys(STRATEGIES)) {
      const plan = planLeave(YEAR, us(), { budget, strategy });
      assert.ok(
        plan.leaveUsed <= budget,
        `${strategy} with ${budget} spent ${plan.leaveUsed}`,
      );
      assert.equal(
        plan.leaveUsed,
        plan.breaks.reduce((sum, item) => sum + item.cost, 0),
        'the total matches the parts',
      );
    }
  }
});

test('a budget of nothing buys nothing', () => {
  const plan = planLeave(YEAR, us(), { budget: 0 });
  assert.equal(plan.breaks.length, 0);
  assert.equal(plan.daysOff, 0);
  assert.equal(plan.multiplier, 0);
});

test('every day it tells you to book is actually a working day', () => {
  const holidays = new Set(us().filter((h) => h.national !== false).map((h) => h.date));
  const plan = planLeave(YEAR, us(), { budget: 20 });
  assert.ok(plan.breaks.length > 0);

  for (const item of plan.breaks) {
    for (const date of item.book) {
      assert.ok(!isWeekend(parseISO(date)), `${date} is a weekend — booking it wastes a day`);
      assert.ok(!holidays.has(date), `${date} is already a public holiday`);
    }
  }
});

test('every day inside a break is genuinely a day off', () => {
  const holidays = new Set(us().filter((h) => h.national !== false).map((h) => h.date));
  const plan = planLeave(YEAR, us(), { budget: 15 });

  for (const item of plan.breaks) {
    const booked = new Set(item.book);
    for (const date of span(item)) {
      const off = isWeekend(parseISO(date)) || holidays.has(date) || booked.has(date);
      assert.ok(off, `${date} sits inside a break but is a normal working day`);
    }
  }
});

test('the arithmetic on each break holds together', () => {
  const plan = planLeave(YEAR, de(), { budget: 18 });
  for (const item of plan.breaks) {
    const days = span(item);
    assert.equal(item.length, days.length, 'length matches the date range');
    assert.equal(item.cost, item.book.length, 'cost matches the days booked');
    assert.equal(
      item.length,
      item.book.length + item.weekendDays + item.holidays.length,
      'every day is booked, a weekend or a holiday',
    );
    assert.ok(item.multiplier >= 1);
  }
  assert.equal(plan.daysOff, plan.breaks.reduce((sum, item) => sum + item.length, 0));
});

test('breaks come back in order and never touch each other', () => {
  const plan = planLeave(YEAR, de(), { budget: 30 });
  for (let i = 1; i < plan.breaks.length; i += 1) {
    const previous = plan.breaks[i - 1];
    const current = plan.breaks[i];
    assert.ok(current.from > previous.to, `${current.from} follows ${previous.to}`);
    // Adjacent breaks would really be one longer break, described as two.
    assert.ok(
      parseISO(current.from).getTime() - parseISO(previous.to).getTime() > 86400000,
      `${previous.to} and ${current.from} run together`,
    );
  }
});

test('each strategy keeps its own promise', () => {
  const long = planLeave(YEAR, us(), { budget: 20, strategy: 'long-breaks' });
  for (const item of long.breaks) {
    assert.ok(item.length >= 7, `long-breaks returned a ${item.length}-day break`);
  }

  const weekends = planLeave(YEAR, us(), { budget: 20, strategy: 'long-weekends' });
  for (const item of weekends.breaks) {
    assert.ok(item.cost <= 2, `long-weekends spent ${item.cost} days on one break`);
  }

  // Balanced exists because the other two answer different questions. If it
  // matched either one exactly there would be no reason for it to be there.
  const balanced = planLeave(YEAR, us(), { budget: 20, strategy: 'balanced' });
  assert.ok(balanced.longest >= 7, 'balanced sets aside enough for one real trip');
  assert.ok(
    balanced.breaks.length > 1,
    'balanced still spends the remainder on shorter breaks',
  );
  assert.notEqual(
    balanced.breaks.length,
    weekends.breaks.length,
    'balanced and long-weekends give different answers',
  );
});

test('long weekends maximise raw days off, which is the trade they make', () => {
  const weekends = planLeave(YEAR, us(), { budget: 10, strategy: 'long-weekends' });
  const long = planLeave(YEAR, us(), { budget: 10, strategy: 'long-breaks' });

  assert.ok(weekends.daysOff > long.daysOff, 'more total days off');
  assert.ok(long.longest > weekends.longest, 'but shorter individual breaks');

  // Ten US public holidays fall on weekdays in 2026, each one bridgeable into a
  // four-day weekend for a single day of leave.
  assert.equal(weekends.daysOff, 40);
  assert.equal(weekends.multiplier, 4);
});

test('nothing is planned before the date you start from', () => {
  const from = `${YEAR}-07-01`;
  const plan = planLeave(YEAR, us(), { budget: 20, after: from });
  for (const item of plan.breaks) {
    assert.ok(item.from >= from, `${item.from} is before ${from}`);
  }
});

test('regional holidays only count when asked for', () => {
  // 16 March 2026 is a Monday, and it is the only holiday in this list. With it
  // ignored, every break in the year is a plain three-day weekend. With it
  // counted, one break — and only one — can reach four days, because the free
  // Monday is already attached to a weekend.
  const monday = `${YEAR}-03-16`;
  const holidays = [{ date: monday, name: 'Invented Regional Day', national: false }];
  const shared = { budget: 20, strategy: 'long-weekends' };

  const without = planLeave(YEAR, holidays, shared);
  assert.equal(without.longest, 3, 'a regional day is a working day unless asked for');
  assert.ok(
    without.breaks.every((item) => item.holidays.length === 0),
    'and is never reported as a holiday',
  );

  const with_ = planLeave(YEAR, holidays, { ...shared, includeRegional: true });
  assert.equal(with_.longest, 4, 'counting it makes one break longer');

  const around = with_.breaks.find((item) => item.from <= monday && item.to >= monday);
  assert.ok(around, 'the free Monday is worth building a break around');
  assert.ok(!around.book.includes(monday), 'a day already off is never booked');
  assert.equal(around.holidays[0].name, 'Invented Regional Day');
  assert.ok(
    with_.breaks.every((item) => !item.book.includes(monday)),
    'no break anywhere books it',
  );
});

test('a country with no holidays still plans, off weekends alone', () => {
  const plan = planLeave(YEAR, [], { budget: 6, strategy: 'long-weekends' });
  assert.ok(plan.breaks.length > 0);
  for (const item of plan.breaks) {
    assert.equal(item.holidays.length, 0);
    assert.ok(item.length >= 3, 'a booked Friday or Monday still makes three days');
  }
});

test('the budget is clamped rather than trusted', () => {
  assert.equal(planLeave(YEAR, us(), { budget: -5 }).budget, 0);
  assert.equal(planLeave(YEAR, us(), { budget: 9999 }).budget, MAX_BUDGET);
  assert.equal(planLeave(YEAR, us(), { budget: 'nonsense' }).budget, 0);
});

test('an unknown strategy falls back rather than throwing', () => {
  const plan = planLeave(YEAR, us(), { budget: 10, strategy: 'not-a-strategy' });
  assert.equal(plan.strategy, 'balanced');
});

test('leap years are planned to the last day', () => {
  const plan = planLeave(2028, fallbackHolidays('US', 2028), { budget: 30 });
  assert.ok(plan.breaks.length > 0);
  for (const item of plan.breaks) {
    assert.ok(item.to <= '2028-12-31', `${item.to} is outside 2028`);
    assert.ok(item.from >= '2028-01-01', `${item.from} is outside 2028`);
  }
});

test('the prose describes the break it was given', () => {
  const plan = planLeave(YEAR, us(), { budget: 10, strategy: 'long-weekends' });
  for (const item of plan.breaks) {
    const text = describeBreak(item);
    assert.match(text, new RegExp(`away for ${item.length} days`));
    assert.ok(
      text.includes(`Book ${item.cost} day`),
      `prose states the real cost: ${text}`,
    );
    if (item.holidays.length === 1) assert.ok(text.includes(item.holidays[0].name));
    if (!item.holidays.length) assert.match(text, /weekends either side/);
  }
});

test('holidays swallowed by a weekend are counted', () => {
  // 4 July 2026 is a Saturday — but US rules move it, so the published date is
  // Friday 3 July and nothing is actually lost. That substitution is the whole
  // point of the observance rules, so the US count here is zero, not one.
  assert.ok(isWeekend(utc(2026, 7, 4)));
  assert.ok(us().some((holiday) => holiday.date === `${YEAR}-07-03`));
  assert.equal(planLeave(YEAR, us(), { budget: 10 }).holidaysLost, 0);

  // Germany substitutes nothing, so a holiday on a Saturday is simply gone.
  const saturday = `${YEAR}-03-14`;
  assert.ok(isWeekend(parseISO(saturday)));
  const plan = planLeave(YEAR, [{ date: saturday, name: 'Invented Saturday Day' }], {
    budget: 5,
  });
  assert.equal(plan.holidaysLost, 1);
});
