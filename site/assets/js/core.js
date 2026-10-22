/**
 * Pure view logic for The RED Collection.
 *
 * Everything in this module is a pure function of (cards, state) -> data or
 * HTML string. Keeping it DOM-free means the gallery, the filters, the summary
 * and the empty state are all unit-testable in Node with zero dependencies,
 * and the browser module stays a thin wiring layer.
 */

export const FILTER_KEYS = ['sport', 'player', 'team', 'year', 'set', 'status', 'tier'];

export const FILTER_LABELS = {
  sport: 'Sport',
  player: 'Player',
  team: 'Team',
  year: 'Year',
  set: 'Set',
  status: 'Status',
  tier: 'Tier',
};

/** Tier -> badge modifier class, for the gold/silver/standard tile styling. */
export const TIER_BADGE_CLASS = {
  Grail: 'badge--grail',
  Keeper: 'badge--keeper',
  Tradeable: 'badge--muted',
};

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(value) {
  return escapeHtml(value);
}

function normalize(value) {
  return String(value ?? '').toLowerCase().trim();
}

/** Human title for a card, e.g. "1989 Upper Deck Ken Griffey Jr. #1". */
export function cardTitle(card) {
  const parts = [card.year, card.set, card.player].filter(Boolean);
  let title = parts.join(' ');
  if (card.cardNumber) title += ` #${card.cardNumber}`;
  return title.trim();
}

export function cardSubtitle(card) {
  const bits = [card.team, card.parallel].filter(Boolean);
  if (card.grade) bits.push([card.gradingCompany, card.grade].filter(Boolean).join(' '));
  return bits.join(' · ');
}

/** Free-text search across the public fields only. */
export function matchesQuery(card, query) {
  const needle = normalize(query);
  if (!needle) return true;
  const haystack = [
    card.player,
    card.team,
    card.set,
    card.sport,
    card.parallel,
    card.grade,
    card.gradingCompany,
    card.status,
    card.tier,
    card.cardNumber,
    card.year,
    card.story,
  ]
    .filter((value) => value !== undefined && value !== null && value !== '')
    .join(' ')
    .toLowerCase();
  return needle
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

/** Apply the active filter selections. Empty string means "all". */
export function applyFilters(cards, state = {}) {
  const list = Array.isArray(cards) ? cards : [];
  return list.filter((card) => {
    for (const key of FILTER_KEYS) {
      const selected = state[key];
      if (!selected) continue;
      if (String(card[key] ?? '') !== String(selected)) return false;
    }
    return matchesQuery(card, state.query);
  });
}

/** Distinct, sorted values for each filter control. */
export function facetOptions(cards) {
  const list = Array.isArray(cards) ? cards : [];
  const facets = {};
  for (const key of FILTER_KEYS) {
    const values = new Set();
    for (const card of list) {
      const value = card[key];
      if (value === undefined || value === null || value === '') continue;
      values.add(String(value));
    }
    const sorted = [...values];
    if (key === 'year') sorted.sort((a, b) => Number(b) - Number(a));
    else sorted.sort((a, b) => a.localeCompare(b));
    facets[key] = sorted;
  }
  return facets;
}

/** Collection metrics. Renders sensible zeros for an empty collection. */
export function computeSummary(cards) {
  const list = Array.isArray(cards) ? cards : [];
  const sports = new Set();
  const players = new Set();
  const sets = new Set();
  let graded = 0;
  let featured = 0;
  let earliest = null;
  let latest = null;

  for (const card of list) {
    if (card.sport) sports.add(card.sport);
    if (card.player) players.add(card.player);
    if (card.set) sets.add(card.set);
    if (card.grade) graded += 1;
    if (card.featured) featured += 1;
    const year = Number(card.year);
    if (Number.isFinite(year)) {
      earliest = earliest === null ? year : Math.min(earliest, year);
      latest = latest === null ? year : Math.max(latest, year);
    }
  }

  return {
    total: list.length,
    sports: sports.size,
    players: players.size,
    sets: sets.size,
    graded,
    featured,
    earliest,
    latest,
    yearRange: earliest === null ? '--' : earliest === latest ? String(earliest) : `${earliest}–${latest}`,
  };
}

export function summaryHtml(summary) {
  const tiles = [
    { label: 'Cards', value: summary.total },
    { label: 'Players', value: summary.players },
    { label: 'Sports', value: summary.sports },
    { label: 'Sets', value: summary.sets },
    { label: 'Graded', value: summary.graded },
    { label: 'Years', value: summary.yearRange },
  ];
  return tiles
    .map(
      (tile) => `<div class="metric">
        <dt class="metric__label">${escapeHtml(tile.label)}</dt>
        <dd class="metric__value">${escapeHtml(tile.value)}</dd>
      </div>`,
    )
    .join('');
}

function imageHtml(card, side) {
  const source = side === 'back' ? card.backImage : card.frontImage;
  const alt = side === 'back' ? card.altBack : card.altFront;
  if (!source) {
    return `<div class="card-art card-art--placeholder" role="img" aria-label="No ${side} scan on file yet">
        <span class="card-art__mark" aria-hidden="true">RED</span>
        <span class="card-art__hint">Scan pending</span>
      </div>`;
  }
  return `<img class="card-art" src="${escapeAttr(source)}" alt="${escapeAttr(alt || cardTitle(card))}" loading="lazy" decoding="async">`;
}

/** One gallery tile. The button is the accessible control that opens detail. */
export function cardTileHtml(card) {
  const badges = [];
  if (card.featured) badges.push('<span class="badge badge--accent">Featured</span>');
  if (card.tier) {
    const tierClass = TIER_BADGE_CLASS[card.tier] ?? 'badge--muted';
    badges.push(`<span class="badge ${tierClass}">${escapeHtml(card.tier)}</span>`);
  }
  if (card.grade) {
    badges.push(
      `<span class="badge">${escapeHtml([card.gradingCompany, card.grade].filter(Boolean).join(' '))}</span>`,
    );
  }
  badges.push(`<span class="badge badge--muted">${escapeHtml(card.status ?? '')}</span>`);

  return `<li class="gallery__item">
      <button type="button" class="card-tile" data-card-id="${escapeAttr(card.id)}" aria-haspopup="dialog">
        <span class="card-tile__art">${imageHtml(card, 'front')}</span>
        <span class="card-tile__body">
          <span class="card-tile__title">${escapeHtml(cardTitle(card))}</span>
          <span class="card-tile__subtitle">${escapeHtml(cardSubtitle(card))}</span>
          <span class="card-tile__badges">${badges.join('')}</span>
        </span>
      </button>
    </li>`;
}

export const EMPTY_STATE_HTML = `<div class="empty-state" data-empty-state="collection">
    <p class="empty-state__eyebrow">The vault is open</p>
    <h3 class="empty-state__title">No cards published yet</h3>
    <p class="empty-state__body">
      This showroom is built and waiting. The moment the first card is catalogued and
      scanned, it appears here &mdash; front, back and the story behind it.
    </p>
    <ol class="empty-state__steps">
      <li>Add the card to the private inventory sheet.</li>
      <li>Save the front and back scans into <code>images/cards/</code>.</li>
      <li>Run the sync, then publish.</li>
    </ol>
  </div>`;

export const NO_RESULTS_HTML = `<div class="empty-state empty-state--compact" data-empty-state="filters">
    <h3 class="empty-state__title">No cards match those filters</h3>
    <p class="empty-state__body">Try a different player, year or set &mdash; or clear the filters to see everything.</p>
    <button type="button" class="button button--ghost" data-action="clear-filters">Clear all filters</button>
  </div>`;

/**
 * Gallery markup. Distinguishes "collection is empty" from "filters matched
 * nothing", so the empty state never looks like a broken page.
 */
export function galleryHtml(visibleCards, totalCards = null) {
  const visible = Array.isArray(visibleCards) ? visibleCards : [];
  const total = totalCards === null ? visible.length : totalCards;
  if (total === 0) return EMPTY_STATE_HTML;
  if (visible.length === 0) return NO_RESULTS_HTML;
  return `<ul class="gallery__grid" role="list">${visible.map(cardTileHtml).join('')}</ul>`;
}

export function featuredHtml(cards) {
  const list = (Array.isArray(cards) ? cards : []).filter((card) => card.featured);
  if (list.length === 0) {
    return `<p class="featured__placeholder" data-empty-state="featured">
      Featured cards will be spotlighted here. Mark a card as featured in the inventory to give it the front page.
    </p>`;
  }
  return `<ul class="gallery__grid gallery__grid--featured" role="list">${list.map(cardTileHtml).join('')}</ul>`;
}

/** Detail content for the dialog. */
export function detailHtml(card) {
  if (!card) return '';
  const facts = [
    ['Player', card.player],
    ['Sport', card.sport],
    ['Team', card.team],
    ['Year', card.year],
    ['Set', card.set],
    ['Card no.', card.cardNumber],
    ['Parallel', card.parallel],
    ['Grade', [card.gradingCompany, card.grade].filter(Boolean).join(' ')],
    ['Status', card.status],
    ['Tier', card.tier],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');

  const story = card.story
    ? card.story
        .split(/\n{2,}/)
        .map((paragraph) => `<p>${escapeHtml(paragraph.trim())}</p>`)
        .join('')
    : '<p class="detail__story-empty">No story written for this card yet.</p>';

  return `<div class="detail">
      <div class="detail__art">
        <figure class="detail__figure">
          ${imageHtml(card, 'front')}
          <figcaption>Front</figcaption>
        </figure>
        <figure class="detail__figure">
          ${imageHtml(card, 'back')}
          <figcaption>Back</figcaption>
        </figure>
      </div>
      <div class="detail__info">
        <h2 class="detail__title" id="card-dialog-title">${escapeHtml(cardTitle(card))}</h2>
        <dl class="detail__facts">
          ${facts
            .map(
              ([label, value]) =>
                `<div class="detail__fact"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`,
            )
            .join('')}
        </dl>
        <div class="detail__story"><h3>The story</h3>${story}</div>
      </div>
    </div>`;
}

export function resultsLabel(visibleCount, totalCount) {
  if (totalCount === 0) return 'No cards published yet';
  if (visibleCount === totalCount) {
    return `Showing all ${totalCount} card${totalCount === 1 ? '' : 's'}`;
  }
  return `Showing ${visibleCount} of ${totalCount} cards`;
}

/** Defensive normalization of fetched data: drop anything malformed. */
export function sanitizeCards(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw.filter((card) => {
    if (!card || typeof card !== 'object') return false;
    if (typeof card.id !== 'string' || card.id === '') return false;
    if (seen.has(card.id)) return false;
    seen.add(card.id);
    return true;
  });
}
