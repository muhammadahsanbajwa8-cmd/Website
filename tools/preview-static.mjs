#!/usr/bin/env node
/**
 * A preview that cannot fail to display.
 *
 * `preview.mjs` packs all 1,791 pages into one file, but it pays for that with
 * machinery: a gzipped payload, DecompressionStream, ES modules served from
 * blob: URLs, and each page composed into an iframe with srcdoc. Every one of
 * those is routinely blocked by a sandboxed viewer — a mail client, a chat
 * attachment pane, a locked-down browser profile — and when any of them is
 * blocked the reader gets a blank rectangle and no explanation.
 *
 * This builds the opposite: a selection of complete pages stacked into one
 * plain document, styles inlined, fonts embedded, and **not one line of
 * JavaScript**. Nothing to block. It renders anywhere HTML renders.
 *
 * The trade is coverage. It carries a representative set of pages rather than
 * the whole site, because a single document holding all of them would be 60 MB
 * of markup.
 *
 *   npm run build:offline && npm run preview:static   →  dist/preview-static.html
 */

import { existsSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import config from '../site.config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.resolve(root, config.outDir);
const cacheDir = path.resolve(root, config.cacheDir);
const output = path.join(
  dist,
  process.argv.includes('--fragment') ? 'preview-fragment.html' : 'preview-static.html',
);

if (!existsSync(path.join(dist, 'index.html'))) {
  process.stderr.write(`No build in ${config.outDir}/. Run \`npm run build:offline\` first.\n`);
  process.exit(1);
}

/**
 * What to include, and what each one is for. Chosen to show every *kind* of
 * page the generator makes rather than every page it made.
 */
const ROUTES = [
  ['/', 'Home', 'The front page: a heat-mapped year ribbon showing how much of the world is off, and the country finder.'],
  ['/countries/', 'All countries', 'Every one of the 195 countries the site holds data for, grouped by region.'],
  ['/de/', 'Country hub — Germany', 'What a single country looks like: next holiday, year-by-year totals, and the tools for it.'],
  ['/de/2026/', 'Year page — Germany 2026', 'The core page. Every holiday with the date, weekday, scope, and an explanation of what the day is for.'],
  ['/de/annual-leave-planner/', 'Annual leave planner', 'The optimiser: where to spend a leave allowance for the most time off. The plan shown is the real computed one.'],
  ['/team/', 'Team holiday overlap', 'Several countries on one planner — the days a distributed team is genuinely all available.'],
  ['/us/business-days-calculator/', 'Working days calculator', 'Both modes: days between two dates, and the date a number of business days away.'],
  ['/compare/de-vs-fr/', 'Comparison — Germany vs France', 'Two countries side by side: shared days off, long weekends, quietest months.'],
  ['/today/', 'Today', 'Who has a public holiday right now, and what is coming up next across the world.'],
  ['/about/', 'About & sources', 'Where the data comes from, how it is built, and the limits of it.'],
];

const css = await readFile(path.join(dist, 'assets/board.css'), 'utf8');

/**
 * `--fragment` emits the page without the document wrapper, for a host that
 * supplies its own <head> and <body>.
 */
const fragment = process.argv.includes('--fragment');

/**
 * The site's stylesheet decides light or dark from `prefers-color-scheme`
 * alone, which is right for a site: the visitor's OS is the only signal there
 * is. A viewer that also offers its own light/dark switch has a third state,
 * and against this stylesheet the switch would do nothing in one direction and
 * the wrong thing in the other — a light choice on a dark OS still gets dark
 * tokens, and a dark choice on a light OS is ignored.
 *
 * Rather than edit the site's CSS for the sake of a preview, layer the two
 * missing cases on top. The site's own rules are untouched and still win when
 * nothing is stamped.
 */
const tokenBlock = (source, marker) => {
  const at = source.indexOf(marker);
  if (at < 0) return '';
  const open = source.indexOf('{', at + marker.length);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return '';
};

const lightTokens = tokenBlock(css, ':root');
const darkTokens = tokenBlock(css.slice(css.indexOf('@media (prefers-color-scheme: dark)')), ':root');

const themeGuards =
  lightTokens && darkTokens
    ? `
/* An explicit light choice beats a dark operating system. */
@media (prefers-color-scheme: dark) {
  :root[data-theme="light"] {${lightTokens}}
}
/* An explicit dark choice works on a light operating system. */
:root[data-theme="dark"] {${darkTokens}}
`
    : '';

/**
 * The embedded webfaces, if a previous `npm run preview` cached them. Without
 * them the page falls back to system fonts rather than reaching for a CDN:
 * one external request is one thing a sandbox can block, and the whole point
 * of this file is that nothing in it can be blocked.
 */
let fontFaces = '';
const fontCache = path.join(cacheDir, 'preview-fonts.css');
if (existsSync(fontCache)) fontFaces = await readFile(fontCache, 'utf8');

const anchorFor = (route) =>
  `page${route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || '-home'}`;

const included = new Map(ROUTES.map(([route]) => [route, anchorFor(route)]));

const sections = [];
const missing = [];

for (const [route, title, blurb] of ROUTES) {
  const file = path.join(dist, route.slice(1), 'index.html');
  if (!existsSync(file)) {
    missing.push(route);
    continue;
  }
  const source = await readFile(file, 'utf8');
  const main = source.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  if (!main) {
    missing.push(route);
    continue;
  }

  const body = main[1]
    // No scripts at all — including the JSON payloads the interactive pages
    // carry, which are dead weight without the code that reads them.
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<noscript>[\s\S]*?<\/noscript>/g, '')
    // Links to pages that are in this file become anchors; everything else
    // is flattened to plain text so nothing looks clickable and then isn't.
    .replace(/href="(\/[^"#?]*?)"/g, (whole, href) =>
      included.has(href) ? `href="#${included.get(href)}"` : `data-dead="${href}"`,
    );

  sections.push(
    `<section class="pv-page" id="${anchorFor(route)}">
      <div class="pv-head">
        <p class="pv-route">${route}</p>
        <h2 class="pv-title">${title}</h2>
        <p class="pv-blurb">${blurb}</p>
      </div>
      <div class="pv-body">${body}</div>
      <p class="pv-back"><a href="#pv-top">↑ back to the list</a></p>
    </section>`,
  );
}

const contents = ROUTES.filter(([route]) => !missing.includes(route))
  .map(
    ([route, title, blurb]) =>
      `<li><a href="#${anchorFor(route)}"><strong>${title}</strong><code>${route}</code></a>
       <span>${blurb}</span></li>`,
  )
  .join('\n');

const totalPages = 1791;

const style = `<style>
${fontFaces}
${css}
${themeGuards}

/* --- Preview housing ------------------------------------------------------
   Deliberately plain: this wrapper exists only to separate one page from the
   next. Everything inside .pv-body is the site's own markup and styles. */
.pv-shell {
  max-width: 74rem;
  margin: 0 auto;
  padding: 2.5rem 1.25rem 4rem;
}
.pv-lede {
  border-bottom: 3px solid var(--ink);
  padding-bottom: 1.5rem;
  margin-bottom: 2rem;
}
.pv-lede h1 {
  font-family: var(--display);
  font-size: clamp(2rem, 5vw, 3.2rem);
  line-height: 1.05;
  margin: 0 0 0.75rem;
  letter-spacing: -0.02em;
}
.pv-lede p {
  max-width: 46rem;
  font-size: 1.05rem;
  color: var(--ink-soft);
  margin: 0 0 0.6rem;
}
.pv-toc {
  list-style: none;
  margin: 0 0 3rem;
  padding: 0;
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
}
.pv-toc li {
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  padding: 0.85rem 1rem;
  background: var(--board-raised);
}
.pv-toc a {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
  text-decoration: none;
  color: var(--ink);
  margin-bottom: 0.3rem;
}
.pv-toc a:hover strong { text-decoration: underline; }
.pv-toc code {
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--ink-faint);
}
.pv-toc span {
  display: block;
  font-size: 0.85rem;
  color: var(--ink-soft);
  line-height: 1.45;
}
.pv-page {
  margin: 0 0 3.5rem;
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--board);
}
.pv-head {
  padding: 1.1rem 1.25rem;
  background: var(--ink);
  color: var(--board);
}
.pv-route {
  font-family: var(--mono);
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  margin: 0 0 0.3rem;
  color: var(--signal);
}
.pv-title {
  font-family: var(--display);
  font-size: 1.35rem;
  margin: 0 0 0.35rem;
  color: var(--board);
}
.pv-blurb {
  margin: 0;
  font-size: 0.9rem;
  max-width: 52rem;
  color: #cdc7b4;
  line-height: 1.5;
}
.pv-body { padding: 0.5rem 0 1.5rem; }
.pv-back {
  margin: 0;
  padding: 0.75rem 1.25rem;
  border-top: 1px solid var(--rule);
  font-size: 0.82rem;
}
/* A link whose target is not in this file: shown as text, not as a promise. */
[data-dead] {
  color: inherit;
  text-decoration: none;
  cursor: default;
  border-bottom: 1px dotted var(--rule-strong);
}
/* The interactive controls cannot compute without JavaScript, and this file
   deliberately has none. Say so on the control rather than leaving a form
   that looks live and does nothing. */
.calc__form, .planner, .team, .finder, #compare-picker {
  position: relative;
}
.calc__form::after, .planner::after, .team::after, .finder::after, #compare-picker::after {
  content: 'Static preview — this control is live on the real site';
  display: block;
  margin-top: 0.9rem;
  padding-top: 0.7rem;
  border-top: 1px dashed var(--rule-strong);
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.03em;
  color: var(--ink-faint);
  grid-column: 1 / -1;
}
</style>`;

const content = `<div class="pv-shell" id="pv-top">

<div class="pv-lede">
  <h1>${config.name} — what the site looks like</h1>
  <p>Ten pages from the build, complete and unaltered, one after another. Every
    style, layout and calendar here is exactly what a visitor would see.</p>
  <p>The real build is <strong>${totalPages.toLocaleString('en')} pages</strong> across
    195 countries — this file carries one of each <em>kind</em> of page rather
    than all of them, because the whole site as a single document would be
    60&nbsp;MB of markup.</p>
  <p>There is no JavaScript in this file, so the forms and pickers are shown as
    they arrive rather than as they behave. The numbers, calendars and plans
    below are all real, computed at build time.</p>
</div>

<ol class="pv-toc">
${contents}
</ol>

${sections.join('\n')}

</div>
`;

// A host that supplies its own <head> and <body> gets the parts, not a second
// document nested inside its own.
const html = fragment
  ? `<title>${config.name}</title>\n${style}\n${content}`
  : `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${config.name} — preview</title>
${style}
</head>
<body>
${content}</body>
</html>
`;

await writeFile(output, html);
const size = (await stat(output)).size;

process.stdout.write(
  `\n  preview:  ${path.relative(process.cwd(), output)}\n` +
    `  pages:    ${sections.length} of ${ROUTES.length} requested${
      missing.length ? ` (missing: ${missing.join(', ')})` : ''
    }\n` +
    `  fonts:    ${fontFaces ? 'embedded from cache' : 'system fallback (run `npm run preview` once to cache the webfaces)'}\n` +
    `  scripts:  none — nothing for a sandbox to block\n` +
    `  size:     ${(size / 1024 / 1024).toFixed(2)} MB\n` +
    `  open it directly in a browser\n\n`,
);
