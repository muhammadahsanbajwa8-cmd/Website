/**
 * The year ribbon: twelve rows of day cells, columns aligned by weekday so
 * every Monday sits in the same column, weekends muted, holidays punched out
 * in the one signal colour.
 *
 * Two modes:
 *   holidays  a Map of ISO date -> holiday, for a single country
 *   heat      a Map of ISO date -> 0..1, for "how much of the world is off"
 */

import {
  MONTH_NAMES,
  MONTH_SHORT,
  daysInMonth,
  iso,
  isWeekend,
  mondayIndex,
  utc,
} from './dates.mjs';

const COLUMNS = 37; // longest month (31 days) offset by up to six weekdays
const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * @param {number} year
 * @param {{
 *   holidays?: Map<string, {name: string, national?: boolean}>,
 *   heat?: Map<string, number>,
 *   today?: string,
 *   label?: string,
 * }} options
 */
export function yearRibbon(year, options = {}) {
  const holidays = options.holidays || new Map();
  const heat = options.heat || null;
  const today = options.today || null;

  const head = Array.from(
    { length: COLUMNS },
    (_, index) =>
      `<span class="ribbon__wd${index % 7 > 4 ? ' is-weekend' : ''}">${
        WEEKDAY_INITIALS[index % 7]
      }</span>`,
  ).join('');

  const rows = [];
  for (let month = 1; month <= 12; month += 1) {
    const first = utc(year, month, 1);
    const offset = mondayIndex(first);
    const cells = [];

    for (let i = 0; i < offset; i += 1) cells.push('<span class="cell cell--pad"></span>');

    for (let day = 1; day <= daysInMonth(year, month); day += 1) {
      const date = utc(year, month, day);
      const key = iso(date);
      const holiday = holidays.get(key);
      const classes = ['cell'];
      const attrs = [];

      if (isWeekend(date)) classes.push('is-weekend');
      if (holiday) {
        classes.push(holiday.national === false ? 'is-holiday is-regional' : 'is-holiday');
        attrs.push(`title="${escapeAttr(`${holiday.name} — ${key}`)}"`);
      }
      if (today && key === today) classes.push('is-today');

      if (heat) {
        const value = heat.get(key) || 0;
        if (value > 0) {
          classes.push('is-heat');
          attrs.push(`style="--k:${value.toFixed(3)}"`);
        }
      }

      cells.push(
        `<span class="${classes.join(' ')}" ${attrs.join(' ')}><b>${day}</b></span>`,
      );
    }

    for (let i = offset + daysInMonth(year, month); i < COLUMNS; i += 1) {
      cells.push('<span class="cell cell--pad"></span>');
    }

    rows.push(
      `<div class="ribbon__row"><span class="ribbon__month" title="${escapeAttr(
        MONTH_NAMES[month - 1],
      )}">${MONTH_SHORT[month - 1]}</span><div class="ribbon__cells">${cells.join('')}</div></div>`,
    );
  }

  const label =
    options.label ||
    `Wall planner for ${year}: twelve rows of days, weekends muted, public holidays marked.`;

  return `<div class="ribbon" role="img" aria-label="${escapeAttr(label)}">
  <div class="ribbon__scroll">
    <div class="ribbon__grid" aria-hidden="true">
      <div class="ribbon__row ribbon__row--head"><span class="ribbon__month"></span><div class="ribbon__cells">${head}</div></div>
      ${rows.join('\n      ')}
    </div>
  </div>
</div>`;
}

/** Legend for whichever mode the ribbon is in. */
export function ribbonLegend(mode = 'country') {
  if (mode === 'heat') {
    return `<p class="legend">
      <span class="legend__item"><i class="swatch swatch--heat" style="--k:.15"></i>few countries off</span>
      <span class="legend__item"><i class="swatch swatch--heat" style="--k:1"></i>many countries off</span>
      <span class="legend__item"><i class="swatch swatch--weekend"></i>weekend</span>
    </p>`;
  }
  return `<p class="legend">
    <span class="legend__item"><i class="swatch swatch--holiday"></i>public holiday</span>
    <span class="legend__item"><i class="swatch swatch--regional"></i>regional</span>
    <span class="legend__item"><i class="swatch swatch--weekend"></i>weekend</span>
  </p>`;
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
