import assert from 'node:assert/strict';
import test from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import refreshFixtures from '../src/server/api/teams/refresh-fixtures.js';
import { progressLengthSchedule, repairLengthRound } from '../src/server/api/_lib/length-schedule-service.js';
import { getServiceSupabase } from '../src/server/api/_lib/supabase.js';

async function refreshScenario(t: test.TestContext, options: { reverse?: boolean; correct?: boolean; noCredentials?: boolean; germanHome?: boolean } = {}) {
  const env = { SUPABASE_URL: 'https://fixture-test.invalid', SUPABASE_SECRET_KEY: 'synthetic-key', CHPP_CONSUMER_KEY: 'synthetic-consumer', CHPP_CONSUMER_SECRET: 'synthetic-secret' };
  const previousEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(previousEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const teams = [1, 2, 3, 4].map(id => ({
    id: `team-${id}`, name: `Team ${id}`, ht_team_id: id, active: true, is_placeholder: false,
    country_name: options.germanHome && id === 2 ? 'Germany' : 'Latvia', team_rank: id,
    oauth_token: id === 2 || options.noCredentials ? null : `synthetic-token-${id}`,
    oauth_token_secret: id === 2 || options.noCredentials ? null : `synthetic-secret-${id}`,
    joined_via_oauth: id !== 2, hattrick_user_id: id === 2 ? null : id,
  }));
  const matches = (options.correct ? [[1, 2], [3, 4]] : [[3, 2], [1, 4]]).map(([home, away], i) => ({
    id: `fixture-${i}`, home_team_id: `team-${options.reverse ? away : home}`, away_team_id: `team-${options.reverse ? home : away}`,
    status: 'not_arranged', completed: false, ht_match_id: null,
    scheduled_for: '2030-03-20T13:45:00Z', schedule_slot_type: 'midweek_friendly', schedule_resolution: 'pending',
  }));
  const rounds = [{ id: 'round-1', round_number: 1, created_at: '2030-03-01T00:00:00Z', matches,
    phase: 'regular', phase_status: 'materialized', reserved_slot_id: 'S107-W13-midweek',
    reserved_slot_kind: 'midweek_friendly', reserved_slot_date: '2030-03-20T00:00:00Z' }];
  const tournament = { id: 'cup', season: 1, schedule_mode: 'single' };
  const repairRequests: Array<Record<string, unknown>> = [];
  const warnings: Array<Record<string, unknown>> = [];
  const friendlyRequests: Array<{ teamId: number; auth: string }> = [];
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === 'chpp.hattrick.org') {
      if (url.searchParams.get('file') !== 'matches') return new Response('<HattrickData><StillInCup>False</StillInCup></HattrickData>');
      const teamId = Number(url.searchParams.get('teamID'));
      friendlyRequests.push({ teamId, auth: new Headers(init?.headers).get('Authorization') || '' });
      const friendly = teamId === 1 || teamId === 2
        ? `<Match><MatchID>999</MatchID><HomeTeamID>${options.germanHome ? 2 : 1}</HomeTeamID><AwayTeamID>${options.germanHome ? 1 : 2}</AwayTeamID><MatchDate>${options.germanHome ? '2030-03-19 19:25:00' : '2030-03-20 14:45:00'}</MatchDate><MatchType>5</MatchType><Status>UPCOMING</Status></Match>` : '';
      return new Response(`<HattrickData><MatchList>${friendly}</MatchList></HattrickData>`);
    }
    assert.equal(url.hostname, 'fixture-test.invalid', 'All requests must remain mocked');
    const table = url.pathname.split('/').at(-1);
    const method = init?.method || (input instanceof Request ? input.method : 'GET');
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    if (table === 'repair_length_schedule_round') {
      repairRequests.push(body);
      const pairs = body.p_unlocked_matches as Array<Record<string, unknown>>;
      matches.splice(0, matches.length, ...pairs.map((pair, i) => ({
        ...matches[0]!, ...pair, id: `repaired-${i}`, ht_match_id: null,
        status: pair.schedule_resolution === 'finalized_unplayed' ? 'misarranged' : 'not_arranged',
      })));
      return new Response(JSON.stringify({ fixtures_replaced: 2, fixtures_inserted: 2 }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (method === 'POST' && table === 'fixture_warnings') warnings.push({ ...body, active: true });
    if (method === 'PATCH' && table === 'matches') Object.assign(matches.find(match => `eq.${match.id}` === url.searchParams.get('id'))!, body);
    if (method !== 'GET') return new Response(null, { status: 204 });
    const data = table === 'tournaments' ? tournament
      : table === 'rounds' ? rounds : table === 'teams' ? teams : table === 'fixture_warnings' ? warnings
      : table === 'tournament_seasons' ? { id: 'season', ranking_snapshot_json: teams.map(team => ({ team_id: team.id, team_rank: team.team_rank })) }
      : table === 'tournament_season_slots' ? teams.map((team, i) => ({ id: `slot-${i}`, current_team_id: team.id }))
      : table === 'tournament_season_slot_assignments' ? [] : null;
    assert.notEqual(data, null, `Unexpected read: ${table}`);
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  };
  const refresh = async () => {
    let status = 0;
    let response: unknown;
    const res = { status(value: number) { status = value; return this; }, json(value: unknown) { response = value; return this; } };
    await refreshFixtures({ method: 'GET', query: { tournament_id: 'cup' } } as unknown as VercelRequest, res as unknown as VercelResponse);
    assert.equal(status, 200, JSON.stringify(response));
  };
  await refresh();
  const repair = () => {
    tournament.schedule_mode = 'length';
    return repairLengthRound(getServiceSupabase(), 'cup', 1).finally(() => { tournament.schedule_mode = 'single'; });
  };
  return { matches, rounds, warnings, friendlyRequests, refresh, repair, repairRequests, tournament };
}

test('wrong booking for an unvalidated opponent is detected and warns both booked teams', async t => {
  const state = await refreshScenario(t);
  assert.deepEqual(state.matches.map(match => match.status), ['misarranged', 'misarranged']);
  assert.deepEqual(state.warnings.map(warning => warning.team_id).sort(), ['team-1', 'team-2']);
  const borrowed = state.friendlyRequests.find(request => request.teamId === 2);
  assert.ok(borrowed, 'Fetch the unvalidated team by its own Hattrick ID');
  assert.match(borrowed.auth, /synthetic-token-1/);
  await state.refresh();
  assert.equal(state.warnings.length, 2, 'Repeated refresh preserves warnings without duplicates');
});

test('unvalidated home teams receive the same wrong-booking detection', async t => {
  const state = await refreshScenario(t, { reverse: true });
  assert.deepEqual(state.matches.map(match => match.status), ['misarranged', 'misarranged']);
  assert.deepEqual(state.warnings.map(warning => warning.team_id).sort(), ['team-1', 'team-2']);
});

test('repair receives both booked teams and frees their originally scheduled opponents', async t => {
  const state = await refreshScenario(t);
  const result = await state.repair();
  assert.equal(result.unavailableTeams, 2);
  assert.equal(result.repairedPlayableFixtures, 1);
  assert.equal(state.repairRequests.length, 1);
  const pairings = state.repairRequests[0]!.p_unlocked_matches as Array<Record<string, unknown>>;
  const containment = pairings.find(pair => pair.schedule_resolution === 'finalized_unplayed')!;
  assert.deepEqual([containment.home_team_id, containment.away_team_id].sort(), ['team-1', 'team-2']);
  const playable = pairings.find(pair => pair.schedule_resolution !== 'finalized_unplayed')!;
  assert.deepEqual([playable.home_team_id, playable.away_team_id].sort(), ['team-3', 'team-4']);
});

test('refresh links a repaired German Tuesday booking and stops treating it as finalized unplayed', async t => {
  const state = await refreshScenario(t, { germanHome: true });
  await state.repair();
  await state.refresh();
  const booked = state.matches.find(match => match.ht_match_id === 999)!;
  assert.ok(booked, 'The correct booked match is linked after repair');
  assert.equal(booked.status, 'arranged');
  assert.equal(booked.schedule_resolution, 'pending', 'Progression must wait for the real match result');
  assert.equal(state.warnings.length, 2, 'Original warning history survives the repair');
  Object.assign(state.matches.find(match => match !== booked)!, { completed: true, status: 'finished', schedule_resolution: 'played' });
  state.tournament.schedule_mode = 'length';
  const progress = await progressLengthSchedule(getServiceSupabase(), 'cup', 1);
  assert.deepEqual(progress, { advanced: false, reason: 'round_unresolved' });
  assert.equal(state.repairRequests.length, 1);
});

test('refresh does not reopen finalized unplayed history in a completed round', async t => {
  const state = await refreshScenario(t, { germanHome: true });
  await state.repair();
  state.rounds[0]!.phase_status = 'completed';
  await state.refresh();
  assert.equal(state.matches.find(match => match.ht_match_id === 999)!.schedule_resolution, 'finalized_unplayed');
  assert.equal(state.warnings.length, 2);
});

test('a correct booking with an unvalidated team is linked without a warning', async t => {
  const state = await refreshScenario(t, { correct: true });
  assert.equal(state.matches[0]!.status, 'arranged');
  assert.equal(state.matches[0]!.ht_match_id, 999);
  assert.equal(state.matches[1]!.status, 'not_arranged');
  assert.equal(state.warnings.length, 0);
});

test('without any complete credentials refresh leaves fixtures and warnings unchanged', async t => {
  const state = await refreshScenario(t, { noCredentials: true });
  assert.equal(state.friendlyRequests.length, 0);
  assert.deepEqual(state.matches.map(match => match.status), ['not_arranged', 'not_arranged']);
  assert.equal(state.warnings.length, 0);
});
