/**
 * Consent banner and ad initialisation.
 *
 * Choice is stored in localStorage only — nothing is sent anywhere.
 * Until a visitor accepts, ads are requested in non-personalised mode; a
 * decline keeps them that way permanently.
 *
 * This is a lightweight notice, not a certified CMP. EEA/UK traffic needs a
 * Google-certified consent management platform — see the README.
 */
(function () {
  'use strict';

  var KEY = 'hb-consent';
  var choice = null;
  try {
    choice = window.localStorage.getItem(KEY);
  } catch (error) {
    choice = null;
  }

  function startAds() {
    var units = document.querySelectorAll('ins.adsbygoogle');
    if (!units.length) return;
    window.adsbygoogle = window.adsbygoogle || [];
    if (choice !== 'accepted') window.adsbygoogle.requestNonPersonalizedAds = 1;
    for (var i = 0; i < units.length; i += 1) {
      if (units[i].getAttribute('data-loaded') === 'true') continue;
      units[i].setAttribute('data-loaded', 'true');
      try {
        window.adsbygoogle.push({});
      } catch (error) {
        /* ad blocked or script unavailable — the page is unaffected */
      }
    }
  }

  function remember(value) {
    choice = value;
    try {
      window.localStorage.setItem(KEY, value);
    } catch (error) {
      /* private mode: the choice simply does not persist */
    }
  }

  function banner() {
    var el = document.createElement('div');
    el.className = 'consent';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Cookie choices');
    el.innerHTML =
      '<div class="consent__inner">' +
      '<p>This site shows ads from Google, which may set cookies. Choose “Personalised ads” to allow ' +
      'ad personalisation, or “Non-personalised” to keep ads generic. Your choice is stored in this ' +
      'browser only. <a href="/privacy/">Privacy</a></p>' +
      '<div class="consent__actions">' +
      '<button type="button" data-consent="declined" class="ghost">Non-personalised</button>' +
      '<button type="button" data-consent="accepted">Personalised ads</button>' +
      '</div></div>';

    el.addEventListener('click', function (event) {
      var value = event.target.getAttribute && event.target.getAttribute('data-consent');
      if (!value) return;
      remember(value);
      el.remove();
      startAds();
    });

    document.body.appendChild(el);
  }

  startAds();
  if (choice !== 'accepted' && choice !== 'declined') banner();
})();
