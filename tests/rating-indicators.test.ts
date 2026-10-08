import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getFormationIndicatorScore,
  getMatchMindsetIndicator,
  getSetPieceIndicatorScore,
  getTacticIndicatorScore,
} from '../src/utils/rating-indicators.ts';

test('mindset indicators show only full defensive settings', () => {
  for (const style of [-10, -1000]) {
    const indicator = getMatchMindsetIndicator(style);
    assert.equal(indicator?.label, '100% Defensive');
    assert.ok(typeof indicator?.score === 'number');
  }
  assert.equal(getMatchMindsetIndicator(0), null);
  assert.equal(getMatchMindsetIndicator(10), null);
  assert.equal(getMatchMindsetIndicator(1000), null);
  assert.equal(getMatchMindsetIndicator(-8), null);
  assert.equal(getMatchMindsetIndicator(800), null);
  assert.equal(getMatchMindsetIndicator(null), null);
});

test('formation indicators recognize complete formations without pinning color scores', () => {
  const formations = ['5-5-0', '5-4-1', '5-3-2', '5-2-3', '4-5-1', '4-4-2', '4-3-3', '3-5-2', '3-4-3', '2-5-3'];
  for (const formation of formations) {
    const score = getFormationIndicatorScore(formation);
    assert.ok(typeof score === 'number' && score >= 0 && score <= 4, formation);
  }
  assert.equal(getFormationIndicatorScore('3-3-2'), null);
  assert.equal(getFormationIndicatorScore('2-4-2'), null);
  assert.equal(getFormationIndicatorScore(null), null);
});

test('tactic indicators recognize displayed labels without pinning color scores', () => {
  const tactics = ['Pressing', 'Normal', 'Attack in wings', 'Attack on wings', 'Attack in the middle', 'Long shots', 'Play creatively', 'Counter-attacks'];
  for (const tactic of tactics) {
    const score = getTacticIndicatorScore(tactic);
    assert.ok(typeof score === 'number' && score >= 0 && score <= 4, tactic);
  }
  assert.equal(getTacticIndicatorScore('Unknown'), null);
  assert.equal(getTacticIndicatorScore(null), null);
});

test('set-piece indicators classify skill bands and ignore invalid values', () => {
  for (const skill of [1, 3, 4, 5, 6, 7, 8, 20]) {
    const score = getSetPieceIndicatorScore(skill);
    assert.ok(typeof score === 'number' && score >= 0 && score <= 4, String(skill));
  }
  assert.equal(getSetPieceIndicatorScore(0), null);
  assert.equal(getSetPieceIndicatorScore(Number.NaN), null);
  assert.equal(getSetPieceIndicatorScore(null), null);
});
