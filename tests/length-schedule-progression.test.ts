import assert from 'node:assert/strict';
import test from 'node:test';

import { progressLengthSchedule } from '../src/server/api/_lib/length-schedule-service.js';

type FixtureStatus = 'not_arranged' | 'arranged' | 'ongoing' | 'misarranged' | 'finished';

function fixture(status: FixtureStatus, overrides: Record<string, unknown> = {}) {
  return {
    id: `fixture-${status}`,
    home_team_id: 'team-1',
    away_team_id: 'team-2',
    home_slot_id: 'slot-1',
    away_slot_id: 'slot-2',
    status,
    completed: false,
    home_goals: null,
    away_goals: null,
    went_120: false,
    total_minutes: null,
    penalty_shootout_home_goals: null,
    penalty_shootout_away_goals: null,
    schedule_resolution: 'pending',
    ht_match_id: null,
    scheduled_for: '2026-09-23T12:00:00.000Z',
    finished_at: null,
    ...overrides,
  };
}

function createHarness(currentFixture: ReturnType<typeof fixture>) {
  const teams = [1, 2].map((index) => ({
    id: `team-${index}`,
    name: `Team ${index}`,
    ht_team_id: 100 + index,
    hattrick_user_id: 200 + index,
    active: true,
    replacement_for_team_id: null,
    country_name: 'Latvia',
    country_id: 1,
    league_id: 1,
    league_level: 1,
    logo_url: null,
    manager_name: null,
    team_rank: index,
    reserve_active: false,
  }));
  const currentRound = {
    id: 'round-1',
    round_number: 1,
    phase: 'regular',
    phase_status: 'materialized',
    reserved_slot_id: 'S95-W12-midweek',
    reserved_slot_kind: 'midweek_friendly',
    reserved_slot_date: '2026-09-23T00:00:00.000Z',
    matches: [currentFixture],
  };
  const nextRound = {
    id: 'round-2',
    round_number: 2,
    phase: 'regular',
    phase_status: 'pending',
    reserved_slot_id: 'S95-W13-midweek',
    reserved_slot_kind: 'midweek_friendly',
    reserved_slot_date: '2099-09-30T00:00:00.000Z',
    matches: [] as Array<Record<string, unknown>>,
  };
  const warnings = [{ id: 'warning-1', round_id: 'round-1', team_id: 'team-1', active: true }];
  const tables: Record<string, Array<Record<string, unknown>>> = {
    tournaments: [{ id: 'tournament-1', schedule_mode: 'length', scoring_mode: 'standard' }],
    tournament_seasons: [{
      id: 'season-1',
      schedule_plan_json: {},
      ranking_snapshot_json: [
        { team_id: 'team-1', team_rank: 1 },
        { team_id: 'team-2', team_rank: 2 },
      ],
      champion_team_id: null,
    }],
    rounds: [currentRound, nextRound],
    tournament_season_slots: [
      { id: 'slot-1', current_team_id: 'team-1' },
      { id: 'slot-2', current_team_id: 'team-2' },
    ],
    tournament_season_slot_assignments: [],
    teams,
    fixture_warnings: warnings,
  };
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  const supabase = {
    from(table: string) {
      let updateValues: Record<string, unknown> | null = null;
      const query = {
        select() { return this; },
        eq() { return this; },
        in() { return this; },
        order() { return this; },
        update(values: Record<string, unknown>) {
          updateValues = values;
          return this;
        },
        maybeSingle() {
          return Promise.resolve({ data: tables[table]?.[0] ?? null, error: null });
        },
        then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
          if (updateValues) {
            for (const row of tables[table] || []) Object.assign(row, updateValues);
          }
          return Promise.resolve({ data: tables[table] || [], error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name !== 'apply_length_round_transition') throw new Error(`Unexpected RPC ${name}`);

      // Model the relevant atomic SQL transition contract for service-boundary tests.
      const completedRound = (tables.rounds as typeof currentRound[]).find((round) => round.id === args.p_completed_round_id);
      const followingRound = (tables.rounds as Array<typeof currentRound | typeof nextRound>).find(
        (round) => round.round_number === (completedRound?.round_number ?? 0) + 1,
      );
      if (!completedRound || completedRound.phase_status === 'completed') {
        return { data: { advanced: false, reason: 'already_completed' }, error: null };
      }
      const now = Date.now();
      for (const match of completedRound.matches as Array<ReturnType<typeof fixture>>) {
        if (
          match.completed === false &&
          match.ht_match_id === null &&
          (match.status === 'not_arranged' || match.status === 'misarranged') &&
          match.scheduled_for !== null &&
          new Date(match.scheduled_for).getTime() <= now
        ) {
          match.schedule_resolution = 'finalized_unplayed';
          match.status = 'misarranged';
        }
      }
      const unresolved = completedRound.matches.some((match) => {
        const row = match as ReturnType<typeof fixture>;
        return Boolean(row.home_team_id && row.away_team_id) &&
          row.completed !== true && row.status !== 'finished' && row.schedule_resolution !== 'finalized_unplayed';
      });
      if (unresolved) return { data: { advanced: false, reason: 'round_unresolved' }, error: null };

      completedRound.phase_status = 'completed';
      if (!followingRound) return { data: { advanced: true, next_round_materialized: false }, error: null };
      followingRound.matches = args.p_matches as Array<Record<string, unknown>>;
      followingRound.phase_status = 'materialized';
      return { data: { advanced: true, next_round_materialized: true }, error: null };
    },
  };

  return { supabase, currentRound, nextRound, warnings, rpcCalls };
}

async function progress(harness: ReturnType<typeof createHarness>) {
  return progressLengthSchedule(
    harness.supabase as unknown as Parameters<typeof progressLengthSchedule>[0],
    'tournament-1',
    1,
  );
}

test('expired unlinked misarranged fixture is finalized and progresses the round', async () => {
  const harness = createHarness(fixture('misarranged'));

  const result = await progress(harness);

  assert.equal(result.advanced, true);
  assert.equal(harness.currentRound.matches[0]?.schedule_resolution, 'finalized_unplayed');
  assert.equal(harness.currentRound.matches[0]?.status, 'misarranged');
  assert.equal(harness.currentRound.phase_status, 'completed');
  assert.equal(harness.nextRound.phase_status, 'materialized');
  assert.equal(harness.nextRound.matches.length, 1);
  assert.equal(harness.warnings.length, 1);
  assert.equal(harness.warnings[0]?.active, false);
});

test('expired unlinked not_arranged fixture is finalized and progresses the round', async () => {
  const harness = createHarness(fixture('not_arranged'));

  const result = await progress(harness);

  assert.equal(result.advanced, true);
  assert.equal(harness.currentRound.matches[0]?.schedule_resolution, 'finalized_unplayed');
  assert.equal(harness.currentRound.matches[0]?.status, 'misarranged');
  assert.equal(harness.nextRound.phase_status, 'materialized');
});

test('future pending fixture remains unresolved and blocks progression', async () => {
  const harness = createHarness(fixture('not_arranged', { scheduled_for: '2099-09-23T12:00:00.000Z' }));

  const result = await progress(harness);

  assert.deepEqual(result, { advanced: false, reason: 'round_unresolved' });
  assert.equal(harness.currentRound.matches[0]?.schedule_resolution, 'pending');
  assert.equal(harness.currentRound.phase_status, 'materialized');
  assert.equal(harness.nextRound.phase_status, 'pending');
  assert.equal(harness.rpcCalls.length, 0);
});

test('arranged, linked, and ongoing fixtures are not finalized by expired-fixture cleanup', async (t) => {
  for (const [status, overrides] of [
    ['arranged', {}],
    ['not_arranged', { ht_match_id: 12345 }],
    ['ongoing', {}],
  ] as Array<[FixtureStatus, Record<string, unknown>]>) {
    await t.test(`${status}${overrides.ht_match_id ? ' linked' : ''}`, async () => {
      const harness = createHarness(fixture(status, overrides));

      await progress(harness);

      assert.notEqual(harness.currentRound.matches[0]?.schedule_resolution, 'finalized_unplayed');
      assert.equal(harness.currentRound.phase_status, 'materialized');
      assert.equal(harness.nextRound.phase_status, 'pending');
    });
  }
});

test('repeated progression does not materialize duplicate next-round fixtures', async () => {
  const harness = createHarness(fixture('misarranged'));

  const firstResult = await progress(harness);
  const firstFixtures = [...harness.nextRound.matches];
  const retryResult = await progress(harness);

  assert.equal(firstResult.advanced, true);
  assert.equal(retryResult.advanced, false);
  assert.equal(harness.nextRound.matches.length, firstFixtures.length);
  assert.deepEqual(harness.nextRound.matches, firstFixtures);
  assert.equal(harness.rpcCalls.length, 1);
});
