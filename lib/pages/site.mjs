/**
 * Site-wide pages: home, the country index, /today/, about and privacy.
 */

import config from '../../site.config.mjs';
import { WEEKDAY_NAMES, formatLong, parseISO } from '../dates.mjs';
import { groupByRegion } from '../countries.mjs';
import { adSlot, esc, layout, url } from '../html.mjs';
import { ribbonLegend, yearRibbon } from '../ribbon.mjs';

const plural = (count, one, many) => `${count.toLocaleString('en')} ${count === 1 ? one : many}`;

/**
 * Home: hero, finder, the world ribbon, featured countries.
 * @param {{countries: Array, featured: Array, heat: Map<string, number>, peak: object,
 *          year: number, today: string, todayCount: number, years: number[]}} data
 */
export function renderHome(data) {
  const { countries, featured, heat, peak, year, today, todayCount, years } = data;

  // A few ready-made pairings, drawn from the featured list.
  const comparePairs = [];
  for (let i = 0; i + 1 < featured.length && comparePairs.length < 4; i += 2) {
    comparePairs.push({
      a: featured[i].code,
      b: featured[i + 1].code,
      aName: `${featured[i].flag} ${featured[i].name}`,
      bName: `${featured[i + 1].flag} ${featured[i + 1].name}`,
    });
  }

  const description =
    `Public holiday calendars and working-day counts for ${countries.length} countries, ` +
    `${years[0]}–${years.at(-1)}. See who is off today, count business days between two dates, ` +
    `and read any year as a wall planner.`;

  const featuredCards = featured
    .map(
      (country) => `<a class="card" href="${url.country(country.code)}">
      <span class="card__name">${esc(country.flag)} ${esc(country.name)}</span>
      <span class="card__meta">${country.stats.total} holidays · ${country.stats.workingDays.toLocaleString(
        'en',
      )} working days · ${year}</span>
      <span class="card__meta">Next: ${
        country.next ? `${esc(country.next.name)}, ${esc(country.next.when)}` : '—'
      }</span>
    </a>`,
    )
    .join('\n');

  const body = `
<section class="hero">
  <div class="wrap">
    <p class="eyebrow">${countries.length} countries · ${years[0]}–${years.at(-1)} · rebuilt nightly</p>
    <h1>Every public holiday, laid out like a wall planner.</h1>
    <p class="lede hero__lede">${esc(config.tagline)} Pick a country for its full calendar, the
      working days in any year, and a calculator that counts business days between two dates.</p>

    <div class="finder">
      <label for="country-finder">Find a country</label>
      <input type="search" id="country-finder" placeholder="Start typing — Germany, JP, Brazil…"
        autocomplete="off" spellcheck="false" aria-describedby="finder-help">
      <p id="finder-help" class="note">Or <a href="${url.countries()}">browse all ${
        countries.length
      } countries</a>.</p>
      <ul class="finder__results" id="finder-results"></ul>
    </div>
  </div>
</section>

<div class="wrap">${adSlot('leaderboard')}</div>

<section class="section">
  <div class="wrap">
    <div class="section__head">
      <h2>${year}, the whole world at once</h2>
      <p class="note mono">${today} · ${
        todayCount ? `${plural(todayCount, 'country is', 'countries are')} off today` : 'no holidays today'
      }</p>
    </div>
    <p>Each cell is one day. The deeper the yellow, the more countries have a public holiday —
      ${
        peak.count
          ? `the peak is <strong>${esc(peak.date)}</strong>, when ${plural(
              peak.count,
              'country stops',
              'countries stop',
            )} at once.`
          : 'no single day stands out this year.'
      }</p>
    ${yearRibbon(year, {
      heat,
      today,
      label: `Heat map of ${year}: how many of ${countries.length} countries have a public holiday on each day.`,
    })}
    ${ribbonLegend('heat')}
    <p class="note"><a href="${url.today()}">See which countries are on holiday today →</a></p>
  </div>
</section>

<div class="wrap">${adSlot('inArticle')}</div>

<section class="section">
  <div class="wrap">
    <div class="section__head">
      <h2>Featured countries</h2>
      <a href="${url.countries()}">All countries →</a>
    </div>
    <div class="grid">${featuredCards}</div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section__head">
      <h2>Planning a trip? Compare two countries</h2>
      <a href="${url.compare()}">Open the comparison →</a>
    </div>
    <p>Put two calendars side by side and see the days you would both be off, each side's long
      weekends, the single days worth booking to stretch a break, and the quietest months to
      travel. Every date links through to the full calendar.</p>
    <div class="grid">${comparePairs
      .map(
        (pair) => `<a class="card" href="${url.pair(pair.a, pair.b)}">
        <span class="card__name">${esc(pair.aName)} vs ${esc(pair.bName)}</span>
        <span class="card__meta">${year} holidays, shared days off and long weekends</span>
      </a>`,
      )
      .join('')}</div>
  </div>
</section>

<section class="section">
  <div class="wrap prose">
    <h2>What this site is</h2>
    <p>A generated reference. Holiday dates come from the
      <a href="https://date.nager.at" rel="noopener">Nager.Date</a> public API, and where the API has
      no entry the dates are computed from each country's statutory rules — fixed dates, "third Monday
      in January" rules, and offsets from Easter Sunday. Every page is rebuilt each night, so
      <a href="${url.today()}">today</a> is always today and next year's calendars appear on their own.</p>
    <p>Working-day counts assume a Monday-to-Friday week and subtract national public holidays that
      fall on a weekday. <a href="${url.about()}">Read the method and its limits →</a></p>
  </div>
</section>
`;

  return layout({
    title: `${config.name} — public holidays and working days by country`,
    description,
    path: url.home(),
    body,
    scripts: ['/assets/finder.js'],
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: config.name,
      url: config.url,
      description,
      potentialAction: {
        '@type': 'SearchAction',
        target: `${config.url}/countries/?q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    },
  });
}

/** Every country, grouped by region. */
export function renderCountriesIndex({ countries, year, years }) {
  const groups = groupByRegion(countries);
  const description =
    `All ${countries.length} countries with holiday data, grouped by region. ` +
    `Public holiday calendars and working-day counts for ${years[0]}–${years.at(-1)}.`;

  const sections = groups
    .map(
      ([region, list]) => `<section class="region">
      <h3 id="${esc(region.toLowerCase().replace(/\s+/g, '-'))}">${esc(region)} <span>${
        list.length
      } countries</span></h3>
      <ul class="country-list">
        ${list
          .map(
            (country) =>
              `<li><a href="${url.country(country.code)}">${esc(country.flag)} ${esc(
                country.name,
              )}</a></li>`,
          )
          .join('\n        ')}
      </ul>
    </section>`,
    )
    .join('\n');

  const body = `
<section class="hero">
  <div class="wrap">
    <p class="eyebrow">${countries.length} countries · ${years[0]}–${years.at(-1)}</p>
    <h1>Every country we hold data for</h1>
    <p class="lede hero__lede">Grouped by region. Each country has a hub, a calendar for every year
      from ${years[0]} to ${years.at(-1)}, and a working days calculator.</p>
    <div class="finder">
      <label for="country-finder">Jump to a country</label>
      <input type="search" id="country-finder" placeholder="Type a name or code…" autocomplete="off" spellcheck="false">
      <ul class="finder__results" id="finder-results"></ul>
    </div>
  </div>
</section>

<div class="wrap">${adSlot('leaderboard')}</div>

<section class="section">
  <div class="wrap">
    ${sections}
  </div>
</section>

<div class="wrap">${adSlot('inArticle')}</div>

<section class="section">
  <div class="wrap prose">
    <h2>Missing a country?</h2>
    <p>Coverage follows the upstream data. The Nager.Date API publishes roughly 110 countries; where a
      country is listed here without upstream data, its dates are computed from statutory rules
      instead. <a href="${url.about()}">How to add a source →</a></p>
  </div>
</section>
`;

  return layout({
    title: `All countries — public holidays and working days`,
    description,
    path: url.countries(),
    body,
    scripts: ['/assets/finder.js'],
    breadcrumbs: [{ name: 'Countries', path: url.countries() }],
  });
}

/** Which countries have a public holiday today. */
export function renderToday({ today, entries, tomorrow, upcoming, countryCount }) {
  const date = parseISO(today);
  const weekday = WEEKDAY_NAMES[date.getUTCDay()];
  const description = entries.length
    ? `${plural(entries.length, 'country has', 'countries have')} a public holiday on ${formatLong(
        date,
      )}: ${entries
        .slice(0, 6)
        .map((entry) => entry.country.name)
        .join(', ')}${entries.length > 6 ? ' and more' : ''}.`
    : `No public holidays anywhere in our ${countryCount}-country data set on ${formatLong(date)}.`;

  const rows = entries
    .map(
      (entry) => `<tr>
      <td><a href="${url.year(entry.country.code, date.getUTCFullYear())}">${esc(
        entry.country.flag,
      )} ${esc(entry.country.name)}</a></td>
      <td>${esc(entry.holiday.name)}</td>
      <td><span class="tag ${entry.holiday.national !== false ? 'tag--national' : ''}">${
        entry.holiday.national !== false ? 'National' : 'Regional'
      }</span></td>
      <td class="date">${esc(entry.country.region)}</td>
    </tr>`,
    )
    .join('\n');

  const body = `
<section class="hero">
  <div class="wrap">
    <p class="eyebrow">${esc(weekday)} ${esc(today)} · UTC</p>
    <h1>${
      entries.length
        ? `${plural(entries.length, 'country is', 'countries are')} on holiday today`
        : 'Nobody is on a public holiday today'
    }</h1>
    <p class="lede hero__lede">${
      entries.length
        ? `Out of ${countryCount} countries with data, these have a public holiday on ${esc(
            formatLong(date),
          )}.`
        : `Across ${countryCount} countries with data, ${esc(
            formatLong(date),
          )} is an ordinary day everywhere.`
    }</p>
  </div>
</section>

<div class="wrap">${adSlot('leaderboard')}</div>

<section class="section">
  <div class="wrap">
    ${
      entries.length
        ? `<div class="table-scroll"><table>
      <caption>Public holidays on ${esc(today)}</caption>
      <thead><tr><th scope="col">Country</th><th scope="col">Holiday</th><th scope="col">Scope</th><th scope="col">Region</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`
        : '<p class="note">This page is rebuilt every night, so check back tomorrow.</p>'
    }
    ${
      tomorrow.length
        ? `<h2 style="margin-top:2rem">Tomorrow</h2>
      <p>${tomorrow
        .map(
          (entry) =>
            `<a href="${url.country(entry.country.code)}">${esc(entry.country.flag)} ${esc(
              entry.country.name,
            )}</a> — ${esc(entry.holiday.name)}`,
        )
        .join(' · ')}</p>`
        : ''
    }
  </div>
</section>

<div class="wrap">${adSlot('inArticle')}</div>

<section class="section">
  <div class="wrap">
    <h2>Coming up</h2>
    <div class="table-scroll"><table>
      <caption>The next public holidays worldwide</caption>
      <thead><tr><th scope="col">Date</th><th scope="col">Weekday</th><th scope="col">Country</th><th scope="col">Holiday</th></tr></thead>
      <tbody>${upcoming
        .map(
          (entry) => `<tr>
        <td class="date">${esc(entry.holiday.date)}</td>
        <td>${esc(WEEKDAY_NAMES[parseISO(entry.holiday.date).getUTCDay()])}</td>
        <td><a href="${url.country(entry.country.code)}">${esc(entry.country.flag)} ${esc(
          entry.country.name,
        )}</a></td>
        <td>${esc(entry.holiday.name)}</td>
      </tr>`,
        )
        .join('\n')}</tbody>
    </table></div>
    <p class="note">Dates are UTC. A holiday starting locally on ${esc(
      today,
    )} may appear a day either side of your own calendar.</p>
  </div>
</section>
`;

  return layout({
    title: `Public holidays today — ${today}`,
    description,
    path: url.today(),
    body,
    breadcrumbs: [{ name: 'Today', path: url.today() }],
  });
}

/** Method, sources and limits. Required reading for an AdSense review. */
export function renderAbout({ countries, years, generatedAt, computedCountries }) {
  const description = `How ${config.name} builds its holiday calendars: sources, the rules used to compute dates, update schedule, and the limits of the data.`;

  const body = `
<section class="hero">
  <div class="wrap">
    <p class="eyebrow">Method &amp; sources</p>
    <h1>How this site is built</h1>
    <p class="lede hero__lede">Every page here is generated from data by a build script. No page is
      written by hand, and nothing is edited after publication except by rebuilding.</p>
  </div>
</section>

<div class="wrap">${adSlot('leaderboard')}</div>

<section class="section">
  <div class="wrap prose">
    <h2>Where the dates come from</h2>
    <p>The primary source is the <a href="https://date.nager.at" rel="noopener">Nager.Date</a> public
      API, an open data set of public holidays covering roughly 110 countries. Responses are cached at
      build time, so the site can be rebuilt without hitting the API again.</p>
    <p>Where the API has no entry for a country and year, dates are computed from that country's
      statutory rules instead. ${computedCountries.join(', ')} have rule sets in this repository
      covering fixed-date holidays, "nth weekday of the month" holidays, and holidays defined as an
      offset from Easter Sunday (computed with the Meeus/Jones/Butcher algorithm). No per-year date
      lists are stored anywhere, so the computed dates stay correct for any year.</p>

    <h2>How the numbers are calculated</h2>
    <ul>
      <li><strong>Working days</strong> — every Monday to Friday in the year, minus national public
        holidays that fall on a weekday. Holidays that land on a Saturday or Sunday are not subtracted
        twice.</li>
      <li><strong>Holidays on a weekend</strong> — holidays whose observed date is a Saturday or
        Sunday. Where a country's law moves the observance to the nearest weekday, the moved date is
        the one shown.</li>
      <li><strong>Longest stretch without a holiday</strong> — the longest run of consecutive days in
        the calendar year with no public holiday of any kind.</li>
      <li><strong>Business-day calculator</strong> — weekends and public holidays removed from the
        range you pick. It runs in your browser against holiday data embedded in the page.</li>
      <li><strong>Long weekends</strong> — a run of three or more consecutive non-working days
        (weekend or public holiday) that a public holiday actually created.</li>
      <li><strong>Days worth booking</strong> — one or two working days that sit between two such
        runs, where taking them off yields at least four consecutive days away.</li>
      <li><strong>Shared days off</strong> — dates that are a public holiday in both of the
        countries being <a href="${url.compare()}">compared</a>, matched on the observed date.</li>
    </ul>
    <p>All dates are handled in UTC so a build produces the same output wherever it runs.</p>

    <h2>Update schedule</h2>
    <p>A scheduled job rebuilds the whole site every night. That keeps
      <a href="${url.today()}">today</a> correct and publishes the next year's calendars as the range
      rolls forward. This build covers ${countries} countries and the years ${years[0]}–${years.at(
        -1,
      )}. Last generated ${esc(generatedAt)}.</p>
  </div>
</section>

<div class="wrap">${adSlot('inArticle')}</div>

<section class="section">
  <div class="wrap prose">
    <h2>The limits of the data</h2>
    <ul>
      <li><strong>Regional holidays are incomplete.</strong> A holiday observed in one state, province
        or nation of a country may be missing, or may be marked national when it is not. German state
        holidays, US state holidays, and the differences between England, Scotland and Northern
        Ireland are the obvious cases.</li>
      <li><strong>Lunar and observational dates are estimates in future years.</strong> Eid al-Fitr,
        Eid al-Adha, Diwali, Chinese New Year and similar holidays depend on lunar calendars or on a
        sighting; official dates are often confirmed only weeks ahead. Computed rule sets in this
        repository do not attempt them at all.</li>
      <li><strong>Substitute days follow the general rule, not every exception.</strong> One-off
        royal, national or emergency holidays declared for a single year will not appear until the
        upstream data set adds them.</li>
      <li><strong>Working-day counts are a default, not your contract.</strong> They assume a
        Monday-to-Friday week. Countries and industries with a Friday-Saturday or six-day week will
        differ.</li>
    </ul>
    <p>Use these pages for planning. For payroll, statutory notice periods or anything with legal
      consequences, confirm against your national gazette or labour authority.</p>

    <h2>Adding a data source</h2>
    <p>The generator reads from one module, <code>lib/source.mjs</code>, which resolves each request in
      order: fresh cache, live API, stale cache, computed rules. A new source slots in as another step
      in that chain and needs only to return <code>{ date, name, type, national }</code>. Country rule
      sets live in <code>lib/fallback.mjs</code> as data, not code paths.</p>

    <h2>Contact</h2>
    <p>Corrections and additions: <a href="mailto:${esc(config.contactEmail)}">${esc(
      config.contactEmail,
    )}</a>. Say which country, which year and which date, and it will be checked against the source.</p>
  </div>
</section>
`;

  return layout({
    title: `About — method, sources and limits`,
    description,
    path: url.about(),
    body,
    breadcrumbs: [{ name: 'About', path: url.about() }],
  });
}

/** Privacy: what actually happens on these pages. */
export function renderPrivacy({ generatedAt }) {
  const description = `What ${config.name} collects, the cookies Google AdSense may set, the Google Fonts request, and why calculator inputs never leave your browser.`;
  const hasAds = Boolean(config.adsense.publisherId);

  const body = `
<section class="hero">
  <div class="wrap">
    <p class="eyebrow">Privacy</p>
    <h1>Privacy policy</h1>
    <p class="lede hero__lede">This is a static site. There are no accounts, no logins, no comment
      forms and no database. Here is everything that happens when you load a page.</p>
  </div>
</section>

<div class="wrap">${adSlot('leaderboard')}</div>

<section class="section">
  <div class="wrap prose">
    <h2>What this site collects directly</h2>
    <p>Nothing. ${esc(
      config.name,
    )} has no server-side code and no analytics of its own. Pages are pre-built
      HTML files served from a static host. The host may keep standard access logs (IP address, user
      agent, requested URL) for security and traffic measurement; those logs are the host's, and this
      site does not read or process them.</p>

    <h2>The working-days calculator</h2>
    <p>The calculator runs entirely in your browser. The holiday data it needs is embedded in the page
      itself, so the dates you type are never sent anywhere — not to this site, not to a third party.
      Nothing you enter is stored, and reloading the page clears it.</p>

    <h2>Google Fonts</h2>
    <p>Pages load three typefaces from Google Fonts (<code>fonts.googleapis.com</code> and
      <code>fonts.gstatic.com</code>). Your browser makes that request directly to Google, which means
      Google receives your IP address and user agent as part of it. Google states that the Fonts API
      does not set cookies and does not use the request for advertising profiling. If you would rather
      avoid the request entirely, a content blocker will stop it — the pages fall back to your system
      fonts and remain fully readable.</p>

    <h2>Advertising${hasAds ? '' : ' (not currently active)'}</h2>
    ${
      hasAds
        ? `<p>This site shows ads through Google AdSense. Google and its partners may set cookies or read
      existing ones, and may use device identifiers, to:</p>`
        : `<p>Ad slots are laid out but no ad code is served yet, because no AdSense publisher ID is
      configured. When ads are switched on, the following applies:</p>`
    }
    <ul>
      <li>measure ad impressions and clicks, and detect invalid traffic;</li>
      <li>limit how often you see the same ad;</li>
      <li>personalise ads based on your prior visits to this and other sites, unless you decline.</li>
    </ul>
    <p>Third-party vendors, including Google, use cookies to serve ads based on your prior visits.
      Google's use of advertising cookies enables it and its partners to serve ads to you based on
      your visit to this and other sites. You can opt out of personalised advertising by visiting
      <a href="https://www.google.com/settings/ads" rel="noopener">Google Ads Settings</a>, and you can
      opt out of third-party vendor cookies at
      <a href="https://www.aboutads.info/choices/" rel="noopener">aboutads.info/choices</a>. Google's
      own explanation of the data it processes for advertising is in its
      <a href="https://policies.google.com/technologies/partner-sites" rel="noopener">partner sites
      policy</a>.</p>

    <h2>Your choice about ads</h2>
    <p>The banner shown on your first visit records one value in this browser's local storage
      (<code>hb-consent</code>, set to <code>accepted</code> or <code>declined</code>). It is read only
      by this site, is never transmitted, and clearing your browser storage removes it. Until you
      accept, ads are requested in non-personalised mode; declining keeps them that way. Non-personalised
      ads still use a cookie for frequency capping and fraud detection, as Google describes.</p>
    <p>If you are in the EEA, the UK or Switzerland, this banner alone is not a certified consent
      management platform. A production deployment serving that traffic should run a Google-certified
      CMP.</p>

    <h2>Children</h2>
    <p>This site is not directed at children and does not knowingly collect information from them.</p>

    <h2>Changes and contact</h2>
    <p>This policy is part of the site's source and changes only when the site is rebuilt. Last
      generated ${esc(generatedAt)}. Questions:
      <a href="mailto:${esc(config.contactEmail)}">${esc(config.contactEmail)}</a>.</p>
  </div>
</section>
`;

  return layout({
    title: `Privacy policy`,
    description,
    path: url.privacy(),
    body,
    breadcrumbs: [{ name: 'Privacy', path: url.privacy() }],
  });
}
