import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EMPTY_STATE_HTML,
  FILTER_KEYS,
  NO_RESULTS_HTML,
  applyFilters,
  cardSubtitle,
  cardTitle,
  computeSummary,
  detailHtml,
  escapeHtml,
  facetOptions,
  featuredHtml,
  galleryHtml,
  matchesQuery,
  resultsLabel,
  sanitizeCards,
  summaryHtml,
} from '../site/assets/js/core.js';

const CARD = {
  id: 'sample-one',
  player: 'Sample Player',
  sport: 'baseball',
  team: 'Sample Team',
  year: 1990,
  set: 'Sample Set',
  cardNumber: '12',
  status: 'owned',
  featured: true,
  grade: '9',
  gradingCompany: 'PSA',
  story: 'First paragraph.\n\nSecond paragraph.',
};

/* --------------------------- empty collection ----------------------------- */

test('renderer handles an empty collection without throwing', () => {
  assert.equal(galleryHtml([], 0), EMPTY_STATE_HTML);
  assert.equal(galleryHtml([]), EMPTY_STATE_HTML);
  assert.doesNotThrow(() => featuredHtml([]));
  assert.doesNotThrow(() => summaryHtml(computeSummary([])));
});

test('empty state is substantive, not a bare message', () => {
  assert.match(EMPTY_STATE_HTML, /No cards published yet/);
  assert.match(EMPTY_STATE_HTML, /data-empty-state="collection"/);
  assert.match(EMPTY_STATE_HTML, /<ol class="empty-state__steps">/);
  // It must not invent cards, counts or claims.
  assert.doesNotMatch(EMPTY_STATE_HTML, /\$|\bvalue\b|\bworth\b/i);
});

test('summary renders zeros for an empty collection', () => {
  const summary = computeSummary([]);
  assert.deepEqual(
    { total: summary.total, players: summary.players, sports: summary.sports, graded: summary.graded },
    { total: 0, players: 0, sports: 0, graded: 0 },
  );
  assert.equal(summary.earliest, null);
  assert.equal(summary.yearRange, '--');

  const html = summaryHtml(summary);
  assert.match(html, /class="metric__value">0</);
  assert.doesNotMatch(html, /NaN|undefined|null/);
});

test('facets and filters are safe on empty or malformed data', () => {
  const facets = facetOptions([]);
  for (const key of FILTER_KEYS) assert.deepEqual(facets[key], []);
  assert.deepEqual(applyFilters([], { query: 'anything' }), []);
  assert.deepEqual(applyFilters(undefined, {}), []);
  assert.deepEqual(facetOptions(null).sport, []);
  assert.equal(resultsLabel(0, 0), 'No cards published yet');
  assert.equal(detailHtml(undefined), '');
});

/* ------------------------------ with cards -------------------------------- */

test('gallery distinguishes an empty collection from an empty filter result', () => {
  assert.equal(galleryHtml([], 3), NO_RESULTS_HTML);
  assert.match(NO_RESULTS_HTML, /data-action="clear-filters"/);
  const html = galleryHtml([CARD], 1);
  assert.match(html, /<ul class="gallery__grid" role="list">/);
  assert.match(html, /data-card-id="sample-one"/);
});

test('card tiles expose an accessible dialog trigger', () => {
  const html = galleryHtml([CARD], 1);
  assert.match(html, /<button type="button" class="card-tile"/);
  assert.match(html, /aria-haspopup="dialog"/);
});

test('cards without images get a labelled placeholder rather than a broken img', () => {
  const html = galleryHtml([{ ...CARD, frontImage: undefined }], 1);
  assert.match(html, /role="img" aria-label="No front scan on file yet"/);
  assert.doesNotMatch(html, /<img/);
});

test('images always carry alt text', () => {
  const html = galleryHtml([{ ...CARD, frontImage: 'images/cards/a.jpg', altFront: 'Front scan' }], 1);
  assert.match(html, /<img class="card-art" src="images\/cards\/a\.jpg" alt="Front scan"/);
  assert.match(html, /loading="lazy"/);
});

test('titles and subtitles compose from public fields only', () => {
  assert.equal(cardTitle(CARD), '1990 Sample Set Sample Player #12');
  assert.equal(cardSubtitle(CARD), 'Sample Team · PSA 9');
});

test('search matches across public fields and requires every token', () => {
  assert.ok(matchesQuery(CARD, ''));
  assert.ok(matchesQuery(CARD, 'sample player'));
  assert.ok(matchesQuery(CARD, 'psa 1990'));
  assert.ok(!matchesQuery(CARD, 'hockey'));
  assert.ok(!matchesQuery(CARD, 'sample nonexistent'));
});

test('filters narrow by each facet key', () => {
  const other = { ...CARD, id: 'two', sport: 'football', year: 2001, player: 'Other' };
  const cards = [CARD, other];
  assert.equal(applyFilters(cards, { sport: 'baseball' }).length, 1);
  assert.equal(applyFilters(cards, { year: '2001' })[0].id, 'two');
  assert.equal(applyFilters(cards, { sport: 'baseball', player: 'Other' }).length, 0);
  assert.equal(applyFilters(cards, {}).length, 2);
});

test('year facets sort newest first and others alphabetically', () => {
  const facets = facetOptions([CARD, { ...CARD, id: 'b', year: 2001, team: 'Alpha Team' }]);
  assert.deepEqual(facets.year, ['2001', '1990']);
  assert.deepEqual(facets.team, ['Alpha Team', 'Sample Team']);
});

test('summary counts distinct values and a year range', () => {
  const summary = computeSummary([CARD, { ...CARD, id: 'b', year: 2001, player: 'Other', grade: undefined }]);
  assert.equal(summary.total, 2);
  assert.equal(summary.players, 2);
  assert.equal(summary.graded, 1);
  assert.equal(summary.yearRange, '1990–2001');
});

test('featured region only shows featured cards and has its own placeholder', () => {
  assert.match(featuredHtml([{ ...CARD, featured: false }]), /data-empty-state="featured"/);
  assert.match(featuredHtml([CARD]), /data-card-id="sample-one"/);
});

test('detail view renders both sides, the fact list and the story', () => {
  const html = detailHtml(CARD);
  assert.match(html, /id="card-dialog-title"/);
  assert.match(html, /<figcaption>Front<\/figcaption>/);
  assert.match(html, /<figcaption>Back<\/figcaption>/);
  assert.match(html, /<dt>Player<\/dt><dd>Sample Player<\/dd>/);
  assert.match(html, /<p>First paragraph\.<\/p><p>Second paragraph\.<\/p>/);
});

test('detail view omits absent optional fields and handles a missing story', () => {
  const html = detailHtml({ id: 'x', player: 'P', sport: 'baseball', team: 'T', year: 1990, set: 'S', status: 'owned' });
  assert.doesNotMatch(html, /Card no\./);
  assert.doesNotMatch(html, /Parallel/);
  assert.match(html, /No story written for this card yet/);
});

/* ------------------------------ escaping ---------------------------------- */

test('all interpolated values are HTML-escaped', () => {
  assert.equal(escapeHtml('<script>"x"&\'y\'</script>'), '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;');
  const nasty = {
    ...CARD,
    id: '"><script>alert(1)</script>',
    player: '<img src=x onerror=alert(1)>',
    altFront: '" onerror="alert(1)',
    frontImage: 'images/cards/a.jpg',
  };
  const html = galleryHtml([nasty], 1) + detailHtml(nasty);
  // No tag or attribute may be created from card data.
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /\sonerror="/, 'an attribute escaped its quotes');
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /alt="&quot; onerror=&quot;alert\(1\)"/, 'alt text must stay inside its quotes');
});

/* ----------------------------- sanitization -------------------------------- */

test('sanitizeCards drops malformed entries and duplicate ids', () => {
  assert.deepEqual(sanitizeCards(null), []);
  assert.deepEqual(sanitizeCards({}), []);
  assert.equal(sanitizeCards([CARD, CARD]).length, 1);
  assert.equal(sanitizeCards([CARD, null, 'x', { id: '' }, { noId: true }]).length, 1);
});

test('resultsLabel reports counts honestly', () => {
  assert.equal(resultsLabel(1, 1), 'Showing all 1 card');
  assert.equal(resultsLabel(2, 2), 'Showing all 2 cards');
  assert.equal(resultsLabel(1, 4), 'Showing 1 of 4 cards');
});
