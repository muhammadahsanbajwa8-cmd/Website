/**
 * The assistant: plain-English questions, answered from the site's own data.
 *
 * There is no language model here, and that is the point. A question about
 * what date falls twenty working days from Tuesday has exactly one correct
 * answer, and a generator that already knows every public holiday in 195
 * countries can produce it in a millisecond, offline, for nobody's money. What
 * a model would add to that is latency, cost, an API key the site cannot keep,
 * and the possibility of a confidently wrong date.
 *
 * So the work here is *understanding the question*, not inventing the answer:
 *
 *   interpret(text, index)   what is being asked, about where, about when
 *   answer(request, data)    the arithmetic, from real holiday tables
 *
 * The split is deliberate. `interpret` runs first and names the countries it
 * needs; the caller fetches only those; `answer` then runs on the data. That is
 * what lets the browser do the whole thing on one small download, and the
 * generator do it with no browser at all — the same two functions either way.
 *
 * When the question is not understood, nothing is guessed. The request comes
 * back with `needs` set, and the page asks for the missing piece.
 *
 * No Node APIs: the browser runs this module directly.
 */

import {
  MONTH_NAMES,
  WEEKDAY_NAMES,
  addDays,
  businessDays,
  daysBetween,
  formatLong,
  formatShort,
  iso,
  isWeekend,
  parseISO,
  utc,
} from './dates.mjs';
import { compareCountries, longWeekends, offRuns } from './compare.mjs';
import { explain } from './glossary.mjs';
import { DEFAULT_STRATEGY, STRATEGIES, planLeave } from './leave.mjs';
import { yearStats } from './stats.mjs';
import { clearRuns, teamOverlap } from './team.mjs';

/** How many countries one question may involve. */
export const MAX_COUNTRIES = 6;

/**
 * What the assistant can actually do. This list is the contract: every entry
 * has a handler below and an example that is answerable, so the suggestions on
 * the page can never advertise something that comes back "I don't know".
 */
export const CAPABILITIES = [
  {
    intent: 'next-holiday',
    label: 'The next day off',
    example: 'When is the next public holiday in Germany?',
  },
  {
    intent: 'on-date',
    label: 'Is this date a working day',
    example: 'Is 25 December a working day in India?',
  },
  {
    intent: 'count',
    label: 'Working days between dates',
    example: 'How many working days until 24 December in the United States?',
  },
  {
    intent: 'deadline',
    label: 'A deadline in working days',
    example: 'What date is 20 business days from today in France?',
  },
  {
    intent: 'leave',
    label: 'Where to spend annual leave',
    example: 'I have 14 days of annual leave next year in the United Kingdom',
  },
  {
    intent: 'team',
    label: 'When a spread-out team is all there',
    example: 'When can US, GB and IN all meet?',
  },
  {
    intent: 'compare',
    label: 'Two countries side by side',
    example: 'France vs Japan holidays',
  },
  {
    intent: 'long-weekends',
    label: 'Long weekends to travel on',
    example: 'Long weekends in Spain next year',
  },
  {
    intent: 'list',
    label: 'What falls in a month',
    example: 'Public holidays in Japan in May',
  },
  {
    intent: 'year-count',
    label: 'How many days off a year has',
    example: 'How many public holidays does Brazil have?',
  },
  {
    intent: 'explain',
    label: 'What a holiday is for',
    example: 'What is Boxing Day?',
  },
];

// --- Text -------------------------------------------------------------------

/** Lowercase, accent-free, punctuation-normalised — but the same length. */
function fold(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const has = (text, pattern) => pattern.test(text);

/**
 * Two-letter country codes that are also ordinary English words. A question
 * reading "how many days in it" is not a question about Italy, so these are
 * matched only when the writer capitalised them.
 */
const CODE_LOOKALIKES = new Set([
  'am', 'as', 'at', 'be', 'by', 'do', 'in', 'is', 'it', 'me', 'my', 'no', 'or',
  'so', 'to', 'us', 'we',
]);

/**
 * Names people actually type. The country list carries the formal name — "United
 * States of America", "Viet Nam" — and almost nobody writes those.
 */
const ALIASES = {
  uk: 'GB',
  'u.k.': 'GB',
  britain: 'GB',
  'great britain': 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  usa: 'US',
  'u.s.': 'US',
  'u.s.a.': 'US',
  america: 'US',
  'the states': 'US',
  'united states': 'US',
  uae: 'AE',
  'the emirates': 'AE',
  emirates: 'AE',
  holland: 'NL',
  'the netherlands': 'NL',
  'south korea': 'KR',
  korea: 'KR',
  'north korea': 'KP',
  czechia: 'CZ',
  'czech republic': 'CZ',
  'ivory coast': 'CI',
  vietnam: 'VN',
  russia: 'RU',
  turkey: 'TR',
  turkiye: 'TR',
  ireland: 'IE',
  'hong kong': 'HK',
  'new zealand': 'NZ',
  'south africa': 'ZA',
  'saudi arabia': 'SA',
  'sri lanka': 'LK',
  philippines: 'PH',
  'the philippines': 'PH',
};

/**
 * A lookup from every name the assistant will accept to a country code.
 *
 * @param {Array<{code: string, name: string, flag?: string}>} countries
 */
export function buildIndex(countries = []) {
  const byName = new Map();
  const byCode = new Map();

  for (const country of countries) {
    const code = String(country.code || '').toUpperCase();
    if (!code) continue;
    byCode.set(code, { code, name: country.name, flag: country.flag || '' });
    byName.set(fold(country.name), code);
    // "Bolivia (Plurinational State of)" is nobody's search term.
    const short = fold(country.name).replace(/\s*\(.*?\)\s*/g, ' ').trim();
    if (short && !byName.has(short)) byName.set(short, code);
    const comma = fold(country.name).split(',')[0].trim();
    if (comma && !byName.has(comma)) byName.set(comma, code);
  }

  for (const [alias, code] of Object.entries(ALIASES)) {
    if (byCode.has(code) && !byName.has(alias)) byName.set(alias, code);
  }

  return {
    byCode,
    byName,
    /** Longest first, so "south korea" wins over "korea". */
    names: [...byName.keys()].sort((a, b) => b.length - a.length),
    get: (code) => byCode.get(String(code || '').toUpperCase()) || null,
  };
}

/**
 * Every country mentioned, in the order they were mentioned.
 *
 * Matching is on whole words against a masked copy of the question, so a name
 * already claimed cannot be claimed again by a shorter one inside it.
 */
export function findCountries(text, index) {
  const original = String(text || '');
  const folded = fold(original);
  const mask = folded.split('');
  const found = [];

  const claim = (start, end, code) => {
    for (let i = start; i < end; i += 1) {
      if (mask[i] === null) return false;
    }
    for (let i = start; i < end; i += 1) mask[i] = null;
    if (!found.some((entry) => entry.code === code)) found.push({ code, at: start });
    return true;
  };

  const boundary = (start, end) =>
    (start === 0 || /[^a-z0-9]/.test(folded[start - 1])) &&
    (end >= folded.length || /[^a-z0-9.]/.test(folded[end]) || folded[end] === '.');

  for (const name of index.names) {
    let from = 0;
    for (;;) {
      const at = folded.indexOf(name, from);
      if (at < 0) break;
      const end = at + name.length;
      if (boundary(at, end)) claim(at, end, index.byName.get(name));
      from = at + 1;
    }
  }

  // Bare codes: "US", "GB", "IN". Case-sensitive for the ones that are also
  // words, so "in India" does not become India and Indonesia.
  const codePattern = /\b([A-Za-z]{2})\b/g;
  let match;
  while ((match = codePattern.exec(original))) {
    const raw = match[1];
    const code = raw.toUpperCase();
    if (!index.byCode.has(code)) continue;
    if (CODE_LOOKALIKES.has(raw.toLowerCase()) && raw !== code) continue;
    claim(match.index, match.index + raw.length, code);
  }

  return found.sort((a, b) => a.at - b.at).map((entry) => entry.code).slice(0, MAX_COUNTRIES);
}

// --- Dates ------------------------------------------------------------------

const MONTH_PATTERN = MONTH_NAMES.map((name) => name.toLowerCase()).join('|');
const MONTH_SHORT_PATTERN = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec';
const WEEKDAY_PATTERN = WEEKDAY_NAMES.map((name) => name.toLowerCase()).join('|');

function monthNumber(word) {
  const cleaned = String(word).toLowerCase().replace(/\.$/, '');
  const full = MONTH_NAMES.findIndex((name) => name.toLowerCase() === cleaned);
  if (full >= 0) return full + 1;
  const short = MONTH_NAMES.findIndex((name) => name.toLowerCase().startsWith(cleaned.slice(0, 3)));
  return short >= 0 ? short + 1 : 0;
}

function weekdayNumber(word) {
  return WEEKDAY_NAMES.findIndex((name) => name.toLowerCase() === String(word).toLowerCase());
}

/** A valid calendar date, or null — so "31 February" is refused, not shifted. */
function safeDate(year, month, day) {
  if (!year || !month || !day) return null;
  const date = utc(year, month, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month) return null;
  return date;
}

/**
 * Every date the question mentions, in the order written.
 *
 * @param {string} text
 * @param {Date} today
 * @param {{year?: number|null}} [options] year to assume when none is written
 * @returns {Array<{date: Date, iso: string, at: number, assumedYear: boolean, source: string}>}
 */
export function findDates(text, today, options = {}) {
  const folded = fold(text);
  const assumeYear = options.year || today.getUTCFullYear();
  const out = [];
  const taken = [];

  const free = (start, end) => !taken.some(([a, b]) => start < b && end > a);
  const push = (start, end, date, source, assumedYear = false) => {
    if (!date || !free(start, end)) return;
    taken.push([start, end]);
    out.push({ date, iso: iso(date), at: start, assumedYear, source });
  };

  const scan = (pattern, handler) => {
    const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    let match;
    while ((match = regex.exec(folded))) {
      const result = handler(match);
      if (result) push(match.index, match.index + match[0].length, result.date, result.source, result.assumedYear);
    }
  };

  // 2026-03-15
  scan(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, (m) => ({
    date: safeDate(Number(m[1]), Number(m[2]), Number(m[3])),
    source: m[0],
  }));

  // 15 March, 15th of March 2027
  scan(
    new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_PATTERN}|${MONTH_SHORT_PATTERN})\\.?(?:\\s*,?\\s*(\\d{4}))?\\b`,
    ),
    (m) => ({
      date: safeDate(Number(m[3]) || assumeYear, monthNumber(m[2]), Number(m[1])),
      source: m[0],
      assumedYear: !m[3],
    }),
  );

  // March 15, Mar 15th 2027
  scan(
    new RegExp(
      `\\b(${MONTH_PATTERN}|${MONTH_SHORT_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?\\b`,
    ),
    (m) => ({
      date: safeDate(Number(m[3]) || assumeYear, monthNumber(m[1]), Number(m[2])),
      source: m[0],
      assumedYear: !m[3],
    }),
  );

  // today, tomorrow, yesterday
  scan(/\b(today|tonight|tomorrow|yesterday)\b/, (m) => ({
    date: addDays(today, { today: 0, tonight: 0, tomorrow: 1, yesterday: -1 }[m[1]]),
    source: m[1],
  }));

  // next Friday, this Monday, Friday
  scan(new RegExp(`\\b(?:(next|this|last)\\s+)?(${WEEKDAY_PATTERN})\\b`), (m) => {
    const target = weekdayNumber(m[2]);
    if (target < 0) return null;
    if (m[1] === 'last') {
      const back = (today.getUTCDay() - target + 7) % 7 || 7;
      return { date: addDays(today, -back), source: m[0] };
    }
    const forward = (target - today.getUTCDay() + 7) % 7;
    const base = addDays(today, forward);
    // "next Friday" on a Wednesday means the Friday after this one.
    const bump = m[1] === 'next' && forward < 7 ? 7 : 0;
    return { date: addDays(base, bump), source: m[0] };
  });

  // in 10 days, in 3 weeks
  scan(/\bin\s+(\d{1,3})\s+(day|week|month)s?\b/, (m) => {
    const n = Number(m[1]);
    if (m[2] === 'day') return { date: addDays(today, n), source: m[0] };
    if (m[2] === 'week') return { date: addDays(today, n * 7), source: m[0] };
    const shifted = new Date(today.getTime());
    shifted.setUTCMonth(shifted.getUTCMonth() + n);
    return { date: shifted, source: m[0] };
  });

  // end of the year, start of next month
  scan(/\b(end|start|beginning)\s+of\s+(?:the\s+)?(this\s+|next\s+)?(year|month)\b/, (m) => {
    const next = (m[2] || '').trim() === 'next';
    if (m[3] === 'year') {
      const year = today.getUTCFullYear() + (next ? 1 : 0);
      return { date: m[1] === 'end' ? utc(year, 12, 31) : utc(year, 1, 1), source: m[0] };
    }
    const month = today.getUTCMonth() + 1 + (next ? 1 : 0);
    const year = today.getUTCFullYear() + (month > 12 ? 1 : 0);
    const normalised = ((month - 1) % 12) + 1;
    if (m[1] !== 'end') return { date: utc(year, normalised, 1), source: m[0] };
    const first = utc(year, normalised, 1);
    first.setUTCMonth(first.getUTCMonth() + 1);
    return { date: addDays(first, -1), source: m[0] };
  });

  return out.sort((a, b) => a.at - b.at);
}

/** A month named on its own — "holidays in May" — with no day beside it. */
function findBareMonth(text, dates) {
  const folded = fold(text);
  const regex = new RegExp(`\\b(${MONTH_PATTERN})\\b`, 'g');
  let match;
  while ((match = regex.exec(folded))) {
    const start = match.index;
    const end = start + match[0].length;
    // A month already claimed by a date — the "March" in "15 March" — is part
    // of that date, not a month the question is scoped to.
    const claimed = dates.some((entry) => start < entry.at + entry.source.length && end > entry.at);
    if (!claimed) return monthNumber(match[1]);
  }
  return 0;
}

/** The year the question is about. */
function findYear(text, today, years) {
  const folded = fold(text);
  const explicit = folded.match(/\b(20\d{2})\b/);
  const current = today.getUTCFullYear();
  let year = current;
  if (explicit) year = Number(explicit[1]);
  else if (has(folded, /\bnext year\b/)) year = current + 1;
  else if (has(folded, /\blast year\b/)) year = current - 1;
  const available = years && years.length ? years : [current];
  if (available.includes(year)) return { year, inRange: true, asked: year };
  const nearest = available.reduce((best, candidate) =>
    Math.abs(candidate - year) < Math.abs(best - year) ? candidate : best,
  );
  return { year: nearest, inRange: false, asked: year };
}

// --- Intent -----------------------------------------------------------------

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30,
};

function findCount(text, pattern) {
  const folded = fold(text);
  const digits = folded.match(pattern.digits);
  if (digits) return Number(digits[1]);
  const words = folded.match(pattern.words);
  if (words && NUMBER_WORDS[words[1]] !== undefined) return NUMBER_WORDS[words[1]];
  return 0;
}

const WORD_NUMBER = Object.keys(NUMBER_WORDS).join('|');

/**
 * Read a question.
 *
 * @param {string} text
 * @param {{
 *   index: ReturnType<typeof buildIndex>,
 *   today: string|Date,
 *   years?: number[],
 * }} context
 */
export function interpret(text, context) {
  const question = String(text || '').trim();
  const index = context.index;
  const today = context.today instanceof Date ? context.today : parseISO(context.today);
  const years = context.years || [today.getUTCFullYear()];
  const folded = fold(question);

  const base = {
    question,
    intent: 'unknown',
    countries: [],
    year: today.getUTCFullYear(),
    yearInRange: true,
    dates: [],
    month: 0,
    budget: 0,
    workingDayCount: 0,
    term: '',
    needs: null,
  };

  if (!question) {
    return { ...base, needs: { kind: 'question', message: 'Ask something to get started.' } };
  }

  const countries = findCountries(question, index);
  const { year, inRange } = findYear(question, today, years);
  const dates = findDates(question, today, { year });
  const month = findBareMonth(question, dates);

  const request = {
    ...base,
    countries,
    year,
    yearInRange: inRange,
    dates,
    month,
    budget: findCount(question, {
      digits: /\b(\d{1,2})\s*(?:days?|d)\b(?![^.]*\bbusiness\b)/,
      words: new RegExp(`\\b(${WORD_NUMBER})\\s+days?\\b`),
    }),
    workingDayCount: findCount(question, {
      digits: /\b(\d{1,3})\s*(?:business|working|work|court)\s*days?\b/,
      words: new RegExp(`\\b(${WORD_NUMBER})\\s+(?:business|working|work)\\s*days?\\b`),
    }),
  };

  // --- Which question is it? -------------------------------------------------
  //
  // Read top to bottom: the earlier tests are the ones with an unmistakable
  // shape (a number of business days, the words "annual leave"), so they get
  // to answer before the vaguer ones look at the same sentence.

  const explainMatch = question.match(
    /\b(?:what|why)\s+(?:is|are|was|does)\s+(?:the\s+)?([^?]{2,60}?)\s*(?:\?|$|about|for|celebrated)/i,
  );

  if (
    request.workingDayCount &&
    has(folded, /\b(from|after|before|deadline|due|falls?|land|what date|which date)\b/)
  ) {
    request.intent = 'deadline';
  } else if (has(folded, /\b(annual leave|holiday allowance|leave days|days off to book|pto|vacation days|book my leave|use my leave)\b/) || (request.budget && has(folded, /\bleave\b/))) {
    request.intent = 'leave';
  } else if (
    dates.length === 1 &&
    has(folded, /^\s*(is|was|isn't|is not|will)\b/) &&
    has(folded, /\b(a |an )?(public )?(holiday|working day|business day|bank holiday|day off|workday)\b/)
  ) {
    // "Is 25 December a working day?" is a yes/no about one date, not a span
    // to count — and it contains the same words a counting question does.
    request.intent = 'on-date';
  } else if (
    has(folded, /\b(how many|how long|number of|count)\b/) &&
    has(folded, /\b(working days?|business days?|weekdays?|days?)\b/) &&
    (dates.length >= 1 || has(folded, /\b(until|till|between|left|remaining)\b/))
  ) {
    request.intent = 'count';
  } else if (
    has(folded, /\b(working days?|business days?|weekdays?)\b/) &&
    has(folded, /\b(until|till|between|left|remaining|from now)\b/)
  ) {
    request.intent = 'count';
  } else if (has(folded, /\bhow long\b/) && dates.length) {
    // "How long until Christmas" names no unit; working days is the useful one.
    request.intent = 'count';
  } else if (has(folded, /\b(vs|versus|compared? (?:to|with)|difference between)\b/) && countries.length >= 2) {
    request.intent = 'compare';
  } else if (
    countries.length >= 3 ||
    (countries.length >= 2 && has(folded, /\b(team|everyone|all|meet|meeting|workshop|sprint|launch|together|overlap|standup|available)\b/))
  ) {
    request.intent = 'team';
  } else if (countries.length === 2) {
    request.intent = 'compare';
  } else if (has(folded, /\blong weekends?\b|\bbridge days?\b/)) {
    request.intent = 'long-weekends';
  } else if (
    dates.length &&
    has(folded, /\b(is|was|will)\b/) &&
    has(folded, /\b(holiday|working day|business day|day off|open|closed|bank holiday|work)\b/)
  ) {
    request.intent = 'on-date';
  } else if (month && has(folded, /\b(holidays?|days? off|what.s on)\b/)) {
    request.intent = 'list';
  } else if (has(folded, /\bhow many\b/) && has(folded, /\bholidays?\b/)) {
    request.intent = 'year-count';
  } else if (has(folded, /\b(next|upcoming|coming|when is the)\b/) && has(folded, /\b(holiday|day off|bank holiday)\b/)) {
    request.intent = 'next-holiday';
  } else if (explainMatch && !countries.length) {
    request.intent = 'explain';
    request.term = explainMatch[1].trim();
  } else if (countries.length === 1) {
    request.intent = 'next-holiday';
  } else if (dates.length) {
    request.intent = 'on-date';
  }

  // --- What is still missing? ------------------------------------------------

  const needsCountry = ['next-holiday', 'on-date', 'count', 'deadline', 'leave', 'list', 'year-count', 'long-weekends'];
  if (request.intent === 'unknown') {
    request.needs = {
      kind: 'question',
      message: 'That one is outside what this page can work out.',
    };
  } else if (needsCountry.includes(request.intent) && !countries.length) {
    request.needs = { kind: 'country', message: 'Which country should this be for?' };
  } else if (request.intent === 'team' && countries.length < 2) {
    request.needs = { kind: 'country', message: 'Name at least two countries for a team.' };
  } else if (request.intent === 'compare' && countries.length < 2) {
    request.needs = { kind: 'country', message: 'Name two countries to compare.' };
  } else if (request.intent === 'deadline' && !request.workingDayCount) {
    request.needs = { kind: 'count', message: 'How many working days from the start date?' };
  } else if (request.intent === 'explain' && !request.term) {
    request.needs = { kind: 'term', message: 'Which holiday should I explain?' };
  }

  return request;
}

// --- Answers ----------------------------------------------------------------
//
// Every handler returns the same shape, so the page renders any answer without
// knowing which question produced it:
//
//   headline   one sentence, the answer itself
//   facts      the numbers, for the tiles
//   prose      the working, in full sentences
//   table      supporting rows, when there are rows worth showing
//   links      where to go for more
//   sources    which countries and years the arithmetic used
//
// Nothing here reaches for data it was not given. A handler with no holiday
// table says so rather than answering from the weekend pattern alone.

const plural = (count, one, many) => `${count.toLocaleString('en')} ${count === 1 ? one : many}`;

const listNames = (names) =>
  names.length <= 1
    ? names[0] || ''
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/**
 * Holidays for a country and year out of whatever the caller loaded.
 *
 * @param {Map<string, any>|object} data code -> {name, flag, years: {[year]: {holidays}}}
 */
function tableFor(data, code, year) {
  const entry = data instanceof Map ? data.get(code) : data[code];
  if (!entry) return null;
  const years = entry.years || {};
  const slot = years[year] || years[String(year)];
  return {
    code,
    name: entry.name || code,
    flag: entry.flag || '',
    holidays: (slot && slot.holidays) || [],
    stats: (slot && slot.stats) || null,
    allYears: years,
    missing: !slot,
  };
}

/** National holidays only, unless the question asked for regional ones too. */
function holidaySet(holidays, includeRegional = false) {
  return new Set(
    holidays.filter((holiday) => includeRegional || holiday.national !== false).map((h) => h.date),
  );
}

function unanswered(request, message, followUps = []) {
  return {
    intent: request.intent,
    question: request.question,
    ok: false,
    headline: message,
    facts: [],
    prose: [],
    table: null,
    links: [],
    sources: [],
    followUps,
  };
}

function shape(request, parts) {
  return {
    intent: request.intent,
    question: request.question,
    ok: true,
    headline: '',
    facts: [],
    prose: [],
    table: null,
    links: [],
    sources: [],
    followUps: [],
    ...parts,
  };
}

const HANDLERS = {
  'next-holiday'(request, ctx) {
    const country = tableFor(ctx.data, request.countries[0], request.year);
    if (!country) return unanswered(request, 'No holiday table was loaded for that country.');

    const todayISO = iso(ctx.today);
    const upcoming = [];
    for (const year of Object.keys(country.allYears).sort()) {
      for (const holiday of country.allYears[year].holidays || []) {
        if (holiday.date >= todayISO && holiday.national !== false) upcoming.push(holiday);
      }
    }
    upcoming.sort((a, b) => (a.date < b.date ? -1 : 1));
    const next = upcoming[0];
    if (!next) {
      return unanswered(
        request,
        `${country.name} has no holiday on file after ${formatShort(ctx.today)}.`,
      );
    }

    const date = parseISO(next.date);
    const away = daysBetween(ctx.today, date);
    const work = businessDays(ctx.today, date, holidaySet(
      Object.values(country.allYears).flatMap((slot) => slot.holidays || []),
    ), { inclusiveEnd: false });

    return shape(request, {
      headline:
        away === 0
          ? `Today is ${next.name} in ${country.name}.`
          : `${next.name}, ${formatLong(date)} — ${plural(away, 'day', 'days')} away in ${country.name}.`,
      facts: [
        { value: String(away), label: 'Days from today', note: formatShort(date) },
        {
          value: String(work.businessDays),
          label: 'Working days first',
          note: 'weekends and holidays removed',
        },
        { value: WEEKDAY_NAMES[date.getUTCDay()], label: 'Falls on a', note: isWeekend(date) ? 'a weekend — no day off gained' : 'a weekday' },
      ],
      prose: [
        explain(next.name) ||
          `${next.name} is the next public holiday on file for ${country.name}.`,
        isWeekend(date)
          ? `It lands on a ${WEEKDAY_NAMES[date.getUTCDay()]}, so unless ${country.name} substitutes the day it does not add to anyone's time off.`
          : `There ${work.businessDays === 1 ? 'is' : 'are'} ${plural(work.businessDays, 'working day', 'working days')} to get through first.`,
      ],
      table: upcoming.length > 1
        ? {
            caption: `The next few in ${country.name}`,
            columns: [{ label: 'Date' }, { label: 'Holiday' }, { label: 'Weekday' }, { label: 'Days away', numeric: true }],
            rows: upcoming.slice(0, 6).map((holiday) => {
              const at = parseISO(holiday.date);
              return [holiday.date, holiday.name, WEEKDAY_NAMES[at.getUTCDay()], String(daysBetween(ctx.today, at))];
            }),
          }
        : null,
      links: [
        { label: `All ${country.name} holidays`, href: ctx.url.country(country.code) },
        { label: `${country.name} ${request.year}`, href: ctx.url.year(country.code, date.getUTCFullYear()) },
      ],
      sources: [{ code: country.code, name: country.name, year: date.getUTCFullYear() }],
      followUps: [
        `Long weekends in ${country.name} next year`,
        `How many public holidays does ${country.name} have?`,
      ],
    });
  },

  'on-date'(request, ctx) {
    const country = tableFor(ctx.data, request.countries[0], request.year);
    if (!country) return unanswered(request, 'No holiday table was loaded for that country.');

    const target = request.dates[0];
    if (!target) return unanswered(request, 'No date in that question to look up.');
    const date = target.date;
    const year = date.getUTCFullYear();
    const slot = country.allYears[year] || country.allYears[String(year)];
    if (!slot) {
      return unanswered(
        request,
        `This site holds ${country.name} for ${Object.keys(country.allYears).join(', ')} — not ${year}.`,
      );
    }

    const key = iso(date);
    const match = (slot.holidays || []).find((holiday) => holiday.date === key);
    const weekend = isWeekend(date);
    const isWorking = !weekend && !match;

    const verdict = match
      ? `${formatLong(date)} is ${match.name} in ${country.name}${match.national === false ? ' (regional)' : ''}.`
      : weekend
        ? `${formatLong(date)} is a ${WEEKDAY_NAMES[date.getUTCDay()]} — a weekend in ${country.name}, and not a public holiday.`
        : `${formatLong(date)} is an ordinary working day in ${country.name}.`;

    const nearby = (slot.holidays || [])
      .filter((holiday) => Math.abs(daysBetween(date, parseISO(holiday.date))) <= 10)
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    return shape(request, {
      headline: verdict,
      facts: [
        { value: isWorking ? 'Working' : 'Off', label: 'Status', note: match ? 'public holiday' : weekend ? 'weekend' : 'no holiday on file' },
        { value: WEEKDAY_NAMES[date.getUTCDay()], label: 'Weekday', note: key },
        { value: String(daysBetween(ctx.today, date)), label: 'Days from today', note: date < ctx.today ? 'in the past' : 'ahead' },
      ],
      prose: [
        match && explain(match.name)
          ? explain(match.name)
          : match
            ? `${match.name} is on the ${country.name} list for ${year}.`
            : `Nothing on the ${country.name} list for ${year} falls on ${key}.`,
        nearby.length
          ? `Within ten days either side: ${nearby.map((h) => `${h.name} (${h.date})`).join(', ')}.`
          : 'Nothing else falls within ten days either side.',
      ],
      table: nearby.length
        ? {
            caption: `Around ${key} in ${country.name}`,
            columns: [{ label: 'Date' }, { label: 'Holiday' }, { label: 'Scope' }],
            rows: nearby.map((h) => [h.date, h.name, h.national === false ? 'Regional' : 'National']),
          }
        : null,
      links: [
        { label: `${country.name} ${year}`, href: ctx.url.year(country.code, year) },
        { label: `Business-day calculator`, href: ctx.url.calculator(country.code) },
      ],
      sources: [{ code: country.code, name: country.name, year }],
      followUps: [
        `How many working days until ${formatShort(date)} in ${country.name}?`,
        `When is the next public holiday in ${country.name}?`,
      ],
    });
  },

  count(request, ctx) {
    const country = tableFor(ctx.data, request.countries[0], request.year);
    if (!country) return unanswered(request, 'No holiday table was loaded for that country.');

    // One date means "from today until then"; two means the span between them.
    let [first, second] = request.dates;
    let start = second ? first.date : ctx.today;
    let end = second ? second.date : first && first.date;
    if (!end) return unanswered(request, 'No date in that question to count towards.');

    // "How many working days until 3 March", asked in November, means next
    // March — a date the writer assumed a year for, and which has passed.
    if (!second && first.assumedYear && end < ctx.today) {
      const rolled = utc(end.getUTCFullYear() + 1, end.getUTCMonth() + 1, end.getUTCDate());
      if (country.allYears[rolled.getUTCFullYear()]) end = rolled;
    }
    if (end < start) [start, end] = [end, start];

    const spanYears = [];
    for (let y = start.getUTCFullYear(); y <= end.getUTCFullYear(); y += 1) spanYears.push(y);
    const covered = spanYears.filter((y) => country.allYears[y] || country.allYears[String(y)]);
    const holidays = covered.flatMap(
      (y) => (country.allYears[y] || country.allYears[String(y)]).holidays || [],
    );

    const result = businessDays(start, end, holidaySet(holidays), { inclusiveEnd: true });
    const removed = holidays.filter((h) => result.holidaysRemoved.includes(h.date));

    return shape(request, {
      headline: `${plural(result.businessDays, 'working day', 'working days')} from ${formatShort(
        start,
      )} to ${formatShort(end)} in ${country.name}.`,
      facts: [
        { value: String(result.businessDays), label: 'Working days', note: 'weekends and holidays removed' },
        { value: String(result.calendarDays), label: 'Calendar days', note: 'both ends counted' },
        { value: String(result.weekendDays), label: 'Weekend days', note: 'Saturdays and Sundays' },
        { value: String(result.holidayDays), label: 'Public holidays', note: 'on weekdays only' },
      ],
      prose: [
        `The span runs ${formatLong(start)} to ${formatLong(end)}, both ends included. Of its ${
          result.calendarDays
        } calendar days, ${result.weekendDays} fall at the weekend and ${
          result.holidayDays
        } are ${country.name} public holidays on a weekday.`,
        removed.length
          ? `Removed as holidays: ${removed.map((h) => `${h.name} (${h.date})`).join(', ')}.`
          : 'No public holiday falls on a weekday inside this span.',
        covered.length < spanYears.length
          ? `Note: this site holds ${country.name} for ${covered.join(', ') || 'no year in this span'}, so part of the span was counted on weekends alone.`
          : '',
      ].filter(Boolean),
      table: null,
      links: [
        { label: `${country.name} business-day calculator`, href: ctx.url.calculator(country.code) },
        { label: `${country.name} holidays`, href: ctx.url.country(country.code) },
      ],
      sources: covered.map((y) => ({ code: country.code, name: country.name, year: y })),
      followUps: [
        `What date is 20 business days from ${formatShort(start)} in ${country.name}?`,
        `Is ${formatShort(end)} a working day in ${country.name}?`,
      ],
    });
  },

  deadline(request, ctx) {
    const country = tableFor(ctx.data, request.countries[0], request.year);
    if (!country) return unanswered(request, 'No holiday table was loaded for that country.');

    const backwards = has(fold(request.question), /\bbefore\b|\bahead of\b|\bprior to\b/);
    const start = request.dates.length ? request.dates[0].date : ctx.today;
    const count = request.workingDayCount;

    const holidays = holidaySet(
      Object.values(country.allYears).flatMap((slot) => slot.holidays || []),
    );

    // Count working days from the day after the start: a deadline of "5
    // business days from Monday" does not include that Monday.
    const step = backwards ? -1 : 1;
    let cursor = start;
    let counted = 0;
    const skipped = [];
    let guard = 0;
    while (counted < count && guard < 4000) {
      guard += 1;
      cursor = addDays(cursor, step);
      if (isWeekend(cursor)) continue;
      if (holidays.has(iso(cursor))) {
        skipped.push(iso(cursor));
        continue;
      }
      counted += 1;
    }

    const named = Object.values(country.allYears)
      .flatMap((slot) => slot.holidays || [])
      .filter((h) => skipped.includes(h.date));
    const calendar = Math.abs(daysBetween(start, cursor));
    const covered = Object.keys(country.allYears).map(Number).sort();
    const beyond = cursor.getUTCFullYear() > covered.at(-1) || cursor.getUTCFullYear() < covered[0];

    return shape(request, {
      headline: `${formatLong(cursor)} — ${count} working ${
        count === 1 ? 'day' : 'days'
      } ${backwards ? 'before' : 'after'} ${formatShort(start)} in ${country.name}.`,
      facts: [
        { value: formatShort(cursor), label: backwards ? 'Start by' : 'Falls on', note: WEEKDAY_NAMES[cursor.getUTCDay()] },
        { value: String(calendar), label: 'Calendar days', note: `to cover ${count} working days` },
        { value: String(skipped.length), label: 'Holidays skipped', note: skipped.length ? named.map((h) => h.name).join(', ') : 'none in the way' },
      ],
      prose: [
        `Counting ${backwards ? 'back from' : 'forward from'} ${formatLong(
          start,
        )}, the start date itself is not counted — day one is the first working day ${
          backwards ? 'before' : 'after'
        } it. Weekends and ${country.name} public holidays are skipped.`,
        skipped.length
          ? `Skipped: ${named.map((h) => `${h.name} (${h.date})`).join(', ')}.`
          : 'No public holiday fell inside the count.',
        beyond
          ? `Warning: the answer falls outside the years this site holds for ${country.name} (${covered.join(', ')}), so holidays past that point could not be checked.`
          : '',
      ].filter(Boolean),
      table: null,
      links: [
        { label: `${country.name} business-day calculator`, href: ctx.url.calculator(country.code) },
      ],
      sources: covered.map((y) => ({ code: country.code, name: country.name, year: y })),
      followUps: [
        `How many working days until ${formatShort(cursor)} in ${country.name}?`,
        `Is ${formatShort(cursor)} a working day in ${country.name}?`,
      ],
    });
  },

  leave(request, ctx) {
    const country = tableFor(ctx.data, request.countries[0], request.year);
    if (!country) return unanswered(request, 'No holiday table was loaded for that country.');
    if (country.missing) {
      return unanswered(request, `No ${request.year} holiday table for ${country.name} on this site.`);
    }

    const budget = request.budget || 10;
    const folded = fold(request.question);
    const strategy = has(folded, /\blong weekends?\b/)
      ? 'long-weekends'
      : has(folded, /\b(trip|abroad|proper|fortnight|two weeks|long break)\b/)
        ? 'long-breaks'
        : DEFAULT_STRATEGY;

    const plan = planLeave(request.year, country.holidays, {
      budget,
      strategy,
      after: request.year === ctx.today.getUTCFullYear() ? iso(ctx.today) : null,
    });

    const best = plan.breaks[0] || null;

    return shape(request, {
      headline: best
        ? `${budget} days of leave buys ${plan.daysOff} days off in ${country.name} — the best single stretch is ${formatShort(
            parseISO(best.from),
          )} to ${formatShort(parseISO(best.to))}.`
        : `No stretch worth booking is left in ${request.year} for ${country.name}.`,
      facts: [
        { value: String(plan.daysOff), label: 'Days off', note: `from ${budget} days of leave` },
        { value: `${plan.multiplier.toFixed(1)}×`, label: 'Leverage', note: 'days off per day booked' },
        { value: String(plan.breaks.length), label: 'Breaks', note: STRATEGIES[strategy].label },
        { value: String(plan.leaveUsed), label: 'Leave spent', note: `of ${budget} available` },
      ],
      prose: [
        `${STRATEGIES[strategy].blurb} Booking ${plural(plan.leaveUsed, 'day', 'days')} against the ${
          request.year
        } ${country.name} calendar turns into ${plan.daysOff} consecutive days off across ${plural(
          plan.breaks.length,
          'break',
          'breaks',
        )} — ${plan.multiplier.toFixed(1)} days off for every day booked.`,
        plan.leaveUsed < budget
          ? `${plural(budget - plan.leaveUsed, 'day', 'days')} of the allowance had nothing worth buying and is left unspent.`
          : 'The whole allowance is spent.',
      ],
      table: plan.breaks.length
        ? {
            caption: `Where to put ${budget} days in ${request.year}`,
            columns: [
              { label: 'From' },
              { label: 'To' },
              { label: 'Leave', numeric: true },
              { label: 'Days off', numeric: true },
              { label: 'Why it works' },
            ],
            rows: plan.breaks.map((item) => [
              item.from,
              item.to,
              String(item.cost),
              String(item.length),
              item.holidays.map((h) => h.name).join(', ') || 'weekend bridge',
            ]),
          }
        : null,
      links: [
        { label: `${country.name} leave planner`, href: ctx.url.leave(country.code) },
        { label: `${country.name} ${request.year}`, href: ctx.url.year(country.code, request.year) },
      ],
      sources: [{ code: country.code, name: country.name, year: request.year }],
      followUps: [
        `Long weekends in ${country.name} in ${request.year}`,
        `How many public holidays does ${country.name} have in ${request.year}?`,
      ],
    });
  },

  team(request, ctx) {
    const members = request.countries
      .map((code) => tableFor(ctx.data, code, request.year))
      .filter((entry) => entry && !entry.missing);
    if (members.length < 2) {
      return unanswered(request, 'Not enough holiday tables were loaded to compare a team.');
    }

    const overlap = teamOverlap(
      request.year,
      members.map((member) => ({
        code: member.code,
        name: member.name,
        flag: member.flag,
        holidays: member.holidays,
      })),
      { today: iso(ctx.today) },
    );
    const runs = clearRuns(overlap, 5);
    const names = members.map((member) => member.name);

    return shape(request, {
      headline: `${overlap.fullyStaffed} of ${overlap.weekdays} weekdays in ${
        request.year
      } have nobody in ${listNames(names)} on a public holiday.`,
      facts: [
        { value: String(overlap.fullyStaffed), label: 'Days everyone works', note: `of ${overlap.weekdays} weekdays` },
        { value: String(overlap.partial), label: 'Days someone is away', note: 'at least one country off' },
        { value: `${Math.round(overlap.coverage * 100)}%`, label: 'Full attendance', note: 'share of the working year' },
        {
          value: overlap.clearestMonth ? overlap.clearestMonth.month : '—',
          label: 'Clearest month',
          note: overlap.clearestMonth ? `${overlap.clearestMonth.absences} disrupted days` : '',
        },
      ],
      prose: [
        `Across ${listNames(names)} there are ${overlap.fullyStaffed} working days in ${
          request.year
        } when nobody is on a public holiday. On the other ${overlap.partial}, at least one country is off — those are the days a meeting quietly loses half its attendees.`,
        runs.length
          ? `The longest clear stretch runs ${runs[0].from} to ${runs[0].to}: ${plural(
              runs[0].workingDays,
              'working day',
              'working days',
            )} with the whole team available. That is where a workshop or a launch fits.`
          : 'No stretch of clear days is long enough to be worth naming.',
        overlap.everyoneOff.length
          ? `Everyone is off together on ${overlap.everyoneOff.length} ${
              overlap.everyoneOff.length === 1 ? 'day' : 'days'
            }: ${overlap.everyoneOff.slice(0, 4).map((entry) => entry.date).join(', ')}.`
          : 'No public holiday is shared by every country in this team.',
      ],
      table: runs.length
        ? {
            caption: `The clearest stretches in ${request.year}`,
            columns: [{ label: 'From' }, { label: 'To' }, { label: 'Working days', numeric: true }],
            rows: runs.map((run) => [run.from, run.to, String(run.workingDays)]),
          }
        : null,
      links: [
        {
          label: 'Open this team in the planner',
          href: `${ctx.url.team()}?c=${members.map((m) => m.code).join(',')}&year=${request.year}`,
        },
      ],
      sources: members.map((member) => ({ code: member.code, name: member.name, year: request.year })),
      followUps: [
        `Long weekends in ${names[0]} in ${request.year}`,
        `When is the next public holiday in ${names[1]}?`,
      ],
    });
  },

  compare(request, ctx) {
    const [first, second] = request.countries.map((code) => tableFor(ctx.data, code, request.year));
    if (!first || !second || first.missing || second.missing) {
      return unanswered(request, 'Both countries need a holiday table for that year.');
    }

    // compareCountries returns the holiday lists themselves; the counts that
    // make a sentence come from the per-year statistics.
    const stats = (country) =>
      country.stats || yearStats(request.year, country.holidays, ctx.today);
    const statsA = stats(first);
    const statsB = stats(second);
    const result = compareCountries(
      { code: first.code, name: first.name, flag: first.flag, holidays: first.holidays, stats: statsA },
      { code: second.code, name: second.name, flag: second.flag, holidays: second.holidays, stats: statsB },
      request.year,
    );

    const a = { ...first, stats: statsA, longWeekends: result.a.longWeekends.length };
    const b = { ...second, stats: statsB, longWeekends: result.b.longWeekends.length };
    const fewer = statsA.workingDays === statsB.workingDays ? null : statsA.workingDays < statsB.workingDays ? a : b;
    const more = fewer === a ? b : a;

    return shape(request, {
      headline: fewer
        ? `${fewer.name} works ${more.stats.workingDays - fewer.stats.workingDays} fewer days than ${
            more.name
          } in ${request.year}.`
        : `${a.name} and ${b.name} both work ${statsA.workingDays} days in ${request.year}.`,
      facts: [
        { value: String(statsA.total), label: `${a.name} holidays`, note: `${statsA.workingDays} working days` },
        { value: String(statsB.total), label: `${b.name} holidays`, note: `${statsB.workingDays} working days` },
        { value: String(result.shared.length), label: 'Shared days off', note: 'the same date in both' },
        { value: String(a.longWeekends), label: `${a.code} long weekends`, note: `${b.code}: ${b.longWeekends}` },
      ],
      prose: [
        `In ${request.year} ${a.name} lists ${plural(statsA.total, 'public holiday', 'public holidays')} and ${
          b.name
        } lists ${statsB.total}. Counting only the ones that land on a weekday, that leaves ${
          statsA.workingDays
        } working days in ${a.name} and ${statsB.workingDays} in ${b.name}.`,
        result.shared.length
          ? `They share ${plural(result.shared.length, 'date', 'dates')}: ${result.shared
              .slice(0, 5)
              .map((entry) => `${entry.date} (${entry.a.name})`)
              .join(', ')}${result.shared.length > 5 ? ', and more' : ''}.`
          : 'No public holiday falls on the same date in both countries.',
        `${result.quietest.name} is the quietest month across the pair, ${result.busiest.name} the busiest.`,
      ],
      table: {
        caption: `${a.name} against ${b.name}, ${request.year}`,
        columns: [{ label: 'Measure' }, { label: a.code }, { label: b.code }],
        rows: [
          ['Public holidays', String(statsA.total), String(statsB.total)],
          ['Working days', String(statsA.workingDays), String(statsB.workingDays)],
          ['Long weekends', String(a.longWeekends), String(b.longWeekends)],
          ['Lost to weekends', String(statsA.weekendHolidayCount), String(statsB.weekendHolidayCount)],
        ],
      },
      links: [
        { label: `${a.name} vs ${b.name} in full`, href: ctx.url.pair(a.code, b.code) },
        { label: 'Interactive comparison', href: ctx.url.compareQuery(a.code, b.code, request.year) },
      ],
      sources: [
        { code: a.code, name: a.name, year: request.year },
        { code: b.code, name: b.name, year: request.year },
      ],
      followUps: [`When can ${a.name} and ${b.name} teams all meet?`, `Long weekends in ${a.name}`],
    });
  },

  'long-weekends'(request, ctx) {
    const country = tableFor(ctx.data, request.countries[0], request.year);
    if (!country || country.missing) {
      return unanswered(request, `No ${request.year} holiday table for that country on this site.`);
    }

    const runs = offRuns(request.year, country.holidays);
    const weekends = longWeekends(runs);
    const todayISO = iso(ctx.today);
    const ahead = weekends.filter((run) => run.end >= todayISO);
    const shown = ahead.length ? ahead : weekends;

    return shape(request, {
      headline: weekends.length
        ? `${plural(weekends.length, 'long weekend', 'long weekends')} in ${country.name} in ${
            request.year
          }${ahead.length && ahead.length !== weekends.length ? `, ${ahead.length} still ahead` : ''}.`
        : `${country.name} gets no long weekend in ${request.year} — every holiday falls mid-week or on a weekend.`,
      facts: [
        { value: String(weekends.length), label: 'Long weekends', note: `in ${request.year}` },
        { value: String(ahead.length), label: 'Still ahead', note: `after ${formatShort(ctx.today)}` },
        {
          value: shown.length ? String(Math.max(...shown.map((run) => run.days))) : '0',
          label: 'Longest',
          note: 'consecutive days off',
        },
      ],
      prose: [
        `A long weekend here means three or more consecutive days off, counting Saturdays, Sundays and public holidays but no booked leave.`,
        shown.length
          ? `The next one runs ${shown[0].start} to ${shown[0].end} — ${plural(
              shown[0].days,
              'day',
              'days',
            )}, on ${shown[0].holidays.map((h) => h.name).join(' and ') || 'the weekend alone'}.`
          : 'Booking a single day of leave is the only way to make one; the leave planner works out which day.',
      ],
      table: shown.length
        ? {
            caption: `Long weekends in ${country.name}, ${request.year}`,
            columns: [{ label: 'From' }, { label: 'To' }, { label: 'Days', numeric: true }, { label: 'Holiday' }],
            rows: shown.slice(0, 12).map((run) => [
              run.start,
              run.end,
              String(run.days),
              run.holidays.map((h) => h.name).join(', '),
            ]),
          }
        : null,
      links: [
        { label: `${country.name} leave planner`, href: ctx.url.leave(country.code) },
        { label: `${country.name} ${request.year}`, href: ctx.url.year(country.code, request.year) },
      ],
      sources: [{ code: country.code, name: country.name, year: request.year }],
      followUps: [
        `I have 12 days of annual leave in ${country.name} in ${request.year}`,
        `How many public holidays does ${country.name} have in ${request.year}?`,
      ],
    });
  },

  list(request, ctx) {
    const country = tableFor(ctx.data, request.countries[0], request.year);
    if (!country || country.missing) {
      return unanswered(request, `No ${request.year} holiday table for that country on this site.`);
    }

    const month = request.month;
    const prefix = month ? `${request.year}-${String(month).padStart(2, '0')}` : `${request.year}-`;
    const rows = country.holidays.filter((holiday) => holiday.date.startsWith(prefix));
    const where = month ? `${MONTH_NAMES[month - 1]} ${request.year}` : String(request.year);

    return shape(request, {
      headline: rows.length
        ? `${plural(rows.length, 'public holiday', 'public holidays')} in ${country.name} in ${where}.`
        : `${country.name} has no public holiday in ${where}.`,
      facts: [
        { value: String(rows.length), label: 'Holidays', note: where },
        {
          value: String(rows.filter((h) => !isWeekend(parseISO(h.date))).length),
          label: 'On a weekday',
          note: 'actual days off work',
        },
        {
          value: String(rows.filter((h) => h.national === false).length),
          label: 'Regional only',
          note: 'not observed nationwide',
        },
      ],
      prose: [
        rows.length
          ? `${where} in ${country.name}: ${rows.map((h) => h.name).join(', ')}.`
          : `Nothing on the ${country.name} list falls in ${where}.`,
        rows.length && rows.some((h) => explain(h.name))
          ? explain(rows.find((h) => explain(h.name)).name)
          : '',
      ].filter(Boolean),
      table: rows.length
        ? {
            caption: `${country.name}, ${where}`,
            columns: [{ label: 'Date' }, { label: 'Holiday' }, { label: 'Weekday' }, { label: 'Scope' }],
            rows: rows.map((holiday) => {
              const at = parseISO(holiday.date);
              return [
                holiday.date,
                holiday.name,
                WEEKDAY_NAMES[at.getUTCDay()],
                holiday.national === false ? 'Regional' : 'National',
              ];
            }),
          }
        : null,
      links: [{ label: `${country.name} ${request.year}`, href: ctx.url.year(country.code, request.year) }],
      sources: [{ code: country.code, name: country.name, year: request.year }],
      followUps: [
        `Long weekends in ${country.name} in ${request.year}`,
        `When is the next public holiday in ${country.name}?`,
      ],
    });
  },

  'year-count'(request, ctx) {
    const country = tableFor(ctx.data, request.countries[0], request.year);
    if (!country || country.missing) {
      return unanswered(request, `No ${request.year} holiday table for that country on this site.`);
    }

    const stats = country.stats || yearStats(request.year, country.holidays, ctx.today);
    const weekends = longWeekends(offRuns(request.year, country.holidays));

    return shape(request, {
      headline: `${country.name} lists ${plural(
        stats.total,
        'public holiday',
        'public holidays',
      )} in ${request.year}, leaving ${stats.workingDays} working days.`,
      facts: [
        { value: String(stats.total), label: 'Public holidays', note: `${stats.nationalCount} national` },
        { value: String(stats.workingDays), label: 'Working days', note: 'weekends and holidays removed' },
        { value: String(stats.weekendHolidays.length), label: 'Lost to weekends', note: 'holidays on a Sat or Sun' },
        { value: String(weekends.length), label: 'Long weekends', note: 'three days off in a row' },
      ],
      prose: [
        `Of the ${stats.total} holidays on the ${country.name} list for ${request.year}, ${
          stats.weekendHolidays.length
        } fall at the weekend and buy nobody a day off. That leaves ${
          stats.workingDays
        } working days in the year.`,
        stats.weekendHolidays.length
          ? `Wasted on a weekend: ${stats.weekendHolidays.map((h) => `${h.name} (${h.weekday})`).join(', ')}.`
          : 'Every holiday this year falls on a weekday.',
      ],
      table: null,
      links: [
        { label: `${country.name} ${request.year}`, href: ctx.url.year(country.code, request.year) },
        { label: `${country.name} leave planner`, href: ctx.url.leave(country.code) },
      ],
      sources: [{ code: country.code, name: country.name, year: request.year }],
      followUps: [
        `Long weekends in ${country.name} in ${request.year}`,
        `Public holidays in ${country.name} in December`,
      ],
    });
  },

  explain(request, ctx) {
    const text = explain(request.term);
    if (!text) {
      return unanswered(
        request,
        `There is no entry for "${request.term}" — this site explains holidays by name, and only the ones it can describe accurately.`,
        ['What is Boxing Day?', 'What is Thanksgiving?'],
      );
    }
    // The explanation is the answer, so it leads: the first sentence is the
    // headline and the rest follows it, rather than the bare name leading and
    // saying nothing.
    const stop = text.indexOf('. ');
    const headline = stop > 0 ? text.slice(0, stop + 1) : text;
    const rest = stop > 0 ? text.slice(stop + 2) : '';

    return shape(request, {
      headline: `${request.term.replace(/^./, (c) => c.toUpperCase())}: ${headline}`,
      facts: [],
      prose: rest ? [rest] : [],
      table: null,
      links: [{ label: 'Browse every country', href: ctx.url.countries() }],
      sources: [],
      followUps: ['When is the next public holiday in Japan?', 'Long weekends in Spain next year'],
    });
  },
};

/**
 * Answer an interpreted question.
 *
 * @param {ReturnType<typeof interpret>} request
 * @param {{
 *   data: Map<string, any>|object,
 *   today: Date|string,
 *   url: object,
 * }} context
 */
export function answer(request, context) {
  const ctx = {
    ...context,
    today: context.today instanceof Date ? context.today : parseISO(context.today),
  };

  if (request.needs) {
    return {
      ...unanswered(request, request.needs.message),
      needs: request.needs,
      followUps: CAPABILITIES.slice(0, 4).map((entry) => entry.example),
    };
  }

  const handler = HANDLERS[request.intent];
  if (!handler) {
    return {
      ...unanswered(request, 'That one is outside what this page can work out.'),
      needs: { kind: 'question', message: 'Try one of these instead.' },
      followUps: CAPABILITIES.slice(0, 4).map((entry) => entry.example),
    };
  }

  const result = handler(request, ctx);
  if (!request.yearInRange && result.ok) {
    result.prose = [
      ...result.prose,
      `This site holds ${ctx.years ? ctx.years.join(', ') : 'a limited range of years'}, so the answer was worked out for ${request.year}.`,
    ];
  }
  return result;
}

/**
 * The whole round trip, for a caller that already holds every country's data —
 * which is the generator, and nobody else.
 */
export function ask(text, context) {
  const request = interpret(text, context);
  return { request, answer: answer(request, context) };
}

export default ask;
