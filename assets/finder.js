/**
 * Country finder. Fetches /countries.json once and filters it in the browser.
 * Keyboard: type to filter, arrow keys to move, Enter to open.
 */
(function () {
  'use strict';

  var input = document.getElementById('country-finder');
  var results = document.getElementById('finder-results');
  if (!input || !results) return;

  var countries = [];
  var loaded = false;

  /** Where the site is mounted; empty when served from a domain root. */
  var BASE = document.documentElement.dataset.base || '';

  function load() {
    if (loaded) return Promise.resolve();
    loaded = true;
    return fetch(BASE + '/countries.json')
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        countries = data.countries || [];
        render(input.value);
      })
      .catch(function () {
        results.innerHTML = '<li><a href="' + BASE + '/countries/">Browse all countries</a></li>';
      });
  }

  function normalise(text) {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function render(query) {
    var q = normalise(query.trim());
    if (!q) {
      results.innerHTML = '';
      return;
    }
    var matches = [];
    for (var i = 0; i < countries.length && matches.length < 12; i += 1) {
      var country = countries[i];
      var name = normalise(country.name);
      if (name.indexOf(q) === 0 || normalise(country.code) === q) matches.unshift(country);
      else if (name.indexOf(q) > -1) matches.push(country);
    }
    if (!matches.length) {
      results.innerHTML =
        '<li><a href="' + BASE + '/countries/">No match — browse all countries</a></li>';
      return;
    }
    results.innerHTML = matches
      .slice(0, 12)
      .map(function (country) {
        return (
          '<li><a href="' +
          country.url +
          '"><span>' +
          country.flag +
          ' ' +
          country.name +
          '</span><span class="code">' +
          country.code +
          '</span></a></li>'
        );
      })
      .join('');
  }

  input.addEventListener('focus', load);
  input.addEventListener('input', function () {
    load();
    render(input.value);
  });

  input.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowDown') {
      var first = results.querySelector('a');
      if (first) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  results.addEventListener('keydown', function (event) {
    var links = Array.prototype.slice.call(results.querySelectorAll('a'));
    var index = links.indexOf(document.activeElement);
    if (index < 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      (links[index + 1] || links[0]).focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (index === 0) input.focus();
      else links[index - 1].focus();
    } else if (event.key === 'Escape') {
      input.focus();
    }
  });
})();
