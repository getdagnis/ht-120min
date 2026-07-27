import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultLocale, isLocale, locales } from '../src/i18n/config';
import { dictionaries } from '../src/i18n/get-dictionary';

test('supports the initial English and Latvian locales', () => {
  assert.deepEqual(locales, ['en', 'lv']);
  assert.equal(defaultLocale, 'en');
  assert.equal(isLocale('en'), true);
  assert.equal(isLocale('lv'), true);
  assert.equal(isLocale('de'), false);
});

test('locale dictionaries expose the same initial message contract', () => {
  assert.deepEqual(Object.keys(dictionaries.en), Object.keys(dictionaries.lv));
  assert.deepEqual(Object.keys(dictionaries.en.common), Object.keys(dictionaries.lv.common));
});
