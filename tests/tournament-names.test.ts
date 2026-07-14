import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTournamentName,
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

test('tournament names use permanent sandbox and current restriction suffixes', () => {
  assert.equal(formatTournamentName('Playground', { registrationType: 'sandbox' }), 'Playground (test)');
  assert.equal(formatTournamentName('Playground (test)', { registrationType: 'sandbox' }), 'Playground (test)');
  assert.equal(formatTournamentName('Queens', { countryLimit: 53 }), 'Queens 🇱🇻');
  assert.equal(formatTournamentName('Queens 🇱🇻', { countryLimit: 53 }), 'Queens 🇱🇻');
  assert.equal(formatTournamentName('Women', { countryLimit: 3000 }), 'Women (HFI)');
  assert.equal(formatTournamentName('Women (HFI)', { countryLimit: 3000 }), 'Women (HFI)');
  assert.equal(hasCountryFlagSuffix('Queens 🇱🇻', 53), true);
  assert.equal(hasCountryFlagSuffix('Queens', 53), false);
});
