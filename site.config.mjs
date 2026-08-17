/**
 * Everything a deployer changes lives in this file.
 * Nothing else in the codebase should need editing to deploy.
 */
export const config = {
  // --- Identity -------------------------------------------------------------
  name: 'Holiday Board',
  tagline: 'Public holidays and working days for every country, rebuilt nightly.',

  /**
   * Where the site lives. No trailing slash.
   *
   * This is the only place the address is written down. It sets the canonical
   * tag, Open Graph and every sitemap URL — and, if it has a path, it also
   * sets the folder the whole site is mounted under, so every internal link
   * and asset is prefixed to match. A GitHub Pages project site needs that;
   * a custom domain does not.
   *
   * Moving to your own domain is this one line: change it, and the /Website
   * prefix disappears from the entire build. See DEPLOY.md.
   */
  url: 'https://muhammadahsanbajwa8-cmd.github.io/Website',

  /** Shown on /about/ and /privacy/ as the contact of record. */
  contactEmail: 'hello@holidayboard.example',

  /** Two-letter codes highlighted on the home page. */
  featured: ['US', 'GB', 'DE', 'FR', 'CA', 'AU', 'IN', 'JP'],

  // --- Year range -----------------------------------------------------------
  /** Pages are generated for (currentYear - back) .. (currentYear + ahead). */
  years: {
    back: 1,
    ahead: 4,
  },

  // --- AdSense --------------------------------------------------------------
  /**
   * Leave publisherId empty until AdSense approves the site. While it is empty
   * the layout renders dashed placeholder boxes instead of ad code, so you can
   * see the page shape without serving ads from an unapproved property.
   */
  adsense: {
    publisherId: '', // e.g. 'pub-1234567890123456'
    slots: {
      leaderboard: '', // after the hero
      inArticle: '', // mid-page
      footer: '', // above the footer
    },
  },

  // --- Events ---------------------------------------------------------------
  /**
   * Concerts, comedy and other live events, from the Ticketmaster Discovery
   * API. Unlike the holiday data this needs a key — a free one from
   * https://developer.ticketmaster.com — supplied as the TICKETMASTER_API_KEY
   * environment variable rather than committed here.
   *
   * With no key the site builds exactly as it does today: no event pages, no
   * "What's on" in the nav, nothing invented. Run
   * `npm run build:offline -- --events-demo` to see the pages with clearly
   * labelled sample listings.
   */
  events: {
    provider: 'ticketmaster',
    apiBase: 'https://app.ticketmaster.com/discovery/v2',
    /**
     * The key is read from this environment variable at build time. It is named
     * here rather than read here: this file is also shipped to the browser for
     * the comparison, where `process` does not exist.
     */
    apiKeyEnv: 'TICKETMASTER_API_KEY',
    /** Empty means every published country; listing codes saves API calls. */
    countries: [],
    /** How far ahead to look, and how many to keep per category. */
    windowDays: 120,
    perCategory: 60,
  },

  // --- Data -----------------------------------------------------------------
  /** Nager.Date API root. No key, no registration. */
  apiBase: 'https://date.nager.at/api/v3',

  /** Where API responses are cached between builds. */
  cacheDir: '.cache',

  /** Where the site is written. */
  outDir: 'dist',
};

export default config;
