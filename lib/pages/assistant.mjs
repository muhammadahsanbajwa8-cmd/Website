/**
 * The assistant page: one box, a plain-English question, a worked answer.
 *
 * `answerCard` is the half that matters. The generator calls it to put a real
 * answer in the HTML — so the page is useful before a line of JavaScript runs,
 * and so search engines see an answer rather than an empty form — and the
 * browser calls the same function for every question after that. One renderer,
 * so the typed answer and the built answer cannot drift apart.
 *
 * No Node APIs: the browser runs this module directly.
 */

import config from '../../site.config.mjs';
import { CAPABILITIES } from '../assistant.mjs';
import { adSlot, esc, jsonScript, layout, url } from '../html.mjs';

/** The facts row: the numbers, before the sentences. */
function facts(items) {
  if (!items || !items.length) return '';
  return `<div class="facts">${items
    .map(
      (fact, index) => `<div class="fact${index === 0 ? ' fact--signal' : ''}">
        <span class="fact__value">${esc(fact.value)}</span>
        <span class="fact__label">${esc(fact.label)}</span>
        ${fact.note ? `<p class="fact__note">${esc(fact.note)}</p>` : ''}
      </div>`,
    )
    .join('')}</div>`;
}

function table(spec) {
  if (!spec || !spec.rows || !spec.rows.length) return '';
  return `<div class="table-scroll">
    <table>
      <caption>${esc(spec.caption)}</caption>
      <thead><tr>${spec.columns
        .map((column) => `<th${column.numeric ? ' class="num"' : ''}>${esc(column.label)}</th>`)
        .join('')}</tr></thead>
      <tbody>${spec.rows
        .map(
          (row) =>
            `<tr>${row
              .map(
                (cell, index) =>
                  `<td${spec.columns[index] && spec.columns[index].numeric ? ' class="num"' : ''}>${esc(
                    cell,
                  )}</td>`,
              )
              .join('')}</tr>`,
        )
        .join('')}</tbody>
    </table>
  </div>`;
}

function chips(items, kind = 'ask') {
  if (!items || !items.length) return '';
  return `<ul class="chips">${items
    .map(
      (item) =>
        `<li><button type="button" class="chip" data-${esc(kind)}="${esc(item)}">${esc(
          item,
        )}</button></li>`,
    )
    .join('')}</ul>`;
}

/**
 * One answer.
 *
 * @param {object} answer the result of `answer()` in lib/assistant.mjs
 * @param {{question?: string}} [options]
 */
export function answerCard(answer, options = {}) {
  const asked = options.question || answer.question || '';

  if (!answer.ok) {
    return `<section class="section section--tight">
      <div class="wrap">
        <div class="answer answer--empty">
          ${asked ? `<p class="answer__asked">${esc(asked)}</p>` : ''}
          <p class="answer__headline">${esc(answer.headline)}</p>
          ${
            answer.followUps && answer.followUps.length
              ? `<p class="note">Questions this page can answer:</p>${chips(answer.followUps)}`
              : ''
          }
        </div>
      </div>
    </section>`;
  }

  const sources = answer.sources && answer.sources.length
    ? `<p class="answer__source">Worked out from ${esc(
        [...new Set(answer.sources.map((entry) => `${entry.name} ${entry.year}`))].join(', '),
      )} — the same tables the rest of this site is built from.</p>`
    : '';

  return `<section class="section section--tight">
  <div class="wrap">
    <article class="answer">
      ${asked ? `<p class="answer__asked">${esc(asked)}</p>` : ''}
      <p class="answer__headline">${esc(answer.headline)}</p>
      ${facts(answer.facts)}
      <div class="answer__prose prose">
        ${answer.prose.map((line) => `<p>${esc(line)}</p>`).join('')}
      </div>
      ${table(answer.table)}
      ${
        answer.links && answer.links.length
          ? `<p class="answer__links">${answer.links
              .map((link) => `<a href="${esc(link.href)}">${esc(link.label)}</a>`)
              .join('')}</p>`
          : ''
      }
      ${sources}
    </article>
    ${
      answer.followUps && answer.followUps.length
        ? `<div class="answer__next"><p class="note">Next:</p>${chips(answer.followUps)}</div>`
        : ''
    }
  </div>
</section>`;
}

/**
 * @param {{
 *   answer: object, question: string, years: number[], currentYear: number,
 *   today: string, countryCount: number,
 * }} page
 */
export function renderAssistant(page) {
  const title = 'Ask';
  const description =
    'Ask about holidays, working days, deadlines and leave in plain English and get a worked ' +
    'answer instantly — no account, no language model, no guessing. Every answer is computed ' +
    `from the public holiday tables for ${page.countryCount} countries.`;

  const body = `
<section class="hero hero--ask">
  <div class="wrap">
    <p class="eyebrow">${page.countryCount} countries · ${page.years[0]}–${page.years.at(-1)} · answers in a millisecond</p>
    <h1>Ask a real question. Get the actual date.</h1>
    <p class="lede hero__lede">How many working days until the deadline. Whether the 25th is a
      day off where your supplier is. Where to put fourteen days of leave so they buy six weeks.
      Type it the way you would say it.</p>

    <form class="ask" id="ask-form" role="search">
      <label class="ask__label" for="ask-input">Your question</label>
      <div class="ask__row">
        <input
          type="text"
          id="ask-input"
          name="q"
          class="ask__input"
          placeholder="How many working days until 24 December in the United States?"
          autocomplete="off"
          spellcheck="false"
          value="${esc(page.question)}">
        <button type="submit" class="ask__go">Answer</button>
      </div>
      <p class="ask__hint" id="ask-hint">Answered here in your browser. Nothing you type is sent anywhere.</p>
    </form>

    ${chips(CAPABILITIES.map((entry) => entry.example))}
  </div>
</section>

<div class="wrap">${adSlot('leaderboard')}</div>

<div id="ask-answer">
${answerCard(page.answer, { question: page.question })}
</div>

<noscript>
  <section class="section"><div class="wrap">
    <p class="note">Asking your own question needs JavaScript, because the answer is worked out in
      your browser rather than on a server. The worked example above, and every
      <a href="${url.countries()}">country page</a>, work without it.</p>
  </div></section>
</noscript>

<div class="wrap">${adSlot('inArticle')}</div>

<section class="section">
  <div class="wrap prose">
    <h2>What it can work out</h2>
    <ul class="ask__list">
      ${CAPABILITIES.map(
        (entry) =>
          `<li><strong>${esc(entry.label)}</strong><span class="mono">${esc(entry.example)}</span></li>`,
      ).join('')}
    </ul>

    <h2>There is no language model here</h2>
    <p>That is a deliberate choice, not a missing feature. "What date is twenty working days from
      Tuesday" has exactly one right answer, and this site already holds every public holiday for
      ${page.countryCount} countries. Working it out arithmetically is instant, costs nothing, runs
      offline, and cannot invent a date that does not exist. A model would add latency, a bill, an
      API key a static site has nowhere to keep — and the possibility of a confidently wrong
      answer to a question about your deadline.</p>
    <p>So the clever part is reading the question, not producing the answer. The page works out
      which countries you named, which dates you meant, and what you were actually asking; then it
      runs the same code that generates the rest of this site. When it cannot tell what you meant,
      it asks — it does not guess.</p>
    <p>Everything happens in your browser. The question is never sent to a server, because there
      is no server: this is a folder of static files. The only network request an answer makes is
      for the holiday table of the countries you named, a few kilobytes each.</p>

    <h2>What it will not do</h2>
    <p>It answers questions about public holidays, working days, leave and deadlines, and nothing
      else — ask it for medical or legal advice and it will tell you it cannot. Holiday data is
      informational: regional coverage is incomplete, employers substitute days, and a date that
      matters legally should be checked against the relevant authority. The
      <a href="${url.about()}">about page</a> lists where every figure comes from.</p>
  </div>
</section>

<script type="application/json" id="ask-config">${jsonScript({
    today: page.today,
    years: page.years,
    currentYear: page.currentYear,
    examples: CAPABILITIES.map((entry) => entry.example),
  })}</script>
`;

  return layout({
    title: `${title} — holidays, working days and deadlines, answered`,
    description,
    path: url.assistant(),
    body,
    bodyClass: 'page-ask',
    modules: ['/assets/assistant.js'],
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: `${config.name} Ask`,
        description,
        url: url.absolute(url.assistant()),
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Any',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        featureList: CAPABILITIES.map((entry) => entry.label),
        creator: { '@type': 'Organization', name: config.name, url: config.url },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: CAPABILITIES.map((entry) => ({
          '@type': 'Question',
          name: entry.example,
          acceptedAnswer: {
            '@type': 'Answer',
            text: `${entry.label}. Answered instantly from the public holiday tables on ${config.name}.`,
          },
        })),
      },
    ],
    breadcrumbs: [{ name: title, path: url.assistant() }],
  });
}

export default renderAssistant;
