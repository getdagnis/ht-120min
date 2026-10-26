import assert from 'node:assert/strict';
import test from 'node:test';
import { interest120m, preferencePairScore } from '../shared/pairing-preferences.js';
import { preferenceOpening } from '../src/utils/preference-opening.js';

test('team answer controls manager fallback and 120m intensity', () => {
  assert.equal(interest120m({ priority: null, importance120m: 'high' }), 4);
  assert.equal(interest120m({ priority: 'flags', importance120m: 'high' }), 0);
  assert.equal(interest120m({ priority: 'both', importance120m: 'regular' }), 1);
  assert.equal(preferencePairScore({ priority: 'flags', importance120m: 'high' }, undefined, true, false), 10);
  assert.equal(preferencePairScore({ priority: 'domestic', importance120m: 'high' }, undefined, true, false), 0);
  assert.equal(preferencePairScore({ priority: '120m', importance120m: 'regular' }, undefined), 0);
});

test('new opener groups mutually interested teams and leaves unanswered roster ranked', () => {
  const teams = ['a', 'b', 'c', 'd'].map((id, index) => ({ id, name: id, teamRank: index + 1,
    countryName: 'Sweden', leagueLevel: 1 }));
  const htIds = { a: 1, b: 2, c: 3, d: 4 };
  assert.equal(preferenceOpening(teams, {}, htIds), null);
  const opener = preferenceOpening(teams, { '1': { priority: '120m', importance120m: 'high' },
    '3': { priority: '120m', importance120m: 'high' } }, htIds);
  assert.ok(opener?.some(pair => [pair.homeTeamId, pair.awayTeamId].sort().join(':') === 'a:c'));
  assert.deepEqual(new Set(opener?.flatMap(pair => [pair.homeTeamId, pair.awayTeamId])), new Set(['a', 'b', 'c', 'd']));
});
