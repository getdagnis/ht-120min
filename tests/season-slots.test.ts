import test from 'node:test';
import assert from 'node:assert/strict';
import { getSeasonSlotBoxSize, getSeasonSlotIndexes } from '../src/utils/season-slots';

test('season slot boxes are always even and preserve one physical slot for odd rosters', () => {
  assert.equal(getSeasonSlotBoxSize(2), 2);
  assert.equal(getSeasonSlotBoxSize(5), 6);
  assert.equal(getSeasonSlotBoxSize(6), 6);
  assert.equal(getSeasonSlotBoxSize(11), 12);
});

test('season slot indexes are stable and one-based', () => {
  assert.deepEqual(getSeasonSlotIndexes(5), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(getSeasonSlotIndexes(6), [1, 2, 3, 4, 5, 6]);
});

test('season slot boxes reject invalid roster sizes', () => {
  assert.throws(() => getSeasonSlotBoxSize(0), /at least two teams/);
  assert.throws(() => getSeasonSlotBoxSize(1), /at least two teams/);
  assert.throws(() => getSeasonSlotBoxSize(2.5), /at least two teams/);
});