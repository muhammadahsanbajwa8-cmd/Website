/**
 * The team overlap view: several countries on one planner, and the days that
 * quietly go wrong when you schedule across them.
 */

import config from '../../site.config.mjs';
import { formatLong, parseISO } from '../dates.mjs';
import { adSlot, esc, jsonScript, layout, url } from '../html.mjs';
import { ribbonLegend, teamRibbon } from '../ribbon.mjs';
import { MAX_MEMBERS, clearRuns } from '../team.mjs';

const plural = (count, one, many) => `${count.toLocaleString('en')} ${count === 1 ? one : many}`;

function absenceRows(absences) {
  return absences
    .map((entry) => {
      const away = entry.away
        .map(
          (member) =>
            `<span class="who" title="${esc(member.holiday)}">${esc(member.flag)} ${esc(
              member.code,
            )}</span>`,
        )
        .join(' ');
      const reasons = [...new Set(entry.away.map((member) => member.holiday))].join(', ');
      return `<tr class="${entry.everyone ? 'is-all' : ''}${entry.past ? ' is-past' : ''}">
        <td class="date">${esc(entry.date)}</td>
        <td>${away}</td>
        <td>${esc(reasons)}</td>
        <td class="num">${entry.away.length}</td>
      </tr>`;
    })
    .join('\n');
}

/**
 * The overlap itself — rendered by the generator for the default team, and by
 * the browser whenever the visitor changes the line-up.
 *
 * @param {ReturnType<import('../team.mjs').teamOverlap>} overlap
 * @param {{today?: string|null, years?: number[]}} [options]
 */
export function teamBody(overlap, options = {}) {
  const today = options.today || null;

  if (overlap.sides.length < 2) {
    return `<section class="section"><div class="wrap">
      <p class="note">Pick at least two countries to see where their calendars collide.</p>
    </div></section>`;
  }

  const runs = clearRuns(overlap, 5);
  const names = overlap.sides.map((side) => side.name);
  const readable = names.length === 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

  return `
<section class="section section--tight">
  <div class="wrap">
    <div class="facts">
      <div class="fact fact--signal">
        <span class="fact__value">${overlap.fullyStaffed}</span>
        <span class="fact__label">Days everyone is working</span>
        <p class="fact__note">of ${overlap.weekdays} weekdays in ${overlap.year}</p>
      </div>
      <div class="fact">
        <span class="fact__value">${overlap.partial}</span>
        <span class="fact__label">Days someone is away</span>
        <p class="fact__note">at least one country on holiday</p>
      </div>
      <div class="fact">
        <span class="fact__value">${overlap.everyoneOff.length}</span>
        <span class="fact__label">Days everyone is off</span>
        <p class="fact__note">${
          overlap.everyoneOff.length
            ? overlap.everyoneOff.map((entry) => entry.date).slice(0, 2).join(', ')
            : 'no holiday is shared by all'
        }</p>
      </div>
      <div class="fact">
        <span class="fact__value">${Math.round(overlap.coverage * 100)}%</span>
        <span class="fact__label">Full attendance</span>
        <p class="fact__note">share of the working year</p>
      </div>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section__head">
      <h2>${overlap.year} across the team</h2>
      <p class="note mono">${overlap.sides.map((side) => side.code).join(' · ')}</p>
    </div>
    ${teamRibbon(overlap.year, overlap.sides, { today })}
    ${ribbonLegend('team')}
  </div>
</section>

<section class="section">
  <div class="wrap prose">
    <h2>What the year looks like</h2>
    <p>Across ${esc(readable)} there are <strong>${overlap.fullyStaffed}</strong> working days in
      ${overlap.year} when nobody is on a public holiday, out of ${overlap.weekdays} weekdays.
      On the other <strong>${overlap.partial}</strong>, at least one country is off — those are
      the days a meeting quietly loses half its attendees.</p>
    ${
      overlap.clearestMonth
        ? `<p><strong>${esc(overlap.clearestMonth.month)}</strong> is the clearest month, with
      ${
        overlap.clearestMonth.absences === 0
          ? 'no disrupted days at all'
          : `only ${plural(overlap.clearestMonth.absences, 'disrupted day', 'disrupted days')}`
      } out of ${overlap.clearestMonth.workingDays}. ${
        overlap.busiestMonth && overlap.busiestMonth.month !== overlap.clearestMonth.month
          ? `<strong>${esc(overlap.busiestMonth.month)}</strong> is the worst, with ${plural(
              overlap.busiestMonth.absences,
              'day',
              'days',
            )} where somebody is away.`
          : ''
      }</p>`
        : ''
    }
    ${
      overlap.everyoneOff.length
        ? `<p>Every country in this team is off on
      ${overlap.everyoneOff
        .map((entry) => `<strong>${esc(formatLong(parseISO(entry.date)))}</strong>`)
        .join(', ')}. That is the rare day you can genuinely stop.</p>`
        : `<p>There is no single day in ${overlap.year} that is a public holiday in all of these
      countries at once — worth knowing before promising the team a shared day off.</p>`
    }
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2>Clearest stretches for something that needs everyone</h2>
    <p class="note">The longest runs of consecutive working days with nobody on a public holiday —
      where a launch, a sprint or an onsite actually fits.</p>
    <div class="table-scroll">
      <table>
        <caption>Uninterrupted working stretches in ${overlap.year}</caption>
        <thead><tr><th scope="col">From</th><th scope="col">To</th><th scope="col">Working days</th></tr></thead>
        <tbody>${runs
          .map(
            (run) =>
              `<tr><td class="date">${esc(run.from)}</td><td class="date">${esc(
                run.to,
              )}</td><td class="num">${run.workingDays}</td></tr>`,
          )
          .join('')}</tbody>
      </table>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2>Every day someone is away</h2>
    <p class="note">${plural(
      overlap.absences.length,
      'weekday',
      'weekdays',
    )} in ${overlap.year} where at least one country has a public holiday. Rows where the whole
      team is off are highlighted.</p>
    <div class="table-scroll">
      <table>
        <caption>Public holidays across the team, ${overlap.year}</caption>
        <thead><tr>
          <th scope="col">Date</th><th scope="col">Away</th>
          <th scope="col">Holiday</th><th scope="col">Countries</th>
        </tr></thead>
        <tbody>${
          absenceRows(overlap.absences) ||
          '<tr><td colspan="4">No public holidays fall on a weekday for this team.</td></tr>'
        }</tbody>
      </table>
    </div>
  </div>
</section>
`;
}

/** The full page. */
export function renderTeam({ countries, overlap, years, currentYear, today, defaultCodes }) {
  const names = overlap.sides.map((side) => side.name);
  const readable =
    names.length === 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

  const title = 'Team holiday overlap';
  const description =
    `See which days your distributed team is actually all available. Pick up to ${MAX_MEMBERS} ` +
    `countries and get the working days nobody is on a public holiday, the days everyone is off, ` +
    `and the clearest stretches for something that needs the whole team.`;

  const options = countries
    .map(
      (country) =>
        `<option value="${esc(country.code)}">${esc(country.flag)} ${esc(country.name)}</option>`,
    )
    .join('');

  const pickers = Array.from({ length: MAX_MEMBERS }, (_, index) => {
    const selected = defaultCodes[index] || '';
    return `<div class="team__slot">
      <label for="team-${index}">${index < 2 ? `Country ${index + 1}` : 'Add a country'}</label>
      <select id="team-${index}" data-slot="${index}">
        <option value="">${index < 2 ? '— pick one —' : '— none —'}</option>
        ${options.replace(
          new RegExp(`<option value="${selected}">`),
          `<option value="${selected}" selected>`,
        )}
      </select>
    </div>`;
  }).join('');

  const body = `
<section class="hero">
  <div class="wrap">
    <p class="eyebrow">${overlap.sides.map((side) => side.flag).join(' ')} ${overlap.sides.length} countries · ${currentYear}</p>
    <h1>${esc(title)}</h1>
    <p class="lede hero__lede">You book a workshop for a Tuesday and half the team is on a public
      holiday you had never heard of. This puts up to ${MAX_MEMBERS} countries on one planner and
      counts the days that actually work — currently ${esc(readable)}.</p>
  </div>
</section>

<div class="wrap">${adSlot('leaderboard')}</div>

<section class="section">
  <div class="wrap">
    <form class="team" id="team-form">
      <div class="team__slots">${pickers}</div>
      <div class="planner__row">
        <div>
          <label for="team-year">Year</label>
          <select id="team-year">${years
            .map(
              (year) =>
                `<option value="${year}"${year === currentYear ? ' selected' : ''}>${year}</option>`,
            )
            .join('')}</select>
        </div>
      </div>
      <label class="calc__check"><input type="checkbox" id="team-regional"> Also count regional holidays</label>
      <p class="note">The line-up goes in the address, so a link to this page keeps your team.</p>
    </form>
    <noscript><p class="note">Choosing a different team needs JavaScript. The comparison below is
      for ${esc(readable)}.</p></noscript>
  </div>
</section>

<div id="team-body" data-year="${currentYear}">
${teamBody(overlap, { today, years })}
</div>

<div class="wrap">${adSlot('inArticle')}</div>

<section class="section">
  <div class="wrap prose">
    <h2>How to read this</h2>
    <p>Only weekdays are counted. A public holiday that lands on a Saturday does not cost the team
      a working day, so it is left out of the totals — it still shows on the planner above.</p>
    <p>"Days everyone is working" is the number to plan around: those are the days you can expect
      the whole team without checking. "Days someone is away" is not a warning to avoid them
      entirely — one person in one country being off is often fine — but it tells you which dates
      need a second look.</p>
    <p>Only national holidays count unless you tick the regional box. That matters for countries
      like India and Germany, where a great deal is decided at state level and a national list
      understates how much of the calendar is actually affected. Regional coverage on this site is
      incomplete, so treat "days everyone is working" as an optimistic number rather than a
      promise.</p>
    <p>Comparing exactly two countries in more depth? The
      <a href="${url.compare()}">country comparison</a> goes further on a pair — shared days off,
      long weekends and the quietest months to travel.</p>
  </div>
</section>

<script type="application/json" id="team-config">${jsonScript({
    years,
    currentYear,
    today,
    max: MAX_MEMBERS,
    defaults: defaultCodes,
  })}</script>
`;

  return layout({
    title: `${title} — the days your whole team is available`,
    description,
    path: url.team(),
    body,
    modules: ['/assets/team.js'],
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: title,
      description,
      url: url.absolute(url.team()),
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Any',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      creator: { '@type': 'Organization', name: config.name, url: config.url },
    },
    breadcrumbs: [{ name: 'Team overlap', path: url.team() }],
  });
}

export default renderTeam;
