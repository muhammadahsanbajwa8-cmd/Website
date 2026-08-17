/**
 * The annual leave planner, one country at a time.
 *
 * The generator renders a default plan so the page says something useful with
 * JavaScript switched off and to a crawler; the browser re-renders the same
 * markup from the same module when the visitor changes the budget.
 */

import config from '../../site.config.mjs';
import { MAX_BUDGET, STRATEGIES, describeBreak, planLeave } from '../leave.mjs';
import { adSlot, esc, jsonScript, layout, url } from '../html.mjs';
import { ribbonLegend, yearRibbon } from '../ribbon.mjs';

const plural = (count, one, many) => `${count.toLocaleString('en')} ${count === 1 ? one : many}`;

/** 'Mon 21 Dec' — short enough to list a week of them on a phone. */
function shortDay(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[date.getUTCDay()]} ${d} ${months[m - 1]}`;
}

function breakCard(item, index) {
  const booked = item.book
    .map((date) => `<li><span class="mono">${esc(date)}</span> ${esc(shortDay(date))}</li>`)
    .join('');

  const holidays = item.holidays.length
    ? `<p class="note">Public holidays inside it: ${item.holidays
        .map((holiday) => `<strong>${esc(holiday.name)}</strong> (${esc(shortDay(holiday.date))})`)
        .join(', ')}.</p>`
    : '';

  return `<article class="brk">
    <header class="brk__head">
      <span class="brk__index">${index + 1}</span>
      <div>
        <h3 class="brk__title">${esc(item.fromLong)} → ${esc(item.toLong)}</h3>
        <p class="brk__meta"><strong>${item.length} days off</strong> for
          <strong>${plural(item.cost, 'day booked', 'days booked')}</strong>
          <span class="brk__mult">×${item.multiplier.toFixed(1)}</span></p>
      </div>
    </header>
    <p class="brk__prose">${esc(describeBreak(item))}</p>
    ${holidays}
    <details class="brk__book">
      <summary>The ${plural(item.cost, 'day', 'days')} to put in the system</summary>
      <ul class="brk__dates">${booked}</ul>
    </details>
  </article>`;
}

/**
 * The plan itself. Rendered by the generator for the default budget and by the
 * browser whenever the visitor changes anything.
 *
 * @param {ReturnType<typeof planLeave>} plan
 * @param {{country: {code: string, name: string}, today?: string|null}} context
 */
export function leaveBody(plan, context = {}) {
  const country = context.country || { name: 'this country' };
  const today = context.today || null;

  if (!plan.budget) {
    return `<section class="section"><div class="wrap">
      <p class="note">Set how many days of annual leave you get, and this works out where to spend them.</p>
    </div></section>`;
  }

  if (!plan.breaks.length) {
    return `<section class="section"><div class="wrap">
      <p class="calc__error">No break matching that shape fits in ${plan.year} for ${esc(
        country.name,
      )}. Try a larger budget, or the <strong>Long weekends</strong> strategy, which accepts shorter runs.</p>
    </div></section>`;
  }

  const booked = new Set(plan.breaks.flatMap((item) => item.book));
  const inBreak = new Set();
  for (const item of plan.breaks) {
    const [fy, fm, fd] = item.from.split('-').map(Number);
    const [ty, tm, td] = item.to.split('-').map(Number);
    for (
      let t = Date.UTC(fy, fm - 1, fd);
      t <= Date.UTC(ty, tm - 1, td);
      t += 86400000
    ) {
      inBreak.add(new Date(t).toISOString().slice(0, 10));
    }
  }

  const allDates = plan.breaks.flatMap((item) => item.book).sort();

  return `
<section class="section section--tight">
  <div class="wrap">
    <div class="facts">
      <div class="fact fact--signal">
        <span class="fact__value">${plan.daysOff}</span>
        <span class="fact__label">Days off</span>
        <p class="fact__note">across ${plural(plan.breaks.length, 'break', 'breaks')}</p>
      </div>
      <div class="fact">
        <span class="fact__value">${plan.leaveUsed}</span>
        <span class="fact__label">Leave days spent</span>
        <p class="fact__note">${
          plan.leaveLeft ? `${plan.leaveLeft} left over` : 'the whole allowance'
        }</p>
      </div>
      <div class="fact">
        <span class="fact__value">×${plan.multiplier.toFixed(1)}</span>
        <span class="fact__label">Days off per day booked</span>
        <p class="fact__note">${
          plan.multiplier >= 3 ? 'a strong year for it' : 'the calendar is not generous'
        }</p>
      </div>
      <div class="fact">
        <span class="fact__value">${plan.longest}</span>
        <span class="fact__label">Longest single break</span>
        <p class="fact__note">consecutive days away</p>
      </div>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section__head">
      <h2>The ${plan.year} plan</h2>
      <p class="note mono">${plan.leaveUsed} booked · ${plan.daysOff} off</p>
    </div>
    ${yearRibbon(plan.year, {
      holidays: new Map(
        plan.breaks.flatMap((item) => item.holidays.map((h) => [h.date, { name: h.name }])),
      ),
      booked,
      inBreak,
      today,
      label: `${country.name} ${plan.year}: ${plan.breaks.length} planned breaks totalling ${plan.daysOff} days off, bought with ${plan.leaveUsed} days of leave.`,
    })}
    ${ribbonLegend('plan')}
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2>Break by break</h2>
    <div class="brks">${plan.breaks.map(breakCard).join('\n')}</div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2>Every day to book, in order</h2>
    <p class="note">${plural(allDates.length, 'day', 'days')} — the whole plan in one list, for
      pasting into a leave request.</p>
    <ol class="booklist">${allDates
      .map((date) => `<li><span class="mono">${esc(date)}</span> <span>${esc(shortDay(date))}</span></li>`)
      .join('')}</ol>
  </div>
</section>
`;
}

/** The full page. */
export function renderLeavePlanner({ country, years, byYear, currentYear, today }) {
  const defaultBudget = 10;

  // Nobody can book a day that has already gone, so the plan only ever looks
  // forwards. Late in the year that leaves too little to plan against, and the
  // page a visitor lands on would show two thin weeks — so once the remainder
  // gets short, the planner opens on next year instead. That is what a person
  // sitting down to book leave in November is doing anyway.
  const remaining = today
    ? Math.round((Date.UTC(currentYear, 11, 31) - Date.parse(today)) / 86400000)
    : 365;
  const planYear = remaining < 90 && years.includes(currentYear + 1) ? currentYear + 1 : currentYear;

  const holidays = byYear[planYear] || [];
  const plan = planLeave(planYear, holidays, {
    budget: defaultBudget,
    strategy: 'balanced',
    after: today && Number(today.slice(0, 4)) === planYear ? today : null,
  });

  const title = `Annual leave planner — ${country.name}`;
  const description =
    `Work out the best days to book off in ${country.name} in ${planYear}. ` +
    `With ${defaultBudget} days of leave you can be away for ${plan.daysOff} days across ` +
    `${plan.breaks.length} breaks by booking around the public holidays. Runs in your browser.`;

  const payload = {
    code: country.code,
    name: country.name,
    currentYear: planYear,
    years,
    today,
    defaults: { budget: defaultBudget, strategy: 'balanced' },
  };

  const strategyRadios = Object.values(STRATEGIES)
    .map(
      (strategy) => `<label class="pick">
        <input type="radio" name="leave-strategy" value="${esc(strategy.id)}"${
          strategy.id === 'balanced' ? ' checked' : ''
        }>
        <span class="pick__label">${esc(strategy.label)}</span>
        <span class="pick__blurb">${esc(strategy.blurb)}</span>
      </label>`,
    )
    .join('');

  const body = `
<section class="hero">
  <div class="wrap">
    <p class="eyebrow">${esc(country.flag)} ${esc(country.name)} · ${planYear}</p>
    <h1>${esc(title)}</h1>
    <p class="lede hero__lede">A day of leave is worth more next to other days off. Booking the
      Friday after a Thursday public holiday costs one day and buys four. This works out where
      those trades are in ${esc(country.name)}'s ${planYear} calendar, and how far
      ${defaultBudget} days can be stretched.</p>
  </div>
</section>

<div class="wrap">${adSlot('leaderboard')}</div>

<section class="section">
  <div class="wrap">
    <form class="planner" id="leave-form">
      <div class="planner__row">
        <div>
          <label for="leave-budget">Days of leave</label>
          <input type="number" id="leave-budget" min="0" max="${MAX_BUDGET}" step="1" value="${defaultBudget}">
        </div>
        <div>
          <label for="leave-year">Year</label>
          <select id="leave-year">${years
            .map(
              (year) =>
                `<option value="${year}"${year === planYear ? ' selected' : ''}>${year}</option>`,
            )
            .join('')}</select>
        </div>
      </div>
      <fieldset class="planner__picks">
        <legend>How would you rather spend them?</legend>
        ${strategyRadios}
      </fieldset>
      <label class="calc__check"><input type="checkbox" id="leave-regional"> Also treat regional holidays as days off</label>
      <p class="note">Nothing is sent anywhere — the whole plan is worked out in this page.</p>
    </form>
  </div>
</section>

<div id="leave-body" data-code="${esc(country.code)}" data-year="${planYear}">
${leaveBody(plan, { country, today })}
</div>

<div class="wrap">${adSlot('inArticle')}</div>

<section class="section">
  <div class="wrap prose">
    <h2>How this works out the answer</h2>
    <p>It lays ${esc(country.name)}'s ${planYear} calendar out as a strip of 365 days, marks
      every weekend and every public holiday, and then looks at every unbroken run of days off
      that could be created by booking leave. Each run has a price — the working days inside it —
      and a value: how long you end up being away. The plan is the set of runs that buys the most
      time within your allowance.</p>
    <p>It is solved exactly rather than by rule of thumb, so nothing better exists inside the
      limits you set. Change the strategy and the limits change: <strong>Long weekends</strong>
      will only bridge one or two days at a time, <strong>Proper holidays</strong> refuses
      anything shorter than a week, and <strong>Balanced</strong> sets aside part of the budget
      for one real trip before spending the rest on short breaks.</p>

    <h2>Before you book anything</h2>
    <ul>
      <li>This assumes a Monday-to-Friday working week and that public holidays are days you do
        not work. Both are wrong for some jobs and some countries.</li>
      <li>Only national holidays are counted unless you tick the regional box, and regional
        coverage is incomplete for many countries.</li>
      <li>Some employers require leave on a public holiday anyway, and some count a bridge day
        differently. Your contract wins over this page.</li>
      <li>Dates that follow the lunar calendar can move by a day. If a break here is built on
        one, confirm it locally before booking flights.</li>
    </ul>
    <p>See the <a href="${url.year(country.code, planYear)}">${esc(
      country.name,
    )} ${planYear} holiday calendar</a> for the dates this is built from, or the
      <a href="${url.calculator(country.code)}">working days calculator</a> to count a range
      of your own.</p>
  </div>
</section>

<script type="application/json" id="leave-config">${jsonScript(payload)}</script>
`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: title,
    description,
    url: url.absolute(url.leave(country.code)),
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Any',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    creator: { '@type': 'Organization', name: config.name, url: config.url },
  };

  return layout({
    title: `${title} — the best days to book off in ${planYear}`,
    description,
    path: url.leave(country.code),
    body,
    jsonLd,
    modules: ['/assets/leave.js'],
    breadcrumbs: [
      { name: 'Countries', path: url.countries() },
      { name: country.name, path: url.country(country.code) },
      { name: 'Annual leave planner', path: url.leave(country.code) },
    ],
  });
}

export default renderLeavePlanner;
