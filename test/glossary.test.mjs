import test from 'node:test';
import assert from 'node:assert/strict';

import { GLOSSARY_SIZE, explain } from '../lib/glossary.mjs';
import { describeRule, fallbackCountries, fallbackHolidays } from '../lib/fallback.mjs';

test('the glossary explains the great majority of holiday rows', () => {
  let known = 0;
  let total = 0;
  for (const code of fallbackCountries()) {
    for (const holiday of fallbackHolidays(code, 2026)) {
      total += 1;
      if (explain(holiday.name)) known += 1;
    }
  }
  const share = known / total;
  assert.ok(share > 0.8, `expected 80%+ of rows explained, got ${(share * 100).toFixed(0)}%`);
});

test('names are matched despite punctuation, accents and observance suffixes', () => {
  assert.ok(explain("New Year's Day"));
  assert.ok(explain('New Year’s Day'), 'a curly apostrophe is the same name');
  assert.ok(explain("New Year's Day (observed)"));
  assert.ok(explain('Christmas Day (substitute day)'));
  assert.ok(explain('St. Stephen’s Day'));
  assert.ok(explain("St Stephen's Day"));
  assert.ok(explain('Kurban Bayramı'), 'Turkish dotless i folds to i');
  assert.ok(explain('Ramazan Bayramı'));
  assert.equal(explain('  LABOUR   DAY  '), explain('Labour Day'));
});

test('the same day under different names gets the same explanation', () => {
  assert.equal(explain('Boxing Day'), explain("St. Stephen's Day"));
  assert.equal(explain('Eid al-Fitr'), explain('Hari Raya Puasa'));
  assert.equal(explain('Eid al-Adha'), explain('Kurban Bayramı'));
  assert.equal(explain('Labour Day'), explain('Labor Day'));
  assert.equal(explain('Nowruz'), explain('Nauryz'));
});

test('nothing is matched by keyword, so unrelated names stay unexplained', () => {
  // These share words with entries but are different occasions entirely.
  assert.equal(explain('Independence of Cuenca'), null);
  assert.equal(explain('Independence of Guayaquil'), null);
  assert.equal(explain('Day after New Year’s Day'), null);
  assert.equal(explain('Sinai Liberation Day'), null);
  assert.equal(explain(''), null);
  assert.equal(explain(null), null);
  assert.equal(explain('Naadam'), null);
});

test('every explanation is a real sentence, not a stub', () => {
  const seen = new Set();
  for (const code of fallbackCountries()) {
    for (const holiday of fallbackHolidays(code, 2026)) {
      const text = explain(holiday.name);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      assert.ok(text.length > 60, `too short: ${text}`);
      assert.ok(/[.!]$/.test(text.trim()), `unfinished sentence: ${text}`);
      assert.ok(!/undefined|null|TODO/.test(text));
    }
  }
  assert.ok(seen.size > 25, `expected many distinct explanations, got ${seen.size}`);
  assert.ok(GLOSSARY_SIZE >= seen.size);
});

// --- How the date is arrived at ----------------------------------------------

test('every computed holiday can say how its date is set', () => {
  let missing = 0;
  for (const code of fallbackCountries()) {
    for (const holiday of fallbackHolidays(code, 2026)) {
      if (!holiday.basis) missing += 1;
    }
  }
  assert.equal(missing, 0, 'no computed holiday is left without a basis');
});

test('the basis describes the rule that actually produced the date', () => {
  const basisOf = (code, name) =>
    fallbackHolidays(code, 2026).find((holiday) => holiday.name.startsWith(name)).basis;

  assert.match(basisOf('US', 'Thanksgiving'), /fourth Thursday in November/);
  assert.match(basisOf('US', 'Memorial Day'), /last Monday in May/);
  assert.match(basisOf('DE', 'Ascension'), /39 days after Easter Sunday/);
  assert.match(basisOf('GB', 'Good Friday'), /2 days before Easter Sunday/);
  assert.match(basisOf('GR', 'Easter Monday'), /Orthodox Easter/);
  assert.match(basisOf('GR', 'Easter Monday'), /Julian calendar/);
  assert.match(basisOf('SA', 'Eid al-Fitr'), /1 Shawwal/);
  assert.match(basisOf('SA', 'Eid al-Fitr'), /lunar/);
  assert.match(basisOf('NG', 'Independence Day'), /fixed date: 1 October/);
  assert.match(basisOf('CA', 'Victoria Day'), /rule of its own/);
});

test('describeRule handles each rule shape it is given', () => {
  assert.match(describeRule({ month: 7, day: 4 }), /fixed date: 4 July/);
  assert.match(describeRule({ month: 1, weekday: 1, nth: 3 }), /third Monday in January/);
  assert.match(describeRule({ month: 5, weekday: 1, nth: -1 }), /last Monday in May/);
  assert.match(describeRule({ easter: 0 }), /Easter Sunday itself/);
  assert.match(describeRule({ easter: 1 }), /1 day after Easter Sunday/);
  assert.match(describeRule({ orthodoxEaster: 0 }), /Orthodox Easter Sunday/);
  assert.match(describeRule({ hijri: { month: 12, day: 10 }, span: 4 }), /10 Dhu al-Hijjah/);
  assert.match(describeRule({ hijri: { month: 12, day: 10 }, span: 4 }), /running 4 days/);
  assert.equal(describeRule({}), null);
});

test('an observance shift and a lunar estimate are both explained on the row', () => {
  // 4 July 2026 is a Saturday, observed on the Friday.
  const july = fallbackHolidays('US', 2026).find((h) => h.name.startsWith('Independence Day'));
  assert.equal(july.observedFrom, '2026-07-04');
  assert.equal(july.date, '2026-07-03');

  const eid = fallbackHolidays('SA', 2026).find((h) => h.name === 'Eid al-Fitr');
  assert.equal(eid.estimated, true);
  const christmas = fallbackHolidays('GB', 2026).find((h) => h.name === 'Christmas Day');
  assert.equal(christmas.estimated, false);
});
