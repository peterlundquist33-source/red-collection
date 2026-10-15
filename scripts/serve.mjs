#!/usr/bin/env node
/**
 * Minimal local preview server for dist/ (no dependencies).
 *   npm run build && npm run serve   ->  http://localhost:4321/red-collection/
 *
 * It mounts dist/ at /red-collection/ so the preview matches the GitHub Pages
 * project path exactly.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const BASE = '/red-collection/';
const PORT = Number(process.env.PORT ?? 4321);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
};

if (!fs.existsSync(DIST)) {
  console.error('dist/ not found - run `npm run build` first.');
  process.exit(1);
}

http
  .createServer((request, response) => {
    const url = new URL(request.url, `http://localhost:${PORT}`);
    if (url.pathname === '/' || url.pathname === BASE.slice(0, -1)) {
      response.writeHead(302, { Location: BASE });
      response.end();
      return;
    }
    if (!url.pathname.startsWith(BASE)) {
      response.writeHead(404).end('Not found');
      return;
    }

    let relative = decodeURIComponent(url.pathname.slice(BASE.length));
    if (relative === '' || relative.endsWith('/')) relative += 'index.html';

    const target = path.resolve(DIST, relative);
    if (!target.startsWith(DIST + path.sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }

    response.writeHead(200, {
      'Content-Type': TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(target).pipe(response);
  })
  .listen(PORT, () => {
    console.log(`Preview: http://localhost:${PORT}${BASE}`);
  });
