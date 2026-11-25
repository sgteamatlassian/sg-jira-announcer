// Reads project keys out of a CSV file (or pasted text).
//
// Accepted shapes:
//   - one key per line                         SGSD
//   - one line of keys                         SGSD,AS;SL
//   - a table with a header row; the column called "key" / "project key" /
//     "Projektschlüssel" is used                Name;Key;Lead
//   - a table without such a header: the first column is used
// Separators: comma, semicolon or tab. Quotes and a BOM are tolerated.

export const PROJECT_KEY = /^[A-Z][A-Z0-9_]{1,254}$/;

const KEY_HEADERS = new Set(['key', 'keys', 'projectkey', 'projectkeys', 'projektkey', 'projektschlussel', 'projektschluessel', 'schlussel', 'schluessel', 'pkey']);
const OTHER_HEADERS = new Set(['project', 'projects', 'projekt', 'projekte']);

const headerName = cell => cell.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

function splitLine(line, delimiter) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { cells.push(cell); cell = ''; }
    else cell += char;
  }
  cells.push(cell);
  return cells.map(value => value.trim());
}

function detectDelimiter(lines) {
  const sample = lines.slice(0, 20).join('\n');
  const counts = [';', ',', '\t'].map(d => [d, sample.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

// Returns { keys, invalid, duplicates, column } - keys are upper-cased, unique
// and in file order; invalid holds the cells that cannot be a project key.
export function parseProjectKeysCsv(input) {
  const lines = String(input || '').replace(/^﻿/, '').split(/\r\n|\n|\r/).filter(line => line.trim());
  if (!lines.length) return { keys: [], invalid: [], duplicates: 0, column: null };
  const delimiter = detectDelimiter(lines);
  let rows = lines.map(line => splitLine(line, delimiter));
  let column = null;
  let cells;

  const headerIndex = rows[0].findIndex(cell => KEY_HEADERS.has(headerName(cell)));
  const tabular = rows.length > 1 && rows.some(row => row.length > 1);
  if (headerIndex >= 0) {
    column = rows[0][headerIndex];
    cells = rows.slice(1).map(row => row[headerIndex] || '');
  } else if (tabular) {
    // A table without a recognizable header: keys are expected in column one.
    if (OTHER_HEADERS.has(headerName(rows[0][0]))) rows = rows.slice(1);
    column = 'first column';
    cells = rows.map(row => row[0] || '');
  } else {
    cells = rows.flat();
    if (cells.length > 1 && OTHER_HEADERS.has(headerName(cells[0]))) cells = cells.slice(1);
  }

  const keys = [];
  const invalid = [];
  const seen = new Set();
  let duplicates = 0;
  for (const cell of cells) {
    if (!cell) continue;
    const key = cell.toUpperCase();
    if (!PROJECT_KEY.test(key)) { invalid.push(cell); continue; }
    if (seen.has(key)) { duplicates += 1; continue; }
    seen.add(key);
    keys.push(key);
  }
  return { keys, invalid, duplicates, column };
}
