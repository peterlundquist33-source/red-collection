/**
 * Inventory -> public JSON pipeline.
 *
 * Design rules:
 *  - Strict allowlist: only PUBLIC_FIELDS are ever emitted.
 *  - Fail closed: a sensitive header or a remote Google URL aborts the run.
 *  - Unknown-but-harmless headers are stripped with a warning.
 *  - Unpublished rows are dropped entirely (not emitted as hidden data).
 */

import {
  CONTROL_FIELDS,
  FIELD_ALIASES,
  GRADING_COMPANIES,
  IMAGE_DIR,
  IMAGE_EXTENSIONS,
  MAX_STORY_LENGTH,
  MIN_YEAR,
  PUBLIC_FIELDS,
  REQUIRED_FIELDS,
  SPORTS,
  STATUSES,
  TIERS,
  containsForbiddenValue,
  isForbiddenFieldName,
  normalizeFieldName,
} from './schema.mjs';

const TRUE_VALUES = new Set(['true', 'yes', 'y', '1', 'x', 'featured', 'published']);
const FALSE_VALUES = new Set(['false', 'no', 'n', '0', '', '-']);

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

export class PipelineError extends Error {}

function fail(errors, message) {
  errors.push(message);
}

function parseBoolean(raw, { field, row, errors, fallback = false }) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === '') return fallback;
  if (TRUE_VALUES.has(value)) return true;
  if (FALSE_VALUES.has(value)) return false;
  fail(errors, `row ${row}: "${field}" must be a boolean (true/false), got "${raw}"`);
  return fallback;
}

/**
 * Validate a repo-relative image path. Only local, relative paths under
 * images/cards are accepted; anything with a scheme, an absolute path, a
 * traversal segment or a Windows separator is rejected.
 */
export function validateImagePath(raw, { field, row, errors }) {
  const value = String(raw ?? '').trim();
  if (value === '') return undefined;

  if (containsForbiddenValue(value)) {
    fail(errors, `row ${row}: "${field}" points at a remote Google URL; store images locally instead`);
    return undefined;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) {
    fail(errors, `row ${row}: "${field}" must be a local relative path, got "${value}"`);
    return undefined;
  }
  if (value.startsWith('/') || /^[a-z]:[\\/]/i.test(value) || value.includes('\\')) {
    fail(errors, `row ${row}: "${field}" must be a relative POSIX path, got "${value}"`);
    return undefined;
  }
  if (value.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')) {
    fail(errors, `row ${row}: "${field}" must not contain traversal segments, got "${value}"`);
    return undefined;
  }

  const normalized = value.replace(/^\.\//, '');
  const withPrefix = normalized.startsWith(`${IMAGE_DIR}/`) ? normalized : `${IMAGE_DIR}/${normalized}`;
  if (!withPrefix.startsWith(`${IMAGE_DIR}/`) || withPrefix.split('/').length < 3) {
    fail(errors, `row ${row}: "${field}" must live under ${IMAGE_DIR}/, got "${value}"`);
    return undefined;
  }

  const extension = withPrefix.slice(withPrefix.lastIndexOf('.')).toLowerCase();
  if (!IMAGE_EXTENSIONS.includes(extension)) {
    fail(
      errors,
      `row ${row}: "${field}" must end in one of ${IMAGE_EXTENSIONS.join(', ')}, got "${value}"`,
    );
    return undefined;
  }

  return withPrefix;
}

/**
 * Map raw headers to canonical field names.
 * Throws PipelineError when a forbidden header is present.
 */
export function mapHeaders(headers) {
  const mapping = new Map();
  const unknown = [];
  const forbidden = [];

  for (const header of headers) {
    const raw = String(header ?? '').trim();
    if (raw === '' || raw === '__row') continue;
    const normalized = normalizeFieldName(raw);
    if (isForbiddenFieldName(raw)) {
      forbidden.push(raw);
      continue;
    }
    const canonical = FIELD_ALIASES.get(normalized);
    if (!canonical) {
      unknown.push(raw);
      continue;
    }
    mapping.set(raw, canonical);
  }

  if (forbidden.length > 0) {
    throw new PipelineError(
      `Refusing to run: inventory contains private/sensitive column(s): ${forbidden.join(', ')}. ` +
        'Financial, valuation, acquisition and Drive-link columns must never enter the public pipeline. ' +
        'Remove them from the exported range (narrow the --range) and retry.',
    );
  }

  return { mapping, unknown };
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Transform raw inventory records into validated public card objects.
 * Returns { cards, errors, warnings, skipped }.
 */
export function buildCards(headers, records, options = {}) {
  const { imageExists } = options;
  const errors = [];
  const warnings = [];
  const skipped = [];
  const cards = [];
  const seenIds = new Map();

  const { mapping, unknown } = mapHeaders(headers);
  for (const header of unknown) {
    warnings.push(`stripped unknown column "${header}" (not part of the public schema)`);
  }

  const presentFields = new Set(mapping.values());
  for (const field of REQUIRED_FIELDS) {
    if (!presentFields.has(field)) {
      errors.push(`inventory is missing required column "${field}"`);
    }
  }
  if (!presentFields.has('published')) {
    warnings.push('no "published" column found; every row is treated as unpublished');
  }
  if (errors.length > 0) return { cards, errors, warnings, skipped };

  for (const record of records) {
    const row = record.__row ?? '?';
    const raw = {};
    for (const [header, canonical] of mapping) {
      if (Object.hasOwn(record, header)) raw[canonical] = record[header];
    }

    const rowErrors = [];

    // Any forbidden host anywhere in the row aborts the run immediately.
    for (const [field, value] of Object.entries(raw)) {
      if (containsForbiddenValue(value)) {
        throw new PipelineError(
          `Refusing to run: row ${row} field "${field}" contains a Google Drive/Docs URL. ` +
            'Download the scan manually, place it under images/cards/, and reference the local path.',
        );
      }
    }

    const published = parseBoolean(raw.published, {
      field: 'published',
      row,
      errors: rowErrors,
      fallback: false,
    });
    if (!published) {
      skipped.push({ row, id: cleanText(raw.id) || null, reason: 'not published' });
      continue;
    }

    const card = {};

    const id = cleanText(raw.id).toLowerCase();
    if (!ID_PATTERN.test(id)) {
      fail(
        rowErrors,
        `row ${row}: "id" must be a 2-64 char slug of lowercase letters, digits and hyphens, got "${raw.id ?? ''}"`,
      );
    } else if (seenIds.has(id)) {
      fail(rowErrors, `row ${row}: duplicate id "${id}" (first seen on row ${seenIds.get(id)})`);
    } else {
      seenIds.set(id, row);
      card.id = id;
    }

    card.player = cleanText(raw.player);
    if (!card.player) fail(rowErrors, `row ${row}: "player" is required`);

    const sport = cleanText(raw.sport).toLowerCase();
    if (!SPORTS.includes(sport)) {
      fail(rowErrors, `row ${row}: "sport" must be one of ${SPORTS.join(', ')}, got "${raw.sport ?? ''}"`);
    } else {
      card.sport = sport;
    }

    card.team = cleanText(raw.team);
    if (!card.team) fail(rowErrors, `row ${row}: "team" is required`);

    const yearText = cleanText(raw.year);
    const year = Number.parseInt(yearText, 10);
    const maxYear = new Date().getUTCFullYear() + 1;
    if (!/^\d{4}$/.test(yearText) || Number.isNaN(year) || year < MIN_YEAR || year > maxYear) {
      fail(rowErrors, `row ${row}: "year" must be a 4-digit year between ${MIN_YEAR} and ${maxYear}, got "${yearText}"`);
    } else {
      card.year = year;
    }

    card.set = cleanText(raw.set);
    if (!card.set) fail(rowErrors, `row ${row}: "set" is required`);

    const status = cleanText(raw.status).toLowerCase();
    if (!STATUSES.includes(status)) {
      fail(rowErrors, `row ${row}: "status" must be one of ${STATUSES.join(', ')}, got "${raw.status ?? ''}"`);
    } else {
      card.status = status;
    }

    const tier = cleanText(raw.tier);
    if (tier) {
      const match = TIERS.find((candidate) => candidate.toLowerCase() === tier.toLowerCase());
      if (!match) {
        fail(rowErrors, `row ${row}: "tier" must be one of ${TIERS.join(', ')}, got "${tier}"`);
      } else {
        card.tier = match;
      }
    }

    const cardNumber = cleanText(raw.cardNumber);
    if (cardNumber) card.cardNumber = cardNumber;

    const parallel = cleanText(raw.parallel);
    if (parallel) card.parallel = parallel;

    const grade = cleanText(raw.grade);
    if (grade) card.grade = grade;

    const gradingCompany = cleanText(raw.gradingCompany);
    if (gradingCompany) {
      const match = GRADING_COMPANIES.find(
        (company) => company.toLowerCase() === gradingCompany.toLowerCase(),
      );
      if (!match) {
        fail(
          rowErrors,
          `row ${row}: "gradingCompany" must be one of ${GRADING_COMPANIES.join(', ')}, got "${gradingCompany}"`,
        );
      } else {
        card.gradingCompany = match;
      }
    }

    card.featured = parseBoolean(raw.featured, {
      field: 'featured',
      row,
      errors: rowErrors,
      fallback: false,
    });

    const frontImage = validateImagePath(raw.frontImage, { field: 'frontImage', row, errors: rowErrors });
    const backImage = validateImagePath(raw.backImage, { field: 'backImage', row, errors: rowErrors });

    for (const [field, value] of [
      ['frontImage', frontImage],
      ['backImage', backImage],
    ]) {
      if (!value) continue;
      if (typeof imageExists === 'function' && !imageExists(value)) {
        fail(rowErrors, `row ${row}: "${field}" references missing file "${value}"`);
        continue;
      }
      card[field] = value;
    }

    const altFront = cleanText(raw.altFront);
    const altBack = cleanText(raw.altBack);
    if (card.frontImage) {
      if (!altFront) {
        fail(rowErrors, `row ${row}: "altFront" is required when a front image is supplied`);
      } else {
        card.altFront = altFront;
      }
    }
    if (card.backImage) {
      if (!altBack) {
        fail(rowErrors, `row ${row}: "altBack" is required when a back image is supplied`);
      } else {
        card.altBack = altBack;
      }
    }

    const story = String(raw.story ?? '').trim().replace(/\r\n/g, '\n');
    if (story.length > MAX_STORY_LENGTH) {
      fail(rowErrors, `row ${row}: "story" exceeds ${MAX_STORY_LENGTH} characters`);
    } else if (story) {
      card.story = story;
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    // Final allowlist projection: nothing outside PUBLIC_FIELDS survives.
    const projected = {};
    for (const field of PUBLIC_FIELDS) {
      if (card[field] !== undefined) projected[field] = card[field];
    }
    for (const field of CONTROL_FIELDS) {
      if (Object.hasOwn(projected, field)) delete projected[field];
    }
    cards.push(projected);
  }

  cards.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    if (a.player !== b.player) return a.player.localeCompare(b.player);
    return a.id.localeCompare(b.id);
  });

  return { cards, errors, warnings, skipped };
}

/** Serialize cards for committing to data/cards.json. */
export function serializeCards(cards) {
  return `${JSON.stringify(cards, null, 2)}\n`;
}
