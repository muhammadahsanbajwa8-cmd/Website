/**
 * Country-scoped pages: the year page, the country hub, and the calculator.
 */

import config from '../../site.config.mjs';
import { WEEKDAY_NAMES, formatLong, iso, isWeekend, parseISO, utc } from '../dates.mjs';
import { explain } from '../glossary.mjs';
import { adSlot, esc, jsonScript, layout, url } from '../html.mjs';
import { ribbonLegend, yearRibbon } from '../ribbon.mjs';

const plural = (count, one, many) => `${count.toLocaleString('en')} ${count === 1 ? one : many}`;

function holidayMap(holidays) {
  return new Map(holidays.map((holiday) => [holiday.date, holiday]));
}

/**
 * A holiday's name, and behind it what the day is for.
 *
 * Two different kinds of answer, both true. The glossary says what the
 * occasion is, where the site can say so reliably; the rule says how the date
 * is arrived at, which is derivable for every computed holiday. A holiday the
 * glossary does not know still gets the second half rather than nothing.
 */
function holidayDetail(holiday, country) {
  const why = explain(holiday.name);
  const lines = [];

  if (why) lines.push(why);
  if (holiday.basis) lines.push(holiday.basis);
  if (holiday.observedFrom) {
    lines.push(
      `The holiday itself falls on ${formatLong(
        parseISO(holiday.observedFrom),
      )}. Because that is a weekend, ${esc(country.name)} observes it on this date instead.`,
    );
  }
  if (holiday.estimated) {
    lines.push(
      'This date is an estimate. It is computed from the arithmetic lunar calendar and the observed date, which depends on the sighting of the moon, can fall a day either side.',
    );
  }
  if (holiday.national === false) {
    lines.push('Observed in part of the country rather than nationwide, so it is not subtracted from the working-day count.');
  }

  const label = `${esc(holiday.name)}${
    holiday.localName ? `<br><span class="note mono">${esc(holiday.localName)}</span>` : ''
  }`;
  if (!lines.length) return label;

  return `<details class="event holiday-why">
    <summary><span class="event__name">${label}</span></summary>
    <div class="event__detail">${lines.map((line) => `<p>${esc(line)}</p>`).join('')}</div>
  </details>`;
}

function holidayTable(holidays, caption, country) {
  const rows = holidays
    .map((holiday) => {
      const date = parseISO(holiday.date);
      const weekend = isWeekend(date);
      // The id makes every date deep-linkable, which is what the comparison
      // pages point at when you click a shared holiday.
      return `<tr class="${weekend ? 'is-weekend' : ''}" id="${esc(holiday.date)}">
      <td class="date">${esc(holiday.date)}</td>
      <td class="day">${esc(WEEKDAY_NAMES[date.getUTCDay()])}</td>
      <td>${holidayDetail(holiday, country)}</td>
      <td><span class="tag ${holiday.national !== false ? 'tag--national' : ''}">${
        holiday.national !== false ? 'National' : 'Regional'
      }</span></td>
    </tr>`;
    })
    .join('\n');

  return `<div class="table-scroll">
  <table>
    <caption>${esc(caption)}</caption>
    <thead><tr><th scope="col">Date</th><th scope="col">Weekday</th><th scope="col">Holiday</th><th scope="col">Scope</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4">No holiday data for this year.</td></tr>'}</tbody>
  </table>
</div>`;
}

/**
 * Says plainly when a country's list is the principal national holidays rather
 * than a complete one. A working-day count from a partial list is an upper
 * bound, and a reader deserves to know that before relying on the number.
 */
function coverageNote(country) {
  if (country.coverage !== 'core') return '';
  return `<div class="wrap">
    <p class="coverage-note" role="note"><strong>Principal national holidays only.</strong>
      ${esc(country.name)} is covered by computed rules rather than a published list, so regional
      holidays and some national ones are missing. Treat the working-day count as an upper bound —
      the real figure is usually lower. <a href="${url.about()}">How this is built →</a></p>
  </div>`;
}

function yearChips(country, years, activeYear) {
  return `<ul class="chips">${years
    .map(
      (year) =>
        `<li><a class="chip" href="${url.year(country.code, year)}"${
          year === activeYear ? ' aria-current="page"' : ''
        }>${year}</a></li>`,
    )
    .join('')}</ul>`;
}

/** The money page: one country, one year. */
export function renderYearPage({ country, year, holidays, stats, years, origin, today }) {
  const title = `Public holidays in ${country.name} ${year}`;
  const gapMonths = (stats.longestGap.days / 30.44).toFixed(1);

  const description =
    `${plural(stats.total, 'public holiday', 'public holidays')} in ${country.name} in ${year}, ` +
    `with dates, weekdays and ${stats.workingDays.toLocaleString('en')} working days. ` +
    `${
      stats.weekendHolidayCount
        ? `${plural(stats.weekendHolidayCount, 'holiday falls', 'holidays fall')} on a weekend.`
        : 'None of them fall on a weekend.'
    }`;

  const weekendDetail = stats.weekendHolidays.length
    ? `<p>${plural(
        stats.weekendHolidays.length,
        'holiday falls',
        'holidays fall',
      )} on a Saturday or Sunday in ${year}: ${stats.weekendHolidays
        .map((holiday) => `<strong>${esc(holiday.name)}</strong> (${esc(holiday.weekday)} ${esc(holiday.date)})`)
        .join(', ')}. Whether those are made up with a day off in lieu depends on local law and your employer.</p>`
    : `<p>Every public holiday in ${esc(country.name)} in ${year} falls on a weekday, so none of them are lost to a weekend.</p>`;

  const body = `
<section class="hero">
  <div class="wrap">
    <p class="eyebrow">${esc(country.flag)} ${esc(country.name)} · ${year}</p>
    <h1>${esc(title)}</h1>
    <p class="lede hero__lede">${esc(country.name)} has ${plural(
      stats.total,
      'public holiday',
      'public holidays',
    )} in ${year} and ${stats.workingDays.toLocaleString(
      'en',
    )} working days, counting Monday to Friday and taking out the ${plural(
      stats.nationalWeekdayCount,
      'national holiday',
      'national holidays',
    )} that land on a weekday.</p>
    ${yearChips(country, years, year)}
  </div>
</section>

${coverageNote(country)}

<div class="wrap">${adSlot('leaderboard')}</div>

<section class="section">
  <div class="wrap">
    <div class="facts">
      <div class="fact fact--signal">
        <span class="fact__value">${stats.total}</span>
        <span class="fact__label">Public holidays</span>
        <p class="fact__note">${stats.nationalCount} national${
          stats.regionalCount ? `, ${stats.regionalCount} regional` : ''
        }</p>
      </div>
      <div class="fact">
        <span class="fact__value">${stats.workingDays.toLocaleString('en')}</span>
        <span class="fact__label">Working days</span>
        <p class="fact__note">of ${stats.weekdays} weekdays in ${year}</p>
      </div>
      <div class="fact">
        <span class="fact__value">${stats.weekendHolidayCount}</span>
        <span class="fact__label">Fall on a weekend</span>
        <p class="fact__note">${
          stats.weekendHolidayCount ? 'days off absorbed by the weekend' : 'nothing lost to a weekend'
        }</p>
      </div>
      <div class="fact">
        <span class="fact__value">${stats.longestGap.days}</span>
        <span class="fact__label">Longest dry spell</span>
        <p class="fact__note">${gapMonths} months, ${esc(stats.longestGap.from || '')} → ${esc(
          stats.longestGap.to || '',
        )}</p>
      </div>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section__head">
      <h2>The ${year} planner</h2>
      <p class="note mono">${esc(country.flag)} ${esc(country.code)} · ${year}</p>
    </div>
    ${yearRibbon(year, {
      holidays: holidayMap(holidays),
      today,
      label: `${country.name} ${year} wall planner: ${stats.total} public holidays marked across twelve months.`,
    })}
    ${ribbonLegend('country')}
  </div>
</section>

<div class="wrap">${adSlot('inArticle')}</div>

<section class="section">
  <div class="wrap">
    <div class="section__head">
      <h2>Every public holiday in ${esc(country.name)}, ${year}</h2>
      <a href="${url.calculator(country.code)}">Working days calculator →</a>
    </div>
    ${holidayTable(holidays, `${country.name} public holidays ${year}`, country)}
  </div>
</section>

<section class="section">
  <div class="wrap prose">
    <h2>What the ${year} calendar means in practice</h2>
    ${weekendDetail}
    <p>The longest stretch without a public holiday runs ${stats.longestGap.days} days, from
      ${esc(formatLong(parseISO(stats.longestGap.from)))} to
      ${esc(formatLong(parseISO(stats.longestGap.to)))}.
      ${
        stats.busiestMonth.count
          ? `${esc(stats.busiestMonth.name)} is the busiest month with ${plural(
              stats.busiestMonth.count,
              'holiday',
              'holidays',
            )}.`
          : ''
      }</p>
    ${
      stats.nextHoliday
        ? `<p>The next public holiday in this year's list is <strong>${esc(
            stats.nextHoliday.name,
          )}</strong> on ${esc(stats.nextHoliday.when)}.</p>`
        : ''
    }
    <p>Need a count between two specific dates? The
      <a href="${url.calculator(country.code)}">${esc(country.name)} working days calculator</a>
      subtracts these holidays and both weekend days for any range you pick.</p>
    <p class="note">Source: ${
      origin === 'computed'
        ? `dates computed from statutory rules (see <a href="${url.about()}">method</a>)`
        : 'Nager.Date public API, cached at build time'
    }. Regional and local holidays may be incomplete — see the <a href="${url.about()}">limits of the data</a>.</p>
    ${
      holidays.some((holiday) => holiday.estimated)
        ? `<p class="note">Dates marked <em>estimated</em> follow the lunar calendar. They are computed
      arithmetically and the observed date, which depends on the sighting of the moon, can fall a day
      either side. Confirm locally before booking anything around them.</p>`
        : ''
    }
  </div>
</section>
`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: `${country.name} public holidays ${year}`,
    description,
    url: url.absolute(url.year(country.code, year)),
    license: 'https://creativecommons.org/licenses/by/4.0/',
    creator: { '@type': 'Organization', name: config.name, url: config.url },
    isAccessibleForFree: true,
    temporalCoverage: `${year}-01-01/${year}-12-31`,
    spatialCoverage: { '@type': 'Country', name: country.name, identifier: country.code },
    variableMeasured: [
      { '@type': 'PropertyValue', name: 'Public holidays', value: stats.total },
      { '@type': 'PropertyValue', name: 'Working days', value: stats.workingDays },
      { '@type': 'PropertyValue', name: 'Holidays on a weekend', value: stats.weekendHolidayCount },
    ],
    distribution: [
      {
        '@type': 'DataDownload',
        encodingFormat: 'text/html',
        contentUrl: url.absolute(url.year(country.code, year)),
      },
    ],
  };

  return layout({
    title: `${title} — dates, weekdays and working days`,
    description,
    path: url.year(country.code, year),
    body,
    jsonLd,
    breadcrumbs: [
      { name: 'Countries', path: url.countries() },
      { name: country.name, path: url.country(country.code) },
      { name: String(year), path: url.year(country.code, year) },
    ],
  });
}

/** Country hub: pick a year, see what is next. */
export function renderCountryHub({ country, years, byYear, statsByYear, next, currentYear, today }) {
  const currentStats = statsByYear[currentYear];
  // Somewhere sensible to start a comparison from: the first featured country
  // that is not this one.
  const compareWith = (
    config.featured.find((code) => code.toUpperCase() !== country.code) || 'US'
  ).toUpperCase();
  const title = `Public holidays in ${country.name}`;
  const description =
    `Public holiday calendars for ${country.name} from ${years[0]} to ${years.at(-1)}. ` +
    `${currentStats.total} holidays and ${currentStats.workingDays.toLocaleString(
      'en',
    )} working days in ${currentYear}` +
    `${next ? `, next up ${next.name} on ${next.when}.` : '.'}`;

  const summaryRows = years
    .map((year) => {
      const stats = statsByYear[year];
      return `<tr>
      <td class="date"><a href="${url.year(country.code, year)}">${year}</a></td>
      <td class="num">${stats.total}</td>
      <td class="num">${stats.workingDays.toLocaleString('en')}</td>
      <td class="num">${stats.weekendHolidayCount}</td>
      <td class="num">${stats.longestGap.days}</td>
    </tr>`;
    })
    .join('\n');

  const body = `
<section class="hero">
  <div class="wrap">
    <p class="eyebrow">${esc(country.flag)} ${esc(country.region)} · ${esc(country.subregion)}</p>
    <h1>${esc(title)}</h1>
    <p class="lede hero__lede">${
      next
        ? `The next public holiday is <strong>${esc(next.name)}</strong> on ${esc(next.when)}${
            next.daysAway === 0
              ? ' — that is today.'
              : ` — ${plural(next.daysAway, 'day', 'days')} away.`
          }`
        : `Holiday calendars for ${esc(country.name)}.`
    }</p>
    ${yearChips(country, years, currentYear)}
  </div>
</section>

${coverageNote(country)}

<div class="wrap">${adSlot('leaderboard')}</div>

<section class="section">
  <div class="wrap">
    <div class="section__head">
      <h2>${currentYear} at a glance</h2>
      <a href="${url.year(country.code, currentYear)}">Full ${currentYear} calendar →</a>
    </div>
    ${yearRibbon(currentYear, {
      holidays: holidayMap(byYear[currentYear]),
      today,
      label: `${country.name} ${currentYear} wall planner.`,
    })}
    ${ribbonLegend('country')}
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2>Year by year</h2>
    <div class="table-scroll">
      <table>
        <caption>${esc(country.name)} — holidays and working days by year</caption>
        <thead><tr>
          <th scope="col">Year</th><th scope="col">Holidays</th><th scope="col">Working days</th>
          <th scope="col">On a weekend</th><th scope="col">Longest gap (days)</th>
        </tr></thead>
        <tbody>${summaryRows}</tbody>
      </table>
    </div>
    <p class="note">Working days count Monday to Friday and subtract national public holidays that fall on a weekday.</p>
  </div>
</section>

<div class="wrap">${adSlot('inArticle')}</div>

<section class="section">
  <div class="wrap prose">
    <h2>Tools for ${esc(country.name)}</h2>
    <ul>
      <li><a href="${url.leave(country.code)}">Annual leave planner</a> — the days to book so a
        handful of leave days buy the longest possible time off.</li>
      <li><a href="${url.calculator(country.code)}">Working days calculator</a> — business days between any two dates, weekends and ${esc(
        country.name,
      )} public holidays removed, or the date a given number of business days away.</li>
      <li><a href="${url.compareQuery(country.code, compareWith, currentYear)}">Compare ${esc(
        country.name,
      )} with another country</a> — shared days off, long weekends, and the quietest months to travel.</li>
      <li><a href="${url.team()}">Team holiday overlap</a> — put ${esc(
        country.name,
      )} alongside up to five other countries and see which days everyone is actually available.</li>
      ${
        country.events
          ? `<li><a href="${url.countryEvents(country.code, 'all')}">What's on in ${esc(
              country.name,
            )}</a> — ${country.events.counts.all} concerts, comedy shows and events coming up, with the ones landing on a public holiday flagged.</li>`
          : ''
      }
      <li><a href="${url.year(country.code, currentYear)}">${currentYear} holiday calendar</a> — the full table with weekdays and scope.</li>
      <li><a href="${url.today()}">Who is on holiday today</a> — every country with a public holiday right now.</li>
    </ul>
  </div>
</section>
`;

  return layout({
    title: `${title} — calendars ${years[0]}–${years.at(-1)}`,
    description,
    path: url.country(country.code),
    body,
    breadcrumbs: [
      { name: 'Countries', path: url.countries() },
      { name: country.name, path: url.country(country.code) },
    ],
  });
}

/** Client-side business-days calculator for one country. */
export function renderCalculator({ country, years, byYear, today }) {
  const title = `Working days calculator — ${country.name}`;
  const description =
    `Count business days between two dates in ${country.name}. Weekends and ${country.name} ` +
    `public holidays are removed, with a breakdown of exactly which days came out. ` +
    `Runs in your browser; covers ${years[0]}–${years.at(-1)}.`;

  const payload = {
    country: country.code,
    name: country.name,
    holidays: Object.fromEntries(
      years.map((year) => [
        year,
        byYear[year].map((holiday) => ({
          date: holiday.date,
          name: holiday.name,
          national: holiday.national !== false,
        })),
      ]),
    ),
    defaults: {
      start: today,
      end: iso(utc(Number(today.slice(0, 4)), 12, 31)),
    },
  };

  const body = `
<section class="hero">
  <div class="wrap">
    <p class="eyebrow">${esc(country.flag)} ${esc(country.name)}</p>
    <h1>${esc(title)}</h1>
    <p class="lede hero__lede">Business days between two dates, with weekends and ${esc(
      country.name,
    )} public holidays taken out. Everything is computed in your browser — the dates you type never leave this page.</p>
  </div>
</section>

<div class="wrap">${adSlot('leaderboard')}</div>

<section class="section">
  <div class="wrap">
    <div class="calc" id="calc">
      <div class="calc__modes" role="tablist" aria-label="Calculator mode">
        <button type="button" role="tab" id="calc-tab-between" aria-controls="calc-form"
          aria-selected="true" data-mode="between">Between two dates</button>
        <button type="button" role="tab" id="calc-tab-add" aria-controls="calc-form-add"
          aria-selected="false" data-mode="add">Add or subtract days</button>
      </div>

      <form class="calc__form" id="calc-form" role="tabpanel" aria-labelledby="calc-tab-between">
        <div>
          <label for="calc-start">Start date</label>
          <input type="date" id="calc-start" name="start" value="${esc(payload.defaults.start)}" required>
        </div>
        <div>
          <label for="calc-end">End date</label>
          <input type="date" id="calc-end" name="end" value="${esc(payload.defaults.end)}" required>
        </div>
        <label class="calc__check"><input type="checkbox" id="calc-inclusive" checked> Include the end date</label>
        <label class="calc__check"><input type="checkbox" id="calc-regional"> Also subtract regional holidays</label>
        <div class="calc__actions">
          <button type="submit">Count working days</button>
          <button type="button" class="ghost" id="calc-reset">Reset</button>
        </div>
        <p class="note">Covers ${years[0]}–${years.at(-1)}. Ranges up to ten years.</p>
      </form>

      <form class="calc__form" id="calc-form-add" role="tabpanel" aria-labelledby="calc-tab-add" hidden>
        <div>
          <label for="add-start">Starting from</label>
          <input type="date" id="add-start" value="${esc(payload.defaults.start)}" required>
        </div>
        <div>
          <label for="add-count">Business days</label>
          <input type="number" id="add-count" value="30" min="0" max="2500" step="1" required>
        </div>
        <div>
          <label for="add-direction">Direction</label>
          <select id="add-direction">
            <option value="after" selected>after that date</option>
            <option value="before">before that date</option>
          </select>
        </div>
        <label class="calc__check"><input type="checkbox" id="add-regional"> Also skip regional holidays</label>
        <div class="calc__actions">
          <button type="submit">Find the date</button>
        </div>
        <p class="note">Counting starts the next working day, the way notice periods and
          court deadlines are usually written.</p>
      </form>

      <div class="calc__answer" id="calc-output" aria-live="polite">
        <p class="note">Pick two dates to see the count.</p>
      </div>
    </div>
    <noscript><p class="note">This calculator needs JavaScript. The
      <a href="${url.year(country.code, Number(today.slice(0, 4)))}">holiday calendar</a> lists every date instead.</p></noscript>
  </div>
</section>

<div class="wrap">${adSlot('inArticle')}</div>

<section class="section">
  <div class="wrap prose">
    <h2>How the count works</h2>
    <ul>
      <li>Every Saturday and Sunday in the range is removed.</li>
      <li>Every ${esc(country.name)} public holiday that falls on a weekday is removed once — a holiday that lands on a weekend is already accounted for.</li>
      <li>By default only national holidays come out. Tick "also subtract regional holidays" to remove holidays observed in part of the country.</li>
      <li>The end date is counted by default. Untick "include the end date" for an exclusive range, the way contract notice periods are often written.</li>
    </ul>

    <h2>Working out a deadline</h2>
    <p>The second tab answers the other question: not how many working days lie between two dates,
      but what date you land on after a given number of them. "Thirty business days from today"
      is how notice periods, payment terms, statutory response windows and shipping estimates
      are normally written, and counting them by hand across
      ${esc(country.name)}'s public holidays is exactly the sort of thing people get wrong.</p>
    <p>Counting begins on the next working day rather than the day you enter, which is the usual
      convention: day one of "10 business days from Monday" is Tuesday. The answer shows every
      weekend and holiday that was skipped along the way, so you can check the reasoning rather
      than trust the number.</p>

    <p>Looking for the full list? See the
      <a href="${url.country(country.code)}">${esc(country.name)} holiday calendars</a>, or plan a
      year of time off with the
      <a href="${url.leave(country.code)}">${esc(country.name)} annual leave planner</a>.</p>
  </div>
</section>

<script type="application/json" id="holiday-data">${jsonScript(payload)}</script>
`;

  return layout({
    title: `${title} — business days between two dates`,
    description,
    path: url.calculator(country.code),
    body,
    scripts: ['/assets/calculator.js'],
    breadcrumbs: [
      { name: 'Countries', path: url.countries() },
      { name: country.name, path: url.country(country.code) },
      { name: 'Working days calculator', path: url.calculator(country.code) },
    ],
  });
}
