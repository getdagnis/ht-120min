import assert from 'node:assert/strict';
import test from 'node:test';

import {
  refreshCurrentHfiTeamRanks,
  selectCurrentHfiParticipants,
  validateHfiRankRefreshAccess,
  type HfiRankParticipant,
} from '../src/server/api/_lib/hfi-rank-refresh.js';

const participant = (overrides: Partial<HfiRankParticipant> = {}): HfiRankParticipant => ({
  id: 'team-row',
  name: 'Team',
  ht_team_id: 123456,
  active: true,
  reserve_active: false,
  is_placeholder: false,
  ...overrides,
});

test('current HFI participants exclude reserves, inactive teams, and placeholders', () => {
  const selected = selectCurrentHfiParticipants([
    participant({ id: 'active' }),
    participant({ id: 'reserve', reserve_active: true }),
    participant({ id: 'inactive', active: false }),
    participant({ id: 'placeholder', is_placeholder: true }),
    participant({ id: 'legacy-null-flags', reserve_active: null, is_placeholder: null }),
  ]);

  assert.deepEqual(selected.map((team) => team.id), ['active', 'legacy-null-flags']);
});

test('missing TeamRank aborts before any team rank update', async () => {
  let writes = 0;

  await assert.rejects(
    refreshCurrentHfiTeamRanks({
      participants: [participant({ id: 'first', ht_team_id: 111 }), participant({ id: 'second', ht_team_id: 222 })],
      fetchTeamDetails: async (teamId) => ({ teamName: `Team ${teamId}`, teamRank: teamId === 111 ? 12 : undefined }),
      updateTeamMetadata: async () => {
        writes += 1;
      },
    }),
    /valid HFI rank/,
  );

  assert.equal(writes, 0);
});

test('invalid active participant IDs abort before CHPP fetches or writes', async () => {
  let fetches = 0;
  let writes = 0;

  await assert.rejects(
    refreshCurrentHfiTeamRanks({
      participants: [participant({ id: 'missing-ht-id', ht_team_id: null })],
      fetchTeamDetails: async () => {
        fetches += 1;
        return { teamName: 'Unexpected teamdetails response', teamRank: 1 };
      },
      updateTeamMetadata: async () => {
        writes += 1;
      },
    }),
    /no valid Hattrick team ID/,
  );

  assert.equal(fetches, 0);
  assert.equal(writes, 0);
});

test('successful refresh maps each Hattrick team ID to its returned rank', async () => {
  const updates: Array<{ teamId: string; teamRank: number }> = [];
  const result = await refreshCurrentHfiTeamRanks({
    participants: [participant({ id: 'row-a', ht_team_id: 111 }), participant({ id: 'row-b', ht_team_id: 222 })],
    fetchTeamDetails: async (teamId) => ({
      teamName: `Team ${teamId}`,
      teamRank: teamId === 111 ? 11 : 22,
      powerRating: teamId === 111 ? 801 : 802,
      powerGlobalRank: teamId === 111 ? 101 : 102,
      powerLeagueRank: teamId === 111 ? 11 : 12,
      powerRegionRank: teamId === 111 ? 3 : 4,
    }),
    updateTeamMetadata: async (teamId, update) => {
      updates.push({ teamId, teamRank: update.teamRank });
    },
  });

  assert.deepEqual(updates, [
    { teamId: 'row-a', teamRank: 11 },
    { teamId: 'row-b', teamRank: 22 },
  ]);
  assert.equal(result.participantCount, 2);
  assert.equal(result.updatedCount, 2);
  assert.deepEqual(
    result.ranks.map(({ htTeamId, teamRank }) => ({ htTeamId, teamRank })),
    [
      { htTeamId: 111, teamRank: 11 },
      { htTeamId: 222, teamRank: 22 },
    ],
  );
  assert.deepEqual(
    result.ranks.map(({ powerRating, powerGlobalRank, powerLeagueRank, powerRegionRank }) => ({
      powerRating,
      powerGlobalRank,
      powerLeagueRank,
      powerRegionRank,
    })),
    [
      { powerRating: 801, powerGlobalRank: 101, powerLeagueRank: 11, powerRegionRank: 3 },
      { powerRating: 802, powerGlobalRank: 102, powerLeagueRank: 12, powerRegionRank: 4 },
    ],
  );
});

test('refresh access rejects non-operational users and non-HFI tournaments', () => {
  assert.equal(
    validateHfiRankRefreshAccess({ canManageOperations: false, leagueCategory: 'hfi' }),
    'This role cannot update HFI ranks.',
  );
  assert.equal(
    validateHfiRankRefreshAccess({ canManageOperations: true, leagueCategory: 'male' }),
    'HFI ranks can only be updated for HFI tournaments.',
  );
  assert.equal(validateHfiRankRefreshAccess({ canManageOperations: true, leagueCategory: 'hfi' }), null);
});
