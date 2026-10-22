/**
 * Public schema for The RED Collection.
 *
 * This file is the single source of truth for what may appear in the public
 * site data file (`data/cards.json`). Anything not described here is either
 * stripped (unknown, harmless) or rejected outright (sensitive).
 */

/** Fields allowed to reach the public JSON, in output order. */
export const PUBLIC_FIELDS = [
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
  'tier',
  'featured',
  'frontImage',
  'backImage',
  'altFront',
  'altBack',
  'story',
];

/** Fields that must be present and non-empty for every published card. */
export const REQUIRED_FIELDS = ['id', 'player', 'sport', 'team', 'year', 'set', 'status'];

/**
 * Input-only control field. Read from the inventory, used to decide whether a
 * row is emitted, and never written to the public JSON.
 */
export const CONTROL_FIELDS = ['published'];

/** Every header the pipeline knowingly accepts. */
export const KNOWN_FIELDS = [...PUBLIC_FIELDS, ...CONTROL_FIELDS];

export const SPORTS = [
  'baseball',
  'basketball',
  'football',
  'hockey',
  'soccer',
  'golf',
  'tennis',
  'racing',
  'boxing',
  'mma',
  'wrestling',
  'olympics',
  'multi-sport',
  'other',
];

export const STATUSES = ['owned', 'incoming', 'grading', 'traded', 'sold', 'archived'];

/**
 * Qualitative "how much this card matters to me" rating. Deliberately not a
 * number or a dollar amount — see FORBIDDEN_FIELD_TOKENS and the privacy
 * model in README.md. Ordered highest-significance first.
 */
export const TIERS = ['Grail', 'Keeper', 'Tradeable'];

export const GRADING_COMPANIES = ['PSA', 'BGS', 'SGC', 'CGC', 'CSG', 'HGA', 'TAG', 'Raw'];

export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];

/** Directory (repo-relative) that every card image must live under. */
export const IMAGE_DIR = 'images/cards';

/** Maximum bytes for a single committed card image. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const MAX_STORY_LENGTH = 2000;

export const MIN_YEAR = 1860;

/**
 * Normalized tokens that must never appear as an inventory header or as a
 * field name in incoming data. Presence of any of these fails the whole run
 * (fail closed) rather than being silently dropped, so a mis-mapped column
 * can never leak private financial or sourcing data into the public site.
 */
export const FORBIDDEN_FIELD_TOKENS = [
  'purchaseprice',
  'pricepaid',
  'paid',
  'price',
  'cost',
  'costbasis',
  'basis',
  'value',
  'estimatedvalue',
  'estvalue',
  'currentvalue',
  'marketvalue',
  'bookvalue',
  'appraisal',
  'appraised',
  'comp',
  'comps',
  'acquired',
  'acquisition',
  'acquisitiondate',
  'acquireddate',
  'dateacquired',
  'purchasedate',
  'datepurchased',
  'purchasedfrom',
  'boughtfrom',
  'seller',
  'vendor',
  'source',
  'sourceurl',
  'invoice',
  'receipt',
  'insurance',
  'insuredvalue',
  'profit',
  'margin',
  'saleprice',
  'soldprice',
  'soldfor',
  'offer',
  'driveurl',
  'driveid',
  'drivelink',
  'drivefileid',
  'googledriveurl',
  'folderid',
  'spreadsheetid',
  'sheetid',
  'owneremail',
  'email',
  'address',
  'phone',
  'storagelocation',
  'vaultlocation',
  'safelocation',
];

/** Hosts / substrings that may never appear in any committed public value. */
export const FORBIDDEN_VALUE_PATTERNS = [
  'drive.google.com',
  'docs.google.com',
  'sheets.google.com',
  'googleusercontent.com',
  'drive.usercontent.google.com',
  'script.google.com',
  'storage.googleapis.com',
];

/** Normalize a header or field name for comparison: lowercase alphanumerics. */
export function normalizeFieldName(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Map of normalized name -> canonical field name. */
export const FIELD_ALIASES = (() => {
  const map = new Map();
  for (const field of KNOWN_FIELDS) map.set(normalizeFieldName(field), field);
  // A few friendly spreadsheet header spellings.
  map.set('cardno', 'cardNumber');
  map.set('number', 'cardNumber');
  map.set('num', 'cardNumber');
  map.set('setname', 'set');
  map.set('company', 'gradingCompany');
  map.set('grader', 'gradingCompany');
  map.set('front', 'frontImage');
  map.set('back', 'backImage');
  map.set('frontalt', 'altFront');
  map.set('backalt', 'altBack');
  map.set('notes', 'story');
  map.set('isfeatured', 'featured');
  map.set('ispublished', 'published');
  return map;
})();

const FORBIDDEN_TOKEN_SET = new Set(FORBIDDEN_FIELD_TOKENS);

/**
 * True when a header is sensitive and the run must abort.
 * Canonical/aliased public headers are always safe, checked first, so a
 * legitimate field name can never be flagged by a substring coincidence.
 */
export function isForbiddenFieldName(name) {
  const normalized = normalizeFieldName(name);
  if (!normalized) return false;
  if (FIELD_ALIASES.has(normalized)) return false;
  if (FORBIDDEN_TOKEN_SET.has(normalized)) return true;
  return FORBIDDEN_FIELD_TOKENS.some((token) => token.length >= 4 && normalized.includes(token));
}

/** True when a string value contains a forbidden remote host. */
export function containsForbiddenValue(value) {
  const haystack = String(value ?? '').toLowerCase();
  return FORBIDDEN_VALUE_PATTERNS.some((pattern) => haystack.includes(pattern));
}
