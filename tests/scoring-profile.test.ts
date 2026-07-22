import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAppg120ScoringMode,
  persistedScoringMode,
  resolveScoringProfile,
  supportsAppg120ChppClassification,
  usesAveragePoints,
} from '../shared/scoring-profile';

test('legacy appg storage and internal appg-120 resolve to the same profile', () => {
  assert.equal(resolveScoringProfile('appg').id, 'appg-120');
  assert.equal(resolveScoringProfile('appg-120').id, 'appg-120');
});

test('APPG-120 separates average aggregation from its 120-minute ruleset', () => {
  const profile = resolveScoringProfile('appg');
  assert.equal(profile.aggregation, 'average-points');
  assert.equal(profile.matchRuleset, 'appg-120');
  assert.equal(profile.targetMinutes, 120);
  assert.equal(profile.supportsChppAutoClassification, true);

  assert.equal(usesAveragePoints('appg'), true);
  assert.equal(isAppg120ScoringMode('appg'), true);
  assert.equal(supportsAppg120ChppClassification('appg'), true);
});

test('other current modes do not inherit APPG-120 classification', () => {
  for (const mode of ['120m', '120min', 'points'] as const) {
    assert.equal(usesAveragePoints(mode), false);
    assert.equal(isAppg120ScoringMode(mode), false);
    assert.equal(supportsAppg120ChppClassification(mode), false);
  }
});

test('internal APPG-120 keeps the legacy database value', () => {
  assert.equal(persistedScoringMode('appg-120'), 'appg');
});
