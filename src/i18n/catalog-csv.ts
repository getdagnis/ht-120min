import type { CatalogValues } from './catalog.js';

const columns = ['key', 'local translation', 'en translation'];

export function exportCatalogCsv(keys: string[], local: CatalogValues, english: CatalogValues) {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return '\uFEFF' + [columns, ...keys.map((key) => [key, local[key] ?? '', english[key] ?? ''])]
    .map((row) => row.map(quote).join(','))
    .join('\r\n');
}

export function importCatalogCsv(csv: string): CatalogValues {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  let closedQuote = false;
  const input = csv.replace(/^\uFEFF/, '');
  const finishValue = () => {
    row.push(value);
    value = '';
    closedQuote = false;
  };
  const finishRow = () => {
    finishValue();
    if (row.some((cell) => cell !== '')) rows.push(row);
    row = [];
  };
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else value += char;
    } else if (char === ',') {
      finishValue();
    } else if (char === '\r' || char === '\n') {
      finishRow();
      if (char === '\r' && input[index + 1] === '\n') index += 1;
    } else if (char === '"' && !value && !closedQuote) {
      quoted = true;
    } else {
      if (closedQuote || char === '"') throw new Error('CSV contains invalid quoting.');
      value += char;
    }
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted value.');
  finishRow();
  const headers = rows.shift()?.map((header) => header.trim().toLowerCase()) || [];
  const keyColumn = headers.indexOf('key');
  const localColumn = headers.indexOf('local translation');
  if (keyColumn < 0 || localColumn < 0 || new Set(headers).size !== headers.length) {
    throw new Error('CSV must contain unique key and local translation columns.');
  }
  if (!rows.length) throw new Error('CSV contains no translations.');
  const entries = new Map<string, string>();
  for (const cells of rows) {
    if (cells.length !== headers.length) throw new Error('CSV row has the wrong number of columns.');
    const key = cells[keyColumn].trim();
    if (!key || entries.has(key)) throw new Error(`CSV contains an empty or duplicate key: ${key}`);
    entries.set(key, cells[localColumn]);
  }
  return Object.fromEntries(entries);
}
