/**
 * End-to-end checks over the real build and privacy gate, plus the local
 * image intake rules.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { copyImages, sniffImageType } from '../scripts/lib/images.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

function run(script, env = {}) {
  return execFileSync(process.execPath, [path.join(ROOT, 'scripts', script)], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('build produces dist/ with exactly the public files', () => {
  const output = run('build.mjs');
  assert.match(output, /Built dist\//);

  for (const file of [
    'index.html',
    'favicon.svg',
    'robots.txt',
    '.nojekyll',
    'assets/css/styles.css',
    'assets/js/app.js',
    'assets/js/core.js',
    'data/cards.json',
  ]) {
    assert.ok(fs.existsSync(path.join(DIST, file)), `dist/${file} is missing`);
  }

  for (const forbidden of ['scripts', 'tests', 'templates', 'node_modules', 'package.json', 'README.md', '.github']) {
    assert.ok(!fs.existsSync(path.join(DIST, forbidden)), `dist/${forbidden} must not be published`);
  }

  // dist's copy must exactly mirror the committed source — the build step
  // copies, it never edits card data.
  const distCards = JSON.parse(fs.readFileSync(path.join(DIST, 'data/cards.json'), 'utf8'));
  const srcCards = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/cards.json'), 'utf8'));
  assert.deepEqual(distCards, srcCards);
});

test('privacy gate passes on the real build', () => {
  run('build.mjs');
  const output = run('check-dist.mjs');
  assert.match(output, /Privacy check passed/);
});

test('privacy gate fails when a forbidden term is planted in dist', () => {
  run('build.mjs');
  const planted = path.join(DIST, 'leak.html');
  fs.writeFileSync(planted, '<p>Purchase price: 250</p>');
  try {
    assert.throws(
      () => run('check-dist.mjs'),
      (error) => /forbidden term/.test(String(error.stderr ?? '') + String(error.stdout ?? '')),
    );
  } finally {
    fs.rmSync(planted, { force: true });
  }
});

test('privacy gate fails when a Drive URL is planted in dist', () => {
  run('build.mjs');
  const planted = path.join(DIST, 'leak.html');
  fs.writeFileSync(planted, '<a href="https://drive.google.com/file/d/x/view">scan</a>');
  try {
    assert.throws(
      () => run('check-dist.mjs'),
      (error) => /forbidden host/.test(String(error.stderr ?? '') + String(error.stdout ?? '')),
    );
  } finally {
    fs.rmSync(planted, { force: true });
  }
});

test('privacy gate fails when a private identifier from the environment appears in dist', () => {
  run('build.mjs');
  const secret = 'PRIVATE-IDENTIFIER-FOR-TEST';
  const planted = path.join(DIST, 'leak.json');
  fs.writeFileSync(planted, JSON.stringify({ note: secret }));
  try {
    assert.throws(
      () => run('check-dist.mjs', { RED_FORBIDDEN_STRINGS: secret }),
      (error) => /listed as private/.test(String(error.stderr ?? '') + String(error.stdout ?? '')),
    );
  } finally {
    fs.rmSync(planted, { force: true });
  }
});

test('privacy gate fails when a private file leaks into dist', () => {
  run('build.mjs');
  const planted = path.join(DIST, 'templates');
  fs.mkdirSync(planted, { recursive: true });
  try {
    assert.throws(
      () => run('check-dist.mjs'),
      (error) => /must never be published/.test(String(error.stderr ?? '') + String(error.stdout ?? '')),
    );
  } finally {
    fs.rmSync(planted, { recursive: true, force: true });
  }
});

/* ------------------------------- images ----------------------------------- */

test('image type sniffing recognises real headers and rejects fakes', () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(8),
  ]);
  assert.equal(sniffImageType(png), '.png');
  assert.equal(sniffImageType(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(12)])), '.jpg');
  assert.equal(sniffImageType(Buffer.from('not an image at all!!')), null);
  assert.equal(sniffImageType(Buffer.alloc(2)), null);
});

test('copyImages copies valid images and refuses unsafe ones', (t) => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'red-src-'));
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'red-dst-'));
  t.after(() => {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  });

  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  fs.writeFileSync(path.join(source, 'good-card.png'), png);
  fs.writeFileSync(path.join(source, 'script.js'), 'alert(1)');
  fs.writeFileSync(path.join(source, 'fake.png'), 'this is not a png');
  fs.writeFileSync(path.join(source, 'mismatch.jpg'), png);

  const result = copyImages(source, target);
  assert.deepEqual(
    result.copied.map((item) => item.name),
    ['good-card.png'],
  );
  assert.equal(result.skipped.length, 3);
  assert.ok(result.skipped.some((item) => /not allowed/.test(item.reason)));
  assert.ok(result.skipped.some((item) => /not a recognised/.test(item.reason)));
  assert.ok(result.skipped.some((item) => /does not match actual type/.test(item.reason)));
  assert.deepEqual(fs.readdirSync(target), ['good-card.png']);
});

test('copyImages reports a missing source directory instead of guessing', () => {
  assert.throws(() => copyImages(path.join(os.tmpdir(), 'red-missing-src'), os.tmpdir()), /not found/);
});

/* ------------------------------ sync CLI ---------------------------------- */

test('sync requires a mode and never hard-codes a sheet id', () => {
  const syncSource = fs.readFileSync(path.join(ROOT, 'scripts', 'sync.mjs'), 'utf8');
  assert.match(syncSource, /--sheet-id/);
  assert.match(syncSource, /RED_SHEET_ID/);
  assert.ok(
    !/[A-Za-z0-9_-]{30,}/.test(syncSource.replace(/[A-Za-z0-9_-]*(peterlundquist33|gmail)[A-Za-z0-9_-]*/g, '')),
    'sync.mjs appears to contain a hard-coded long identifier',
  );
  assert.match(syncSource, /peterlundquist33@gmail\.com/, 'the required account must be pinned');
});

test('sync --sheet without an id exits with a clear error', () => {
  assert.throws(
    () =>
      execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'sync.mjs'), '--sheet'], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, RED_SHEET_ID: '' },
      }),
    (error) => /Sheet ID is required/.test(String(error.stderr ?? '')),
  );
});

test('sync --csv dry run on the headers-only template writes nothing', () => {
  const before = fs.readFileSync(path.join(ROOT, 'data', 'cards.json'), 'utf8');
  const output = execFileSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'sync.mjs'), '--csv', 'templates/inventory-template.csv', '--dry-run'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.match(output, /0 published card\(s\)/);
  assert.equal(fs.readFileSync(path.join(ROOT, 'data', 'cards.json'), 'utf8'), before);
});
