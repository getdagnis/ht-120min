import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareTournamentActivity, getCurrentRoundNumber, getTournamentCardDateLabel, getTournamentCardDescription,
  type TournamentCardSummary,
} from '../src/utils/tournament-card-details.js';

const base: TournamentCardSummary = {
  id: 'base', slug: 'base', name: 'Base', created_at: '2026-01-01T00:00:00Z',
  season: 1, totalRounds: 5, completedRounds: 0, totalMatches: 0, completedMatches: 0,
  teamCount: 2, rounds: [], plannedStartDate: '2026-09-01T00:00:00Z',
};

test('activity order uses season, completed rounds, teams, then start date with a stable tie', () => {
  const rows: TournamentCardSummary[] = [
    { ...base, id: 'a', slug: 'a', season: 1, completedRounds: 5, teamCount: 8 },
    { ...base, id: 'b', slug: 'b', season: 2, completedRounds: 1, teamCount: 2 },
    { ...base, id: 'c', slug: 'c', season: 2, completedRounds: 2, teamCount: 2 },
    { ...base, id: 'd', slug: 'd', season: 2, completedRounds: 2, teamCount: 4,
      startedAt: '2026-09-02T00:00:00Z', rounds: [{ round_number: 1 }] },
    { ...base, id: 'e', slug: 'e', season: 2, completedRounds: 2, teamCount: 4,
      startedAt: '2026-09-03T00:00:00Z', rounds: [{ round_number: 1 }] },
    { ...base, id: 'f', slug: 'f', season: 2, completedRounds: 2, teamCount: 4,
      startedAt: '2026-09-03T00:00:00Z', rounds: [{ round_number: 1 }] },
  ];
  const expected = ['e', 'f', 'd', 'c', 'b', 'a'];
  assert.deepEqual([...rows].sort(compareTournamentActivity).map((row) => row.id), expected);
  assert.deepEqual([...rows].reverse().sort(compareTournamentActivity).map((row) => row.id), expected);
});

test('card details show current round and a fixed-zone start date', () => {
  const row = { ...base, season: 2, status: 'active', totalMatches: 5, completedMatches: 2,
    startedAt: '2026-09-23T11:00:00Z', rounds: [
      { round_number: 1, matches: [{ completed: true }] },
      { round_number: 2, matches: [{ completed: true }] },
      { round_number: 3, matches: [{ completed: false }] },
    ] };
  assert.equal(getCurrentRoundNumber(row), 3);
  assert.equal(getTournamentCardDateLabel(row), 'Started: 23/09/2026');
});

test('card descriptions show up to 20 normalized words with an ellipsis only when truncated', () => {
  const twentyWords = Array.from({ length: 20 }, (_, index) => `word${index + 1}`).join(' ');
  assert.equal(getTournamentCardDescription(`  ${twentyWords}  `), twentyWords);
  assert.equal(getTournamentCardDescription(`${twentyWords} word21 word22`), `${twentyWords}...`);
  assert.equal(getTournamentCardDescription('  A\n short   description  '), 'A short description');
  assert.equal(getTournamentCardDescription('  '), '');
  assert.equal(getTournamentCardDescription(null), '');
});
