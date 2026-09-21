import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getFixtureChallengeMatchPlace,
  getFixtureChallengeMatchType,
  getFixtureChallengeSide,
  resolveFixtureChallengeOptions,
} from '../src/server/api/_lib/fixture-challenge.js';
import { mapAdHomeAwayToChppMatchPlace } from '../src/server/api/_lib/chpp-challenges.js';

test('fixture challenges use cup rules for both supported 120-minute scoring values', () => {
  assert.equal(getFixtureChallengeMatchType('120m'), 1);
  assert.equal(getFixtureChallengeMatchType('120min'), 1);
  assert.equal(getFixtureChallengeMatchType('points'), 0);
  assert.equal(getFixtureChallengeMatchType(null), 0);
});

test('fixture challenge venue follows the logged-in team fixture side', () => {
  assert.equal(getFixtureChallengeMatchPlace('home'), 0);
  assert.equal(getFixtureChallengeMatchPlace('away'), 1);
});

test('fixture challenges identify only the signed-in manager side', () => {
  assert.equal(getFixtureChallengeSide({ viewerUserId: 12, homeOwnerId: 12, awayOwnerId: 23 }), 'home');
  assert.equal(getFixtureChallengeSide({ viewerUserId: 23, homeOwnerId: 12, awayOwnerId: 23 }), 'away');
  assert.equal(getFixtureChallengeSide({ viewerUserId: 99, homeOwnerId: 12, awayOwnerId: 23 }), null);
});

test('fixture challenge rules and venue can be safely overridden without changing team ownership', () => {
  const scheduled = { matchType: 1 as const, matchPlace: 0 as const };
  assert.deepEqual(resolveFixtureChallengeOptions({ matchType: 'normal', venue: 'away' }, scheduled), {
    matchType: 0,
    matchPlace: 1,
  });
  assert.equal(resolveFixtureChallengeOptions({ matchType: 'anything', venue: 'away' }, scheduled), null);
  assert.equal(resolveFixtureChallengeOptions({ matchType: 'cup_rules', venue: 'neutral' }, scheduled), null);
});

test('matchmaker home/away mapping agrees with the documented CHPP values', () => {
  assert.equal(mapAdHomeAwayToChppMatchPlace('home'), 0);
  assert.equal(mapAdHomeAwayToChppMatchPlace('away'), 1);
  assert.equal(mapAdHomeAwayToChppMatchPlace('either'), 0);
});
