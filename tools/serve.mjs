#!/usr/bin/env node
/**
 * A preview server for dist/. Thirty lines instead of a dependency.
 *   node tools/serve.mjs [port]
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(process.cwd(), 'dist');
const port = Number(process.argv[2] || process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function resolve(pathname) {
  const decoded = decodeURIComponent(pathname.split('?')[0]);
  let file = path.join(root, path.normalize(decoded).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(root)) return null;
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
  return existsSync(file) ? file : null;
}

http
  .createServer((req, res) => {
    const file = resolve(req.url) || path.join(root, '404.html');
    const status = resolve(req.url) ? 200 : 404;
    res.writeHead(status, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  })
  .listen(port, () => {
    process.stdout.write(`Serving dist/ on http://localhost:${port}\n`);
  });
