/**
 * Structural tests for the shipped markup, the committed data file and the
 * accessibility hooks the app depends on. These run without a DOM: they assert
 * that the required semantics and behaviours are actually present in source.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { PUBLIC_FIELDS, REQUIRED_FIELDS } from '../scripts/lib/schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const html = read('site/index.html');
const app = read('site/assets/js/app.js');
const css = read('site/assets/css/styles.css');

/* ------------------------------ data file --------------------------------- */

test('committed data/cards.json is a valid card array', () => {
  const cards = JSON.parse(read('data/cards.json'));
  assert.ok(Array.isArray(cards), 'must be an array');
  const ids = new Set();
  for (const card of cards) {
    for (const field of REQUIRED_FIELDS) {
      assert.ok(
        card[field] !== undefined && card[field] !== null && card[field] !== '',
        `card ${card.id ?? '?'} is missing required field: ${field}`,
      );
    }
    assert.ok(!ids.has(card.id), `duplicate card id: ${card.id}`);
    ids.add(card.id);
  }
});

test('committed data file contains only allowlisted fields if ever populated', () => {
  const cards = JSON.parse(read('data/cards.json'));
  for (const card of cards) {
    for (const key of Object.keys(card)) {
      assert.ok(PUBLIC_FIELDS.includes(key), `non-public field in committed data: ${key}`);
    }
  }
});

test('inventory template ships headers only, with no card rows', () => {
  const lines = read('templates/inventory-template.csv').trim().split('\n');
  assert.equal(lines.length, 1, 'template must contain only the header row');
  const headers = lines[0].split(',');
  for (const required of ['id', 'player', 'sport', 'team', 'year', 'set', 'status', 'published']) {
    assert.ok(headers.includes(required), `template is missing "${required}"`);
  }
  for (const forbidden of ['price', 'value', 'cost', 'acquired', 'seller', 'drive']) {
    assert.ok(
      !headers.some((header) => header.toLowerCase().includes(forbidden)),
      `template must not include a "${forbidden}" column`,
    );
  }
});

/* ------------------------------- markup ----------------------------------- */

test('page has required landmarks and a single h1', () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<main id="main">/);
  assert.match(html, /<header class="site-header">/);
  assert.match(html, /<footer class="site-footer">/);
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.match(html, /<a class="skip-link" href="#main">/);
});

test('every required region is present', () => {
  for (const id of [
    'collection-summary',
    'featured-cards',
    'gallery',
    'filters',
    'search',
    'results-status',
    'card-dialog',
    'card-dialog-body',
    'card-dialog-close',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
});

test('all filters exist as labelled native selects', () => {
  for (const key of ['sport', 'player', 'team', 'year', 'set', 'status', 'tier']) {
    assert.match(html, new RegExp(`data-filter="${key}"`), `missing ${key} filter`);
    assert.match(html, new RegExp(`for="filter-${key}"`), `missing label for ${key}`);
    assert.match(html, new RegExp(`id="filter-${key}"`), `missing id for ${key}`);
  }
  assert.match(html, /<label class="label" for="search">/);
});

test('sections are labelled by their headings', () => {
  for (const labelled of ['hero-title', 'summary-title', 'featured-title', 'gallery-title', 'about-title']) {
    assert.match(html, new RegExp(`aria-labelledby="${labelled}"`), `missing aria-labelledby=${labelled}`);
    assert.match(html, new RegExp(`id="${labelled}"`), `missing heading id ${labelled}`);
  }
});

test('results status is a live region', () => {
  assert.match(html, /id="results-status" role="status" aria-live="polite"/);
});

test('dialog uses modal dialog semantics with an accessible close control', () => {
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-labelledby="card-dialog-title"/);
  assert.match(html, /id="card-dialog"[\s\S]*?hidden/);
  assert.match(html, /aria-label="Close card details"/);
  assert.match(html, /<button\s+class="dialog__close"/);
});

/* ----------------------- keyboard + focus behaviour ------------------------ */

test('app implements Escape-to-close, a focus trap and focus restore', () => {
  assert.match(app, /event\.key === 'Escape'/, 'Escape handling missing');
  assert.match(app, /event\.key !== 'Tab'/, 'Tab focus trap missing');
  assert.match(app, /shiftKey/, 'shift+Tab handling missing');
  assert.match(app, /lastFocused = document\.activeElement/, 'focus is not captured before opening');
  assert.match(app, /lastFocused\.focus\(\)/, 'focus is not restored on close');
  assert.match(app, /dom\.dialogClose\.focus\(\)/, 'focus does not move into the dialog');
});

test('dialog listener is removed on close (no leaked key handlers)', () => {
  assert.match(app, /addEventListener\('keydown', onDialogKeydown\)/);
  assert.match(app, /removeEventListener\('keydown', onDialogKeydown\)/);
});

test('body scroll is locked while the dialog is open', () => {
  assert.match(app, /classList\.add\('is-dialog-open'\)/);
  assert.match(app, /classList\.remove\('is-dialog-open'\)/);
  assert.match(css, /body\.is-dialog-open\s*\{[\s\S]*?overflow:\s*hidden/);
});

test('focusable selector covers the standard interactive elements', () => {
  for (const selector of ['a[href]', 'button:not([disabled])', 'select:not([disabled])', '[tabindex]']) {
    assert.ok(app.includes(selector), `focusable selector missing ${selector}`);
  }
});

/* ------------------------------ styling ------------------------------------ */

test('visible focus styles and reduced-motion support are defined', () => {
  assert.match(css, /:focus-visible\s*\{[\s\S]*?outline:\s*3px solid/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('layout is mobile-first: base rules plus min-width breakpoints only', () => {
  assert.ok(/@media \(min-width: \d+px\)/.test(css), 'no min-width breakpoints found');
  assert.ok(!/@media \(max-width: \d+px\)/.test(css), 'max-width queries break the mobile-first baseline');
  assert.match(css, /grid-template-columns: repeat\(auto-fill, minmax\(min\(100%, \d+px\), 1fr\)\)/);
});

test('touch targets meet the 44px minimum', () => {
  for (const rule of [/\.button\s*\{[\s\S]*?min-height:\s*44px/, /\.input,\n\.select\s*\{[\s\S]*?min-height:\s*44px/]) {
    assert.match(css, rule);
  }
});

/* ------------------------------ privacy ----------------------------------- */

test('site sources are relative-path only (works under /red-collection/)', () => {
  for (const source of [html, app, css]) {
    assert.ok(!/(src|href)="\//.test(source), 'absolute root paths break a project-path deployment');
  }
  assert.match(html, /href="assets\/css\/styles\.css"/);
  assert.match(html, /src="assets\/js\/app\.js"/);
  assert.match(app, /fetch\('data\/cards\.json'/);
});

test('no external requests, fonts, trackers or inline event handlers', () => {
  for (const [name, source] of [
    ['index.html', html],
    ['app.js', app],
    ['styles.css', css],
  ]) {
    assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(source), `${name} references an external URL`);
    assert.ok(!/fonts\.(googleapis|gstatic)/.test(source), `${name} loads an external font`);
    assert.ok(!/google-analytics|gtag|googletagmanager|plausible|hotjar/i.test(source), `${name} has a tracker`);
    assert.ok(!/\son(click|load|error|mouseover)=/i.test(source), `${name} has an inline event handler`);
  }
});

test('visible copy never mentions money, valuation or acquisition', () => {
  // Visible text only: HTML attributes such as value="" are not user-facing.
  const visible = html.replace(/<[^>]*>/g, ' ');
  for (const pattern of [
    /purchase/i,
    /\bprice\b/i,
    /\bvalue[ds]?\b/i,
    /\bworth\b/i,
    /\bcost\b/i,
    /\bapprais/i,
    /acquisition/i,
    /\$\d/,
  ]) {
    assert.ok(!pattern.test(visible), `index.html visible copy mentions ${pattern}`);
  }
  // Meta/OG descriptions are user-facing too.
  for (const match of html.match(/content="[^"]*"/g) ?? []) {
    assert.ok(!/\bprice|\bvalue[ds]?\b|purchase|\bworth\b|\bcost\b/i.test(match), `meta copy mentions money: ${match}`);
  }
});

test('meta, OG tags and favicon defaults are present', () => {
  // Collapse attribute whitespace so multi-line meta tags still match.
  const head = html.replace(/\s+/g, ' ');
  assert.match(head, /<meta name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(head, /<meta name="description" content="[^"]{30,}"/);
  assert.match(head, /<meta name="robots" content="index, follow"/);
  assert.match(head, /property="og:title"/);
  assert.match(head, /property="og:description"/);
  assert.match(head, /name="twitter:card"/);
  assert.match(head, /rel="icon" href="favicon\.svg"/);
  assert.match(head, /<title>[^<]+<\/title>/);
  assert.ok(fs.existsSync(path.join(ROOT, 'site/favicon.svg')));
  assert.ok(fs.existsSync(path.join(ROOT, 'site/robots.txt')));
});
