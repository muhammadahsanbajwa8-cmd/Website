/**
 * Business-days calculator.
 *
 * Runs entirely in the browser against holiday data embedded in the page.
 * Nothing is sent anywhere — there is no request to make.
 */
(function () {
  'use strict';

  var root = document.getElementById('calc');
  if (!root) return;

  var payload = document.getElementById('holiday-data');
  if (!payload) return;
  var data = JSON.parse(payload.textContent);

  var startInput = document.getElementById('calc-start');
  var endInput = document.getElementById('calc-end');
  var inclusive = document.getElementById('calc-inclusive');
  var regional = document.getElementById('calc-regional');
  var output = document.getElementById('calc-output');
  var form = document.getElementById('calc-form');

  var DAY = 86400000;
  var MAX_DAYS = 3653; // ten years
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  /** ISO date string -> UTC Date, or null. */
  function parse(text) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text || '')) return null;
    var parts = text.split('-');
    var date = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
    return isNaN(date.getTime()) ? null : date;
  }

  function iso(date) {
    return date.toISOString().slice(0, 10);
  }

  function pretty(text) {
    var date = parse(text);
    if (!date) return text;
    return (
      WEEKDAYS[date.getUTCDay()] +
      ' ' +
      date.getUTCDate() +
      ' ' +
      MONTHS[date.getUTCMonth()] +
      ' ' +
      date.getUTCFullYear()
    );
  }

  /** Map of ISO date -> holiday name, for the years the range touches. */
  function holidayMap(fromYear, toYear, includeRegional) {
    var map = {};
    for (var year = fromYear; year <= toYear; year += 1) {
      var list = data.holidays[year];
      if (!list) continue;
      for (var i = 0; i < list.length; i += 1) {
        var holiday = list[i];
        if (!includeRegional && holiday.national === false) continue;
        if (!map[holiday.date]) map[holiday.date] = holiday.name;
      }
    }
    return map;
  }

  function message(kind, text) {
    output.innerHTML = '<p class="' + kind + '">' + text + '</p>';
  }

  function calculate() {
    var start = parse(startInput.value);
    var end = parse(endInput.value);

    if (!start || !end) {
      message('note', 'Pick a start date and an end date.');
      return;
    }
    if (end.getTime() < start.getTime()) {
      message(
        'calc__error',
        'The end date (' +
          pretty(endInput.value) +
          ') is before the start date. Swap them and try again.',
      );
      return;
    }

    var countEnd = inclusive.checked;
    var last = countEnd ? end : new Date(end.getTime() - DAY);
    var span = Math.round((last.getTime() - start.getTime()) / DAY) + 1;

    if (span <= 0) {
      message('note', 'That range is empty: with the end date excluded there are no days to count.');
      return;
    }
    if (span > MAX_DAYS) {
      message(
        'calc__error',
        'That range covers ' +
          span.toLocaleString() +
          ' days. This calculator handles up to ten years at a time — shorten the range.',
      );
      return;
    }

    var years = Object.keys(data.holidays).map(Number);
    var minYear = Math.min.apply(null, years);
    var maxYear = Math.max.apply(null, years);
    var map = holidayMap(start.getUTCFullYear(), last.getUTCFullYear(), regional.checked);

    var calendarDays = 0;
    var weekendDays = 0;
    var removed = [];
    for (var d = start.getTime(); d <= last.getTime(); d += DAY) {
      var day = new Date(d);
      calendarDays += 1;
      var dow = day.getUTCDay();
      if (dow === 0 || dow === 6) {
        weekendDays += 1;
        continue;
      }
      var key = iso(day);
      if (map[key]) removed.push({ date: key, name: map[key] });
    }
    var business = calendarDays - weekendDays - removed.length;

    var uncovered = [];
    if (start.getUTCFullYear() < minYear) uncovered.push('before ' + minYear);
    if (last.getUTCFullYear() > maxYear) uncovered.push('after ' + maxYear);

    var html =
      '<p class="eyebrow">Working days</p>' +
      '<p><span class="calc__big">' +
      business.toLocaleString() +
      '</span></p>' +
      '<p class="note">' +
      pretty(iso(start)) +
      ' to ' +
      pretty(endInput.value) +
      (countEnd ? ', end date included' : ', end date excluded') +
      '.</p>' +
      '<ul class="calc__breakdown">' +
      row('Calendar days', calendarDays) +
      row('Weekend days removed', '−' + weekendDays) +
      row('Public holidays removed', '−' + removed.length) +
      row('Working days', business) +
      '</ul>';

    if (removed.length) {
      html +=
        '<h3>Holidays subtracted</h3><div class="table-scroll"><table>' +
        '<thead><tr><th>Date</th><th>Weekday</th><th>Holiday</th></tr></thead><tbody>' +
        removed
          .map(function (holiday) {
            var date = parse(holiday.date);
            return (
              '<tr><td class="date">' +
              holiday.date +
              '</td><td>' +
              WEEKDAYS[date.getUTCDay()] +
              '</td><td>' +
              escapeHTML(holiday.name) +
              '</td></tr>'
            );
          })
          .join('') +
        '</tbody></table></div>';
    } else {
      html += '<p class="note">No public holidays fall on a weekday inside this range.</p>';
    }

    if (uncovered.length) {
      html +=
        '<p class="note">Heads up: this site holds holiday data for ' +
        minYear +
        '–' +
        maxYear +
        ', so days ' +
        uncovered.join(' and ') +
        ' were counted with weekends removed but no holidays subtracted.</p>';
    }

    output.innerHTML = html;
  }

  function row(label, value) {
    return '<li><span>' + label + '</span><span>' + value.toLocaleString() + '</span></li>';
  }

  function escapeHTML(text) {
    return String(text).replace(/[&<>"]/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character];
    });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    calculate();
  });
  [startInput, endInput, inclusive, regional].forEach(function (element) {
    element.addEventListener('change', calculate);
  });

  var reset = document.getElementById('calc-reset');
  if (reset) {
    reset.addEventListener('click', function () {
      startInput.value = data.defaults.start;
      endInput.value = data.defaults.end;
      inclusive.checked = true;
      regional.checked = false;
      calculate();
    });
  }

  calculate();
})();
