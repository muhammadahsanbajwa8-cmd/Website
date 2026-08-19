import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BROWSER_MODULES } from '../lib/browser-modules.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every static import specifier in a module. */
function importsOf(source) {
  const specifiers = [];
  const pattern = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = pattern.exec(source))) specifiers.push(match[1]);
  return specifiers;
}

const sources = new Map();
for (const relative of BROWSER_MODULES) {
  sources.set(relative, await readFile(path.join(root, relative), 'utf8'));
}

test('modules shipped to the browser use no Node APIs', () => {
  for (const [relative, source] of sources) {
    for (const specifier of importsOf(source)) {
      assert.ok(
        !specifier.startsWith('node:'),
        `${relative} imports ${specifier}, which the browser cannot load`,
      );
    }
    assert.ok(!/\bprocess\.\w/.test(source), `${relative} touches process`);
    assert.ok(!/require\s*\(/.test(source), `${relative} uses require()`);
    assert.ok(!/__dirname|__filename/.test(source), `${relative} uses CommonJS globals`);
  }
});

test('every import of a shipped module is itself shipped', () => {
  const shipped = new Set(BROWSER_MODULES);
  for (const [relative, source] of sources) {
    for (const specifier of importsOf(source)) {
      assert.ok(specifier.startsWith('.'), `${relative} imports bare specifier ${specifier}`);
      const resolved = path
        .normalize(path.join(path.dirname(relative), specifier))
        .split(path.sep)
        .join('/');
      assert.ok(
        shipped.has(resolved),
        `${relative} imports ${specifier} → ${resolved}, which is not in BROWSER_MODULES`,
      );
    }
  }
});

test('every browser entry point only imports shipped modules', async () => {
  const shipped = new Set(BROWSER_MODULES.map((relative) => `/assets/mjs/${relative}`));
  for (const name of [
    'assets/compare.js',
    'assets/leave.js',
    'assets/team.js',
    'assets/assistant.js',
  ]) {
    const entry = await readFile(path.join(root, name), 'utf8');
    const specifiers = importsOf(entry);
    assert.ok(specifiers.length > 0, `${name} imports something`);
    for (const specifier of specifiers) {
      assert.ok(shipped.has(specifier), `${name} imports ${specifier}, which is not shipped`);
    }
  }
});

test('every interactive renderer is reachable from the shipped set', () => {
  for (const module of [
    'lib/pages/compare.mjs',
    'lib/compare.mjs',
    'lib/pages/leave.mjs',
    'lib/leave.mjs',
    'lib/pages/team.mjs',
    'lib/team.mjs',
    'lib/pages/assistant.mjs',
    'lib/assistant.mjs',
    'lib/glossary.mjs',
  ]) {
    assert.ok(BROWSER_MODULES.includes(module), `${module} is shipped to the browser`);
  }
  // The generator and the browser must agree on the config the layout reads.
  assert.ok(BROWSER_MODULES.includes('site.config.mjs'));
});
