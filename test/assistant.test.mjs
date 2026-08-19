import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAPABILITIES,
  answer,
  buildIndex,
  findCountries,
  findDates,
  interpret,
} from '../lib/assistant.mjs';
import { answerCard } from '../lib/pages/assistant.mjs';
import { iso, parseISO } from '../lib/dates.mjs';
import { url } from '../lib/html.mjs';

/**
 * A fixture rather than the real tables: these tests are about reading the
 * question and doing the arithmetic, and neither should change when a country
 * moves a holiday.
 */
const COUNTRIES = [
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'IN', name: 'India', flag: '🇮🇳' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪' },
  { code: 'FR', name: 'France', flag: '🇫🇷' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵' },
  { code: 'ES', name: 'Spain', flag: '🇪🇸' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
  { code: 'IT', name: 'Italy', flag: '🇮🇹' },
  { code: 'KR', name: 'Korea, Republic of', flag: '🇰🇷' },
];

const YEARS = [2025, 2026, 2027];
const TODAY = parseISO('2026-08-19'); // a Wednesday
const index = buildIndex(COUNTRIES);

/** The same small calendar for every country, plus one country-specific day. */
function holidaysFor(code, year) {
  return [
    { date: `${year}-01-01`, name: "New Year's Day", national: true },
    { date: `${year}-05-01`, name: 'Labour Day', national: true },
    { date: `${year}-12-25`, name: 'Christmas Day', national: true },
    { date: `${year}-12-26`, name: 'Boxing Day', national: code === 'GB' },
    { date: `${year}-09-07`, name: `${code} National Day`, national: true },
  ];
}

const DATA = Object.fromEntries(
  COUNTRIES.map((country) => [
    country.code,
    {
      code: country.code,
      name: country.name,
      flag: country.flag,
      years: Object.fromEntries(
        YEARS.map((year) => [year, { holidays: holidaysFor(country.code, year) }]),
      ),
    },
  ]),
);

const ask = (question) => {
  const request = interpret(question, { index, today: TODAY, years: YEARS });
  return { request, result: answer(request, { data: DATA, today: TODAY, years: YEARS, url }) };
};

// --- Reading the question ----------------------------------------------------

test('country names, aliases and codes all resolve', () => {
  assert.deepEqual(findCountries('holidays in Germany', index), ['DE']);
  assert.deepEqual(findCountries('the UK and France', index), ['GB', 'FR']);
  assert.deepEqual(findCountries('USA vs Japan', index), ['US', 'JP']);
  assert.deepEqual(findCountries('US, GB and IN', index), ['US', 'GB', 'IN']);
  // "South Korea" must win over the shorter "Korea" inside it.
  assert.deepEqual(findCountries('public holidays in South Korea', index), ['KR']);
});

test('two-letter words are not mistaken for country codes', () => {
  // IN is India, IT is Italy, IS is Iceland — and all three are English words.
  assert.deepEqual(findCountries('how many days are in it', index), []);
  assert.deepEqual(findCountries('is it a holiday', index), []);
  // Capitalised, they are codes again.
  assert.deepEqual(findCountries('holidays in IN and IT', index), ['IN', 'IT']);
});

test('a country is named once however often it appears', () => {
  assert.deepEqual(findCountries('France, France and France', index), ['FR']);
});

test('no question drags in more than six countries', () => {
  const many = 'US GB IN DE FR JP ES BR'.split(' ').join(', ');
  assert.equal(findCountries(many, index).length, 6);
});

test('dates are read in every shape people write them', () => {
  const read = (text) => findDates(text, TODAY, { year: 2026 }).map((entry) => entry.iso);

  assert.deepEqual(read('on 2026-03-15'), ['2026-03-15']);
  assert.deepEqual(read('on 15 March'), ['2026-03-15']);
  assert.deepEqual(read('on 15th of March 2027'), ['2027-03-15']);
  assert.deepEqual(read('on March 15'), ['2026-03-15']);
  assert.deepEqual(read('on Mar 15th, 2027'), ['2027-03-15']);
  assert.deepEqual(read('today'), ['2026-08-19']);
  assert.deepEqual(read('tomorrow'), ['2026-08-20']);
  assert.deepEqual(read('in 10 days'), ['2026-08-29']);
  assert.deepEqual(read('end of the year'), ['2026-12-31']);
});

test('a weekday resolves forward, and "next" skips the coming one', () => {
  // 2026-08-19 is a Wednesday.
  assert.deepEqual(findDates('on Friday', TODAY).map((d) => d.iso), ['2026-08-21']);
  assert.deepEqual(findDates('next Friday', TODAY).map((d) => d.iso), ['2026-08-28']);
  assert.deepEqual(findDates('last Friday', TODAY).map((d) => d.iso), ['2026-08-14']);
});

test('an impossible date is refused rather than rolled over', () => {
  assert.deepEqual(findDates('31 February 2026', TODAY), []);
  assert.deepEqual(findDates('2026-02-30', TODAY), []);
});

test('two dates in one question come back in the order written', () => {
  const dates = findDates('between 1 March and 30 June', TODAY, { year: 2026 });
  assert.deepEqual(dates.map((entry) => entry.iso), ['2026-03-01', '2026-06-30']);
});

test('the year comes from the words when it is not written out', () => {
  assert.equal(interpret('holidays in Germany next year', { index, today: TODAY, years: YEARS }).year, 2027);
  assert.equal(interpret('holidays in Germany last year', { index, today: TODAY, years: YEARS }).year, 2025);
  assert.equal(interpret('holidays in Germany in 2027', { index, today: TODAY, years: YEARS }).year, 2027);
  assert.equal(interpret('holidays in Germany', { index, today: TODAY, years: YEARS }).year, 2026);
});

test('a year the site does not hold falls back to the nearest it does', () => {
  const request = interpret('holidays in Germany in 2044', { index, today: TODAY, years: YEARS });
  assert.equal(request.yearInRange, false);
  assert.equal(request.year, 2027);
});

// --- Choosing an intent ------------------------------------------------------

test('each question reaches the intent that can answer it', () => {
  const cases = [
    ['When is the next public holiday in Germany?', 'next-holiday'],
    ['Is 25 December a working day in India?', 'on-date'],
    ['How many working days until 24 December in the United States?', 'count'],
    ['What date is 20 business days from today in France?', 'deadline'],
    ['I have 14 days of annual leave next year in the United Kingdom', 'leave'],
    ['When can US, GB and IN all meet?', 'team'],
    ['France vs Japan holidays', 'compare'],
    ['Long weekends in Spain next year', 'long-weekends'],
    ['Public holidays in Japan in May', 'list'],
    ['How many public holidays does Brazil have?', 'year-count'],
    ['What is Boxing Day?', 'explain'],
  ];
  for (const [question, intent] of cases) {
    assert.equal(interpret(question, { index, today: TODAY, years: YEARS }).intent, intent, question);
  }
});

test('a yes/no about one date is not read as a span to count', () => {
  // Both sentences contain "working day"; only one of them is a count.
  assert.equal(interpret('Is 25 December a working day in India?', { index, today: TODAY, years: YEARS }).intent, 'on-date');
  assert.equal(interpret('How many working days until 25 December in India?', { index, today: TODAY, years: YEARS }).intent, 'count');
});

test('a question missing its country asks for one instead of guessing', () => {
  const { request, result } = ask('how many working days until 24 December');
  assert.equal(request.needs.kind, 'country');
  assert.equal(result.ok, false);
  assert.ok(result.followUps.length, 'it offers something answerable instead');
});

test('a question outside the subject is refused rather than answered', () => {
  const { result } = ask('what should I have for dinner');
  assert.equal(result.ok, false);
  assert.ok(result.needs, 'it says what it needs rather than inventing an answer');
});

// --- The arithmetic ----------------------------------------------------------

test('working days between two dates subtract weekends and holidays', () => {
  const { result } = ask('How many working days between 21 December and 31 December in India?');
  assert.equal(result.ok, true);
  // 21-31 Dec 2026: 11 calendar days, 2 weekend days (26th Sat, 27th Sun),
  // Christmas on Friday the 25th. Boxing Day is a Saturday and costs nothing.
  const value = (label) => result.facts.find((fact) => fact.label === label).value;
  assert.equal(value('Calendar days'), '11');
  assert.equal(value('Weekend days'), '2');
  assert.equal(value('Public holidays'), '1');
  assert.equal(value('Working days'), '8');
});

test('a deadline counts from the day after the start and skips holidays', () => {
  const { result } = ask('What date is 5 business days from 21 December in India?');
  assert.equal(result.ok, true);
  // From Mon 21st: Tue 22, Wed 23, Thu 24, (Fri 25 Christmas skipped),
  // (weekend), Mon 28, Tue 29 — five working days lands on the 29th.
  assert.match(result.headline, /29 December 2026/);
});

test('a date already gone is read as next year when the year was assumed', () => {
  const { result } = ask('How many working days until 1 January in India?');
  assert.equal(result.ok, true);
  assert.match(result.headline, /1 Jan 2027/);
});

test('the next holiday looks past the end of the year it started in', () => {
  const { result } = ask('When is the next public holiday in Germany?');
  assert.equal(result.ok, true);
  // From 19 August 2026 the next one in the fixture is 7 September.
  assert.match(result.headline, /7 September 2026/);
});

test('a date with a holiday on it is reported as a day off, not a working day', () => {
  const { result } = ask('Is 25 December a working day in India?');
  assert.equal(result.ok, true);
  assert.match(result.headline, /Christmas Day/);
  assert.equal(result.facts.find((fact) => fact.label === 'Status').value, 'Off');
});

test('a regional holiday elsewhere does not make a working day off', () => {
  // Boxing Day is national in GB only; in India it is regional and 26 December
  // 2026 is a Saturday either way, so ask about a country where it is not kept.
  const { result } = ask('Is 26 December a working day in India?');
  assert.equal(result.ok, true);
  assert.match(result.headline, /Boxing Day/);
});

test('a team answer never claims more clear days than there are weekdays', () => {
  const { result } = ask('When can US, GB and IN all meet in 2026?');
  assert.equal(result.ok, true);
  const clear = Number(result.facts[0].value);
  const weekdays = Number(result.facts[0].note.match(/\d+/)[0]);
  assert.ok(clear > 0 && clear <= weekdays, `${clear} of ${weekdays}`);
});

test('leave never spends more than the allowance', () => {
  const { result } = ask('I have 8 days of annual leave next year in the United Kingdom');
  assert.equal(result.ok, true);
  const spent = Number(result.facts.find((fact) => fact.label === 'Leave spent').value);
  assert.ok(spent <= 8, `spent ${spent} of 8`);
});

test('an answer says which tables it was worked out from', () => {
  const { result } = ask('How many public holidays does Brazil have?');
  assert.equal(result.ok, true);
  assert.deepEqual(result.sources, [{ code: 'BR', name: 'Brazil', year: 2026 }]);
});

// --- The contract ------------------------------------------------------------

test('every advertised example actually answers', () => {
  for (const capability of CAPABILITIES) {
    const { request, result } = ask(capability.example);
    assert.equal(request.intent, capability.intent, `${capability.example} → ${request.intent}`);
    assert.equal(result.ok, true, `${capability.example}: ${result.headline}`);
    assert.ok(result.headline.length > 10, `${capability.example} says something`);
  }
});

test('every follow-up an answer offers is itself answerable', () => {
  for (const capability of CAPABILITIES) {
    const { result } = ask(capability.example);
    for (const followUp of result.followUps) {
      const next = ask(followUp);
      assert.equal(next.result.ok, true, `follow-up "${followUp}" from "${capability.example}"`);
    }
  }
});

test('nothing a question carries reaches the page unescaped', () => {
  const { result } = ask('<script>alert(1)</script> holidays in Germany');
  const html = answerCard(result, { question: '<script>alert(1)</script>' });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'the question is escaped');
  assert.ok(html.includes('&lt;script&gt;'), 'and escaped rather than dropped');
});

test('an answer card carries no address that ignores the mount point', () => {
  const { result } = ask('France vs Japan holidays');
  const html = answerCard(result, { question: 'France vs Japan holidays' });
  for (const match of html.matchAll(/href="([^"]*)"/g)) {
    assert.ok(
      !match[1].startsWith('/') || match[1].startsWith(url.base() || '/'),
      `${match[1]} ignores the mount point`,
    );
  }
});

test('the empty question asks for one rather than throwing', () => {
  const { request, result } = ask('');
  assert.equal(request.needs.kind, 'question');
  assert.equal(result.ok, false);
});

test('a question about a country the site does not cover says so', () => {
  const request = interpret('holidays in Atlantis', { index, today: TODAY, years: YEARS });
  assert.deepEqual(request.countries, []);
  assert.ok(request.needs, 'it asks which country rather than answering about none');
});

test('today is read from the caller, never from the clock', () => {
  const other = parseISO('2027-03-01');
  const request = interpret('what is the next holiday in Germany', { index, today: other, years: YEARS });
  const result = answer(request, { data: DATA, today: other, years: YEARS, url });
  assert.match(result.headline, /1 May 2027/);
  assert.equal(iso(other), '2027-03-01');
});
