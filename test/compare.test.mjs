import test from 'node:test';
import assert from 'node:assert/strict';

import { bridges, compareCountries, longWeekends, offRuns } from '../lib/compare.mjs';
import { fallbackHolidays } from '../lib/fallback.mjs';
import { isWeekend, parseISO } from '../lib/dates.mjs';
import { yearStats } from '../lib/stats.mjs';

function country(code, name, year) {
  const holidays = fallbackHolidays(code, year);
  return { code, name, flag: '', holidays, stats: yearStats(year, holidays) };
}

test('off-day runs cover every weekend and holiday exactly once', () => {
  const holidays = fallbackHolidays('DE', 2026);
  const runs = offRuns(2026, holidays);
  const covered = new Set();

  for (const run of runs) {
    for (let d = parseISO(run.start); d <= parseISO(run.end); d = new Date(d.getTime() + 86400000)) {
      const key = d.toISOString().slice(0, 10);
      assert.ok(!covered.has(key), `${key} counted once`);
      covered.add(key);
      assert.ok(
        isWeekend(d) || holidays.some((h) => h.date === key),
        `${key} is a weekend or a holiday`,
      );
    }
  }
  // Every one of 2026's 104 weekend days lands inside a run.
  const counted = [...covered].filter((key) => isWeekend(parseISO(key))).length;
  assert.equal(counted, 365 - 261, 'all weekend days are inside a run');
});

test('runs are separated by at least one working day', () => {
  const runs = offRuns(2026, fallbackHolidays('GB', 2026));
  for (let i = 0; i < runs.length - 1; i += 1) {
    assert.ok(runs[i].end < runs[i + 1].start);
    const gap =
      (parseISO(runs[i + 1].start) - parseISO(runs[i].end)) / 86400000 - 1;
    assert.ok(gap >= 1, 'adjacent runs would have been merged');
  }
});

test('long weekends are real three-day breaks caused by a holiday', () => {
  const holidays = fallbackHolidays('GB', 2026);
  const breaks = longWeekends(offRuns(2026, holidays));
  assert.ok(breaks.length >= 5);
  for (const item of breaks) {
    assert.ok(item.days >= 3);
    assert.ok(item.holidays.length >= 1);
    assert.ok(item.names.length >= 1);
  }
  // Easter 2026: Good Friday 3 April to Easter Monday 6 April is four days.
  const easter = breaks.find((item) => item.start === '2026-04-03');
  assert.ok(easter, 'the Easter break is found');
  assert.equal(easter.days, 4);
  assert.equal(easter.end, '2026-04-06');
  assert.deepEqual(easter.names, ['Good Friday', 'Easter Monday']);
});

test('a midweek holiday is not a long weekend on its own', () => {
  // German Unity Day 2027 falls on a Sunday; Labour Day 2027 on a Saturday.
  const breaks = longWeekends(offRuns(2027, fallbackHolidays('DE', 2027)));
  for (const item of breaks) assert.ok(item.days >= 3);
  // Ascension Day 2026 is a Thursday, which alone gives a one-day break.
  const may2026 = longWeekends(offRuns(2026, fallbackHolidays('DE', 2026))).find(
    (item) => item.start === '2026-05-14',
  );
  assert.equal(may2026, undefined, 'a lone Thursday is not a long weekend');
});

test('bridges name the days you would book and what they buy', () => {
  // Ascension 2026 (Thu 14 May) + Friday 15 May reaches Sunday 17 May.
  const found = bridges(offRuns(2026, fallbackHolidays('DE', 2026)));
  const ascension = found.find((item) => item.bridge.includes('2026-05-15'));
  assert.ok(ascension, 'the Ascension bridge is found');
  assert.equal(ascension.daysOff, 1);
  assert.equal(ascension.totalDays, 4);
  assert.equal(ascension.start, '2026-05-14');
  assert.equal(ascension.end, '2026-05-17');

  for (const item of found) {
    assert.ok(item.daysOff >= 1 && item.daysOff <= 2);
    assert.ok(item.totalDays >= 4 && item.totalDays >= item.daysOff + 3);
    assert.equal(item.bridge.length, item.daysOff);
    for (const date of item.bridge) {
      assert.ok(!isWeekend(parseISO(date)), `${date} is a working day worth booking`);
    }
  }
});

test('comparison splits holidays into shared, only-A and only-B', () => {
  const de = country('DE', 'Germany', 2026);
  const fr = country('FR', 'France', 2026);
  const result = compareCountries(de, fr, 2026);

  const total = result.shared.length + result.onlyA.length;
  assert.equal(total, de.holidays.length, 'every German holiday is accounted for');
  assert.equal(
    result.shared.length + result.onlyB.length,
    fr.holidays.length,
    'every French holiday is accounted for',
  );

  // Both observe New Year's Day, Easter Monday, Ascension, Whit Monday, 1 May
  // and Christmas Day in 2026.
  const sharedDates = result.shared.map((item) => item.date);
  for (const date of ['2026-01-01', '2026-04-06', '2026-05-01', '2026-05-14', '2026-05-25', '2026-12-25']) {
    assert.ok(sharedDates.includes(date), `${date} is shared`);
  }
  // German Unity Day is German only; Bastille Day is French only.
  assert.ok(result.onlyA.some((h) => h.date === '2026-10-03'));
  assert.ok(result.onlyB.some((h) => h.date === '2026-07-14'));
  assert.ok(result.shared.every((item) => item.a.date === item.b.date));
});

test('shared entries know whether the two countries call it the same thing', () => {
  const result = compareCountries(country('DE', 'Germany', 2026), country('FR', 'France', 2026), 2026);
  const christmas = result.shared.find((item) => item.date === '2026-12-25');
  assert.equal(christmas.sameName, true);
  const boxing = result.shared.find((item) => item.date === '2026-12-26');
  assert.equal(boxing, undefined, 'France does not observe 26 December');
});

test('month buckets add up to each country total', () => {
  const de = country('DE', 'Germany', 2026);
  const us = country('US', 'United States', 2026);
  const result = compareCountries(de, us, 2026);
  assert.equal(
    result.months.reduce((sum, month) => sum + month.a, 0),
    de.holidays.length,
  );
  assert.equal(
    result.months.reduce((sum, month) => sum + month.b, 0),
    us.holidays.length,
  );
  assert.equal(result.months.length, 12);
  assert.ok(result.quietest.a + result.quietest.b <= result.busiest.a + result.busiest.b);
});

test('shared breaks are windows both countries are actually off', () => {
  const result = compareCountries(country('DE', 'Germany', 2026), country('FR', 'France', 2026), 2026);
  assert.ok(result.sharedBreaks.length > 0);
  for (const window of result.sharedBreaks) {
    assert.ok(window.days >= 3);
    assert.ok(window.start <= window.end);
    assert.ok(window.names.length > 0);
  }
  // Easter weekend 2026 is a break in both.
  assert.ok(result.sharedBreaks.some((window) => window.start <= '2026-04-06' && window.end >= '2026-04-04'));
});

test('highlights are factual, numbered, and never contradict the stats', () => {
  const de = country('DE', 'Germany', 2026);
  const fr = country('FR', 'France', 2026);
  const result = compareCountries(de, fr, 2026);
  const keys = result.highlights.map((item) => item.key);

  assert.ok(keys.includes('holidays'));
  assert.ok(keys.includes('working-days'));
  assert.ok(keys.includes('shared'));
  assert.ok(keys.includes('long-weekends'));
  assert.ok(keys.includes('quiet'));

  const holidayLine = result.highlights.find((item) => item.key === 'holidays');
  // France has 11, Germany 9, in 2026.
  assert.match(holidayLine.headline, /France has 2 more public holidays/);
  assert.match(holidayLine.detail, /Germany 9/);
  assert.match(holidayLine.detail, /France 11/);

  const workLine = result.highlights.find((item) => item.key === 'working-days');
  assert.match(workLine.detail, new RegExp(`${de.stats.workingDays}`));
  assert.match(workLine.detail, new RegExp(`${fr.stats.workingDays}`));

  for (const item of result.highlights) {
    assert.ok(item.headline.length > 0 && item.headline.length < 80);
    assert.ok(item.detail.length > 0);
    assert.ok(!/undefined|NaN/.test(item.headline + item.detail));
  }
});

test('comparing a country with itself degrades sensibly', () => {
  const us = country('US', 'United States', 2026);
  const result = compareCountries(us, { ...us }, 2026);
  assert.equal(result.onlyA.length, 0);
  assert.equal(result.onlyB.length, 0);
  assert.equal(result.shared.length, us.holidays.length);
  assert.match(result.highlights[0].headline, /Both get/);
});

test('a country with no holiday data does not break the comparison', () => {
  const empty = { code: 'ZZ', name: 'Nowhere', holidays: [], stats: yearStats(2026, []) };
  const result = compareCountries(country('GB', 'United Kingdom', 2026), empty, 2026);
  assert.equal(result.shared.length, 0);
  assert.equal(result.onlyB.length, 0);
  assert.ok(result.onlyA.length > 0);
  assert.ok(result.highlights.every((item) => !/undefined|NaN/.test(item.headline + item.detail)));
});

test('the comparison is symmetric in the facts it reports', () => {
  const forward = compareCountries(country('US', 'United States', 2027), country('IN', 'India', 2027), 2027);
  const backward = compareCountries(country('IN', 'India', 2027), country('US', 'United States', 2027), 2027);
  assert.equal(forward.shared.length, backward.shared.length);
  assert.equal(forward.onlyA.length, backward.onlyB.length);
  assert.equal(forward.sharedBreaks.length, backward.sharedBreaks.length);
  assert.equal(
    forward.highlights.find((h) => h.key === 'holidays').headline,
    backward.highlights.find((h) => h.key === 'holidays').headline,
  );
});
