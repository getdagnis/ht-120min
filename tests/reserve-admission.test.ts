import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateBalancedRound } from '../src/utils/length-schedule.js';
import { checkReserveAdmission, findVerifiedReserveOwner, resolveReserveCupStatus } from '../src/server/api/_lib/reserve-admission.js';
import { registerReserveTeam } from '../src/server/api/_lib/chpp-register.js';

function harness(t: test.TestContext, options: { count?: number; hfi?: boolean; blocked?: boolean; failure?: boolean; cup?: boolean; missingCup?: boolean; leagueCoverage?: boolean; assigned?: boolean; finished?: boolean } = {}) {
  const teams = Array.from({ length: options.count || 2 }, (_, i) => ({ id: `reserve-${i}`, name: `Reserve ${i}`, ht_team_id: 100 + i, active: false, reserve_active: true, is_placeholder: false, power_rating: 1000 + i * 100, team_rank: 100 - i, country_name: 'Germany', league_level: 4 }));
  const tables: Record<string, unknown> = {
    tournaments: { id: 'cup', season: 1, schedule_mode: 'length', status: 'active', max_teams: 4, league_category: options.hfi ? 'hfi' : 'male' },
    rounds: [{ id: 'round', phase: options.finished ? 'postseason' : 'regular', phase_status: 'materialized', round_number: 2, reserved_slot_id: 'S95-W13-midweek', reserved_slot_kind: 'midweek_friendly', reserved_slot_date: '2030-03-20T00:00:00Z' }],
    tournament_seasons: { id: 'season' },
    matches: options.assigned ? [{ reserve_team_id: teams[0]!.id }] : [],
    profiles: { hattrick_user_id: 8777402, manager_name: 'Fixture manager', oauth_token: 'synthetic-token', oauth_token_secret: 'synthetic-secret' },
  };
  const supabase = {
    async rpc() { return { data: [{ hattrick_user_id: 8777402 }], error: null }; },
    from(table: string) {
      let conflict = false; let gateway = false;
      const query = {
        update() { return this; }, select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; }, limit() { return this; },
        neq() { conflict = true; return this; }, not() { gateway = true; return this; },
        then(resolve: (result: unknown) => unknown) { return Promise.resolve({ data: table === 'teams' ? conflict ? [] : teams : tables[table], count: 4, error: null }).then(resolve); },
        single() { return Promise.resolve({ data: tables[table], error: null }); },
        maybeSingle() { return Promise.resolve({ data: gateway ? { oauth_token: 'synthetic-token', oauth_token_secret: 'synthetic-secret' } : tables[table], error: null }); },
      }; return query;
    },
  };
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.hostname, 'chpp.hattrick.org');
    if (options.failure) return new Response('Unavailable', { status: 503 });
    if (url.searchParams.get('file') === 'managercompendium') return new Response(readFileSync(new URL('../docs/managercompendium.example.xml', import.meta.url), 'utf8'));
    if (url.searchParams.get('file') === 'teamdetails') return new Response(`<HattrickData><Team><TeamID>${url.searchParams.get('teamID')}</TeamID><TeamName>Reserve</TeamName><League><LeagueID>${options.hfi ? 3000 : 3}</LeagueID><LeagueName>${options.hfi ? 'HFI' : 'Germany'}</LeagueName></League><LeagueSystemID>${options.hfi ? 2 : 1}</LeagueSystemID>${options.missingCup ? '<Cup />' : `<StillInCup>${options.cup ? 'True' : 'False'}</StillInCup>`}</Team></HattrickData>`);
    if (options.leagueCoverage) return new Response(`<HattrickData><Team><TeamID>${url.searchParams.get('teamID')}</TeamID><MatchList><Match><MatchID>10</MatchID><MatchDate>2030-03-24 14:00:00</MatchDate><MatchType>1</MatchType><HomeTeamID>${url.searchParams.get('teamID')}</HomeTeamID><AwayTeamID>999</AwayTeamID><Status>UPCOMING</Status></Match></MatchList></Team></HattrickData>`);
    return new Response(options.blocked ? '<HattrickData><Match><MatchID>9</MatchID><MatchDate>2030-03-19 19:25:00</MatchDate><MatchType>5</MatchType><HomeTeamID>100</HomeTeamID><AwayTeamID>999</AwayTeamID><Status>UPCOMING</Status></Match></HattrickData>' : '<HattrickData/>');
  };
  return { supabase: supabase as unknown as SupabaseClient, teams };
}

test('known ownership is freshly checked with the token owner, not a userID lookup', async t => {
  const state = harness(t);
  const owner = await findVerifiedReserveOwner(state.supabase, 681813);
  assert.equal(owner.team?.teamId, 681813);
  assert.equal(owner.credentials?.hattrick_user_id, 8777402);
});

test('expired or changed ownership never produces a validated reserve', async t => {
  const failed = harness(t, { failure: true });
  assert.equal((await findVerifiedReserveOwner(failed.supabase, 681813)).team, null);
  const changed = harness(t);
  assert.equal((await findVerifiedReserveOwner(changed.supabase, 999999)).team, null);
});

test('registering one owned team inserts only that selected reserve', async () => {
  const inserted: Array<Record<string, unknown>> = [];
  const supabase = {
    from() {
      const query = {
        select() { return this; }, eq() { return this; }, neq() { return this; }, in() { return this; },
        insert(row: Record<string, unknown>) { inserted.push(row); return this; },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        single() { return Promise.resolve({ data: { id: 'selected', active: false, reserve_active: true }, error: null }); },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: [], error: null }).then(resolve); },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  await registerReserveTeam(supabase, {
    tournamentId: 'cup', team: { teamId: 2062034, teamName: 'FC Comoren' },
    managerName: 'Fixture manager', hattrickUserId: 1,
    accessToken: 'synthetic-token', accessTokenSecret: 'synthetic-secret',
  });
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0]!.ht_team_id, 2062034);
  assert.equal(inserted[0]!.active, false);
});

test('regular reserves rank by Power Rating and HFI reserves by lowest rank', async t => {
  for (const hfi of [false, true]) {
    const state = harness(t, { hfi, count: 4 });
    const checked = await checkReserveAdmission(state.supabase, 'cup', state.teams.map(team => team.id));
    assert.equal(checked.canAdmit, true);
    assert.deepEqual(checked.teamIds, ['reserve-3', 'reserve-2', 'reserve-1', 'reserve-0']);
    assert.equal(checked.pairs.length, 2);
    assert.equal(checked.newFieldSize, 8);
  }
});

test('bookings and failed checks block the entire selected group', async t => {
  for (const options of [{ blocked: true }, { failure: true }, { cup: true }, { assigned: true }]) {
    const state = harness(t, options);
    const result = await checkReserveAdmission(state.supabase, 'cup', state.teams.map(team => team.id));
    assert.equal(result.canAdmit, false);
  }
});

test('site-admin admission shows booking and cup conflicts as warnings but keeps fixture conflicts blocking', async t => {
  for (const options of [{ blocked: true }, { cup: true }]) {
    const state = harness(t, options);
    const result = await checkReserveAdmission(state.supabase, 'cup', state.teams.map(team => team.id), { isSiteAdmin: true });
    assert.equal(result.canAdmit, true);
    assert.ok(result.statuses.some(status => status.warnings.length > 0));
  }
  const assigned = harness(t, { assigned: true });
  const result = await checkReserveAdmission(assigned.supabase, 'cup', assigned.teams.map(team => team.id), { isSiteAdmin: true });
  assert.equal(result.canAdmit, false);
});

test('odd selections and postseason entry are rejected', async t => {
  const state = harness(t, { finished: true });
  await assert.rejects(checkReserveAdmission(state.supabase, 'cup', ['one']), /even number/);
  await assert.rejects(checkReserveAdmission(state.supabase, 'cup', state.teams.map(team => team.id)), /before playoffs/);
});

test('missing cup data is distinguished from ownership and friendly booking', async t => {
  const state = harness(t, { missingCup: true });
  const result = await checkReserveAdmission(state.supabase, 'cup', state.teams.map(team => team.id));
  assert.equal(result.canAdmit, false);
  assert.equal(result.statuses[0]!.booked, false);
  assert.equal(result.statuses[0]!.inCup, null);
  assert.match(result.statuses[0]!.error!, /Cup status unavailable/);
});

test('temporarily empty Cup uses a complete identified schedule, never an empty or wrong-team feed', () => {
  const league = { matchId: 1, matchDate: '2030-03-24 14:00:00', matchType: 1, homeTeamId: 100, awayTeamId: 200, status: 'UPCOMING' };
  const booking = { isBooked: false, match: null, scheduledMatches: [league] };
  const roundDate = new Date('2030-03-20T00:00:00Z');
  assert.equal(resolveReserveCupStatus(booking, 100, roundDate), false);
  assert.equal(resolveReserveCupStatus({ ...booking, scheduledMatches: [] }, 100, roundDate), null);
  assert.equal(resolveReserveCupStatus(booking, 999, roundDate), null);
  assert.equal(resolveReserveCupStatus({ ...booking, scheduledMatches: [league, { ...league, matchType: 3, status: 'ONGOING' }] }, 100, roundDate), true);
  assert.equal(resolveReserveCupStatus({ ...booking, scheduledMatches: [{ ...league, matchType: 3, status: 'UPCOMING' }] }, 100, roundDate), true);
  assert.equal(resolveReserveCupStatus({ ...booking, scheduledMatches: [{ ...league, matchDate: '2030-03-17 14:00:00' }] }, 100, roundDate), null);
});

test('empty Cup during live league play does not block a verified free reserved week', async t => {
  const state = harness(t, { missingCup: true, leagueCoverage: true });
  const checked = await checkReserveAdmission(state.supabase, 'cup', state.teams.map(team => team.id));
  assert.equal(checked.canAdmit, true);
  assert.ok(checked.statuses.every(status => status.inCup === false && status.booked === false));
});


test('large expanded fields use bounded valid pairing candidates', () => {
  const teams = Array.from({ length: 24 }, (_, i) => ({ id: `team-${i}`, name: `Team ${i}`, teamRank: i + 1 }));
  const pairs = generateBalancedRound(teams, { boundedCandidates: true, balanceRepeats: true });
  assert.equal(pairs.length, 12);
  assert.equal(new Set(pairs.flatMap(pair => [pair.homeTeamId, pair.awayTeamId])).size, 24);
});

test('reserve admission and ownership lookup require an operational organizer role', async t => {
  const { default: handler } = await import('../src/server/api/app.js');
  const { buildAppSessionCookie } = await import('../src/server/api/_lib/app-session.js');
  const env = { APP_SESSION_SECRET: 'synthetic-session-secret', SUPABASE_URL: 'https://reserve-auth-test.invalid', SUPABASE_SECRET_KEY: 'synthetic-key' };
  const originalEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.hostname, 'reserve-auth-test.invalid');
    const table = url.pathname.split('/').at(-1);
    const value = table === 'tournaments' ? { organizer_id: 1, organizer_name: 'Organizer' } : table === 'tournament_roles' ? { role: 'press_officer' } : { manager_name: 'Manager' };
    return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  });
  for (const action of ['lookup', 'remove']) for (const cookie of ['', buildAppSessionCookie(999998, env.APP_SESSION_SECRET, false)]) {
    let status = 0;
    const response = { status(value: number) { status = value; return this; }, json() { return this; } };
    await handler({ method: 'POST', headers: { cookie }, query: { route: 'reserve-admission' }, body: { tournamentId: 'cup', action, teamId: action === 'lookup' ? 681813 : '10000000-0000-0000-0000-000000000001' } } as unknown as Parameters<typeof handler>[0], response as unknown as Parameters<typeof handler>[1]);
    assert.equal(status, cookie ? 403 : 401);
  }
});
