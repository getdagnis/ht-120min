import assert from 'node:assert/strict';
import test from 'node:test';
import { isFixtureMisarranged } from '../src/utils/fixture-status.js';

test('a historical warning cannot override a confirmed fixture status', () => {
  for (const status of ['arranged', 'ongoing', 'finished']) {
    assert.equal(isFixtureMisarranged(status, false, true), false, status);
  }
  assert.equal(isFixtureMisarranged('not_arranged', true, true), false);
});

test('unresolved warnings and explicitly misarranged fixtures still display as misarranged', () => {
  assert.equal(isFixtureMisarranged('not_arranged', false, true), true);
  assert.equal(isFixtureMisarranged('not_arranged', false, false), false);
  assert.equal(isFixtureMisarranged('misarranged', false, false), true);
  assert.equal(isFixtureMisarranged('misarranged', true, true), true);
});
