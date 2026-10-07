import assert from 'node:assert/strict';
import test from 'node:test';
import { skillDisplay } from '../src/utils/hattrick-skill';

test('formats Hattrick skill level zero as non-existent and missing skill as unavailable', () => {
  assert.equal(skillDisplay(0), 'Non-existent (0)');
  assert.equal(skillDisplay(null), '—');
});
