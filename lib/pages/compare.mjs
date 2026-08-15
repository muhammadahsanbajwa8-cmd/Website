/**
 * Country comparison for trip planning.
 *
 * `compareBody()` is imported by the browser as well as the generator, so the
 * interactive picker on /compare/ produces byte-identical markup to the
 * pre-rendered pair pages. Keep it free of Node APIs and free of ad slots —
 * ads belong to the page shell, which only the generator builds.
 */

import { WEEKDAY_NAMES, formatShort, parseISO } from '../dates.mjs';
import { adSlot, esc, jsonScript, layout, url } from '../html.mjs';
import { ribbonLegend, twinRibbon } from '../ribbon.mjs';

const plural = (count, one, many) => `${count.toLocaleString('en')} ${count === 1 ? one : many}`;

function holidayMap(holidays) {
  return new Map(holidays.map((holiday) => [holiday.date, holiday]));
}

/** A link to the exact date on a country's year page. */
function dateLink(code, date, text) {
  return `<a href="${url.holiday(code, date)}">${esc(text || date)}</a>`;
}

function highlightCards(result) {
  return `<ul class="highlights">${result.highlights
    .map(
      (item) => `<li class="highlight highlight--${esc(item.key)}">
      <p class="highlight__headline">${esc(item.headline)}</p>
      <p class="highlight__detail">${esc(item.detail)}</p>
    </li>`,
    )
    .join('')}</ul>`;
}

function headToHead(result) {
  const { a, b, year } = result;
  const row = (label, aValue, bValue, note) => {
    const aNum = Number(aValue);
    const bNum = Number(bValue);
    const aWins = Number.isFinite(aNum) && Number.isFinite(bNum) && aNum > bNum;
    const bWins = Number.isFinite(aNum) && Number.isFinite(bNum) && bNum > aNum;
    return `<tr>
      <th scope="row">${esc(label)}${note ? `<span class="note"> ${esc(note)}</span>` : ''}</th>
      <td class="num${aWins ? ' is-more' : ''}">${esc(String(aValue))}</td>
      <td class="num${bWins ? ' is-more' : ''}">${esc(String(bValue))}</td>
    </tr>`;
  };

  return `<div class="table-scroll">
  <table class="versus">
    <caption>${esc(a.name)} versus ${esc(b.name)}, ${year}</caption>
    <thead><tr>
      <th scope="col">Measure</th>
      <th scope="col"><a href="${url.year(a.code, year)}">${esc(a.flag)} ${esc(a.name)}</a></th>
      <th scope="col"><a href="${url.year(b.code, year)}">${esc(b.flag)} ${esc(b.name)}</a></th>
    </tr></thead>
    <tbody>
      ${row('Public holidays', a.stats.total, b.stats.total)}
      ${row('National holidays', a.stats.nationalCount, b.stats.nationalCount)}
      ${row('Working days', a.stats.workingDays, b.stats.workingDays, '(Mon–Fri, holidays removed)')}
      ${row('Holidays on a weekend', a.stats.weekendHolidayCount, b.stats.weekendHolidayCount)}
      ${row('Long weekends', a.longWeekends.length, b.longWeekends.length, '(3 days or more)')}
      ${row('Longest run with no holiday', a.stats.longestGap.days, b.stats.longestGap.days, '(days)')}
    </tbody>
  </table>
</div>`;
}

function sharedTable(result) {
  const { a, b, shared, year } = result;
  if (!shared.length) {
    return `<p class="note">No date in ${year} is a public holiday in both countries. If you need one office open while you travel in the other, that is good news — check the
      <a href="${url.calculator(a.code)}">${esc(a.name)}</a> and
      <a href="${url.calculator(b.code)}">${esc(b.name)}</a> working-day calculators.</p>`;
  }

  return `<div class="table-scroll">
  <table>
    <caption>Days both countries are on holiday, ${year}</caption>
    <thead><tr>
      <th scope="col">Date</th><th scope="col">Weekday</th>
      <th scope="col">${esc(a.name)} calls it</th><th scope="col">${esc(b.name)} calls it</th>
    </tr></thead>
    <tbody>${shared
      .map(
        (item) => `<tr class="${item.weekend ? 'is-weekend' : ''}">
      <td class="date">${dateLink(a.code, item.date)}</td>
      <td class="day">${esc(item.weekday)}</td>
      <td>${dateLink(a.code, item.date, item.a.name)}</td>
      <td>${
        item.sameName
          ? '<span class="note">same holiday</span>'
          : dateLink(b.code, item.date, item.b.name)
      }</td>
    </tr>`,
      )
      .join('')}</tbody>
  </table>
</div>`;
}

function breakList(country, year) {
  if (!country.longWeekends.length) {
    return `<p class="note">No public holiday in ${esc(
      country.name,
    )} creates a three-day weekend in ${year}.</p>`;
  }
  return `<ul class="breaks">${country.longWeekends
    .map(
      (item) => `<li>
      <span class="breaks__days mono">${item.days}d</span>
      <span class="breaks__when">${dateLink(country.code, item.start, item.label)}</span>
      <span class="breaks__why">${esc(item.names.join(', '))}</span>
    </li>`,
    )
    .join('')}</ul>`;
}

function bridgeList(country) {
  if (!country.bridges.length) return '';
  return `<div class="bridges">
    <h4>${esc(country.flag)} ${esc(country.name)} — days worth booking</h4>
    <ul class="breaks">${country.bridges
      .slice(0, 4)
      .map(
        (item) => `<li>
        <span class="breaks__days mono">${item.totalDays}d</span>
        <span class="breaks__when">${esc(item.label)}</span>
        <span class="breaks__why">book ${item.bridge
          .map((date) => dateLink(country.code, date, formatShort(parseISO(date))))
          .join(' + ')} — ${plural(item.daysOff, 'day off', 'days off')} for ${
          item.totalDays
        } away</span>
      </li>`,
      )
      .join('')}</ul>
  </div>`;
}

function monthStrip(result) {
  const { a, b, months } = result;
  const peak = Math.max(1, ...months.map((month) => Math.max(month.a, month.b)));
  return `<div class="months" role="table" aria-label="Public holidays per month">
    ${months
      .map(
        (month) => `<div class="months__col" role="row">
      <span class="months__bars">
        <i class="months__bar months__bar--a" style="--h:${(month.a / peak).toFixed(
          3,
        )}" title="${esc(a.name)}: ${plural(month.a, 'holiday', 'holidays')} in ${esc(
          month.name,
        )}"></i>
        <i class="months__bar months__bar--b" style="--h:${(month.b / peak).toFixed(
          3,
        )}" title="${esc(b.name)}: ${plural(month.b, 'holiday', 'holidays')} in ${esc(
          month.name,
        )}"></i>
      </span>
      <span class="months__label mono">${esc(month.short)}</span>
      <span class="months__count mono">${month.a}·${month.b}</span>
    </div>`,
      )
      .join('')}
  </div>
  <p class="legend">
    <span class="legend__item"><i class="swatch swatch--holiday"></i>${esc(a.name)}</span>
    <span class="legend__item"><i class="swatch swatch--b"></i>${esc(b.name)}</span>
  </p>`;
}

function onlyList(country, holidays, year) {
  if (!holidays.length) {
    return `<p class="note">Every ${esc(country.name)} holiday in ${year} is also observed in the other country.</p>`;
  }
  return `<ul class="only-list">${holidays
    .map(
      (holiday) => `<li>
      <span class="mono">${esc(holiday.date)}</span>
      ${dateLink(country.code, holiday.date, holiday.name)}
      <span class="note">${esc(WEEKDAY_NAMES[parseISO(holiday.date).getUTCDay()])}</span>
    </li>`,
    )
    .join('')}</ul>`;
}

/**
 * The comparison itself. Rendered by the generator for pair pages and by the
 * browser for any other pairing.
 *
 * @param {object} result output of compareCountries()
 * @param {{today?: string, years?: number[]}} options
 */
export function compareBody(result, options = {}) {
  const { a, b, year } = result;
  const years = options.years || [year];
  const today = options.today || null;

  const yearChips = `<ul class="chips" data-role="year-switch">${years
    .map(
      (item) =>
        `<li><a class="chip" href="${url.compareQuery(a.code, b.code, item)}" data-year="${item}"${
          item === year ? ' aria-current="page"' : ''
        }>${item}</a></li>`,
    )
    .join('')}</ul>`;

  return `
<section class="section section--tight">
  <div class="wrap">
    ${years.length > 1 ? yearChips : ''}
    <h2 class="visually-hidden">Highlights</h2>
    ${highlightCards(result)}
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section__head">
      <h2>Head to head, ${year}</h2>
      <p class="note mono">${esc(a.code)} · ${esc(b.code)}</p>
    </div>
    ${headToHead(result)}
    <p class="note">Working days count Monday to Friday and remove national holidays that fall on a
      weekday. Full detail on the
      <a href="${url.year(a.code, year)}">${esc(a.name)} ${year}</a> and
      <a href="${url.year(b.code, year)}">${esc(b.name)} ${year}</a> pages.</p>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section__head">
      <h2>Both calendars on one planner</h2>
      <p class="note mono">${year}</p>
    </div>
    ${twinRibbon(
      year,
      { code: a.code, name: a.name, holidays: holidayMap(a.holidays) },
      { code: b.code, name: b.name, holidays: holidayMap(b.holidays) },
      { today },
    )}
    ${ribbonLegend('twin')}
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2>When you are both off</h2>
    <p>${
      result.shared.length
        ? `${plural(result.shared.length, 'date is', 'dates are')} a public holiday in both countries in ${year}. Expect closures, higher fares and busier roads on these days in both places at once.`
        : `The two calendars never collide in ${year}.`
    }</p>
    ${sharedTable(result)}
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section__head">
      <h2>Windows worth planning around</h2>
      <p class="note">breaks of three days or more</p>
    </div>
    ${
      result.sharedBreaks.length
        ? `<p>${plural(
            result.sharedBreaks.length,
            'window',
            'windows',
          )} where both countries are on a long break at the same time: ${result.sharedBreaks
            .map((window) => `<strong>${esc(window.label)}</strong>`)
            .join(', ')}.</p>`
        : `<p>No window in ${year} has both countries on a long break at the same time.</p>`
    }
    <div class="split">
      <div>
        <h3>${esc(a.flag)} ${esc(a.name)}</h3>
        ${breakList(a, year)}
      </div>
      <div>
        <h3>${esc(b.flag)} ${esc(b.name)}</h3>
        ${breakList(b, year)}
      </div>
    </div>
    ${bridgeList(a)}
    ${bridgeList(b)}
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section__head">
      <h2>Month by month</h2>
      <p class="note">quietest: ${esc(result.quietest.name)} · busiest: ${esc(result.busiest.name)}</p>
    </div>
    ${monthStrip(result)}
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2>What only one side observes</h2>
    <div class="split">
      <div>
        <h3>${esc(a.flag)} Only in ${esc(a.name)}</h3>
        ${onlyList(a, result.onlyA, year)}
      </div>
      <div>
        <h3>${esc(b.flag)} Only in ${esc(b.name)}</h3>
        ${onlyList(b, result.onlyB, year)}
      </div>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2>Research either country</h2>
    <div class="grid">
      <a class="card" href="${url.country(a.code)}">
        <span class="card__name">${esc(a.flag)} ${esc(a.name)}</span>
        <span class="card__meta">Every year, next holiday, full calendars</span>
      </a>
      <a class="card" href="${url.country(b.code)}">
        <span class="card__name">${esc(b.flag)} ${esc(b.name)}</span>
        <span class="card__meta">Every year, next holiday, full calendars</span>
      </a>
      <a class="card" href="${url.calculator(a.code)}">
        <span class="card__name">${esc(a.name)} working days</span>
        <span class="card__meta">Count business days for your trip dates</span>
      </a>
      <a class="card" href="${url.calculator(b.code)}">
        <span class="card__name">${esc(b.name)} working days</span>
        <span class="card__meta">Count business days for your trip dates</span>
      </a>
    </div>
  </div>
</section>
`;
}

/** A pre-rendered pair page: /compare/{a}-vs-{b}/ */
export function renderComparePair({ result, years, today }) {
  const { a, b, year } = result;
  const title = `${a.name} vs ${b.name} — public holidays and trip timing ${year}`;
  const description =
    `Compare public holidays and working days in ${a.name} and ${b.name} for ${year}: ` +
    `${a.stats.total} holidays against ${b.stats.total}, ` +
    `${result.shared.length} ${result.shared.length === 1 ? 'day' : 'days'} off in common, ` +
    `and the long weekends worth planning a trip around.`;

  const body = `
<section class="hero hero--compare">
  <div class="wrap">
    <p class="eyebrow">Compare · ${year}</p>
    <h1>${esc(a.flag)} ${esc(a.name)} <span class="versus-mark">vs</span> ${esc(b.flag)} ${esc(
      b.name,
    )}</h1>
    <p class="lede hero__lede">${esc(result.highlights[0].detail)} ${esc(
      result.highlights[2].detail,
    )}</p>
    <p><a href="${url.compare()}">Compare two different countries →</a></p>
  </div>
</section>

<div class="wrap">${adSlot('leaderboard')}</div>

<div id="compare-body" data-a="${esc(a.code)}" data-b="${esc(b.code)}" data-year="${year}">
${compareBody(result, { years, today })}
</div>

<div class="wrap">${adSlot('inArticle')}</div>

<section class="section">
  <div class="wrap prose">
    <h2>How to read this</h2>
    <p>Everything here is computed from the two countries' published holiday calendars — no
      opinions about which country is better, only what the dates say. A day that is a public
      holiday in both places usually means closures on both ends of a trip; a long weekend in the
      country you are visiting means domestic travel is busy and prices rise.</p>
    <p>Working-day counts assume a Monday-to-Friday week. Regional holidays are marked separately
      and are not subtracted from the working-day totals; see the
      <a href="${url.about()}">limits of the data</a>.</p>
  </div>
</section>
`;

  return layout({
    title,
    description,
    path: url.pair(a.code, b.code),
    body,
    modules: ['/assets/compare.js'],
    breadcrumbs: [
      { name: 'Compare', path: url.compare() },
      { name: `${a.name} vs ${b.name}`, path: url.pair(a.code, b.code) },
    ],
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Dataset',
      name: `${a.name} and ${b.name} public holidays compared, ${year}`,
      description,
      url: url.absolute(url.pair(a.code, b.code)),
      isAccessibleForFree: true,
      temporalCoverage: `${year}-01-01/${year}-12-31`,
      spatialCoverage: [
        { '@type': 'Country', name: a.name, identifier: a.code },
        { '@type': 'Country', name: b.name, identifier: b.code },
      ],
      variableMeasured: [
        { '@type': 'PropertyValue', name: `${a.name} public holidays`, value: a.stats.total },
        { '@type': 'PropertyValue', name: `${b.name} public holidays`, value: b.stats.total },
        { '@type': 'PropertyValue', name: 'Shared days off', value: result.shared.length },
      ],
    },
  });
}

/** The comparison hub: pick any two countries. */
export function renderCompareIndex({ countries, years, currentYear, pairs }) {
  const description =
    `Compare public holidays and working days in any two of ${countries.length} countries. ` +
    `See the days you are both off, each side's long weekends, and the quietest months to travel.`;

  const options = (selected) =>
    countries
      .map(
        (country) =>
          `<option value="${esc(country.code)}"${
            country.code === selected ? ' selected' : ''
          }>${esc(country.flag)} ${esc(country.name)}</option>`,
      )
      .join('');

  const body = `
<section class="hero">
  <div class="wrap">
    <p class="eyebrow">Trip planning · ${countries.length} countries</p>
    <h1>Compare two countries</h1>
    <p class="lede hero__lede">Pick any two. You get the days you would both be off, each side's
      long weekends, the single days worth booking to stretch a break, and the quietest months to
      travel — all computed from published holiday calendars.</p>

    <form class="compare-picker" id="compare-picker">
      <div>
        <label for="pick-a">Country A</label>
        <select id="pick-a" name="a">${options(countries[0]?.code)}</select>
      </div>
      <p class="versus-mark" aria-hidden="true">vs</p>
      <div>
        <label for="pick-b">Country B</label>
        <select id="pick-b" name="b">${options(countries[1]?.code)}</select>
      </div>
      <div>
        <label for="pick-year">Year</label>
        <select id="pick-year" name="year">${years
          .map(
            (year) =>
              `<option value="${year}"${year === currentYear ? ' selected' : ''}>${year}</option>`,
          )
          .join('')}</select>
      </div>
      <button type="submit">Compare</button>
    </form>
    <noscript><p class="note">Choosing countries needs JavaScript. The ready-made comparisons below
      work without it.</p></noscript>
  </div>
</section>

<div class="wrap">${adSlot('leaderboard')}</div>

<div id="compare-body" data-state="empty">
  <section class="section">
    <div class="wrap">
      <p class="note" id="compare-status">Pick two countries above to see the comparison.</p>
    </div>
  </section>
</div>

<section class="section" id="ready-made">
  <div class="wrap">
    <h2>Ready-made comparisons</h2>
    <p>Popular pairings, pre-built for ${currentYear}.</p>
    <div class="grid">${pairs
      .map(
        (pair) => `<a class="card" href="${url.pair(pair.a.code, pair.b.code)}">
        <span class="card__name">${esc(pair.a.flag)} ${esc(pair.a.name)} vs ${esc(
          pair.b.flag,
        )} ${esc(pair.b.name)}</span>
        <span class="card__meta">${pair.a.stats.total} vs ${pair.b.stats.total} holidays · ${
          pair.shared
        } days off in common</span>
      </a>`,
      )
      .join('')}</div>
  </div>
</section>

<div class="wrap">${adSlot('inArticle')}</div>

<section class="section">
  <div class="wrap prose">
    <h2>What a comparison tells you</h2>
    <ul>
      <li><strong>Days you are both off</strong> — offices, banks and many attractions close on both
        ends of the trip at once.</li>
      <li><strong>Long weekends in the country you are visiting</strong> — domestic travel peaks,
        so book earlier and expect higher prices.</li>
      <li><strong>Days worth booking</strong> — a single day off next to a holiday can turn a
        weekend into four or more days away.</li>
      <li><strong>The quietest month</strong> — fewest public holidays across both countries, which
        usually means the least disruption.</li>
    </ul>
    <p>Every date links through to the full calendar for that country and year, so you can check the
      detail before you book. <a href="${url.about()}">How the data is built →</a></p>
  </div>
</section>
`;

  return layout({
    title: 'Compare two countries — public holidays and trip timing',
    description,
    path: url.compare(),
    body,
    modules: ['/assets/compare.js'],
    breadcrumbs: [{ name: 'Compare', path: url.compare() }],
    head: `<script type="application/json" id="compare-config">${jsonScript({
      years,
      currentYear,
    })}</script>`,
  });
}
