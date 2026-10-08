import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildLengthScheduleDraft,
  buildRoundRepair,
  deriveTournamentFormats,
  generateBalancedRound,
  getFullRoundRobinRoundCount,
  getRegularPhaseMatches,
  resolveChampionshipTeam,
  serializeLengthScheduleDraft,
  type LengthScheduleTeam,
} from '../src/utils/length-schedule';

const repairMigration = readFileSync(
  new URL('../migrations/history/20261001090135_repair_length_schedule_affected_fixtures.sql', import.meta.url),
  'utf8',
);
const roundOneRecoveryMigration = readFileSync(
  new URL('../migrations/history/20261001090921_recover_length_round_one.sql', import.meta.url),
  'utf8',
);

function rankedTeams(count: number): LengthScheduleTeam[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `team-${index + 1}`,
    name: `Team ${index + 1}`,
    teamRank: index + 1,
    countryName: 'San Marino',
    leagueLevel: 1,
  }));
}

test('full round-robin length is generic for even and odd fields', () => {
  assert.equal(getFullRoundRobinRoundCount(6), 5);
  assert.equal(getFullRoundRobinRoundCount(7), 7);
  assert.equal(getFullRoundRobinRoundCount(12), 11);
});

test('meaningful formats derive from team and safe-round counts', () => {
  assert.deepEqual(
    deriveTournamentFormats({ teamCount: 6, safeRoundCount: 6 }).map((format) => [
      format.totalRounds,
      format.regularRounds,
      format.postseasonRounds,
    ]),
    [[6, 5, 1], [5, 5, 0]],
  );
  for (const teamCount of [8, 10, 12]) {
    const formats = deriveTournamentFormats({ teamCount, safeRoundCount: 6 });
    assert.equal(formats.length, 1);
    assert.equal(formats[0]?.kind, 'balanced');
    assert.equal(formats[0]?.regularRounds, 6);
  }
});

test('7 October 2026 exposes six safe S95 rounds without spilling into S96', () => {
  const draft = buildLengthScheduleDraft({
    teams: rankedTeams(12),
    startSlotId: 'S95-W12-midweek',
    now: new Date('2026-09-30T00:00:00Z'),
  });

  assert.equal(draft.valid, true);
  assert.equal(draft.htSeason, 95);
  assert.equal(draft.safeRoundCount, 6);
  assert.deepEqual(
    draft.safeSlots.map((slot) => `${slot.htWeek}:${slot.kind}`),
    [
      '12:midweek_friendly',
      '13:midweek_friendly',
      '14:midweek_friendly',
      '15:midweek_friendly',
      '16:midweek_friendly',
      '16:weekend_friendly',
    ],
  );
  assert.ok(draft.safeSlots.every((slot) => slot.htSeason === 95));
});

test('initial staged generation reserves all rounds and materializes only round one', () => {
  const draft = buildLengthScheduleDraft({
    teams: rankedTeams(6),
    startSlotId: 'S95-W12-midweek',
    now: new Date('2026-09-30T00:00:00Z'),
  });
  assert.equal(draft.selectedFormat?.kind, 'round_robin_plus_final');
  assert.equal(draft.rounds.length, 6);
  assert.equal(draft.rounds[0]?.phaseStatus, 'materialized');
  assert.equal(draft.rounds[0]?.matches.length, 3);
  assert.ok(draft.rounds.slice(1).every((round) => round.phaseStatus === 'pending' && round.matches.length === 0));
  assert.equal(draft.rounds[5]?.phase, 'postseason');

  const payload = serializeLengthScheduleDraft(draft);
  assert.equal(payload.mode, 'length');
  assert.equal(payload.ranking_snapshot.length, 6);
  assert.equal(payload.rounds[0]?.matches.length, 3);
  assert.ok(payload.rounds.slice(1).every((round) => round.matches.length === 0));
});

test('missing HFI rank blocks generation', () => {
  const teams = rankedTeams(6);
  teams[2]!.teamRank = null;
  const draft = buildLengthScheduleDraft({
    teams,
    startSlotId: 'S95-W12-midweek',
    now: new Date('2026-09-30T00:00:00Z'),
  });
  assert.equal(draft.valid, false);
  assert.match(draft.reason || '', /Update HFI ranks/);
});

test('custom regular length cannot exceed the no-rematch opponent set', () => {
  const draft = buildLengthScheduleDraft({
    teams: rankedTeams(6),
    startSlotId: 'S95-W12-midweek',
    selectedFormatId: 'custom-6',
    customRoundCount: 6,
    now: new Date('2026-09-30T00:00:00Z'),
  });
  assert.equal(draft.valid, false);
  assert.match(draft.reason || '', /cannot exceed/);
});

test('balanced round is deterministic, rank-near and contains each team once', () => {
  const teams = rankedTeams(12);
  const first = generateBalancedRound(teams);
  const second = generateBalancedRound(teams);
  assert.deepEqual(second, first);
  const participants = first.flatMap((pair) => [pair.homeTeamId, pair.awayTeamId]).filter(Boolean);
  assert.equal(new Set(participants).size, 12);
  assert.equal(participants.length, 12);
  const distance = first.reduce((sum, pair) => {
    if (!pair.homeTeamId || !pair.awayTeamId) return sum;
    const home = teams.find((team) => team.id === pair.homeTeamId)!;
    const away = teams.find((team) => team.id === pair.awayTeamId)!;
    return sum + Math.abs(Number(home.teamRank) - Number(away.teamRank));
  }, 0);
  assert.equal(distance, 6);
});

test('played opponents are excluded and odd fields receive one fair bye', () => {
  const teams = rankedTeams(5);
  const first = generateBalancedRound(teams, { byeCounts: { 'team-1': 1 } });
  assert.equal(first.filter((pair) => pair.isBye).length, 1);
  assert.notEqual(first.find((pair) => pair.isBye)?.homeTeamId, 'team-1');
  const playedPairs = first
    .filter((pair) => pair.homeTeamId && pair.awayTeamId)
    .map((pair) => [pair.homeTeamId!, pair.awayTeamId!] as [string, string]);
  const second = generateBalancedRound(teams, { playedPairs });
  const firstKeys = new Set(playedPairs.map(([a, b]) => [a, b].sort().join(':')));
  assert.ok(
    second
      .filter((pair) => pair.homeTeamId && pair.awayTeamId)
      .every((pair) => !firstKeys.has([pair.homeTeamId!, pair.awayTeamId!].sort().join(':'))),
  );
});

test('balanced round falls back to the minimum number of rematches when strict pairing is impossible', () => {
  const teams = rankedTeams(4);
  const playedPairs: Array<[string, string]> = [
    ['team-1', 'team-2'],
    ['team-3', 'team-4'],
    ['team-1', 'team-3'],
    ['team-1', 'team-4'],
  ];
  const used = new Set(playedPairs.map(([a, b]) => [a, b].sort().join(':')));
  const pairings = generateBalancedRound(teams, { playedPairs }, 3);
  const rematches = pairings.filter(
    (pairing) =>
      pairing.homeTeamId &&
      pairing.awayTeamId &&
      used.has([pairing.homeTeamId, pairing.awayTeamId].sort().join(':')),
  );
  assert.equal(rematches.length, 1);
});

test('length schedule preserves country-specific kickoff times and only uses the safe W16 weekend', () => {
  const teams = rankedTeams(2).map((team) => ({ ...team, countryName: 'England' }));
  const draft = buildLengthScheduleDraft({
    teams,
    startSlotId: 'S95-W12-midweek',
    selectedFormatId: 'round-robin-1',
    now: new Date('2026-09-30T00:00:00Z'),
  });
  assert.equal(draft.valid, true);
  // England's configured friendly is Tuesday 21:00 Stockholm-local here,
  // proving that the nominal midweek slot is not rewritten to Wednesday.
  assert.equal(draft.rounds[0]?.matches[0]?.scheduledFor.toISOString(), '2026-10-06T19:00:00.000Z');
  assert.equal(
    draft.safeSlots.some((slot) => slot.kind === 'weekend_friendly' && slot.htWeek === 15),
    false,
  );
  assert.equal(
    draft.safeSlots.some((slot) => slot.kind === 'weekend_friendly' && slot.htWeek === 16),
    true,
  );
});

test('progressive full round robins contain every opponent pair exactly once', () => {
  for (const teamCount of [5, 6, 8, 10, 12]) {
    const teams = rankedTeams(teamCount);
    const playedPairs: Array<[string, string]> = [];
    const byeCounts: Record<string, number> = {};
    const homeCounts: Record<string, number> = {};
    const roundCount = getFullRoundRobinRoundCount(teamCount);
    for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
      const pairings = generateBalancedRound(teams, { playedPairs, byeCounts, homeCounts }, roundIndex);
      const participants = pairings.flatMap((pairing) => [pairing.homeTeamId, pairing.awayTeamId]).filter(Boolean);
      assert.equal(participants.length, teamCount);
      assert.equal(new Set(participants).size, teamCount);
      for (const pairing of pairings) {
        if (pairing.homeTeamId && pairing.awayTeamId) {
          playedPairs.push([pairing.homeTeamId, pairing.awayTeamId]);
          homeCounts[pairing.homeTeamId] = (homeCounts[pairing.homeTeamId] || 0) + 1;
        } else {
          const byeTeamId = pairing.homeTeamId || pairing.awayTeamId;
          if (byeTeamId) byeCounts[byeTeamId] = (byeCounts[byeTeamId] || 0) + 1;
        }
      }
    }
    assert.equal(new Set(playedPairs.map(([a, b]) => [a, b].sort().join(':'))).size, teamCount * (teamCount - 1) / 2);
    if (teamCount % 2 !== 0) assert.ok(Object.values(byeCounts).every((count) => count === 1));
  }
});

test('repair preserves locked pairs, contains unavailable teams and repairs free teams', () => {
  const result = buildRoundRepair({
    teams: rankedTeams(12),
    lockedPairs: [['team-1', 'team-2'], ['team-3', 'team-4'], ['team-5', 'team-6']],
    unavailableTeamIds: ['team-7', 'team-8'],
  });
  assert.deepEqual(result.lockedPairs, [['team-1', 'team-2'], ['team-3', 'team-4'], ['team-5', 'team-6']]);
  assert.deepEqual(
    new Set([result.containmentPairs[0]?.homeTeamId, result.containmentPairs[0]?.awayTeamId]),
    new Set(['team-7', 'team-8']),
  );
  assert.equal(result.repairedPairs.length, 2);
});

test('repair with odd unavailable and free groups minimizes the unavoidable affected free team', () => {
  const result = buildRoundRepair({
    teams: rankedTeams(12),
    lockedPairs: [['team-1', 'team-2'], ['team-3', 'team-4'], ['team-5', 'team-6']],
    unavailableTeamIds: ['team-7', 'team-8', 'team-9'],
  });
  assert.equal(result.containmentPairs.length, 2);
  assert.equal(result.repairedPairs.length, 1);
  const allIds = [...result.containmentPairs, ...result.repairedPairs]
    .flatMap((pairing) => [pairing.homeTeamId, pairing.awayTeamId])
    .filter(Boolean);
  assert.equal(allIds.length, 6);
  assert.equal(new Set(allIds).size, 6);
});

test('repair only pools warned fixtures and preserves untouched unarranged pairs', () => {
  const result = buildRoundRepair({
    teams: rankedTeams(8),
    lockedPairs: [['team-5', 'team-6'], ['team-7', 'team-8']],
    unavailableTeamIds: ['team-1', 'team-3'],
  });
  assert.deepEqual(result.lockedPairs, [['team-5', 'team-6'], ['team-7', 'team-8']]);
  assert.deepEqual(
    new Set([result.containmentPairs[0]?.homeTeamId, result.containmentPairs[0]?.awayTeamId]),
    new Set(['team-1', 'team-3']),
  );
  assert.deepEqual(
    new Set([result.repairedPairs[0]?.homeTeamId, result.repairedPairs[0]?.awayTeamId]),
    new Set(['team-2', 'team-4']),
  );
});

test('repair migration deletes only fixtures containing unlocked participants', () => {
  const deleteBlock = repairMigration.slice(
    repairMigration.indexOf('  DELETE FROM public.matches'),
    repairMigration.indexOf('  GET DIAGNOSTICS v_deleted = ROW_COUNT;'),
  );
  assert.match(repairMigration, /v_repair_team_ids uuid\[\]/);
  assert.match(repairMigration, /array_agg\(DISTINCT team_id\)/);
  assert.match(deleteBlock, /home_team_id = ANY\(v_repair_team_ids\)/);
  assert.match(deleteBlock, /away_team_id = ANY\(v_repair_team_ids\)/);
});

test('Round 1 recovery is guarded and only replaces that round fixtures', () => {
  assert.match(roundOneRecoveryMigration, /schedule_mode = 'length'/);
  assert.match(roundOneRecoveryMigration, /v_round\.round_number <> 1/);
  assert.match(roundOneRecoveryMigration, /v_round\.phase <> 'regular'/);
  assert.match(roundOneRecoveryMigration, /DELETE FROM public\.matches\s+WHERE round_id = p_round_id/);
  assert.doesNotMatch(roundOneRecoveryMigration, /DELETE FROM public\.rounds/);
  assert.match(roundOneRecoveryMigration, /GRANT EXECUTE ON FUNCTION public\.recover_length_schedule_round_one/);
});

test('regular standings input excludes postseason rounds', () => {
  const regularMatch = { id: 'regular' };
  const finalMatch = { id: 'final' };
  assert.deepEqual(getRegularPhaseMatches([
    { phase: 'regular', matches: [regularMatch] },
    { phase: 'postseason', matches: [finalMatch] },
    { matches: [{ id: 'legacy' }] },
  ]), [regularMatch, { id: 'legacy' }]);
});

test('championship outcome reverses regulation winners but follows ET and penalties', () => {
  assert.equal(resolveChampionshipTeam({
    homeTeamId: 'a', awayTeamId: 'b', homeGoals: 2, awayGoals: 1, went120: false,
  }), 'b');
  assert.equal(resolveChampionshipTeam({
    homeTeamId: 'a', awayTeamId: 'b', homeGoals: 2, awayGoals: 1, went120: true,
  }), 'a');
  assert.equal(resolveChampionshipTeam({
    homeTeamId: 'a', awayTeamId: 'b', homeGoals: 1, awayGoals: 1, went120: true,
    penaltyShootoutHomeGoals: 4, penaltyShootoutAwayGoals: 5,
  }), 'b');
});
