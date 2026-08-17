import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_MEMBERS, clearRuns, teamOverlap } from '../lib/team.mjs';
import { fallbackHolidays } from '../lib/fallback.mjs';
import { isWeekend, parseISO, weekdaysInYear } from '../lib/dates.mjs';

const YEAR = 2026;

const member = (code) => ({
  code,
  name: code,
  flag: '',
  holidays: fallbackHolidays(code, YEAR),
});

const team = (...codes) => teamOverlap(YEAR, codes.map(member));

test('every weekday is either fully staffed or disrupted, never both', () => {
  const overlap = team('US', 'GB', 'IN');
  assert.equal(overlap.weekdays, weekdaysInYear(YEAR));
  assert.equal(overlap.fullyStaffed + overlap.partial, overlap.weekdays);
  assert.equal(overlap.partial, overlap.absences.length);
  assert.equal(overlap.coverage, overlap.fullyStaffed / overlap.weekdays);
});

test('weekends are left out of the counts entirely', () => {
  const overlap = team('US', 'DE');
  for (const entry of overlap.absences) {
    assert.ok(!isWeekend(parseISO(entry.date)), `${entry.date} is a weekend`);
  }
});

test('an absence names who is away and why', () => {
  const overlap = team('US', 'GB');
  assert.ok(overlap.absences.length > 0);

  for (const entry of overlap.absences) {
    assert.ok(entry.away.length >= 1, `${entry.date} has nobody away`);
    assert.equal(entry.away.length + entry.present.length, 2, 'everyone is accounted for');
    for (const person of entry.away) {
      assert.ok(person.holiday, `${entry.date}: ${person.code} is away for no stated reason`);
      assert.ok(['US', 'GB'].includes(person.code));
    }
    assert.equal(entry.everyone, entry.away.length === 2);
  }
});

test('"everyone off" means every country, not merely several', () => {
  const overlap = team('US', 'GB', 'IN', 'DE');
  for (const entry of overlap.everyoneOff) {
    assert.equal(entry.away.length, overlap.sides.length, `${entry.date} is not universal`);
    assert.equal(entry.present.length, 0);
  }
  // Across these four, Christmas Day is the only weekday holiday they share.
  assert.deepEqual(
    overlap.everyoneOff.map((entry) => entry.date),
    [`${YEAR}-12-25`],
  );
});

test('a bigger team is never easier to schedule', () => {
  const two = team('US', 'GB');
  const four = team('US', 'GB', 'IN', 'DE');
  assert.ok(
    four.fullyStaffed <= two.fullyStaffed,
    'adding people cannot add days when everyone is free',
  );
  assert.ok(four.partial >= two.partial);
});

test('one country on its own is just that country', () => {
  const overlap = teamOverlap(YEAR, [member('US')]);
  const weekdayHolidays = fallbackHolidays('US', YEAR).filter(
    (holiday) => holiday.national !== false && !isWeekend(parseISO(holiday.date)),
  ).length;
  assert.equal(overlap.partial, weekdayHolidays);
  assert.equal(overlap.everyoneOff.length, weekdayHolidays);
});

test('the team is capped rather than allowed to grow without limit', () => {
  const codes = ['US', 'GB', 'IN', 'DE', 'FR', 'CA', 'AU', 'IE'];
  const overlap = teamOverlap(YEAR, codes.map(member));
  assert.equal(overlap.sides.length, MAX_MEMBERS);
  assert.equal(overlap.perMember.length, MAX_MEMBERS);
});

test('regional holidays only count when asked for', () => {
  const extra = { date: `${YEAR}-03-17`, name: 'Invented Regional Day', national: false };
  const base = [{ ...member('US'), holidays: [...fallbackHolidays('US', YEAR), extra] }];

  const without = teamOverlap(YEAR, base);
  const with_ = teamOverlap(YEAR, base, { includeRegional: true });

  assert.ok(!without.absences.some((entry) => entry.date === extra.date));
  assert.ok(with_.absences.some((entry) => entry.date === extra.date));
  assert.equal(with_.partial, without.partial + 1);
});

test('the monthly breakdown adds back up to the year', () => {
  const overlap = team('US', 'GB', 'IN');
  assert.equal(overlap.monthly.length, 12);
  assert.equal(
    overlap.monthly.reduce((sum, month) => sum + month.workingDays, 0),
    overlap.weekdays,
  );
  assert.equal(
    overlap.monthly.reduce((sum, month) => sum + month.absences, 0),
    overlap.partial,
  );
});

test('the clearest month really is the clearest', () => {
  const overlap = team('US', 'GB', 'IN', 'DE');
  const rate = (month) => (month.workingDays ? month.absences / month.workingDays : 0);
  for (const month of overlap.monthly) {
    assert.ok(
      rate(overlap.clearestMonth) <= rate(month),
      `${month.month} is clearer than ${overlap.clearestMonth.month}`,
    );
    assert.ok(rate(overlap.busiestMonth) >= rate(month));
  }
});

test('clear runs contain no disrupted day, and are ranked longest first', () => {
  const overlap = team('US', 'GB', 'IN');
  const blocked = new Set(overlap.absences.map((entry) => entry.date));
  const runs = clearRuns(overlap, 5);

  assert.ok(runs.length > 0);
  for (const run of runs) {
    assert.ok(!blocked.has(run.from), `${run.from} is disrupted`);
    assert.ok(!blocked.has(run.to), `${run.to} is disrupted`);
    assert.ok(!isWeekend(parseISO(run.from)));
    assert.ok(!isWeekend(parseISO(run.to)));
    assert.ok(run.workingDays >= 1);
    assert.ok(run.from <= run.to);
  }
  for (let i = 1; i < runs.length; i += 1) {
    assert.ok(runs[i - 1].workingDays >= runs[i].workingDays, 'ranked longest first');
  }
});

test('every clear run really is clear, day by day', () => {
  const overlap = team('US', 'DE');
  const blocked = new Set(overlap.absences.map((entry) => entry.date));
  for (const run of clearRuns(overlap, 3)) {
    let counted = 0;
    for (let d = parseISO(run.from); d <= parseISO(run.to); d = new Date(d.getTime() + 86400000)) {
      const key = d.toISOString().slice(0, 10);
      if (isWeekend(d)) continue;
      assert.ok(!blocked.has(key), `${key} is inside a "clear" run but somebody is away`);
      counted += 1;
    }
    assert.equal(counted, run.workingDays, 'the count matches the days');
  }
});

test('a team of one country repeated is still a team of one', () => {
  const overlap = teamOverlap(YEAR, [member('US'), member('US')]);
  // The engine does not deduplicate — the picker does — but the maths must
  // still hold, and every shared day must read as "everyone off".
  assert.equal(overlap.everyoneOff.length, overlap.partial);
});
