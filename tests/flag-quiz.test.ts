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

test('question and answer pool excludes familiar flags, including all UK leagues', () => {
  const excluded = [
    'Australia', 'Belgium', 'Brazil', 'Canada', 'Czechia', 'Denmark',
    'England', 'Finland', 'France', 'Germany', 'Greece', 'Iceland',
    'India', 'Italy', 'Jamaica', 'Japan', 'Netherlands',
    'Northern Ireland', 'Norway', 'Poland', 'Portugal', 'Romania',
    'Russia', 'Scotland', 'Spain', 'Sweden', 'Switzerland', 'Turkey',
    'Ukraine', 'USA', 'Wales',
  ];
  assert.ok(excluded.every((name) => !FLAG_QUIZ_COUNTRIES.some((country) => country.leagueName === name)));
  assert.ok(FLAG_QUIZ_COUNTRIES.some((country) => country.leagueName === 'Ireland'));
  assert.throws(() => flagQuizOptions(1, seeded(1))); // Sweden is excluded.
});

test('same-initial distractor count varies from zero to three', () => {
  for (let count = 0; count <= 3; count++) {
    const choices = flagQuizOptions(126, () => count / 4);
    assert.equal(choices.filter((choice) => choice.leagueId !== 126 && choice.name[0] === 'I').length, count);
  }
});

test('every eligible country gets six unique choices with at most three same-initial distractors', () => {
  for (const country of FLAG_QUIZ_COUNTRIES) {
    for (let seed = 1; seed <= 10; seed++) {
      const choices = flagQuizOptions(country.leagueId, seeded(seed));
      assert.equal(choices.length, 6);
      assert.equal(new Set(choices.map((c) => c.leagueId)).size, 6);
      assert.ok(choices.some((c) => c.leagueId === country.leagueId));
      const wrong = choices.filter((c) => c.leagueId !== country.leagueId);
      assert.ok(wrong.filter((c) => c.name[0] === country.leagueName[0]).length <= 3);
      assert.ok(choices.every((c) => FLAG_QUIZ_COUNTRIES.some((valid) => valid.leagueId === c.leagueId)));
    }
  }
});
