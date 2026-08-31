import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveMatchmakerSwipe } from '../src/utils/matchmaker';

test('horizontal Matchmaker swipes resolve to their card actions', () => {
  assert.equal(resolveMatchmakerSwipe(-80, 8), 'next');
  assert.equal(resolveMatchmakerSwipe(80, -8), 'challenge');
});

test('short or primarily vertical Matchmaker gestures do not trigger actions', () => {
  assert.equal(resolveMatchmakerSwipe(-40, 2), null);
  assert.equal(resolveMatchmakerSwipe(70, 65), null);
  assert.equal(resolveMatchmakerSwipe(10, 90), null);
});
