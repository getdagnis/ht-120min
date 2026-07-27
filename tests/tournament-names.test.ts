import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTournamentName,
  formatTournamentSlug,
  hasCountryFlagSuffix,
  normalizeTournamentName,
  normalizeTournamentSlug,
} from '../src/utils/tournament-names';

test('tournament name normalization ignores emoji and punctuation', () => {
  assert.equal(normalizeTournamentName('Queens of the Pacific Cup 🇬🇺!'), 'queensofthepacificcup');
  assert.equal(normalizeTournamentName('Queens-of-the-Pacific-Cup'), 'queensofthepacificcup');
});

test('tournament slug normalization never leaves a trailing dash', () => {
  assert.equal(normalizeTournamentSlug('Bone Crushers International 🏆'), 'bone-crushers-international');
});

test('sandbox slug suggestions carry the immutable test marker without duplicating it', () => {
  assert.equal(formatTournamentSlug('Practice Cup', 'sandbox'), 'practice-cup-test');
  assert.equal(formatTournamentSlug('Practice Cup (test)', 'sandbox'), 'practice-cup-test');
  assert.equal(formatTournamentSlug('Practice Cup', 'validated'), 'practice-cup');
});

test('tournament names use permanent sandbox and current restriction suffixes', () => {
  assert.equal(formatTournamentName('Playground', { registrationType: 'sandbox' }), 'Playground (test)');
  assert.equal(formatTournamentName('Playground (test)', { registrationType: 'sandbox' }), 'Playground (test)');
  assert.equal(formatTournamentName('Queens', { countryLimit: 48 }), 'Queens 🇱🇻');
  assert.equal(formatTournamentName('Queens 🇱🇻', { countryLimit: 48 }), 'Queens 🇱🇻');
  assert.equal(formatTournamentName('Women', { countryLimit: 3000 }), 'Women (HFI)');
  assert.equal(formatTournamentName('Women (HFI)', { countryLimit: 3000 }), 'Women (HFI)');
  assert.equal(hasCountryFlagSuffix('Queens 🇱🇻', 48), true);
  assert.equal(hasCountryFlagSuffix('Queens', 48), false);
});
