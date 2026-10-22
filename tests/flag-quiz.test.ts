import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FLAG_QUIZ_COUNTRIES, flagQuizOptions } from '../shared/flag-quiz.ts';

function seeded(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
}

test('flag pool excludes Oceania and special leagues', () => {
  assert.ok(FLAG_QUIZ_COUNTRIES.length > 100);
  assert.ok(FLAG_QUIZ_COUNTRIES.every((c) => c.countryId !== null && c.leagueId !== 15));
  assert.throws(() => flagQuizOptions(15, seeded(1)));
  assert.throws(() => flagQuizOptions(1000, seeded(1)));
});

test('every eligible country gets six unique choices with same-initial and nearby distractors', () => {
  for (const country of FLAG_QUIZ_COUNTRIES) {
    for (let seed = 1; seed <= 10; seed++) {
      const choices = flagQuizOptions(country.leagueId, seeded(seed));
      assert.equal(choices.length, 6);
      assert.equal(new Set(choices.map((c) => c.leagueId)).size, 6);
      assert.ok(choices.some((c) => c.leagueId === country.leagueId));
      const matchingCount = Math.min(2, FLAG_QUIZ_COUNTRIES.filter((c) => c.leagueId !== country.leagueId && c.leagueName[0] === country.leagueName[0]).length);
      const wrong = choices.filter((c) => c.leagueId !== country.leagueId);
      assert.ok(wrong.filter((c) => c.name[0] === country.leagueName[0]).length >= matchingCount);
      assert.ok(wrong.every((c) => c.name[0] === country.leagueName[0] || Math.abs(c.leagueId - country.leagueId) <= 20));
      assert.ok(choices.every((c) => FLAG_QUIZ_COUNTRIES.some((valid) => valid.leagueId === c.leagueId)));
    }
  }
});
