import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultLocale, isLocale, localeNames, locales } from '../src/i18n/config';
import { dictionaries } from '../src/i18n/get-dictionary';
import { applyCatalogValues } from '../src/i18n/catalog';
import en from '../src/i18n/messages/en';

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

test('locale names are centrally defined as language endonyms', () => {
  assert.deepEqual(localeNames, {
    en: 'English',
    it: 'Italiano',
    lv: 'Letiņvalodā',
  });
});

test('catalog key echoes do not replace source copy with unresolved translation keys', () => {
  const result = applyCatalogValues(en, { 'PublicUI.RatingsPitch.ratingB': 'PublicUI.RatingsPitch.ratingB' });
  assert.equal(result.PublicUI.RatingsPitch.ratingB, en.PublicUI.RatingsPitch.ratingB);
});
