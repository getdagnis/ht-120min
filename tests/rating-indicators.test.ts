import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getFormationIndicatorScore,
  getMatchMindsetIndicator,
  getSetPieceIndicatorScore,
  getTacticIndicatorScore,
} from '../src/utils/rating-indicators.ts';

test('mindset indicators recognize only full defensive and offensive settings', () => {
  assert.deepEqual(getMatchMindsetIndicator(-10), { label: '100% Defensive', score: 1 });
  assert.deepEqual(getMatchMindsetIndicator(-1000), { label: '100% Defensive', score: 1 });
  assert.deepEqual(getMatchMindsetIndicator(10), { label: '100% Offensive', score: 3 });
  assert.deepEqual(getMatchMindsetIndicator(1000), { label: '100% Offensive', score: 3 });
  assert.equal(getMatchMindsetIndicator(-8), null);
  assert.equal(getMatchMindsetIndicator(0), null);
  assert.equal(getMatchMindsetIndicator(800), null);
  assert.equal(getMatchMindsetIndicator(null), null);
});

test('formation indicators use the canonical complete-formation scores', () => {
  const expected: Record<string, number> = {
    '5-5-0': 1,
    '5-4-1': 1,
    '5-3-2': 1,
    '5-2-3': 2,
    '4-5-1': 2,
    '4-4-2': 2,
    '4-3-3': 3,
    '3-5-2': 3,
    '3-4-3': 4,
    '2-5-3': 4,
  };
  for (const [formation, score] of Object.entries(expected)) {
    assert.equal(getFormationIndicatorScore(formation), score, formation);
  }
  assert.equal(getFormationIndicatorScore('3-3-2'), null);
  assert.equal(getFormationIndicatorScore('2-4-2'), null);
  assert.equal(getFormationIndicatorScore(null), null);
});

test('tactic indicators recognize displayed labels and leave unknown values uncolored', () => {
  const expected: Record<string, number> = {
    Pressing: 1,
    Normal: 3,
    'Attack in wings': 4,
    'Attack on wings': 4,
    'Attack in the middle': 4,
    'Long shots': 4,
    'Play creatively': 4,
    'Counter-attacks': 4,
  };
  for (const [tactic, score] of Object.entries(expected)) {
    assert.equal(getTacticIndicatorScore(tactic), score, tactic);
  }
  assert.equal(getTacticIndicatorScore('Unknown'), null);
  assert.equal(getTacticIndicatorScore(null), null);
});

test('set-piece indicators classify skill bands and ignore invalid values', () => {
  assert.equal(getSetPieceIndicatorScore(1), 1);
  assert.equal(getSetPieceIndicatorScore(3), 1);
  assert.equal(getSetPieceIndicatorScore(4), 2);
  assert.equal(getSetPieceIndicatorScore(5), 2);
  assert.equal(getSetPieceIndicatorScore(6), 3);
  assert.equal(getSetPieceIndicatorScore(7), 3);
  assert.equal(getSetPieceIndicatorScore(8), 4);
  assert.equal(getSetPieceIndicatorScore(20), 4);
  assert.equal(getSetPieceIndicatorScore(0), null);
  assert.equal(getSetPieceIndicatorScore(Number.NaN), null);
  assert.equal(getSetPieceIndicatorScore(null), null);
});
