import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeekendPreview, shuffleWeekendPreview, type WeekendTeam } from '../src/utils/forge-weekend-preview.js';
import type { SlotObservation } from '../shared/organizer-planning.js';

test('shuffle includes unmatched teams and drops previous make-up annotations', () => {
  const result = shuffleWeekendPreview([{ homeTeamId: '1', awayTeamId: '2', originalFixtureId: 'old' },
    { homeTeamId: '3', awayTeamId: '4' }], ['5'], () => 0);
  assert.deepEqual(result, { pairs: [{ homeTeamId: '2', awayTeamId: '3' }, { homeTeamId: '4', awayTeamId: '5' }], unmatched: ['1'] });
});

test('weekend preview prioritizes one missed fixture and excludes unavailable or non-active teams', () => {
  const teams: WeekendTeam[] = Array.from({ length: 6 }, (_, index) => ({ id: String(index + 1), name: `Team ${index + 1}`,
    ht_team_id: index + 1, hattrick_user_id: index + 1, active: index !== 5, reserve_active: false }));
  const checks = new Map<number, SlotObservation>(teams.map((team, index) => [team.ht_team_id!, { teamId: team.id,
    state: index === 4 ? 'booked' : 'free', checkedAt: '2026-10-26T00:00:00Z', reason: '', pendingOpponentIds: [], challengesKnown: true }]));
  const result = createWeekendPreview(teams, checks, [
    { id: 'later', roundNumber: 2, homeTeamId: '1', awayTeamId: '3' },
    { id: 'earlier', roundNumber: 1, homeTeamId: '1', awayTeamId: '2' },
  ]);
  assert.equal(result.pairs[0].originalFixtureId, 'earlier');
  assert.equal(result.pairs.length, 2);
  assert.deepEqual(new Set(result.pairs.flatMap(pair => [pair.homeTeamId, pair.awayTeamId])), new Set(['1', '2', '3', '4']));
});

test('opponent swaps preserve team uniqueness and reject same-manager pairings', async () => {
  const { swapWeekendOpponents } = await import('../src/utils/forge-weekend-preview.js');
  const teams: WeekendTeam[] = Array.from({ length: 4 }, (_, index) => ({ id: String(index + 1), name: `Team ${index + 1}`,
    ht_team_id: index + 1, hattrick_user_id: index + 1, active: true, reserve_active: false }));
  const pairs = [{ homeTeamId: '1', awayTeamId: '2', originalFixtureId: 'missed' }, { homeTeamId: '3', awayTeamId: '4' }];
  const swapped = swapWeekendOpponents(pairs, 0, 1, teams)!;
  assert.deepEqual(swapped, [{ homeTeamId: '1', awayTeamId: '4' }, { homeTeamId: '3', awayTeamId: '2' }]);
  teams[3].hattrick_user_id = 1;
  assert.equal(swapWeekendOpponents(pairs, 0, 1, teams), null);
});
