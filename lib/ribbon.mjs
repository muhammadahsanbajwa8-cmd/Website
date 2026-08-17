/**
 * The year ribbon: twelve rows of day cells, columns aligned by weekday so
 * every Monday sits in the same column, weekends muted, holidays punched out
 * in the one signal colour.
 *
 * Modes:
 *   holidays  a Map of ISO date -> holiday, for a single country
 *   heat      a Map of ISO date -> 0..1, for "how much of the world is off"
 *   booked    a Set of ISO dates bought with annual leave, shown hatched
 *   inBreak   a Set of ISO dates inside a planned break, shown as a band
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
  const booked = options.booked || null;
  const inBreak = options.inBreak || null;

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
      if (inBreak && inBreak.has(key)) classes.push('is-break');
      if (holiday) {
        classes.push(holiday.national === false ? 'is-holiday is-regional' : 'is-holiday');
        attrs.push(`title="${escapeAttr(`${holiday.name} — ${key}`)}"`);
      }
      if (booked && booked.has(key)) {
        classes.push('is-booked');
        attrs.push(`title="${escapeAttr(`Book this day off — ${key}`)}"`);
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

/**
 * Two countries on one planner: each month is a pair of rows sharing the same
 * weekday columns, so a day both countries are off reads as a solid block.
 *
 * @param {number} year
 * @param {{code: string, name: string, holidays: Map<string, object>}} a
 * @param {{code: string, name: string, holidays: Map<string, object>}} b
 * @param {{today?: string}} [options]
 */
export function twinRibbon(year, a, b, options = {}) {
  const today = options.today || null;

  const head = Array.from(
    { length: COLUMNS },
    (_, index) =>
      `<span class="ribbon__wd${index % 7 > 4 ? ' is-weekend' : ''}">${
        WEEKDAY_INITIALS[index % 7]
      }</span>`,
  ).join('');

  const sideCells = (side, other, month) => {
    const first = utc(year, month, 1);
    const offset = mondayIndex(first);
    const cells = [];
    for (let i = 0; i < offset; i += 1) cells.push('<span class="cell cell--pad"></span>');

    for (let day = 1; day <= daysInMonth(year, month); day += 1) {
      const date = utc(year, month, day);
      const key = iso(date);
      const holiday = side.holidays.get(key);
      const shared = Boolean(holiday && other.holidays.get(key));
      const classes = ['cell', 'cell--thin'];
      const attrs = [];

      if (isWeekend(date)) classes.push('is-weekend');
      if (holiday) {
        classes.push(holiday.national === false ? 'is-holiday is-regional' : 'is-holiday');
        if (shared) classes.push('is-shared');
        attrs.push(
          `title="${escapeAttr(
            `${side.name}: ${holiday.name} — ${key}${shared ? ' (both countries off)' : ''}`,
          )}"`,
        );
      }
      if (today && key === today) classes.push('is-today');

      cells.push(`<span class="${classes.join(' ')}" ${attrs.join(' ')}></span>`);
    }

    for (let i = offset + daysInMonth(year, month); i < COLUMNS; i += 1) {
      cells.push('<span class="cell cell--pad"></span>');
    }
    return cells.join('');
  };

  const rows = [];
  for (let month = 1; month <= 12; month += 1) {
    rows.push(`<div class="ribbon__row ribbon__row--twin">
      <span class="ribbon__month" title="${escapeAttr(MONTH_NAMES[month - 1])}">${
        MONTH_SHORT[month - 1]
      }</span>
      <div class="twin">
        <div class="ribbon__cells" data-side="${escapeAttr(a.code)}">${sideCells(a, b, month)}</div>
        <div class="ribbon__cells" data-side="${escapeAttr(b.code)}">${sideCells(b, a, month)}</div>
      </div>
    </div>`);
  }

  const sharedCount = [...a.holidays.keys()].filter((key) => b.holidays.has(key)).length;

  return `<div class="ribbon ribbon--twin" role="img" aria-label="${escapeAttr(
    `${year} planner comparing ${a.name} and ${b.name}. Each month shows ${a.name} on the upper row and ${b.name} on the lower row; ${sharedCount} days are public holidays in both.`,
  )}">
  <div class="ribbon__key" aria-hidden="true">
    <span><i class="ribbon__swatch"></i>upper row ${escapeAttr(a.name)}</span>
    <span><i class="ribbon__swatch"></i>lower row ${escapeAttr(b.name)}</span>
  </div>
  <div class="ribbon__scroll">
    <div class="ribbon__grid" aria-hidden="true">
      <div class="ribbon__row ribbon__row--head"><span class="ribbon__month"></span><div class="ribbon__cells">${head}</div></div>
      ${rows.join('\n      ')}
    </div>
  </div>
</div>`;
}

/**
 * A whole team on one planner: one row per country per month, sharing weekday
 * columns. Reading down a column tells you who is away that day, which is the
 * only question this view exists to answer.
 *
 * @param {number} year
 * @param {Array<{code: string, name: string, flag?: string, holidays: Map<string, object>}>} sides
 * @param {{today?: string}} [options]
 */
export function teamRibbon(year, sides, options = {}) {
  const today = options.today || null;

  const head = Array.from(
    { length: COLUMNS },
    (_, index) =>
      `<span class="ribbon__wd${index % 7 > 4 ? ' is-weekend' : ''}">${
        WEEKDAY_INITIALS[index % 7]
      }</span>`,
  ).join('');

  const sideCells = (side, month) => {
    const first = utc(year, month, 1);
    const offset = mondayIndex(first);
    const cells = [];
    for (let i = 0; i < offset; i += 1) cells.push('<span class="cell cell--pad"></span>');

    for (let day = 1; day <= daysInMonth(year, month); day += 1) {
      const date = utc(year, month, day);
      const key = iso(date);
      const holiday = side.holidays.get(key);
      // "Everyone off" is worth its own mark: those are the days a distributed
      // team can genuinely stop, rather than the days one office is quiet.
      const all = holiday && sides.every((other) => other.holidays.has(key));
      const classes = ['cell', 'cell--thin'];
      const attrs = [];

      if (isWeekend(date)) classes.push('is-weekend');
      if (holiday) {
        classes.push(holiday.national === false ? 'is-holiday is-regional' : 'is-holiday');
        if (all) classes.push('is-shared');
        attrs.push(
          `title="${escapeAttr(
            `${side.name}: ${holiday.name} — ${key}${all ? ' (everyone off)' : ''}`,
          )}"`,
        );
      }
      if (today && key === today) classes.push('is-today');

      cells.push(`<span class="${classes.join(' ')}" ${attrs.join(' ')}></span>`);
    }

    for (let i = offset + daysInMonth(year, month); i < COLUMNS; i += 1) {
      cells.push('<span class="cell cell--pad"></span>');
    }
    return cells.join('');
  };

  const rows = [];
  for (let month = 1; month <= 12; month += 1) {
    rows.push(`<div class="ribbon__row ribbon__row--team">
      <span class="ribbon__month" title="${escapeAttr(MONTH_NAMES[month - 1])}">${
        MONTH_SHORT[month - 1]
      }</span>
      <div class="twin twin--team">
        ${sides
          .map(
            (side) =>
              // The code sits after the cells, not before: a label on the left
              // would push every row out of the weekday columns the header
              // sets, and the alignment is the whole point of the view.
              `<div class="twin__line"><div class="ribbon__cells" data-side="${escapeAttr(
                side.code,
              )}">${sideCells(side, month)}</div><span class="twin__code">${escapeAttr(
                side.code,
              )}</span></div>`,
          )
          .join('\n        ')}
      </div>
    </div>`);
  }

  return `<div class="ribbon ribbon--twin ribbon--team" role="img" aria-label="${escapeAttr(
    `${year} planner for ${sides.length} countries: ${sides
      .map((side) => side.name)
      .join(', ')}. Each month shows one row per country, in that order.`,
  )}">
  <div class="ribbon__key" aria-hidden="true">
    ${sides
      .map(
        (side, index) =>
          `<span><i class="ribbon__swatch"></i>row ${index + 1} ${escapeAttr(side.name)}</span>`,
      )
      .join('\n    ')}
  </div>
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
  if (mode === 'twin') {
    return `<p class="legend">
      <span class="legend__item"><i class="swatch swatch--holiday"></i>public holiday</span>
      <span class="legend__item"><i class="swatch swatch--shared"></i>holiday in both</span>
      <span class="legend__item"><i class="swatch swatch--weekend"></i>weekend</span>
    </p>`;
  }
  if (mode === 'team') {
    return `<p class="legend">
      <span class="legend__item"><i class="swatch swatch--holiday"></i>one country off</span>
      <span class="legend__item"><i class="swatch swatch--shared"></i>everyone off</span>
      <span class="legend__item"><i class="swatch swatch--weekend"></i>weekend</span>
    </p>`;
  }
  if (mode === 'plan') {
    return `<p class="legend">
      <span class="legend__item"><i class="swatch swatch--holiday"></i>public holiday</span>
      <span class="legend__item"><i class="swatch swatch--booked"></i>day you book</span>
      <span class="legend__item"><i class="swatch swatch--break"></i>inside a break</span>
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
