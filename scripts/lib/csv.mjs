/**
 * Minimal RFC 4180 CSV reader (zero dependencies).
 * Handles quoted fields, escaped quotes, embedded newlines and CRLF.
 */

export function parseCsv(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let sawAnyChar = false;

  for (let i = 0; i < src.length; i += 1) {
    const char = src[i];

    if (inQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      sawAnyChar = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      sawAnyChar = true;
      continue;
    }
    if (char === '\r') continue;
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      sawAnyChar = false;
      continue;
    }
    field += char;
    sawAnyChar = true;
  }

  if (inQuotes) throw new Error('CSV parse error: unterminated quoted field');
  if (field !== '' || sawAnyChar || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

/**
 * Parse CSV text into { headers, records } where each record maps the raw
 * header text to the raw cell text. Header mapping/validation happens later
 * in the pipeline so that forbidden headers can fail the run.
 */
export function parseCsvRecords(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return { headers: [], records: [] };

  const headers = rows[0].map((header) => header.trim());
  const records = rows.slice(1).map((cells, index) => {
    const record = {};
    headers.forEach((header, column) => {
      if (header === '') return;
      record[header] = (cells[column] ?? '').trim();
    });
    // 1-based row number as seen in a spreadsheet (header is row 1).
    record.__row = index + 2;
    return record;
  });

  return { headers, records };
}

/** Convert a 2D value matrix (e.g. a Sheets range) into the same shape. */
export function rowsToRecords(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { headers: [], records: [] };
  const headers = (rows[0] ?? []).map((header) => String(header ?? '').trim());
  const records = [];
  rows.slice(1).forEach((cells, index) => {
    const list = Array.isArray(cells) ? cells : [];
    if (!list.some((cell) => String(cell ?? '').trim() !== '')) return;
    const record = {};
    headers.forEach((header, column) => {
      if (header === '') return;
      record[header] = String(list[column] ?? '').trim();
    });
    record.__row = index + 2;
    records.push(record);
  });
  return { headers, records };
}
