import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCsv, parseCsvRecords, rowsToRecords } from '../scripts/lib/csv.mjs';
import { PipelineError, buildCards, serializeCards, validateImagePath } from '../scripts/lib/pipeline.mjs';
import { PUBLIC_FIELDS, isForbiddenFieldName } from '../scripts/lib/schema.mjs';

const HEADERS = [
  'id',
  'player',
  'sport',
  'team',
  'year',
  'set',
  'cardNumber',
  'parallel',
  'grade',
  'gradingCompany',
  'status',
  'featured',
  'frontImage',
  'backImage',
  'altFront',
  'altBack',
  'story',
  'published',
];

function row(overrides = {}, rowNumber = 2) {
  return {
    id: 'test-card',
    player: 'Test Player',
    sport: 'baseball',
    team: 'Test Team',
    year: '1990',
    set: 'Test Set',
    cardNumber: '12',
    parallel: '',
    grade: '',
    gradingCompany: '',
    status: 'owned',
    featured: 'false',
    frontImage: '',
    backImage: '',
    altFront: '',
    altBack: '',
    story: '',
    published: 'true',
    __row: rowNumber,
    ...overrides,
  };
}

/* ------------------------------ CSV parsing ------------------------------- */

test('parseCsv handles quotes, escaped quotes, commas and newlines', () => {
  const rows = parseCsv('a,b\n"x,1","say ""hi"""\n"multi\nline",2\n');
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['x,1', 'say "hi"'],
    ['multi\nline', '2'],
  ]);
});

test('parseCsvRecords returns headers plus spreadsheet row numbers', () => {
  const { headers, records } = parseCsvRecords('id,player\nabc,Someone\n');
  assert.deepEqual(headers, ['id', 'player']);
  assert.equal(records.length, 1);
  assert.equal(records[0].__row, 2);
  assert.equal(records[0].player, 'Someone');
});

test('header-only template produces zero records', () => {
  const { headers, records } = parseCsvRecords(`${HEADERS.join(',')}\n`);
  assert.deepEqual(headers, HEADERS);
  assert.deepEqual(records, []);
});

test('rowsToRecords mirrors the CSV shape for Sheets values', () => {
  const { headers, records } = rowsToRecords([
    ['id', 'player'],
    ['abc', 'Someone'],
    ['', ''],
  ]);
  assert.deepEqual(headers, ['id', 'player']);
  assert.equal(records.length, 1);
});

/* ----------------------------- happy path --------------------------------- */

test('a valid published row becomes a public card with allowlisted fields only', () => {
  const { cards, errors } = buildCards(HEADERS, [row()]);
  assert.deepEqual(errors, []);
  assert.equal(cards.length, 1);
  const card = cards[0];
  for (const key of Object.keys(card)) {
    assert.ok(PUBLIC_FIELDS.includes(key), `unexpected public field: ${key}`);
  }
  assert.equal(card.id, 'test-card');
  assert.equal(card.year, 1990);
  assert.equal(card.featured, false);
  assert.ok(!Object.hasOwn(card, 'published'), 'published must not be emitted');
});

test('cards are sorted newest year first', () => {
  const { cards } = buildCards(HEADERS, [
    row({ id: 'old', year: '1980' }, 2),
    row({ id: 'new', year: '2001' }, 3),
  ]);
  assert.deepEqual(
    cards.map((card) => card.id),
    ['new', 'old'],
  );
});

test('serializeCards emits stable, newline-terminated JSON', () => {
  assert.equal(serializeCards([]), '[]\n');
});

/* ----------------------------- validation --------------------------------- */

test('duplicate ids are rejected', () => {
  const { cards, errors } = buildCards(HEADERS, [row({ id: 'dupe' }, 2), row({ id: 'dupe' }, 3)]);
  assert.equal(cards.length, 1);
  assert.ok(errors.some((error) => /duplicate id "dupe"/.test(error)), errors.join('\n'));
});

test('ids must be lowercase slugs', () => {
  const { cards, errors } = buildCards(HEADERS, [row({ id: 'Not A Slug!' })]);
  assert.equal(cards.length, 0);
  assert.ok(errors.some((error) => /"id" must be/.test(error)));
});

test('missing required columns fail the run before any row is processed', () => {
  const headers = HEADERS.filter((header) => header !== 'status');
  const { cards, errors } = buildCards(headers, [row()]);
  assert.equal(cards.length, 0);
  assert.ok(errors.some((error) => /missing required column "status"/.test(error)));
});

test('blank required values are rejected', () => {
  for (const field of ['player', 'team', 'set']) {
    const { cards, errors } = buildCards(HEADERS, [row({ [field]: '' })]);
    assert.equal(cards.length, 0, `${field} should be required`);
    assert.ok(errors.some((error) => error.includes(`"${field}" is required`)));
  }
});

test('sport and status must be in the documented enums', () => {
  const sport = buildCards(HEADERS, [row({ sport: 'quidditch' })]);
  assert.equal(sport.cards.length, 0);
  assert.ok(sport.errors.some((error) => /"sport" must be one of/.test(error)));

  const status = buildCards(HEADERS, [row({ status: 'maybe' })]);
  assert.equal(status.cards.length, 0);
  assert.ok(status.errors.some((error) => /"status" must be one of/.test(error)));
});

test('grading company must be a known grader', () => {
  const bad = buildCards(HEADERS, [row({ grade: '9', gradingCompany: 'TotallyReal' })]);
  assert.equal(bad.cards.length, 0);
  const good = buildCards(HEADERS, [row({ grade: '9', gradingCompany: 'psa' })]);
  assert.equal(good.cards[0].gradingCompany, 'PSA');
});

test('year must be a plausible four-digit year', () => {
  for (const year of ['', '90', '1700', '99999', 'nineteen']) {
    const { cards, errors } = buildCards(HEADERS, [row({ year })]);
    assert.equal(cards.length, 0, `year "${year}" should be rejected`);
    assert.ok(errors.some((error) => /"year" must be/.test(error)));
  }
});

test('non-boolean featured values are rejected', () => {
  const { cards, errors } = buildCards(HEADERS, [row({ featured: 'sometimes' })]);
  assert.equal(cards.length, 0);
  assert.ok(errors.some((error) => /"featured" must be a boolean/.test(error)));
});

test('boolean synonyms are accepted', () => {
  const { cards } = buildCards(HEADERS, [row({ featured: 'YES' })]);
  assert.equal(cards[0].featured, true);
});

/* --------------------------- published gating ------------------------------ */

test('unpublished rows are excluded entirely', () => {
  const { cards, skipped } = buildCards(HEADERS, [
    row({ id: 'shown', published: 'true' }, 2),
    row({ id: 'hidden', published: 'false' }, 3),
    row({ id: 'blank', published: '' }, 4),
  ]);
  assert.deepEqual(
    cards.map((card) => card.id),
    ['shown'],
  );
  assert.equal(skipped.length, 2);
  assert.ok(!JSON.stringify(cards).includes('hidden'));
});

test('an inventory with no published rows yields an empty array', () => {
  const { cards, errors } = buildCards(HEADERS, [row({ published: 'false' })]);
  assert.deepEqual(cards, []);
  assert.deepEqual(errors, []);
  assert.equal(serializeCards(cards), '[]\n');
});

/* ------------------------------- privacy ---------------------------------- */

test('forbidden field names are detected', () => {
  for (const name of [
    'Purchase Price',
    'purchase_price',
    'Estimated Value',
    'Current Value',
    'Cost Basis',
    'Acquisition Date',
    'Date Acquired',
    'Purchased From',
    'Seller',
    'Drive URL',
    'driveFileId',
    'Insured Value',
    'Sale Price',
    'Profit',
  ]) {
    assert.ok(isForbiddenFieldName(name), `${name} should be forbidden`);
  }
});

test('legitimate public field names are never flagged as forbidden', () => {
  for (const name of [...PUBLIC_FIELDS, 'published', 'Card Number', 'set name', 'Grading Company']) {
    assert.ok(!isForbiddenFieldName(name), `${name} should be allowed`);
  }
});

test('a sensitive column fails the whole run (fail closed)', () => {
  const headers = [...HEADERS, 'Purchase Price'];
  assert.throws(
    () => buildCards(headers, [row({ 'Purchase Price': '250.00' })]),
    (error) => error instanceof PipelineError && /private\/sensitive column/.test(error.message),
  );
});

test('every documented private column aborts rather than being dropped', () => {
  for (const header of ['Estimated Value', 'Acquisition Source', 'Drive URL', 'Cost Basis', 'Date Acquired']) {
    assert.throws(
      () => buildCards([...HEADERS, header], [row()]),
      PipelineError,
      `${header} should abort the run`,
    );
  }
});

test('a Google Drive URL anywhere in a row aborts the run', () => {
  for (const value of [
    'https://drive.google.com/file/d/abc/view',
    'https://docs.google.com/spreadsheets/d/abc',
    'https://lh3.googleusercontent.com/abc',
  ]) {
    assert.throws(
      () => buildCards(HEADERS, [row({ frontImage: value, altFront: 'front' })]),
      (error) => error instanceof PipelineError && /Drive\/Docs URL/.test(error.message),
      `${value} should abort the run`,
    );
  }
});

test('unknown columns are stripped with a warning, not emitted', () => {
  const { cards, warnings, errors } = buildCards([...HEADERS, 'Nickname'], [row({ Nickname: 'The One' })]);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((warning) => /stripped unknown column "Nickname"/.test(warning)));
  assert.ok(!JSON.stringify(cards).includes('The One'));
});

/* ----------------------------- image paths -------------------------------- */

test('image paths must be local, relative and under images/cards', () => {
  const errors = [];
  const context = { field: 'frontImage', row: 2, errors };

  assert.equal(validateImagePath('images/cards/a.jpg', context), 'images/cards/a.jpg');
  assert.equal(validateImagePath('a.png', { ...context }), 'images/cards/a.png');
  assert.equal(validateImagePath('', { ...context }), undefined);
  assert.deepEqual(errors, []);

  for (const bad of [
    'https://example.com/a.jpg',
    'http://drive.google.com/a.jpg',
    '/etc/passwd.png',
    '../../secrets/a.jpg',
    'images/cards/../../a.jpg',
    'C:\\scans\\a.jpg',
    'images\\cards\\a.jpg',
    'images/cards/a.gif',
    'images/cards/a.svg',
    'file:///tmp/a.png',
    '//evil.example/a.png',
  ]) {
    const localErrors = [];
    const result = validateImagePath(bad, { field: 'frontImage', row: 2, errors: localErrors });
    assert.equal(result, undefined, `${bad} should be rejected`);
    assert.ok(localErrors.length > 0, `${bad} should produce an error`);
  }
});

test('alt text is required whenever an image is present', () => {
  const imageExists = () => true;
  const missingAlt = buildCards(HEADERS, [row({ frontImage: 'images/cards/a.jpg' })], { imageExists });
  assert.equal(missingAlt.cards.length, 0);
  assert.ok(missingAlt.errors.some((error) => /"altFront" is required/.test(error)));

  const ok = buildCards(HEADERS, [row({ frontImage: 'images/cards/a.jpg', altFront: 'Front of card' })], {
    imageExists,
  });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.cards[0].altFront, 'Front of card');
});

test('missing image files are reported instead of shipping broken links', () => {
  const { cards, errors } = buildCards(
    HEADERS,
    [row({ frontImage: 'images/cards/nope.jpg', altFront: 'Front' })],
    { imageExists: () => false },
  );
  assert.equal(cards.length, 0);
  assert.ok(errors.some((error) => /missing file/.test(error)));
});
