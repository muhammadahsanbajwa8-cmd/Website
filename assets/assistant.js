/**
 * The interactive half of the assistant.
 *
 * The whole loop runs here: read the question, work out which countries it
 * names, fetch only those, answer, render. Nothing is sent anywhere — there is
 * no server to send it to — and the renderer is the generator's own, so a typed
 * answer is byte-identical to a built one.
 */

import { answer, buildIndex, interpret } from '/assets/mjs/lib/assistant.mjs';
import { answerCard } from '/assets/mjs/lib/pages/assistant.mjs';
import { url } from '/assets/mjs/lib/html.mjs';

/** Where the site is mounted; empty when served from a domain root. */
const BASE = document.documentElement.dataset.base || '';

const form = document.getElementById('ask-form');
const input = document.getElementById('ask-input');
const output = document.getElementById('ask-answer');
const hint = document.getElementById('ask-hint');
const configEl = document.getElementById('ask-config');

if (form && input && output && configEl) {
  const config = JSON.parse(configEl.textContent);
  const cache = new Map();
  let index = null;
  let pending = 0;

  function say(message) {
    output.innerHTML = `<section class="section section--tight"><div class="wrap">
      <div class="answer answer--empty"><p class="answer__headline">${message}</p></div>
    </div></section>`;
  }

  /** The country list, fetched once and reused for every question after. */
  async function countryIndex() {
    if (index) return index;
    const response = await fetch(`${BASE}/countries.json`);
    if (!response.ok) throw new Error('country list unavailable');
    const data = await response.json();
    index = buildIndex(data.countries || []);
    return index;
  }

  async function load(code) {
    if (cache.has(code)) return cache.get(code);
    const response = await fetch(`${BASE}/data/${code}.json`);
    if (!response.ok) throw new Error(`no data for ${code}`);
    const data = await response.json();
    cache.set(code, data);
    return data;
  }

  async function ask(question, options = {}) {
    const text = String(question || '').trim();
    if (!text) return;

    // Answers can arrive out of order when someone asks again while a fetch is
    // in flight; only the newest one is allowed to paint.
    const ticket = (pending += 1);
    const isCurrent = () => ticket === pending;

    let resolved;
    try {
      resolved = await countryIndex();
    } catch (error) {
      if (isCurrent()) say('The country list could not be loaded. Try reloading the page.');
      return;
    }
    if (!isCurrent()) return;

    const request = interpret(text, {
      index: resolved,
      today: config.today,
      years: config.years,
    });

    const data = {};
    try {
      const loaded = await Promise.all(request.countries.map(load));
      loaded.forEach((entry) => {
        data[entry.code] = entry;
      });
    } catch (error) {
      if (isCurrent()) {
        say(
          `This site has no holiday table for one of those countries. <a href="${BASE}/countries/">Browse the ones it covers</a>.`,
        );
      }
      return;
    }
    if (!isCurrent()) return;

    const result = answer(request, {
      data,
      today: config.today,
      years: config.years,
      url,
    });

    output.innerHTML = answerCard(result, { question: text });
    document.title = result.ok
      ? `${result.headline} — Ask`
      : 'Ask — holidays, working days and deadlines, answered';

    // The question goes in the address, so an answer can be linked or bookmarked.
    if (!options.silent) {
      const params = new URLSearchParams({ q: text });
      window.history.replaceState({}, '', `${window.location.pathname}?${params}`);
    }
    if (hint) {
      hint.textContent = request.needs
        ? request.needs.message
        : 'Answered here in your browser. Nothing you type is sent anywhere.';
    }
    output.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    ask(input.value);
  });

  // Every suggestion on the page — the examples and the follow-ups inside an
  // answer — is a button carrying the question it stands for.
  document.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-ask]');
    if (!chip) return;
    event.preventDefault();
    input.value = chip.dataset.ask;
    ask(chip.dataset.ask);
    input.focus();
  });

  // A shared link such as /ask/?q=… opens on that answer.
  const shared = new URLSearchParams(window.location.search).get('q');
  if (shared) {
    input.value = shared;
    ask(shared, { silent: true });
  }
}
