#!/usr/bin/env node
/**
 * Bundle dist/ into one self-contained HTML file you can open, mail, or drop
 * in a message — no server, no network.
 *
 *   npm run build:offline && npm run preview   →  dist/preview.html
 *
 * Every generated page keeps its own markup. The stylesheet, fonts, scripts,
 * ES modules and country data are stored once and composed into an iframe at
 * view time, so the site's CSS and media queries behave exactly as they do
 * when served.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import config from '../site.config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.resolve(root, config.outDir);
const cacheDir = path.resolve(root, config.cacheDir);
const output = path.join(dist, 'preview.html');

if (!existsSync(path.join(dist, 'index.html'))) {
  process.stderr.write(
    `No build found in ${config.outDir}/. Run \`npm run build\` or \`npm run build:offline\` first.\n`,
  );
  process.exit(1);
}

async function walk(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full)));
    else found.push(full);
  }
  return found;
}

const files = (await walk(dist)).filter((file) => file !== output);

/**
 * A full build is a few thousand pages — far more than belongs in a single
 * file you can mail. Every shared page is included, plus every page for a
 * sample of countries chosen to show the range: complete rule sets, core
 * coverage, estimated Islamic dates and the Orthodox computus.
 *
 * Override with `--countries=US,GB,...`, or `--countries=all` for everything.
 */
const DEFAULT_SAMPLE = [
  ...config.featured,
  'NG', // core coverage, with estimated Eid dates
  'SA', // an entirely lunar calendar
  'GR', // Orthodox Easter
  'BR',
];
const requested = (process.argv.find((arg) => arg.startsWith('--countries=')) || '').split('=')[1];
const sample = requested === 'all' ? null : new Set((requested ? requested.split(',') : DEFAULT_SAMPLE).map((code) => code.trim().toUpperCase()));

/** Country-scoped routes are `/xx/...`; everything else is shared. */
function inSample(route) {
  if (!sample) return true;
  const first = route.split('/')[1] || '';
  if (!/^[a-z]{2}$/.test(first)) return true;
  return sample.has(first.toUpperCase());
}

// --- Pages -------------------------------------------------------------------

const pages = {};
let skipped = 0;
for (const file of files.filter((file) => file.endsWith('.html'))) {
  const source = await readFile(file, 'utf8');
  const route = `/${path.relative(dist, file).replace(/index\.html$/, '').split(path.sep).join('/')}`;
  if (!inSample(route)) {
    skipped += 1;
    continue;
  }
  const body = source.match(/<body[^>]*>([\s\S]*)<\/body>/);
  if (!body) continue;

  pages[route] = {
    title: (source.match(/<title>([\s\S]*?)<\/title>/) || [, ''])[1],
    // Script tags are re-attached at compose time from the inlined sources.
    scripts: [...source.matchAll(/<script[^>]*src="([^"]+)"/g)].map((match) => match[1]),
    body: body[1].replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, ''),
  };
}

// --- Styles, scripts, modules, data ------------------------------------------

const css = await readFile(path.join(dist, 'assets/board.css'), 'utf8');

const scripts = {};
for (const file of files.filter((file) => /assets\/[^/]+\.js$/.test(file))) {
  scripts[`/assets/${path.basename(file)}`] = await readFile(file, 'utf8');
}

/**
 * The comparison's ES modules, served from blob: URLs through an import map.
 *
 * Every specifier is rewritten to a *bare* one (`hb/lib/dates.mjs`). Bare
 * specifiers are the only kind an import map can remap unconditionally: a
 * path-absolute specifier is resolved against the importing module's own URL
 * first, and a blob: URL has no hierarchy to resolve against.
 */
const BARE = 'hb/';
const moduleKey = (file) =>
  BARE + path.relative(path.join(dist, 'assets/mjs'), file).split(path.sep).join('/');

const modules = {};
for (const file of files.filter((file) => file.includes(`${path.sep}assets${path.sep}mjs${path.sep}`))) {
  const key = moduleKey(file);
  const source = await readFile(file, 'utf8');
  modules[key] = source.replace(/(from\s+['"])(\.[^'"]+)(['"])/g, (_, open, specifier, close) => {
    const dir = path.posix.dirname(key.slice(BARE.length));
    const resolved = path.posix.normalize(path.posix.join(dir, specifier));
    return `${open}${BARE}${resolved}${close}`;
  });
}

// Anything the pages fetch at runtime, served from memory by a fetch shim.
const data = {};
for (const file of files.filter((file) => file.endsWith('.json'))) {
  const key = `/${path.relative(dist, file).split(path.sep).join('/')}`;
  const match = key.match(/^\/data\/([A-Z]{2})\.json$/);
  if (match && sample && !sample.has(match[1])) continue;
  data[key] = await readFile(file, 'utf8');
}

// The site's own token blocks, so the preview can force either theme.
const lightTokens = css.match(/:root\s*\{([\s\S]*?)\}/)[1];
const darkTokens = css.match(/@media \(prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\}/)[1];

// --- Fonts -------------------------------------------------------------------

/**
 * Inline the webfaces so the preview shows the real typography offline. The
 * URL is read back out of the built HTML rather than repeated here, so it
 * cannot drift from what the site actually requests.
 */
async function inlineFonts() {
  const home = await readFile(path.join(dist, 'index.html'), 'utf8');
  const href = (home.match(/<link rel="stylesheet" href="(https:\/\/fonts\.googleapis\.com[^"]+)"/) ||
    [])[1];
  if (!href) return { head: '', note: 'no webfont link in the build' };

  const link = `<link rel="stylesheet" href="${href}">`;
  const cacheFile = path.join(cacheDir, 'preview-fonts.css');
  if (existsSync(cacheFile)) {
    return { head: `<style>${await readFile(cacheFile, 'utf8')}</style>`, note: 'from cache' };
  }

  const agent =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
  try {
    const response = await fetch(href.replace(/&amp;/g, '&'), {
      headers: { 'user-agent': agent },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const sheet = await response.text();

    // Latin only: the site's own copy is English.
    const blocks = sheet
      .split('@font-face')
      .slice(1)
      .map((block) => `@font-face${block.split('}\n')[0]}}`)
      .filter((block) => /unicode-range:[^;]*U\+0000-00FF/.test(block));

    let out = '';
    for (const block of blocks) {
      const url = block.match(/url\((https:\/\/[^)]+\.woff2)\)/);
      if (!url) continue;
      const font = await fetch(url[1], {
        headers: { 'user-agent': agent },
        signal: AbortSignal.timeout(20_000),
      });
      if (!font.ok) throw new Error(`HTTP ${font.status}`);
      const base64 = Buffer.from(await font.arrayBuffer()).toString('base64');
      out += `${block.replace(
        /url\(https:\/\/[^)]+\.woff2\)\s*format\('woff2'\)/,
        `url(data:font/woff2;base64,${base64}) format('woff2')`,
      )}\n`;
    }
    if (!out) throw new Error('no latin faces found');

    await mkdir(cacheDir, { recursive: true });
    await writeFile(cacheFile, out);
    return { head: `<style>${out}</style>`, note: `${blocks.length} faces embedded` };
  } catch (error) {
    // No network: fall back to the stylesheet link, which works in any browser
    // that is online when the file is opened.
    return { head: link, note: `linked, not embedded (${error.message})` };
  }
}

const fonts = await inlineFonts();

// --- Compose -----------------------------------------------------------------

const payload = {
  pages,
  css,
  fontsHead: fonts.head,
  scripts,
  modules,
  // The browser entry point, pointed at the same bare specifiers.
  entry: (scripts['/assets/compare.js'] || '').replace(/(['"])\/assets\/mjs\//g, `$1${BARE}`),
  data,
  lightTokens,
  darkTokens,
  site: {
    name: config.name,
    pages: Object.keys(pages).length,
    skipped,
    countries: sample ? sample.size : null,
  },
};

const shell = await readFile(path.join(root, 'tools/preview-shell.html'), 'utf8');
const encoded = JSON.stringify(payload).replace(/</g, '\\u003c');
await writeFile(output, shell.replace('__PAYLOAD__', () => encoded));

const size = (await stat(output)).size;
process.stdout.write(
  `\n  preview:  ${path.relative(process.cwd(), output)}\n` +
    `  pages:    ${Object.keys(pages).length}\n` +
    `  fonts:    ${fonts.note}\n` +
    `  size:     ${(size / 1024 / 1024).toFixed(2)} MB\n` +
    `  open it directly in a browser — no server needed\n\n`,
);
