/**
 * Everything a deployer changes lives in this file.
 * Nothing else in the codebase should need editing to deploy.
 */
export const config = {
  // --- Identity -------------------------------------------------------------
  name: 'Holiday Board',
  tagline: 'Public holidays and working days for every country, rebuilt nightly.',

  /** Canonical origin. No trailing slash. Used for canonical tags, OG, sitemap. */
  url: 'https://holidayboard.example',

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

  // --- Data -----------------------------------------------------------------
  /** Nager.Date API root. No key, no registration. */
  apiBase: 'https://date.nager.at/api/v3',

  /** Where API responses are cached between builds. */
  cacheDir: '.cache',

  /** Where the site is written. */
  outDir: 'dist',
};

export default config;
