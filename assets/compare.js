/**
 * The interactive half of the country comparison.
 *
 * It imports the very same modules the generator uses, straight from the
 * browser as native ES modules. There is no bundler and no second copy of the
 * comparison logic — a pair page rendered here is identical to one rendered at
 * build time.
 */

import { compareCountries } from '/assets/mjs/lib/compare.mjs';
import { compareBody } from '/assets/mjs/lib/pages/compare.mjs';
import { yearStats } from '/assets/mjs/lib/stats.mjs';

const container = document.getElementById('compare-body');
if (container) {
  const picker = document.getElementById('compare-picker');
  const cache = new Map();

  const configEl = document.getElementById('compare-config');
  const config = configEl ? JSON.parse(configEl.textContent) : null;
  const years = config
    ? config.years
    : [...document.querySelectorAll('[data-role="year-switch"] [data-year]')].map((el) =>
        Number(el.dataset.year),
      );

  const today = new Date().toISOString().slice(0, 10);

  async function loadCountry(code) {
    if (cache.has(code)) return cache.get(code);
    const response = await fetch(`/data/${code.toUpperCase()}.json`);
    if (!response.ok) throw new Error(`No data for ${code}`);
    const data = await response.json();
    cache.set(code, data);
    return data;
  }

  /** Shape one country's stored data for compareCountries(). */
  function forYear(country, year) {
    const bucket = country.years[year] || { holidays: [], stats: null };
    return {
      code: country.code,
      name: country.name,
      flag: country.flag,
      holidays: bucket.holidays,
      stats: bucket.stats || yearStats(Number(year), bucket.holidays),
      // Listings are upcoming-only, so they belong to the country rather than
      // to the year being compared.
      events: country.events || null,
    };
  }

  function status(message, kind) {
    container.innerHTML = `<section class="section"><div class="wrap"><p class="${
      kind || 'note'
    }">${message}</p></div></section>`;
  }

  async function render(aCode, bCode, year) {
    if (!aCode || !bCode) return;
    status('Loading…');
    try {
      const [a, b] = await Promise.all([loadCountry(aCode), loadCountry(bCode)]);
      const result = compareCountries(forYear(a, year), forYear(b, year), Number(year));
      container.innerHTML = compareBody(result, { years, today });
      container.dataset.a = aCode;
      container.dataset.b = bCode;
      container.dataset.year = String(year);
      container.dataset.state = 'ready';
      document.title = `${a.name} vs ${b.name} — public holidays ${year}`;
    } catch (error) {
      status(
        'That country pairing has no data on this site. <a href="/countries/">Browse the countries we cover</a>.',
        'calc__error',
      );
    }
  }

  /** Keep the address bar shareable without navigating. */
  function sync(aCode, bCode, year) {
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}?a=${aCode}&b=${bCode}&year=${year}`,
    );
  }

  // --- The picker on /compare/ ---------------------------------------------
  if (picker) {
    const selectA = document.getElementById('pick-a');
    const selectB = document.getElementById('pick-b');
    const selectYear = document.getElementById('pick-year');

    const current = () => [selectA.value, selectB.value, selectYear.value];

    const run = () => {
      const [a, b, year] = current();
      sync(a, b, year);
      render(a, b, year);
    };

    picker.addEventListener('submit', (event) => {
      event.preventDefault();
      run();
    });
    [selectA, selectB, selectYear].forEach((select) => select.addEventListener('change', run));

    // A shared link such as /compare/?a=DE&b=FR&year=2027 opens ready to read.
    const params = new URLSearchParams(window.location.search);
    const a = (params.get('a') || '').toUpperCase();
    const b = (params.get('b') || '').toUpperCase();
    const year = params.get('year');
    if (a && b) {
      selectA.value = a;
      selectB.value = b;
      if (year && [...selectYear.options].some((option) => option.value === year)) {
        selectYear.value = year;
      }
      run();
    }
  }

  // --- Year switching, on both the hub and the pre-rendered pair pages ------
  container.addEventListener('click', (event) => {
    const link = event.target.closest('[data-role="year-switch"] [data-year]');
    if (!link) return;
    event.preventDefault();
    const year = link.dataset.year;
    const aCode = container.dataset.a;
    const bCode = container.dataset.b;
    if (!aCode || !bCode) return;

    const selectYear = document.getElementById('pick-year');
    if (selectYear) selectYear.value = year;
    window.history.replaceState({}, '', `${window.location.pathname}?a=${aCode}&b=${bCode}&year=${year}`);
    render(aCode, bCode, year);
  });
}
