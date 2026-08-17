/**
 * The interactive half of the annual leave planner.
 *
 * It imports the optimiser and the renderer the generator used, so the plan
 * shown after you change the budget is produced by exactly the same code that
 * produced the one on the page when it loaded.
 */

import { planLeave } from '/assets/mjs/lib/leave.mjs';
import { leaveBody } from '/assets/mjs/lib/pages/leave.mjs';

/** Where the site is mounted; empty when served from a domain root. */
const BASE = document.documentElement.dataset.base || '';

const container = document.getElementById('leave-body');
const form = document.getElementById('leave-form');
const configEl = document.getElementById('leave-config');

if (container && form && configEl) {
  const config = JSON.parse(configEl.textContent);
  const country = { code: config.code, name: config.name };

  const budgetInput = document.getElementById('leave-budget');
  const yearSelect = document.getElementById('leave-year');
  const regional = document.getElementById('leave-regional');

  let data = null;

  const strategy = () => {
    const checked = form.querySelector('input[name="leave-strategy"]:checked');
    return checked ? checked.value : 'balanced';
  };

  function status(message, kind) {
    container.innerHTML = `<section class="section"><div class="wrap"><p class="${
      kind || 'note'
    }">${message}</p></div></section>`;
  }

  async function load() {
    if (data) return data;
    const response = await fetch(`${BASE}/data/${config.code.toUpperCase()}.json`);
    if (!response.ok) throw new Error('no data');
    data = await response.json();
    return data;
  }

  async function render() {
    const year = Number(yearSelect.value);
    const budget = Math.max(0, Math.min(40, Number(budgetInput.value) || 0));

    try {
      const country_ = await load();
      const bucket = country_.years[year] || { holidays: [] };
      const plan = planLeave(year, bucket.holidays, {
        budget,
        strategy: strategy(),
        includeRegional: regional.checked,
        // Planning days that have already gone is not planning.
        after: config.today && Number(config.today.slice(0, 4)) === year ? config.today : null,
      });
      container.innerHTML = leaveBody(plan, { country, today: config.today });
      container.dataset.year = String(year);
    } catch (error) {
      status(
        `Could not load the ${config.name} calendar. <a href="${BASE}/${config.code.toLowerCase()}/">Open the country page</a> instead.`,
        'calc__error',
      );
    }
  }

  /** Keep the address bar shareable without navigating. */
  function sync() {
    const params = new URLSearchParams({
      days: String(budgetInput.value),
      strategy: strategy(),
      year: String(yearSelect.value),
    });
    if (regional.checked) params.set('regional', '1');
    window.history.replaceState({}, '', `${window.location.pathname}?${params}`);
  }

  const run = () => {
    sync();
    render();
  };

  form.addEventListener('submit', (event) => event.preventDefault());
  form.addEventListener('change', run);
  budgetInput.addEventListener('input', run);

  // A shared link such as ?days=25&strategy=long-breaks opens ready to read.
  const params = new URLSearchParams(window.location.search);
  const days = params.get('days');
  const wanted = params.get('strategy');
  const year = params.get('year');
  let restored = false;

  if (days !== null && Number.isFinite(Number(days))) {
    budgetInput.value = String(Math.max(0, Math.min(40, Number(days))));
    restored = true;
  }
  if (wanted) {
    const radio = form.querySelector(`input[name="leave-strategy"][value="${CSS.escape(wanted)}"]`);
    if (radio) {
      radio.checked = true;
      restored = true;
    }
  }
  if (year && [...yearSelect.options].some((option) => option.value === year)) {
    yearSelect.value = year;
    restored = true;
  }
  if (params.get('regional') === '1') {
    regional.checked = true;
    restored = true;
  }

  if (restored) render();
}
