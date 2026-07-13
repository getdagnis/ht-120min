import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTournamentName, normalizeTournamentSlug } from '../src/utils/tournament-names';

test('tournament name normalization ignores emoji and punctuation', () => {
  assert.equal(normalizeTournamentName('Queens of the Pacific Cup 🇬🇺!'), 'queensofthepacificcup');
  assert.equal(normalizeTournamentName('Queens-of-the-Pacific-Cup'), 'queensofthepacificcup');
});

test('tournament slug normalization never leaves a trailing dash', () => {
  assert.equal(normalizeTournamentSlug('Bone Crushers International 🏆'), 'bone-crushers-international');
});
