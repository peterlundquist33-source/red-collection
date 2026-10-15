/**
 * Browser wiring for The RED Collection.
 * All view logic lives in core.js; this file only touches the DOM.
 */

import {
  FILTER_KEYS,
  applyFilters,
  computeSummary,
  detailHtml,
  escapeHtml,
  facetOptions,
  featuredHtml,
  galleryHtml,
  resultsLabel,
  sanitizeCards,
  summaryHtml,
} from './core.js';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const state = {
  cards: [],
  query: '',
  sport: '',
  player: '',
  team: '',
  year: '',
  set: '',
  status: '',
};

const dom = {};
let lastFocused = null;

function byId(id) {
  return document.getElementById(id);
}

function cacheDom() {
  dom.gallery = byId('gallery');
  dom.featured = byId('featured-cards');
  dom.summary = byId('collection-summary');
  dom.results = byId('results-status');
  dom.search = byId('search');
  dom.filters = byId('filters');
  dom.clear = byId('clear-filters');
  dom.dialog = byId('card-dialog');
  dom.dialogBody = byId('card-dialog-body');
  dom.dialogClose = byId('card-dialog-close');
  dom.backdrop = byId('card-dialog-backdrop');
  dom.year = byId('current-year');
}

function renderFilters() {
  if (!dom.filters) return;
  const facets = facetOptions(state.cards);
  for (const key of FILTER_KEYS) {
    const select = dom.filters.querySelector(`[data-filter="${key}"]`);
    if (!select) continue;
    const options = facets[key] ?? [];
    const current = state[key];
    select.innerHTML =
      `<option value="">All</option>` +
      options
        .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
        .join('');
    select.value = options.includes(current) ? current : '';
    state[key] = select.value;
    select.disabled = options.length === 0;
  }
}

function render() {
  const visible = applyFilters(state.cards, state);

  if (dom.summary) dom.summary.innerHTML = summaryHtml(computeSummary(state.cards));
  if (dom.featured) dom.featured.innerHTML = featuredHtml(state.cards);
  if (dom.gallery) dom.gallery.innerHTML = galleryHtml(visible, state.cards.length);
  if (dom.results) dom.results.textContent = resultsLabel(visible.length, state.cards.length);
  if (dom.clear) {
    const active = Boolean(state.query) || FILTER_KEYS.some((key) => state[key]);
    dom.clear.hidden = !active;
  }
}

function clearFilters() {
  state.query = '';
  for (const key of FILTER_KEYS) state[key] = '';
  if (dom.search) dom.search.value = '';
  renderFilters();
  render();
  if (dom.search) dom.search.focus();
}

/* ---------- Accessible dialog: focus trap, Escape, focus restore ---------- */

function focusableInDialog() {
  return [...dom.dialog.querySelectorAll(FOCUSABLE)].filter(
    (node) => node.offsetParent !== null || node === dom.dialogClose,
  );
}

function trapFocus(event) {
  if (event.key !== 'Tab') return;
  const nodes = focusableInDialog();
  if (nodes.length === 0) {
    event.preventDefault();
    return;
  }
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function onDialogKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeDialog();
    return;
  }
  trapFocus(event);
}

function openDialog(cardId) {
  const card = state.cards.find((item) => item.id === cardId);
  if (!card || !dom.dialog) return;

  lastFocused = document.activeElement;
  dom.dialogBody.innerHTML = detailHtml(card);
  dom.dialog.hidden = false;
  if (dom.backdrop) dom.backdrop.hidden = false;
  document.body.classList.add('is-dialog-open');
  dom.dialog.addEventListener('keydown', onDialogKeydown);
  dom.dialogClose.focus();
}

function closeDialog() {
  if (!dom.dialog || dom.dialog.hidden) return;
  dom.dialog.removeEventListener('keydown', onDialogKeydown);
  dom.dialog.hidden = true;
  if (dom.backdrop) dom.backdrop.hidden = true;
  document.body.classList.remove('is-dialog-open');
  dom.dialogBody.innerHTML = '';
  if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  lastFocused = null;
}

/* ------------------------------- wiring ---------------------------------- */

function bindEvents() {
  if (dom.search) {
    dom.search.addEventListener('input', (event) => {
      state.query = event.target.value;
      render();
    });
  }

  if (dom.filters) {
    dom.filters.addEventListener('change', (event) => {
      const key = event.target.dataset.filter;
      if (!key || !FILTER_KEYS.includes(key)) return;
      state[key] = event.target.value;
      render();
    });
  }

  if (dom.clear) dom.clear.addEventListener('click', clearFilters);

  document.addEventListener('click', (event) => {
    const tile = event.target.closest('[data-card-id]');
    if (tile) {
      openDialog(tile.dataset.cardId);
      return;
    }
    if (event.target.closest('[data-action="clear-filters"]')) clearFilters();
    if (event.target.closest('[data-action="close-dialog"]')) closeDialog();
  });

  if (dom.backdrop) dom.backdrop.addEventListener('click', closeDialog);
}

async function loadCards() {
  try {
    const response = await fetch('data/cards.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return sanitizeCards(await response.json());
  } catch (error) {
    console.warn('The RED Collection: could not load card data.', error);
    return [];
  }
}

async function init() {
  cacheDom();
  if (dom.year) dom.year.textContent = String(new Date().getFullYear());
  bindEvents();
  render();
  state.cards = await loadCards();
  renderFilters();
  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
