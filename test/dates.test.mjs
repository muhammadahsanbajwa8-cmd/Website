import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MON,
  THU,
  addDays,
  businessDays,
  daysInMonth,
  easterOffset,
  easterSunday,
  iso,
  isLeapYear,
  isWeekend,
  mondayIndex,
  nthWeekdayOfMonth,
  parseISO,
  utc,
  weekdayOnOrBefore,
  weekdaysInYear,
} from '../lib/dates.mjs';

test('easter is computed, never tabulated', () => {
  // Reference dates from the Gregorian computus.
  const known = {
    2020: '2020-04-12',
    2021: '2021-04-04',
    2022: '2022-04-17',
    2023: '2023-04-09',
    2024: '2024-03-31',
    2025: '2025-04-20',
    2026: '2026-04-05',
    2027: '2027-03-28',
    2028: '2028-04-16',
    2029: '2029-04-01',
    2030: '2030-04-21',
    2031: '2031-04-13',
    2032: '2032-03-28',
    2033: '2033-04-17',
    2034: '2034-04-09',
    2035: '2035-03-25',
  };
  for (const [year, expected] of Object.entries(known)) {
    assert.equal(iso(easterSunday(Number(year))), expected, `Easter ${year}`);
  }
});

test('easter always lands on a Sunday, for a thousand years', () => {
  for (let year = 1600; year <= 2600; year += 1) {
    assert.equal(easterSunday(year).getUTCDay(), 0, `Easter ${year} is a Sunday`);
  }
});

test('easter-relative holidays', () => {
  // Good Friday, Easter Monday, Ascension (+39), Whit Monday (+50).
  assert.equal(iso(easterOffset(2026, -2)), '2026-04-03');
  assert.equal(iso(easterOffset(2026, 1)), '2026-04-06');
  assert.equal(iso(easterOffset(2026, 39)), '2026-05-14');
  assert.equal(iso(easterOffset(2026, 50)), '2026-05-25');

  assert.equal(iso(easterOffset(2027, -2)), '2027-03-26');
  assert.equal(iso(easterOffset(2027, 1)), '2027-03-29');
  assert.equal(iso(easterOffset(2027, 39)), '2027-05-06');
  assert.equal(iso(easterOffset(2027, 50)), '2027-05-17');
});

test('nth weekday of month, counting forwards', () => {
  // US Thanksgiving: fourth Thursday in November.
  assert.equal(iso(nthWeekdayOfMonth(2025, 11, THU, 4)), '2025-11-27');
  assert.equal(iso(nthWeekdayOfMonth(2026, 11, THU, 4)), '2026-11-26');
  assert.equal(iso(nthWeekdayOfMonth(2027, 11, THU, 4)), '2027-11-25');
  assert.equal(iso(nthWeekdayOfMonth(2028, 11, THU, 4)), '2028-11-23');

  // Martin Luther King Jr. Day: third Monday in January.
  assert.equal(iso(nthWeekdayOfMonth(2026, 1, MON, 3)), '2026-01-19');
  assert.equal(iso(nthWeekdayOfMonth(2027, 1, MON, 3)), '2027-01-18');

  // UK early May bank holiday: first Monday in May.
  assert.equal(iso(nthWeekdayOfMonth(2026, 5, MON, 1)), '2026-05-04');
  assert.equal(iso(nthWeekdayOfMonth(2027, 5, MON, 1)), '2027-05-03');
});

test('nth weekday of month, counting backwards', () => {
  // US Memorial Day / UK spring bank holiday: last Monday in May.
  assert.equal(iso(nthWeekdayOfMonth(2025, 5, MON, -1)), '2025-05-26');
  assert.equal(iso(nthWeekdayOfMonth(2026, 5, MON, -1)), '2026-05-25');
  assert.equal(iso(nthWeekdayOfMonth(2027, 5, MON, -1)), '2027-05-31');
  assert.equal(iso(nthWeekdayOfMonth(2028, 5, MON, -1)), '2028-05-29');

  // UK summer bank holiday: last Monday in August.
  assert.equal(iso(nthWeekdayOfMonth(2026, 8, MON, -1)), '2026-08-31');
  assert.equal(iso(nthWeekdayOfMonth(2027, 8, MON, -1)), '2027-08-30');
});

test('nth weekday results stay inside their month', () => {
  for (let year = 2020; year <= 2040; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      for (let weekday = 0; weekday < 7; weekday += 1) {
        const first = nthWeekdayOfMonth(year, month, weekday, 1);
        const last = nthWeekdayOfMonth(year, month, weekday, -1);
        assert.equal(first.getUTCMonth() + 1, month);
        assert.equal(last.getUTCMonth() + 1, month);
        assert.equal(first.getUTCDay(), weekday);
        assert.equal(last.getUTCDay(), weekday);
        assert.ok(first.getUTCDate() <= 7);
        assert.ok(last.getUTCDate() > daysInMonth(year, month) - 7);
      }
    }
  }
});

test('weekday on or before a fixed date (Victoria Day)', () => {
  // The Monday preceding 25 May.
  assert.equal(iso(weekdayOnOrBefore(utc(2026, 5, 24), MON)), '2026-05-18');
  assert.equal(iso(weekdayOnOrBefore(utc(2027, 5, 24), MON)), '2027-05-24');
});

test('leap years and weekday counts', () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2025), false);
  assert.equal(isLeapYear(2000), true);
  assert.equal(isLeapYear(1900), false);
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2025, 2), 28);
  assert.equal(weekdaysInYear(2026), 261);
  assert.equal(weekdaysInYear(2027), 261);
});

test('weekend detection and planner column index', () => {
  assert.equal(isWeekend(parseISO('2026-01-03')), true); // Saturday
  assert.equal(isWeekend(parseISO('2026-01-04')), true); // Sunday
  assert.equal(isWeekend(parseISO('2026-01-05')), false); // Monday
  assert.equal(mondayIndex(parseISO('2026-01-05')), 0);
  assert.equal(mondayIndex(parseISO('2026-01-04')), 6);
});

test('business days exclude weekends and holidays', () => {
  const holidays = new Set(['2026-01-01']);
  const r = businessDays(parseISO('2026-01-01'), parseISO('2026-01-31'), holidays);
  // January 2026 starts on a Thursday: 9 weekend days, New Year's Day removed.
  assert.equal(r.calendarDays, 31);
  assert.equal(r.weekendDays, 9);
  assert.equal(r.holidayDays, 1);
  assert.equal(r.businessDays, 21);
  assert.deepEqual(r.holidaysRemoved, ['2026-01-01']);
});

test('business days: end before start yields zero', () => {
  const r = businessDays(parseISO('2026-05-10'), parseISO('2026-05-01'));
  assert.equal(r.calendarDays, 0);
  assert.equal(r.businessDays, 0);
});

test('business days: exclusive end drops the final day', () => {
  const inclusive = businessDays(parseISO('2026-01-05'), parseISO('2026-01-09'));
  const exclusive = businessDays(parseISO('2026-01-05'), parseISO('2026-01-09'), new Set(), {
    inclusiveEnd: false,
  });
  assert.equal(inclusive.businessDays, 5);
  assert.equal(exclusive.businessDays, 4);
});

test('business days: a single weekend day is zero business days', () => {
  const r = businessDays(parseISO('2026-01-03'), parseISO('2026-01-03'));
  assert.equal(r.calendarDays, 1);
  assert.equal(r.businessDays, 0);
});

test('business days over a ten-year range stays consistent', () => {
  const r = businessDays(parseISO('2026-01-01'), parseISO('2035-12-31'));
  const expected = [
    2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035,
  ].reduce((sum, year) => sum + weekdaysInYear(year), 0);
  assert.equal(r.businessDays, expected);
  assert.equal(r.calendarDays, r.businessDays + r.weekendDays);
});

test('date arithmetic is timezone independent', () => {
  const before = process.env.TZ;
  try {
    for (const zone of ['UTC', 'Pacific/Auckland', 'America/Los_Angeles']) {
      process.env.TZ = zone;
      assert.equal(iso(addDays(utc(2026, 3, 1), -1)), '2026-02-28');
      assert.equal(iso(easterSunday(2026)), '2026-04-05');
    }
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});
