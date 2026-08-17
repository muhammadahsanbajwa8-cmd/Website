/**
 * The interactive half of the team overlap view.
 *
 * Countries are fetched one small file at a time and cached, so building a
 * six-country team downloads six files rather than the whole world.
 */

import { teamOverlap } from '/assets/mjs/lib/team.mjs';
import { teamBody } from '/assets/mjs/lib/pages/team.mjs';

const container = document.getElementById('team-body');
const form = document.getElementById('team-form');
const configEl = document.getElementById('team-config');

if (container && form && configEl) {
  const config = JSON.parse(configEl.textContent);
  const cache = new Map();

  const slots = [...form.querySelectorAll('select[data-slot]')];
  const yearSelect = document.getElementById('team-year');
  const regional = document.getElementById('team-regional');

  const chosen = () => {
    const seen = [];
    for (const slot of slots) {
      const code = slot.value.toUpperCase();
      // A country picked twice is a mistake, not a team of two clones.
      if (code && !seen.includes(code)) seen.push(code);
    }
    return seen;
  };

  function status(message, kind) {
    container.innerHTML = `<section class="section"><div class="wrap"><p class="${
      kind || 'note'
    }">${message}</p></div></section>`;
  }

  async function load(code) {
    if (cache.has(code)) return cache.get(code);
    const response = await fetch(`/data/${code}.json`);
    if (!response.ok) throw new Error(`no data for ${code}`);
    const data = await response.json();
    cache.set(code, data);
    return data;
  }

  async function render() {
    const codes = chosen();
    const year = Number(yearSelect.value);

    if (codes.length < 2) {
      status('Pick at least two countries to see where their calendars collide.');
      return;
    }

    status('Loading…');
    try {
      const loaded = await Promise.all(codes.map(load));
      const members = loaded.map((country) => ({
        code: country.code,
        name: country.name,
        flag: country.flag,
        holidays: (country.years[year] || { holidays: [] }).holidays,
      }));
      const overlap = teamOverlap(year, members, {
        includeRegional: regional.checked,
        today: config.today,
      });
      container.innerHTML = teamBody(overlap, { today: config.today, years: config.years });
      container.dataset.year = String(year);
      document.title = `${members.map((member) => member.name).join(', ')} — team holiday overlap ${year}`;
    } catch (error) {
      status(
        'One of those countries has no data on this site. <a href="/countries/">Browse the countries we cover</a>.',
        'calc__error',
      );
    }
  }

  /** The line-up goes in the address, so the link carries the team. */
  function sync() {
    const codes = chosen();
    const params = new URLSearchParams({ c: codes.join(','), year: String(yearSelect.value) });
    if (regional.checked) params.set('regional', '1');
    window.history.replaceState({}, '', `${window.location.pathname}?${params}`);
  }

  const run = () => {
    sync();
    render();
  };

  form.addEventListener('submit', (event) => event.preventDefault());
  form.addEventListener('change', run);

  // A shared link such as ?c=US,GB,IN&year=2027 opens with that team.
  const params = new URLSearchParams(window.location.search);
  const codes = (params.get('c') || '')
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, slots.length);
  const year = params.get('year');
  let restored = false;

  if (codes.length) {
    slots.forEach((slot, index) => {
      const code = codes[index] || '';
      if (!code || [...slot.options].some((option) => option.value === code)) slot.value = code;
    });
    restored = true;
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
