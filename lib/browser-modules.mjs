/**
 * The modules shipped to the browser for the comparison pages.
 *
 * They are copied into dist/assets/mjs/ with their directory structure intact,
 * so their relative imports resolve exactly as they do on disk. That is what
 * lets the interactive comparison run the generator's own code with no bundler
 * and no second implementation to drift.
 *
 * Every module listed here must be free of Node APIs, and every module they
 * import must also be listed. `test/browser-modules.test.mjs` enforces both.
 */
export const BROWSER_MODULES = [
  'site.config.mjs',
  'lib/dates.mjs',
  'lib/compare.mjs',
  'lib/ribbon.mjs',
  'lib/html.mjs',
  'lib/stats.mjs',
  'lib/leave.mjs',
  'lib/team.mjs',
  'lib/glossary.mjs',
  'lib/assistant.mjs',
  'lib/pages/compare.mjs',
  'lib/pages/assistant.mjs',
  'lib/pages/leave.mjs',
  'lib/pages/team.mjs',
];

export default BROWSER_MODULES;
