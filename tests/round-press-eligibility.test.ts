import assert from 'node:assert/strict';
import test from 'node:test';
import { getEligibleRoundPressNumber, type RoundPressEligibilityRound } from '../src/server/api/_lib/round-press-eligibility.js';

const now = new Date('2026-09-23T10:00:00Z');
const fixture = (id: string, completed: boolean, scheduled_for: string | null = null) => ({
  home_team_id: `${id}-home`,
  away_team_id: `${id}-away`,
  completed,
  status: completed ? 'finished' : 'ongoing',
  scheduled_for,
});

test('unfinished previous round is unavailable', () => {
  const rounds: RoundPressEligibilityRound[] = [
    { round_number: 1, matches: [fixture('r1', false)] },
    { round_number: 2, matches: [fixture('r2', false, '2026-09-23T12:00:00Z')] },
  ];
  assert.equal(getEligibleRoundPressNumber(rounds, now), null);
});

test('completed round is available before the next kickoff', () => {
  const rounds: RoundPressEligibilityRound[] = [
    { round_number: 1, matches: [fixture('r1', true)] },
    { round_number: 2, matches: [fixture('r2', false, '2026-09-23T12:00:00Z')] },
  ];
  assert.equal(getEligibleRoundPressNumber(rounds, now), 1);
});

test('the next kickoff is an exclusive cutoff', () => {
  const rounds: RoundPressEligibilityRound[] = [
    { round_number: 1, matches: [fixture('r1', true)] },
    { round_number: 2, matches: [fixture('r2', false, '2026-09-23T10:00:00Z')] },
  ];
  assert.equal(getEligibleRoundPressNumber(rounds, now), null);
});

test('the earliest playable next-round kickoff controls the cutoff', () => {
  const rounds: RoundPressEligibilityRound[] = [
    { round_number: 1, matches: [fixture('r1', true)] },
    {
      round_number: 2,
      matches: [
        fixture('late', false, '2026-09-23T16:00:00Z'),
        fixture('early', false, '2026-09-23T09:00:00Z'),
      ],
    },
  ];
  assert.equal(getEligibleRoundPressNumber(rounds, now), null);
});

test('a completed final round is available without a next round', () => {
  assert.equal(getEligibleRoundPressNumber([
    { round_number: 1, matches: [fixture('r1', true)] },
  ], now), 1);
});

test('bye slots do not block completion or become a cutoff', () => {
  const rounds: RoundPressEligibilityRound[] = [
    { round_number: 1, matches: [fixture('r1', true), { home_team_id: 'only-home', away_team_id: null, completed: false }] },
    { round_number: 2, matches: [{ home_team_id: 'bye-only', away_team_id: null, completed: false }] },
  ];
  assert.equal(getEligibleRoundPressNumber(rounds, now), 1);
});
