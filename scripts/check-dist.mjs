#!/usr/bin/env node
/**
 * Privacy gate for the publishable output.
 *
 * Scans every text file in dist/ (and the committed public data file) for:
 *   - private Google identifiers passed via RED_SHEET_ID
 *   - any Google Drive/Docs/Sheets URL
 *   - financial / acquisition vocabulary
 *   - leaked script, template or dependency files
 *
 * Exits non-zero if anything is found, so CI refuses to publish.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { FORBIDDEN_VALUE_PATTERNS, PUBLIC_FIELDS } from './lib/schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const TEXT_EXTENSIONS = new Set(['.html', '.css', '.js', '.json', '.svg', '.txt', '.md', '.webmanifest']);

/**
 * Words that must not appear in published output. Each entry is a regex with
 * word boundaries so ordinary copy ("featured", "set") is never flagged.
 */
const FORBIDDEN_TERMS = [
  /purchase\s*price/i,
  /price\s*paid/i,
  /\bpaid\b/i,
  /cost\s*basis/i,
  /estimated\s*value/i,
  /current\s*value/i,
  /market\s*value/i,
  /insured\s*value/i,
  /\bapprais(al|ed)\b/i,
  /acquisition\s*(date|source|price)/i,
  /date\s*acquired/i,
  /purchased\s*from/i,
  /\bsale\s*price\b/i,
  /\bprofit\b/i,
  /spreadsheet\s*id/i,
  /\bsheet\s*id\b/i,
];

/**
 * Google file IDs are long base64url-ish tokens. The private Sheet ID is
 * deliberately NOT written here (this repository is public): instead the
 * checker flags any identifier-shaped token of that length, and additionally
 * compares against RED_SHEET_ID / RED_FORBIDDEN_STRINGS when provided.
 */
const GOOGLE_ID_SHAPE = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{40,60}(?![A-Za-z0-9_-])/g;

/** Google IDs mix cases and digits; this avoids flagging rules of dashes. */
function looksLikeGoogleId(token) {
  return /[a-z]/.test(token) && /[A-Z]/.test(token) && /[0-9]/.test(token);
}

/** Paths that must never exist inside dist/. */
const FORBIDDEN_PATHS = [
  'scripts',
  'tests',
  'templates',
  'node_modules',
  'private',
  'package.json',
  'package-lock.json',
  'README.md',
  '.github',
  '.git',
];

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function main() {
  const problems = [];

  if (!fs.existsSync(DIST)) {
    console.error('error: dist/ not found. Run `npm run build` first.');
    process.exit(1);
  }

  for (const forbidden of FORBIDDEN_PATHS) {
    if (fs.existsSync(path.join(DIST, forbidden))) {
      problems.push(`dist/ contains "${forbidden}", which must never be published`);
    }
  }

  const files = walk(DIST);
  if (files.length === 0) problems.push('dist/ is empty');

  const secrets = [process.env.RED_SHEET_ID, ...String(process.env.RED_FORBIDDEN_STRINGS ?? '').split(',')]
    .map((value) => String(value ?? '').trim())
    .filter((value) => value.length >= 12);

  for (const file of files) {
    const relative = path.relative(ROOT, file);
    const extension = path.extname(file).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    const contents = fs.readFileSync(file, 'utf8');

    for (const pattern of FORBIDDEN_VALUE_PATTERNS) {
      if (contents.toLowerCase().includes(pattern)) {
        problems.push(`${relative}: contains forbidden host "${pattern}"`);
      }
    }
    for (const pattern of FORBIDDEN_TERMS) {
      const match = contents.match(pattern);
      if (match) problems.push(`${relative}: contains forbidden term "${match[0].trim()}"`);
    }
    for (const secret of secrets) {
      if (contents.includes(secret)) {
        problems.push(`${relative}: contains a value listed as private (RED_SHEET_ID / RED_FORBIDDEN_STRINGS)`);
      }
    }
    for (const token of contents.match(GOOGLE_ID_SHAPE) ?? []) {
      if (!looksLikeGoogleId(token)) continue;
      problems.push(`${relative}: contains a Google-file-ID-shaped token "${token.slice(0, 6)}..."`);
    }
  }

  // The published data file may only contain allowlisted fields.
  const dataFile = path.join(DIST, 'data', 'cards.json');
  if (!fs.existsSync(dataFile)) {
    problems.push('dist/data/cards.json is missing');
  } else {
    let cards;
    try {
      cards = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    } catch (error) {
      problems.push(`dist/data/cards.json is not valid JSON: ${error.message}`);
      cards = [];
    }
    if (!Array.isArray(cards)) {
      problems.push('dist/data/cards.json must be a JSON array');
    } else {
      cards.forEach((card, index) => {
        for (const key of Object.keys(card ?? {})) {
          if (!PUBLIC_FIELDS.includes(key)) {
            problems.push(`dist/data/cards.json[${index}]: non-public field "${key}"`);
          }
        }
      });
    }
  }

  if (problems.length > 0) {
    console.error(`\nPrivacy check FAILED with ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  console.log(`Privacy check passed: ${files.length} file(s) in dist/, no private data found.`);
}

main();
