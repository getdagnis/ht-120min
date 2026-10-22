import assert from 'node:assert/strict';
import test from 'node:test';
import { repairLengthRound } from '../src/server/api/_lib/length-schedule-service.js';

function createHarness(options: { doubleBye: boolean; warning?: boolean } = { doubleBye: true }) {
  const teams = Array.from({ length: options.doubleBye ? 4 : 3 }, (_, index) => ({
    id: `team-${index + 1}`, name: `Team ${index + 1}`, active: true,
    reserve_active: false, is_placeholder: false, team_rank: index + 1,
  }));
  const match = (id: string, home: string | null, away: string | null) => ({
    id, home_team_id: home, away_team_id: away,
    home_slot_id: home ? `slot-${home}` : null,
    away_slot_id: away ? `slot-${away}` : null,
    status: 'not_arranged', completed: false, ht_match_id: null,
    scheduled_for: '2099-09-23T12:00:00.000Z', finished_at: null,
    schedule_resolution: 'pending',
  });
  const matches = [match('untouched', 'team-1', 'team-2'), match('bye-1', 'team-3', null)];
  if (options.doubleBye) matches.push(match('bye-2', null, 'team-4'));
  const round = {
    id: 'round-1', round_number: 1, phase: 'regular', phase_status: 'materialized',
    reserved_slot_id: 'S169-W13-midweek', reserved_slot_kind: 'midweek_friendly',
    reserved_slot_date: '2099-09-23T00:00:00.000Z', matches,
  };
  const rows: Record<string, Record<string, unknown>[]> = {
    tournaments: [{ id: 'cup', schedule_mode: 'length' }],
    tournament_seasons: [{ id: 'season-1', schedule_plan_json: {}, ranking_snapshot_json: teams.map(team => ({ team_id: team.id, team_rank: team.team_rank })) }],
    rounds: [round], teams,
    tournament_season_slots: teams.map(team => ({ id: `slot-${team.id}`, current_team_id: team.id })),
    tournament_season_slot_assignments: [],
    fixture_warnings: options.warning ? [{ team_id: 'team-1', active: true }] : [],
  };
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const supabase = {
    from(table: string) {
      let activeFilter: unknown = null;
      return {
        select() { return this; },
        eq(column: string, value: unknown) {
          if (table === 'teams' && column === 'active') activeFilter = value;
          return this;
        },
        in() { return this; },
        order() { return this; },
        maybeSingle() { return Promise.resolve({ data: rows[table]?.[0] ?? null, error: null }); },
        then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
          return Promise.resolve({
            data: (rows[table] || []).filter(row => activeFilter === null || row.active === activeFilter),
            error: null,
          }).then(resolve, reject);
        },
      };
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: { fixtures_replaced: 2, fixtures_inserted: 1 }, error: null };
    },
  };
  return { supabase: supabase as unknown as Parameters<typeof repairLengthRound>[0], calls };
}

test('repair pairs two separate BYEs and keeps the unrelated fixture locked', async () => {
  const { supabase, calls } = createHarness();
  const result = await repairLengthRound(supabase, 'cup', 1);
  assert.equal(result.lockedFixtures, 1);
  assert.equal(result.repairedPlayableFixtures, 1);
  assert.equal(calls.length, 1);
  const replacement = calls[0]!.args.p_unlocked_matches as Array<Record<string, unknown>>;
  assert.equal(replacement.length, 1);
  assert.deepEqual([replacement[0]!.home_team_id, replacement[0]!.away_team_id].sort(), ['team-3', 'team-4']);
});

test('one legitimate BYE alone does not trigger repair', async () => {
  const { supabase, calls } = createHarness({ doubleBye: false });
  await assert.rejects(repairLengthRound(supabase, 'cup', 1), /No booked-elsewhere teams, vacant fixtures, or excess BYEs/);
  assert.equal(calls.length, 0);
});

test('warning repair preserves an unrelated single BYE', async () => {
  const { supabase, calls } = createHarness({ doubleBye: false, warning: true });
  const result = await repairLengthRound(supabase, 'cup', 1);
  assert.equal(result.repairedPlayableFixtures, 0);
  const replacement = calls[0]!.args.p_unlocked_matches as Array<Record<string, unknown>>;
  assert.equal(replacement.length, 1);
  assert.deepEqual([replacement[0]!.home_team_id, replacement[0]!.away_team_id].sort(), ['team-1', 'team-2']);
});
