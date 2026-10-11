import assert from 'node:assert/strict';
import test from 'node:test';
import { exportCatalogCsv, importCatalogCsv } from '../src/i18n/catalog-csv.ts';

test('catalog CSV preserves local commas, quotes, Unicode, multiline text and empty values', () => {
  const local = { first: 'Spēles, "raunds"\n{round}', second: '' };
  const english = { first: 'Matches, "round"\n{round}', second: 'Standings' };
  const csv = exportCatalogCsv(Object.keys(local), local, english);
  assert.ok(csv.startsWith('\uFEFF"key","local translation","en translation"'));
  assert.deepEqual(importCatalogCsv(csv), local);
});

test('catalog CSV imports local values by key and ignores reordered English reference columns', () => {
  assert.deepEqual(
    importCatalogCsv('en translation,key,local translation\r\nChanged English,second,Vietējais\r\nIgnore,first,\r\n'),
    { second: 'Vietējais', first: '' },
  );
});

test('catalog CSV rejects duplicate keys, missing local column and malformed rows', () => {
  for (const csv of [
    'key,local translation\na,One\na,Two',
    'key,en translation\na,One',
    'key,local translation\na,"Unclosed',
    'key,local translation\na,One,Extra',
    'key,local translation\na,"Closed"extra',
  ]) assert.throws(() => importCatalogCsv(csv));
});
