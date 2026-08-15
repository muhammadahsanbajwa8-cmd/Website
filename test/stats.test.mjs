import test from 'node:test';
import assert from 'node:assert/strict';

import { fallbackHolidays } from '../lib/fallback.mjs';
import { weekdaysInYear } from '../lib/dates.mjs';
import { nextHolidayAcrossYears, yearStats } from '../lib/stats.mjs';

test('working days subtract only national holidays that fall on weekdays', () => {
  const holidays = fallbackHolidays('US', 2026);
  const stats = yearStats(2026, holidays);
  assert.equal(stats.total, 11);
  assert.equal(stats.weekdays, weekdaysInYear(2026));
  // Every US 2026 holiday is observed on a weekday, so all 11 are subtracted.
  assert.equal(stats.weekendHolidayCount, 0);
  assert.equal(stats.workingDays, stats.weekdays - 11);
});

test('weekend holidays are counted and named', () => {
  // Anzac Day 2026 falls on Saturday 25 April and is not moved.
  const stats = yearStats(2026, fallbackHolidays('AU', 2026));
  assert.equal(stats.weekendHolidayCount, 2);
  const names = stats.weekendHolidays.map((h) => h.name).join(' ');
  assert.match(names, /Anzac Day/);
  assert.match(names, /Easter Saturday/);
  assert.equal(stats.weekendHolidays[0].weekday, 'Saturday');
});

test('regional holidays do not reduce the working-day count', () => {
  const stats = yearStats(2026, fallbackHolidays('CA', 2026));
  assert.ok(stats.regionalCount > 0);
  const nationalWeekday = fallbackHolidays('CA', 2026).filter(
    (h) => h.national !== false && !['0', '6'].includes(String(new Date(h.date).getUTCDay())),
  );
  assert.equal(stats.workingDays, stats.weekdays - nationalWeekday.length);
});

test('the longest gap is a real run of holiday-free days', () => {
  const holidays = fallbackHolidays('FR', 2026);
  const stats = yearStats(2026, holidays);
  const dates = new Set(holidays.map((h) => h.date));
  assert.ok(stats.longestGap.days > 30);
  assert.ok(!dates.has(stats.longestGap.from));
  assert.ok(!dates.has(stats.longestGap.to));
  const span =
    Math.round(
      (new Date(`${stats.longestGap.to}T00:00:00Z`) - new Date(`${stats.longestGap.from}T00:00:00Z`)) /
        86400000,
    ) + 1;
  assert.equal(span, stats.longestGap.days);
});

test('every country-year produces a distinct set of numbers', () => {
  const seen = new Set();
  for (const code of ['US', 'GB', 'DE', 'FR', 'IE', 'CA', 'AU', 'IN']) {
    for (const year of [2025, 2026, 2027, 2028]) {
      const s = yearStats(year, fallbackHolidays(code, year));
      seen.add(`${s.total}|${s.workingDays}|${s.weekendHolidayCount}|${s.longestGap.days}`);
      assert.ok(s.workingDays > 200 && s.workingDays < 262);
      assert.equal(s.calendarDays, year % 4 === 0 ? 366 : 365);
    }
  }
  // 32 country-years; near-duplicate pages would show up as a tiny set here.
  assert.ok(seen.size > 20, `expected varied stats, got ${seen.size} distinct fingerprints`);
});

test('next holiday is found across a year boundary', () => {
  const byYear = { 2026: fallbackHolidays('DE', 2026), 2027: fallbackHolidays('DE', 2027) };
  const next = nextHolidayAcrossYears(byYear, new Date('2026-12-27T00:00:00Z'));
  assert.equal(next.date, '2027-01-01');
  assert.equal(next.year, 2027);
  assert.equal(next.daysAway, 5);
});

test('an empty holiday list still produces usable stats', () => {
  const stats = yearStats(2026, []);
  assert.equal(stats.total, 0);
  assert.equal(stats.workingDays, stats.weekdays);
  assert.equal(stats.longestGap.days, 365);
  assert.equal(stats.nextHoliday, null);
});
