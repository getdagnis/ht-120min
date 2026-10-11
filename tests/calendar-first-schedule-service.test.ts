import assert from 'node:assert/strict';
import test from 'node:test';
import { progressLengthSchedule } from '../src/server/api/_lib/length-schedule-service.js';

function harness(count = 12, playoffs = 3) {
  const teams = Array.from({ length: count }, (_, i) => ({
    id: `team-${i + 1}`, name: `Team ${String(i + 1).padStart(2, '0')}`, ht_team_id: i + 1,
    hattrick_user_id: i + 1, active: true, replacement_for_team_id: null,
    country_name: 'England', league_level: 1, team_rank: null, reserve_active: false,
  }));
  const slots = teams.map((team, i) => ({ id: `slot-${i + 1}`, slot_index: i + 1, current_team_id: team.id }));
  const match = (home: string, away: string, index: number) => ({
    id: `match-${index}`, home_team_id: home, away_team_id: away,
    home_slot_id: `slot-${Number(home.split('-')[1])}`, away_slot_id: `slot-${Number(away.split('-')[1])}`,
    status: 'finished', completed: true, home_goals: 1, away_goals: 0,
    went_120: true, total_minutes: 120, schedule_resolution: 'played', ht_match_id: index + 1,
    scheduled_for: '2030-03-20T12:00:00Z', finished_at: '2030-03-20T14:00:00Z',
    playoff_match_number: index + 1,
  });
  const rounds: Array<Record<string, unknown>> = Array.from({ length: playoffs + 1 }, (_, i) => ({
    id: `round-${i + 1}`, round_number: i + 1, phase: i === 0 ? 'regular' : 'postseason',
    phase_round_number: i === 0 ? 1 : i, phase_status: i === 0 ? 'materialized' : 'pending',
    reserved_slot_id: `S95-W${12 + i}-midweek`, reserved_slot_kind: 'midweek_friendly',
    reserved_slot_date: '2030-03-20T00:00:00Z',
    matches: i === 0 ? Array.from({ length: count / 2 }, (_, m) => match(`team-${m * 2 + 1}`, `team-${m * 2 + 2}`, m)) : [],
  }));
  const plan = { version: 2, regular_pairings: [] as Array<Array<{ home_slot_index: number; away_slot_index: number | null }>>, postseason_rounds: playoffs };
  const tables: Record<string, unknown[]> = {
    tournaments: [{ id: 'cup', schedule_mode: 'length', scoring_mode: 'standard' }],
    tournament_seasons: [{ id: 'season', schedule_plan_json: plan,
      ranking_snapshot_json: teams.map((team, i) => ({ team_id: team.id, ranking_value: 800 - i, seed: i + 1 })) }],
    teams, rounds, tournament_season_slots: slots, tournament_season_slot_assignments: [], fixture_warnings: [],
  };
  const calls: Array<Record<string, unknown>> = [];
  const supabase = {
    from(table: string) {
      const query = {
        select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; }, update() { return this; },
        maybeSingle() { return Promise.resolve({ data: tables[table]?.[0], error: null }); },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: tables[table] || [], error: null }).then(resolve); },
      };
      return query;
    },
    async rpc(_name: string, args: Record<string, unknown>) {
      calls.push(args);
      const current = rounds.find(round => round.id === args.p_completed_round_id)!;
      current.phase_status = 'completed';
      const next = rounds.find(round => round.id === args.p_next_round_id);
      if (next) { next.matches = args.p_matches; next.phase_status = 'materialized'; }
      return { data: { advanced: true, next_round_materialized: Boolean(next) }, error: null };
    },
  };
  const progress = () => progressLengthSchedule(supabase as unknown as Parameters<typeof progressLengthSchedule>[0], 'cup', 1);
  const finishRound = (index: number) => {
    const fixtures = rounds[index]!.matches as Array<Record<string, unknown>>;
    for (const fixture of fixtures) Object.assign(fixture, {
      completed: true, status: 'finished', schedule_resolution: 'played', home_goals: 1, away_goals: 0, went_120: true,
    });
    return fixtures;
  };
  return { teams, slots, rounds, plan, calls, progress, finishRound, assignments: tables.tournament_season_slot_assignments as Array<Record<string, unknown>>, tournament: tables.tournaments[0] as Record<string, unknown> };
}

test('top-eight playoffs progress through quarterfinals, semifinals and final using bracket order', async () => {
  const state = harness();
  await state.progress();
  const quarters = state.finishRound(1);
  assert.equal(quarters.length, 4);
  assert.deepEqual(quarters.map(match => match.playoff_match_number), [1, 2, 3, 4]);
  const winners = quarters.map(match => match.home_team_id);
  quarters.reverse(); // Database relationship ordering is not bracket ordering.
  await state.progress();
  const semis = state.finishRound(2);
  assert.deepEqual(semis.map(match => [match.home_team_id, match.away_team_id]), [[winners[0], winners[1]], [winners[2], winners[3]]]);
  await state.progress();
  const final = state.finishRound(3);
  assert.equal(final.length, 1);
  assert.deepEqual([final[0]!.home_team_id, final[0]!.away_team_id], semis.map(match => match.home_team_id));
  await state.progress();
  assert.equal(state.calls.at(-1)?.p_champion_team_id, final[0]!.home_team_id);
  const calls = state.calls.length;
  await state.progress();
  assert.equal(state.calls.length, calls);
});

test('top-four and top-two finishes use the same phased progression', async () => {
  for (const [count, playoffs] of [[8, 2], [6, 1]]) {
    const state = harness(count, playoffs);
    await state.progress();
    assert.equal((state.rounds[1]!.matches as unknown[]).length, 2 ** (playoffs! - 1));
  }
});

test('a tied playoff result cannot select a winner or advance the bracket', async () => {
  const state = harness();
  await state.progress();
  const quarters = state.finishRound(1);
  quarters[0]!.away_goals = 1;
  const calls = state.calls.length;
  await assert.rejects(state.progress(), /decisive winner/);
  assert.equal(state.calls.length, calls);
});

test('new regular rounds use the frozen slot plan, including a replacement occupant', async () => {
  const state = harness(4, 1);
  state.rounds[1]!.phase = 'regular';
  state.plan.regular_pairings = [[{ home_slot_index: 1, away_slot_index: 2 }, { home_slot_index: 3, away_slot_index: 4 }], [{ home_slot_index: 1, away_slot_index: 3 }, { home_slot_index: 2, away_slot_index: 4 }]];
  state.teams[0]!.id = 'replacement';
  state.slots[0]!.current_team_id = 'replacement';
  await state.progress();
  const fixtures = state.rounds[1]!.matches as Array<Record<string, unknown>>;
  assert.deepEqual(fixtures.map(match => [match.home_team_id, match.away_team_id]), [['replacement', 'team-3'], ['team-2', 'team-4']]);
});


test('missed regular fixtures keep the existing played-history fallback active', async () => {
  const state = harness(4, 1);
  state.rounds[1]!.phase = 'regular';
  state.plan.regular_pairings = [
    [{ home_slot_index: 1, away_slot_index: 2 }, { home_slot_index: 3, away_slot_index: 4 }],
    [{ home_slot_index: 1, away_slot_index: 2 }, { home_slot_index: 3, away_slot_index: 4 }],
  ];
  const previous = state.rounds[0]!.matches as Array<Record<string, unknown>>;
  previous[1]!.completed = false;
  previous[1]!.status = 'misarranged';
  previous[1]!.schedule_resolution = 'finalized_unplayed';
  await state.progress();
  const next = state.rounds[1]!.matches as Array<Record<string, unknown>>;
  assert.ok(next.every(match => [match.home_team_id, match.away_team_id].sort().join(':') !== 'team-1:team-2'));
});


test('admitted reserves participate in later rounds without using the original smaller pairing plan', async () => {
  const state = harness(4, 1);
  state.tournament.league_category = 'male';
  state.rounds[1]!.phase = 'regular';
  state.plan.regular_pairings = [[{ home_slot_index: 1, away_slot_index: 2 }, { home_slot_index: 3, away_slot_index: 4 }], [{ home_slot_index: 1, away_slot_index: 3 }, { home_slot_index: 2, away_slot_index: 4 }]];
  for (const number of [5, 6]) {
    state.teams.push({ ...state.teams[0]!, id: `team-${number}`, name: `Team ${number}`, ht_team_id: number, hattrick_user_id: number });
    state.slots.push({ id: `slot-${number}`, slot_index: number, current_team_id: `team-${number}` });
    state.assignments.push({ tournament_season_slot_id: `slot-${number}`, team_id: `team-${number}`, admission_request_id: 'admission', entry_round_id: 'round-1', ranking_source: 'power_rating', ranking_value: 1000 + number });
  }
  const current = state.rounds[0]!.matches as Array<Record<string, unknown>>;
  current.push({ ...current[0]!, id: 'new-match', home_team_id: 'team-5', away_team_id: 'team-6', home_slot_id: 'slot-5', away_slot_id: 'slot-6' });
  await state.progress();
  const next = state.rounds[1]!.matches as Array<Record<string, unknown>>;
  assert.equal(next.length, 3);
  assert.deepEqual(next.flatMap(match => [match.home_team_id, match.away_team_id]).sort(), state.teams.map(team => team.id).sort());
  for (const match of next) assert.ok(!current.some(old => [old.home_team_id, old.away_team_id].sort().join(':') === [match.home_team_id, match.away_team_id].sort().join(':')), 'Complete available unique pairings before rematches');
});
