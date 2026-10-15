#!/usr/bin/env node
/**
 * Sync the private inventory into the public data file.
 *
 *   node scripts/sync.mjs --csv private/inventory.csv
 *   node scripts/sync.mjs --sheet --sheet-id <ID> --range 'Cards!A1:S500'
 *
 * The Sheet ID is never hard-coded: it must arrive via --sheet-id or the
 * RED_SHEET_ID environment variable, so it stays out of the repository and
 * out of the published site.
 *
 * Nothing in this script downloads from or authenticates to Drive URLs. The
 * only network access is the `gog sheets get` call below, which runs locally
 * under an explicit Google account.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { parseCsvRecords, rowsToRecords } from './lib/csv.mjs';
import { copyImages } from './lib/images.mjs';
import { PipelineError, buildCards, serializeCards } from './lib/pipeline.mjs';
import { IMAGE_DIR } from './lib/schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = path.join(ROOT, 'data', 'cards.json');

/** The only Google account this project may ever use. */
const REQUIRED_ACCOUNT = 'peterlundquist33@gmail.com';
const DEFAULT_RANGE = 'Cards!A1:S1000';

function parseArgs(argv) {
  const args = { mode: null, csv: null, sheetId: null, range: null, imagesSrc: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--csv':
        args.mode = 'csv';
        if (argv[i + 1] && !argv[i + 1].startsWith('--')) args.csv = next();
        break;
      case '--sheet':
        args.mode = 'sheet';
        break;
      case '--csv-file':
        args.csv = next();
        break;
      case '--sheet-id':
        args.sheetId = next();
        break;
      case '--range':
        args.range = next();
        break;
      case '--images-src':
        args.imagesSrc = next();
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

const USAGE = `The RED Collection - inventory sync

Usage:
  node scripts/sync.mjs --csv <file> [--images-src <dir>] [--dry-run]
  node scripts/sync.mjs --sheet --sheet-id <id> [--range <A1 range>] [--dry-run]

Options:
  --csv <file>          Read a local CSV inventory export.
  --sheet               Read a Google Sheet range locally via the gog CLI.
  --sheet-id <id>       Spreadsheet ID (or set RED_SHEET_ID). Never committed.
  --range <range>       A1 range to read. Default: ${DEFAULT_RANGE}
  --images-src <dir>    Copy validated local image files into ${IMAGE_DIR}/.
  --dry-run             Validate and report; do not write data/cards.json.

Privacy: only the public allowlist is written. Private columns (price, value,
acquisition, Drive links) abort the run instead of being dropped silently.
`;

function readSheet(sheetId, range) {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(sheetId)) {
    throw new Error('invalid --sheet-id (expected a Google spreadsheet ID)');
  }
  let stdout;
  try {
    stdout = execFileSync(
      'gog',
      ['--account', REQUIRED_ACCOUNT, '--readonly', '--json', 'sheets', 'get', sheetId, range],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    const detail = [error.stderr, error.stdout, error.message].filter(Boolean).join('\n').trim();
    throw new Error(
      `gog sheets get failed. Confirm the gog keyring is unlocked and that ${REQUIRED_ACCOUNT} is authorized.\n${detail}`,
    );
  }

  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new Error('could not parse gog JSON output');
  }

  const rows =
    (Array.isArray(payload) && payload) ||
    payload.values ||
    payload.result?.values ||
    payload.data?.values ||
    payload.valueRange?.values;

  if (!Array.isArray(rows)) {
    throw new Error('gog returned no "values" array for the requested range');
  }
  return rows;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`error: ${error.message}\n`);
    console.error(USAGE);
    process.exit(2);
  }

  if (args.help || !args.mode) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 2);
  }

  let headers;
  let records;

  try {
    if (args.mode === 'csv') {
      const csvPath = args.csv ?? process.env.RED_INVENTORY_CSV;
      if (!csvPath) throw new Error('--csv requires a file path (or set RED_INVENTORY_CSV)');
      const resolved = path.resolve(csvPath);
      if (!fs.existsSync(resolved)) throw new Error(`CSV not found: ${resolved}`);
      ({ headers, records } = parseCsvRecords(fs.readFileSync(resolved, 'utf8')));
      console.log(`Read ${records.length} inventory row(s) from ${resolved}`);
    } else {
      const sheetId = args.sheetId ?? process.env.RED_SHEET_ID;
      if (!sheetId) {
        throw new Error(
          'a Sheet ID is required: pass --sheet-id <id> or set RED_SHEET_ID. ' +
            'It is intentionally not stored in this repository.',
        );
      }
      const range = args.range ?? process.env.RED_SHEET_RANGE ?? DEFAULT_RANGE;
      const rows = readSheet(sheetId, range);
      ({ headers, records } = rowsToRecords(rows));
      console.log(`Read ${records.length} inventory row(s) from range ${range}`);
    }

    if (args.imagesSrc) {
      const result = copyImages(path.resolve(args.imagesSrc), path.join(ROOT, IMAGE_DIR));
      console.log(`Images: copied ${result.copied.length}, skipped ${result.skipped.length}`);
      for (const item of result.skipped) console.warn(`  skipped ${item.name}: ${item.reason}`);
    }

    const { cards, errors, warnings, skipped } = buildCards(headers, records, {
      imageExists: (relative) => fs.existsSync(path.join(ROOT, relative)),
    });

    for (const warning of warnings) console.warn(`warning: ${warning}`);
    for (const item of skipped) console.log(`skipped row ${item.row}${item.id ? ` (${item.id})` : ''}: ${item.reason}`);

    if (errors.length > 0) {
      console.error(`\n${errors.length} validation error(s):`);
      for (const message of errors) console.error(`  - ${message}`);
      console.error('\nNothing was written. Fix the inventory and retry.');
      process.exit(1);
    }

    if (args.dryRun) {
      console.log(`\nDry run OK: ${cards.length} published card(s) would be written to data/cards.json`);
      return;
    }

    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, serializeCards(cards));
    console.log(`\nWrote ${cards.length} published card(s) to data/cards.json`);
    console.log('Next: npm test && npm run build && npm run check, then commit.');
  } catch (error) {
    if (error instanceof PipelineError) {
      console.error(`\nPRIVACY STOP: ${error.message}`);
      process.exit(1);
    }
    console.error(`error: ${error.message}`);
    process.exit(1);
  }
}

main();
