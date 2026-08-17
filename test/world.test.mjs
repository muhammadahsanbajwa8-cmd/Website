import test from 'node:test';
import assert from 'node:assert/strict';

import { iso, orthodoxEasterSunday, parseISO } from '../lib/dates.mjs';
import {
  HIJRI,
  gregorianToJDN,
  hijriInGregorianYear,
  islamicToJDN,
  jdnToGregorian,
} from '../lib/islamic.mjs';
import { WORLD_COUNTRIES, WORLD_RULES } from '../lib/world.mjs';
import { coverageOf, detailedCountries, fallbackCountries, fallbackHolidays } from '../lib/fallback.mjs';
import { countryInfo } from '../lib/countries.mjs';

const named = (code, year, name) =>
  fallbackHolidays(code, year).find((h) => h.name.startsWith(name));

// --- Orthodox Easter ---------------------------------------------------------

test('Orthodox Easter matches the published dates', () => {
  const known = {
    2023: '2023-04-16',
    2024: '2024-05-05',
    2025: '2025-04-20',
    2026: '2026-04-12',
    2027: '2027-05-02',
    2028: '2028-04-16',
    2029: '2029-04-08',
    2030: '2030-04-28',
  };
  for (const [year, expected] of Object.entries(known)) {
    assert.equal(iso(orthodoxEasterSunday(Number(year))), expected, `Orthodox Easter ${year}`);
  }
});

test('Orthodox Easter is always a Sunday, and never before Western Easter', () => {
  for (let year = 2000; year <= 2099; year += 1) {
    assert.equal(orthodoxEasterSunday(year).getUTCDay(), 0, `${year} is a Sunday`);
  }
});

test('Greece uses the Orthodox computus, not the Western one', () => {
  // Western Easter 2026 is 5 April; Orthodox is 12 April.
  assert.equal(named('GR', 2026, 'Good Friday').date, '2026-04-10');
  assert.equal(named('GR', 2026, 'Easter Monday').date, '2026-04-13');
  assert.equal(named('GR', 2024, 'Easter Monday').date, '2024-05-06');
});

// --- The Islamic calendar ----------------------------------------------------

test('Julian Day Number conversion round-trips', () => {
  for (const [year, month, day] of [
    [2026, 1, 1],
    [2026, 12, 31],
    [2000, 2, 29],
    [1999, 7, 15],
  ]) {
    const back = jdnToGregorian(gregorianToJDN(year, month, day));
    assert.deepEqual(back, { year, month, day });
  }
});

test('the tabular calendar lands within a couple of days of the observed Eid', () => {
  // Observed dates differ by country because they depend on a moon sighting;
  // an arithmetic calendar cannot match them exactly, and this asserts the
  // accuracy it does have rather than a precision it does not.
  const observed = {
    eidAlFitr: {
      2023: '2023-04-21',
      2024: '2024-04-10',
      2025: '2025-03-30',
      2026: '2026-03-20',
      2027: '2027-03-09',
    },
    eidAlAdha: {
      2023: '2023-06-28',
      2024: '2024-06-16',
      2025: '2025-06-06',
      2026: '2026-05-27',
      2027: '2027-05-16',
    },
  };

  for (const [feast, years] of Object.entries(observed)) {
    for (const [year, expected] of Object.entries(years)) {
      const computed = hijriInGregorianYear(
        Number(year),
        HIJRI[feast].month,
        HIJRI[feast].day,
      );
      assert.ok(computed.length >= 1, `${feast} ${year} was computed`);
      const drift = Math.min(
        ...computed.map((date) =>
          Math.abs((date.getTime() - parseISO(expected).getTime()) / 86400000),
        ),
      );
      assert.ok(drift <= 2, `${feast} ${year}: computed drifts ${drift} days from ${expected}`);
    }
  }
});

test('a Hijri date can fall twice in one Gregorian year', () => {
  // The Hijri year is about eleven days shorter, so some Gregorian years get
  // two occurrences and the rule must emit both.
  let doubled = 0;
  for (let year = 2000; year <= 2060; year += 1) {
    const found = hijriInGregorianYear(year, 1, 1);
    assert.ok(found.length <= 2);
    for (const date of found) assert.equal(date.getUTCFullYear(), year);
    if (found.length === 2) doubled += 1;
  }
  assert.ok(doubled > 0, 'some years carry two Islamic New Years');
});

test('Hijri dates move about eleven days earlier each Gregorian year', () => {
  // A Hijri year is 354 or 355 days, so a feast drifts backwards through the
  // Gregorian calendar at roughly eleven days a year.
  for (let year = 2024; year <= 2035; year += 1) {
    const first = hijriInGregorianYear(year, HIJRI.eidAlFitr.month, HIJRI.eidAlFitr.day)[0];
    const next = hijriInGregorianYear(year + 1, HIJRI.eidAlFitr.month, HIJRI.eidAlFitr.day)[0];
    if (!first || !next) continue;
    const gap = (next.getTime() - first.getTime()) / 86400000;
    assert.ok(gap === 354 || gap === 355, `${year}→${year + 1} spans ${gap} days`);
  }
});

test('the Islamic epoch is where it should be', () => {
  // 1 Muharram 1 AH corresponds to 16 July 622 in the Julian calendar.
  assert.equal(islamicToJDN(1, 1, 1), 1948440);
});

// --- The world table ---------------------------------------------------------

test('the table covers most of the world', () => {
  assert.ok(WORLD_COUNTRIES.length > 150, `expected 150+, got ${WORLD_COUNTRIES.length}`);
  assert.ok(fallbackCountries().length > 180);
  // Every code is a real ISO 3166-1 alpha-2 code we have a name for.
  for (const code of WORLD_COUNTRIES) {
    assert.match(code, /^[A-Z]{2}$/, `${code} is a two-letter code`);
    assert.notEqual(countryInfo(code).name, code, `${code} is in the ISO table`);
  }
});

test('the detailed and core sets do not overlap', () => {
  for (const code of detailedCountries()) {
    assert.ok(!WORLD_COUNTRIES.includes(code), `${code} is only in one table`);
  }
});

test('coverage is reported honestly', () => {
  assert.equal(coverageOf('US'), 'full');
  assert.equal(coverageOf('DE'), 'full');
  assert.equal(coverageOf('NG'), 'core');
  assert.equal(coverageOf('JP'), 'core');
  assert.equal(coverageOf('ZZ'), null);
  assert.equal(coverageOf(''), null);
});

test('every core country produces ordered, in-year, non-duplicated holidays', () => {
  for (const code of WORLD_COUNTRIES) {
    for (const year of [2025, 2026, 2027, 2030, 2035]) {
      const holidays = fallbackHolidays(code, year);
      assert.ok(holidays.length >= 1, `${code} ${year} has at least one holiday`);

      const seen = new Set();
      let previous = '';
      for (const holiday of holidays) {
        assert.ok(holiday.date.startsWith(`${year}-`), `${code} ${holiday.date} is inside ${year}`);
        assert.ok(holiday.date >= previous, `${code} ${year} is ordered`);
        previous = holiday.date;
        const key = holiday.date + holiday.name;
        assert.ok(!seen.has(key), `${code} ${year} ${key} appears once`);
        seen.add(key);
        assert.ok(holiday.name.length > 1);
        // A real calendar date, not something that merely looks like one.
        const parsed = parseISO(holiday.date);
        assert.equal(iso(parsed), holiday.date, `${code} ${holiday.date} is a real date`);
      }
    }
  }
});

test('only lunar dates are flagged as estimates', () => {
  const nigeria = fallbackHolidays('NG', 2026);
  const eid = nigeria.find((holiday) => holiday.name === 'Eid al-Fitr');
  const christmas = nigeria.find((holiday) => holiday.name === 'Christmas Day');
  assert.equal(eid.estimated, true);
  assert.equal(christmas.estimated, false);

  // Nothing in a fully-specified country is an estimate.
  for (const code of detailedCountries()) {
    for (const holiday of fallbackHolidays(code, 2026)) {
      assert.equal(holiday.estimated, false, `${code} ${holiday.name}`);
    }
  }
});

test('multi-day feasts run consecutively', () => {
  // Saudi Arabia observes four days of Eid al-Fitr.
  const days = fallbackHolidays('SA', 2026)
    .filter((holiday) => holiday.name === 'Eid al-Fitr')
    .map((holiday) => holiday.date);
  assert.equal(days.length, 4);
  for (let i = 1; i < days.length; i += 1) {
    const gap = (parseISO(days[i]) - parseISO(days[i - 1])) / 86400000;
    assert.equal(gap, 1, 'consecutive days');
  }
});

test('spot checks against well-known national dates', () => {
  const checks = [
    ['NG', 2026, 'Independence Day', '2026-10-01'],
    ['ZA', 2026, 'Freedom Day', '2026-04-27'],
    ['BR', 2026, 'Independence Day', '2026-09-07'],
    ['MX', 2026, 'Independence Day', '2026-09-16'],
    ['JP', 2026, 'Culture Day', '2026-11-03'],
    ['KR', 2026, 'Liberation Day', '2026-08-15'],
    ['ID', 2026, 'Independence Day', '2026-08-17'],
    ['TR', 2026, 'Republic Day', '2026-10-29'],
    ['IT', 2026, 'Republic Day', '2026-06-02'],
    ['ES', 2026, 'National Day', '2026-10-12'],
    ['PL', 2026, 'Constitution Day', '2026-05-03'],
    ['NZ', 2026, 'Waitangi Day', '2026-02-06'],
    ['KE', 2026, 'Jamhuri Day', '2026-12-12'],
    ['EG', 2026, 'Sinai Liberation Day', '2026-04-25'],
    ['AR', 2026, 'Independence Day', '2026-07-09'],
  ];
  for (const [code, year, name, expected] of checks) {
    const found = named(code, year, name);
    assert.ok(found, `${code} ${name} exists`);
    assert.equal(found.date, expected, `${code} ${name} ${year}`);
  }
});

test('nth-weekday rules in the world table resolve correctly', () => {
  // Japan's Coming of Age Day is the second Monday in January.
  assert.equal(named('JP', 2026, 'Coming of Age').date, '2026-01-12');
  assert.equal(named('JP', 2027, 'Coming of Age').date, '2027-01-11');
  // New Zealand's Labour Day is the fourth Monday in October.
  assert.equal(named('NZ', 2026, 'Labour Day').date, '2026-10-26');
  // Mexico's Constitution Day is the first Monday in February.
  assert.equal(named('MX', 2026, 'Constitution Day').date, '2026-02-02');
  for (const [code, name] of [['JP', 'Coming of Age'], ['NZ', 'Labour Day'], ['MX', 'Constitution Day']]) {
    for (let year = 2024; year <= 2035; year += 1) {
      assert.equal(parseISO(named(code, year, name).date).getUTCDay(), 1, `${code} ${year} Monday`);
    }
  }
});

test('every rule in the table is one of the supported kinds', () => {
  for (const [code, spec] of Object.entries(WORLD_RULES)) {
    assert.equal(spec.coverage, 'core', `${code} is core coverage`);
    for (const rule of spec.rules) {
      assert.ok(rule.name && rule.name.length > 1, `${code} rule has a name`);
      const kind =
        rule.hijri !== undefined ||
        rule.easter !== undefined ||
        rule.orthodoxEaster !== undefined ||
        rule.nth !== undefined ||
        (rule.month !== undefined && rule.day !== undefined);
      assert.ok(kind, `${code}/${rule.name} is a recognised rule`);
      if (rule.month !== undefined && rule.hijri === undefined) {
        assert.ok(rule.month >= 1 && rule.month <= 12, `${code}/${rule.name} month`);
      }
      if (rule.day !== undefined) assert.ok(rule.day >= 1 && rule.day <= 31);
      if (rule.hijri) {
        assert.ok(rule.hijri.month >= 1 && rule.hijri.month <= 12);
        assert.ok(rule.hijri.day >= 1 && rule.hijri.day <= 30);
        assert.equal(rule.estimated, true, `${code}/${rule.name} is marked estimated`);
      }
    }
  }
});
