import test from 'node:test';
import assert from 'node:assert/strict';

import { fallbackCountries, fallbackHolidays } from '../lib/fallback.mjs';
import { isWeekend, parseISO } from '../lib/dates.mjs';

const dates = (code, year) => fallbackHolidays(code, year).map((h) => h.date);
const named = (code, year, name) =>
  fallbackHolidays(code, year).find((h) => h.name.startsWith(name));

test('the fallback covers at least eight countries', () => {
  const codes = fallbackCountries();
  assert.ok(codes.length >= 8, `expected 8+ countries, got ${codes.length}`);
  for (const code of ['US', 'GB', 'AU', 'CA', 'DE', 'FR', 'IE', 'IN']) {
    assert.ok(codes.includes(code), `${code} is covered`);
  }
});

test('US federal holidays, 2026', () => {
  // 4 July 2026 is a Saturday, so it is observed on Friday 3 July.
  assert.deepEqual(dates('US', 2026), [
    '2026-01-01',
    '2026-01-19',
    '2026-02-16',
    '2026-05-25',
    '2026-06-19',
    '2026-07-03',
    '2026-09-07',
    '2026-10-12',
    '2026-11-11',
    '2026-11-26',
    '2026-12-25',
  ]);
  assert.match(named('US', 2026, 'Independence Day').name, /observed/);
});

test('US federal holidays, 2027, including the New Year spillover', () => {
  // 1 January 2028 is a Saturday, so it is observed on Friday 31 December 2027.
  assert.deepEqual(dates('US', 2027), [
    '2027-01-01',
    '2027-01-18',
    '2027-02-15',
    '2027-05-31',
    '2027-06-18',
    '2027-07-05',
    '2027-09-06',
    '2027-10-11',
    '2027-11-11',
    '2027-11-25',
    '2027-12-24',
    '2027-12-31',
  ]);
  assert.equal(named('US', 2027, "New Year's Day").date, '2027-01-01');
  const spillover = fallbackHolidays('US', 2027).at(-1);
  assert.match(spillover.name, /New Year's Day \(observed\)/);
});

test('UK bank holidays, 2026 and 2027, match the published lists', () => {
  assert.deepEqual(dates('GB', 2026), [
    '2026-01-01',
    '2026-04-03',
    '2026-04-06',
    '2026-05-04',
    '2026-05-25',
    '2026-08-31',
    '2026-12-25',
    '2026-12-28',
  ]);
  // Christmas Day 2027 is a Saturday and Boxing Day a Sunday: the substitute
  // days are Monday 27th and Tuesday 28th, and they must not collide.
  assert.deepEqual(dates('GB', 2027), [
    '2027-01-01',
    '2027-03-26',
    '2027-03-29',
    '2027-05-03',
    '2027-05-31',
    '2027-08-30',
    '2027-12-27',
    '2027-12-28',
  ]);
});

test('Easter-relative holidays land correctly for future years', () => {
  assert.equal(named('DE', 2026, 'Ascension Day').date, '2026-05-14');
  assert.equal(named('DE', 2026, 'Whit Monday').date, '2026-05-25');
  assert.equal(named('DE', 2027, 'Ascension Day').date, '2027-05-06');
  assert.equal(named('DE', 2027, 'Whit Monday').date, '2027-05-17');
  assert.equal(named('FR', 2026, 'Easter Monday').date, '2026-04-06');
  assert.equal(named('FR', 2027, 'Easter Monday').date, '2027-03-29');
  assert.equal(named('IN', 2026, 'Good Friday').date, '2026-04-03');
  assert.equal(named('IN', 2027, 'Good Friday').date, '2027-03-26');
});

test('nth-weekday holidays land correctly for future years', () => {
  assert.equal(named('US', 2026, 'Thanksgiving').date, '2026-11-26');
  assert.equal(named('US', 2027, 'Thanksgiving').date, '2027-11-25');
  assert.equal(named('CA', 2026, 'Thanksgiving').date, '2026-10-12');
  assert.equal(named('CA', 2027, 'Thanksgiving').date, '2027-10-11');
  assert.equal(named('IE', 2026, 'October Holiday').date, '2026-10-26');
  assert.equal(named('IE', 2027, 'October Holiday').date, '2027-10-25');
  assert.equal(named('AU', 2026, "King's Birthday").date, '2026-06-08');
  assert.equal(named('AU', 2027, "King's Birthday").date, '2027-06-14');
});

test("Canada's Victoria Day is the Monday on or before 24 May", () => {
  assert.equal(named('CA', 2026, 'Victoria Day').date, '2026-05-18');
  assert.equal(named('CA', 2027, 'Victoria Day').date, '2027-05-24');
  for (let year = 2024; year <= 2035; year += 1) {
    const day = parseISO(named('CA', year, 'Victoria Day').date);
    assert.equal(day.getUTCDay(), 1, `Victoria Day ${year} is a Monday`);
  }
});

test("Ireland's St. Brigid's Day rule", () => {
  // 1 February is a Friday in 2030 and 2036; otherwise the first Monday.
  assert.equal(named('IE', 2030, "St. Brigid's Day").date, '2030-02-01');
  assert.equal(named('IE', 2026, "St. Brigid's Day").date, '2026-02-02');
  assert.equal(named('IE', 2027, "St. Brigid's Day").date, '2027-02-01');
  // The holiday did not exist before 2023.
  assert.equal(named('IE', 2022, "St. Brigid's Day"), undefined);
});

test('holidays introduced in a given year do not appear before it', () => {
  assert.equal(named('US', 2020, 'Juneteenth'), undefined);
  assert.equal(named('US', 2021, 'Juneteenth').date, '2021-06-18');
  assert.equal(named('CA', 2020, 'National Day for Truth'), undefined);
  assert.ok(named('CA', 2021, 'National Day for Truth'));
});

test('every computed country stays sane across a twenty-year span', () => {
  for (const code of fallbackCountries()) {
    for (let year = 2020; year <= 2040; year += 1) {
      const holidays = fallbackHolidays(code, year);
      assert.ok(holidays.length >= 5, `${code} ${year} has holidays`);

      const seen = new Set();
      let previous = '';
      for (const holiday of holidays) {
        assert.ok(holiday.date.startsWith(`${year}-`), `${code} ${holiday.date} inside ${year}`);
        assert.ok(holiday.date >= previous, `${code} ${year} is date-ordered`);
        previous = holiday.date;
        assert.ok(!seen.has(holiday.date + holiday.name), `${code} ${year} has no duplicates`);
        seen.add(holiday.date + holiday.name);
        assert.equal(typeof holiday.name, 'string');
        assert.ok(holiday.name.length > 0);
        assert.equal(typeof holiday.national, 'boolean');
      }
    }
  }
});

test('substituted holidays never land on a weekend or on each other', () => {
  for (const code of ['GB', 'IE', 'AU', 'CA']) {
    for (let year = 2020; year <= 2040; year += 1) {
      const holidays = fallbackHolidays(code, year);
      const days = new Set();
      for (const holiday of holidays) {
        if (!/substitute|observed/.test(holiday.name)) continue;
        assert.ok(!isWeekend(parseISO(holiday.date)), `${code} ${holiday.date} is a weekday`);
        assert.ok(!days.has(holiday.date), `${code} ${holiday.date} is not doubled up`);
        days.add(holiday.date);
      }
    }
  }
});

test('unknown countries return null rather than an empty year', () => {
  assert.equal(fallbackHolidays('ZZ', 2026), null);
  assert.equal(fallbackHolidays('', 2026), null);
});
