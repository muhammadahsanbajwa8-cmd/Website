import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import config from '../site.config.mjs';
import { BASE, url } from '../lib/html.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the mount point comes from the configured URL', () => {
  assert.equal(BASE, new URL(config.url).pathname.replace(/\/+$/, ''));
  // Either empty, or a path with no trailing slash — never a bare '/'.
  assert.ok(BASE === '' || (BASE.startsWith('/') && !BASE.endsWith('/')), `BASE is '${BASE}'`);
});

test('every address the site generates carries the mount point', () => {
  const generated = [
    url.home(),
    url.countries(),
    url.today(),
    url.about(),
    url.privacy(),
    url.compare(),
    url.team(),
    url.assistant(),
    url.country('DE'),
    url.year('DE', 2026),
    url.calculator('DE'),
    url.leave('DE'),
    url.events(),
    url.countryEvents('DE', 'concerts'),
    url.pair('FR', 'DE'),
    url.compareQuery('DE', 'FR', 2026),
    url.holiday('DE', '2026-12-25'),
    url.asset('/assets/board.css'),
  ];
  for (const address of generated) {
    assert.ok(address.startsWith(`${BASE}/`), `${address} does not start with '${BASE}/'`);
  }
});

test('absolute URLs carry the mount point exactly once', () => {
  if (!BASE) return; // nothing to double
  for (const pathname of [url.home(), url.year('DE', 2026), url.asset('/sitemap.xml')]) {
    const absolute = url.absolute(pathname);
    const occurrences = absolute.split(BASE).length - 1;
    assert.equal(occurrences, 1, `${absolute} repeats '${BASE}'`);
    assert.ok(absolute.startsWith(new URL(config.url).origin));
  }
});

test('pair URLs stay alphabetical whatever the mount point', () => {
  assert.equal(url.pair('FR', 'DE'), url.pair('DE', 'FR'));
  assert.ok(url.pair('FR', 'DE').endsWith('/compare/de-vs-fr/'));
});

/**
 * The guard that matters.
 *
 * Sub-path hosting breaks one hardcoded address at a time, and it breaks
 * quietly: the page still renders, one link just goes nowhere. Every internal
 * address has to come from `url.*` on the server, or from the mount point the
 * layout stamps on <html> in the browser. A literal root-absolute path in
 * either place is the bug, so fail on the literal rather than waiting to find
 * the broken link.
 */
test('no internal address is hardcoded to the domain root', async () => {
  const offenders = [];

  const scan = async (dir, extensions) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scan(full, extensions);
        continue;
      }
      if (!extensions.some((extension) => entry.name.endsWith(extension))) continue;

      const source = await readFile(full, 'utf8');
      const relative = path.relative(root, full);

      source.split('\n').forEach((line, index) => {
        // Only markup attributes and fetch targets; a comment or a route table
        // key is not an address the browser will follow.
        const matches = [
          ...line.matchAll(/(?:href|src)=(["'])(\/(?!\/)[^"']*)\1/g),
          ...line.matchAll(/fetch\(\s*(["'])(\/(?!\/)[^"']*)\1/g),
        ];
        for (const match of matches) {
          offenders.push(`${relative}:${index + 1}  ${match[2]}`);
        }
      });
    }
  };

  await scan(path.join(root, 'lib'), ['.mjs']);
  await scan(path.join(root, 'assets'), ['.js']);

  assert.deepEqual(
    offenders,
    [],
    `these addresses ignore the mount point and 404 on a sub-path host:\n  ${offenders.join('\n  ')}`,
  );
});

test('static module specifiers are the one exception, and are rewritten at build', async () => {
  // `import ... from '/assets/mjs/...'` cannot read the mount point at runtime:
  // the browser resolves it before any of our code runs. build.mjs rewrites
  // these on the way into dist/, so the literal is expected here — but the
  // rewrite has to still exist.
  const build = await readFile(path.join(root, 'build.mjs'), 'utf8');
  assert.match(build, /assets\\\/mjs\\\//, 'build.mjs still rebases module specifiers');

  const entries = ['assets/compare.js', 'assets/leave.js', 'assets/team.js', 'assets/assistant.js'];
  for (const name of entries) {
    const source = await readFile(path.join(root, name), 'utf8');
    assert.match(source, /from '\/assets\/mjs\//, `${name} imports from /assets/mjs/`);
  }
});
