#!/usr/bin/env node
/**
 * Build dist/ - the exact set of files published to GitHub Pages.
 *
 * Only the site shell, the public data file and card images are copied.
 * Scripts, tests, templates, node_modules, git metadata and any private
 * working folder are structurally excluded: the allowlist below is the only
 * thing that gets copied.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { IMAGE_EXTENSIONS } from './lib/schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

/** Explicit allowlist of what ships. */
const COPY_PLAN = [
  { from: 'site', to: '.', kind: 'dir', extensions: ['.html', '.css', '.js', '.svg', '.txt', '.webmanifest'] },
  { from: 'data/cards.json', to: 'data/cards.json', kind: 'file' },
  { from: 'images/cards', to: 'images/cards', kind: 'dir', extensions: IMAGE_EXTENSIONS, optional: true },
];

function copyDir(sourceDir, targetDir, extensions) {
  let count = 0;
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(targetPath, { recursive: true });
      count += copyDir(sourcePath, targetPath, extensions);
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (extensions && !extensions.includes(extension)) {
      console.warn(`  skipped ${path.relative(ROOT, sourcePath)} (extension not in the publish allowlist)`);
      continue;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    count += 1;
  }
  return count;
}

function main() {
  // Validate the data file before shipping it.
  const dataPath = path.join(ROOT, 'data', 'cards.json');
  if (!fs.existsSync(dataPath)) {
    console.error('error: data/cards.json is missing. Run a sync (or commit an empty array).');
    process.exit(1);
  }
  let cards;
  try {
    cards = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  } catch (error) {
    console.error(`error: data/cards.json is not valid JSON: ${error.message}`);
    process.exit(1);
  }
  if (!Array.isArray(cards)) {
    console.error('error: data/cards.json must contain a JSON array.');
    process.exit(1);
  }

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  let total = 0;
  for (const item of COPY_PLAN) {
    const source = path.join(ROOT, item.from);
    const target = path.join(DIST, item.to);
    if (!fs.existsSync(source)) {
      if (item.optional) continue;
      console.error(`error: required source missing: ${item.from}`);
      process.exit(1);
    }
    if (item.kind === 'file') {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
      total += 1;
    } else {
      fs.mkdirSync(target, { recursive: true });
      total += copyDir(source, target, item.extensions);
    }
  }

  // .nojekyll keeps GitHub Pages from reinterpreting the static output.
  fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

  console.log(`Built dist/ with ${total} file(s) and ${cards.length} published card(s).`);
}

main();
