import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findExactPendingIncomingChallenge,
  findExactPendingOutgoingChallenge,
  isForgeFixtureAlreadyBooked,
  resolveForgeFixtureActionTarget,
  resolveForgeTeamActions,
  selectCurrentForgeRound,
  type ForgeFixtureRecord,
} from '../src/server/api/_lib/forge-matches.js';
import forgeMatchesHandler from '../src/server/api/forge/matches.js';

const home = {
  id: 'home-row',
  name: 'Star Queens',
  managerName: 'stevanovic',
  managerHtId: 101,
  htTeamId: 111,
  active: true,
  isPlaceholder: false,
};
const away = {
  id: 'away-row',
  name: 'Angels Revange',
  managerName: 'LEMMIE',
  managerHtId: 202,
  htTeamId: 222,
  active: true,
  isPlaceholder: false,
};
const fixture: ForgeFixtureRecord = {
  id: 'match-1',
  roundId: 'round-1',
  status: 'not_arranged',
  completed: false,
  home,
  away,
};
const ready = { state: 'ready' as const, reason: 'CHPP challenge state loaded.', outgoing: [], incoming: [] };

test('fixture action resolution keeps both managers, teams, and home/away orientation', () => {
  const homeAction = resolveForgeFixtureActionTarget(fixture, 'home');
  const awayAction = resolveForgeFixtureActionTarget(fixture, 'away');

  assert.equal(homeAction?.team.managerHtId, 101);
  assert.equal(homeAction?.team.htTeamId, 111);
  assert.equal(homeAction?.opponent.managerHtId, 202);
  assert.equal(homeAction?.opponent.htTeamId, 222);
  assert.equal(homeAction?.matchPlace, 0);
  assert.equal(awayAction?.team.managerHtId, 202);
  assert.equal(awayAction?.team.htTeamId, 222);
  assert.equal(awayAction?.opponent.managerHtId, 101);
  assert.equal(awayAction?.opponent.htTeamId, 111);
  assert.equal(awayAction?.matchPlace, 1);
});

test('duplicate outgoing challenge is found for the exact opponent and disables another send', () => {
  const outgoing = [{ opponentTeamId: 222, trainingMatchId: 7001, friendlyType: 1, isAgreed: false }];
  const exact = findExactPendingOutgoingChallenge(outgoing, 222);
  assert.equal(exact?.trainingMatchId, 7001);
  assert.equal(findExactPendingOutgoingChallenge(outgoing, 999), null);

  const actions = resolveForgeTeamActions({
    fixture,
    side: 'home',
    inspection: { ...ready, outgoing },
    outgoing: exact,
    incoming: null,
    opponentOutgoing: null,
  });
  assert.equal(actions.chppState, 'OUTGOING CHALLENGE');
  assert.equal(actions.canChallenge, false);
  assert.equal(actions.canWithdraw, true);
});

test('incoming exact-opponent challenge enables accept and a wrong opponent does not', () => {
  const incoming = [{ opponentTeamId: 111, trainingMatchId: 7002, friendlyType: 1, isAgreed: false }];
  assert.equal(findExactPendingIncomingChallenge(incoming, 111)?.trainingMatchId, 7002);
  assert.equal(findExactPendingIncomingChallenge(incoming, 999), null);

  const actions = resolveForgeTeamActions({
    fixture,
    side: 'away',
    inspection: { ...ready, incoming },
    outgoing: null,
    incoming: incoming[0],
    opponentOutgoing: null,
  });
  assert.equal(actions.chppState, 'INCOMING CHALLENGE');
  assert.equal(actions.canAccept, true);
  assert.equal(actions.canChallenge, false);
});

test('arranged fixture disables challenge actions', () => {
  const arranged = { ...fixture, status: 'arranged' };
  assert.equal(isForgeFixtureAlreadyBooked(arranged), true);
  const actions = resolveForgeTeamActions({
    fixture: arranged,
    side: 'home',
    inspection: ready,
    outgoing: null,
    incoming: null,
    opponentOutgoing: null,
  });
  assert.equal(actions.chppState, 'ARRANGED');
  assert.equal(actions.canChallenge, false);
  assert.equal(actions.canAccept, false);
  assert.equal(actions.canWithdraw, false);
});

test('missing credentials produce a safe disabled state without crashing', () => {
  const actions = resolveForgeTeamActions({
    fixture,
    side: 'home',
    inspection: { state: 'credentials_missing', reason: 'No stored CHPP credentials.', outgoing: [], incoming: [] },
    outgoing: null,
    incoming: null,
    opponentOutgoing: null,
  });
  assert.equal(actions.chppState, 'CHPP CREDENTIALS MISSING');
  assert.equal(actions.canChallenge, false);
  assert.equal(actions.canAccept, false);
});

test('client-side action target cannot spoof a different opponent or team', () => {
  const target = resolveForgeFixtureActionTarget(fixture, 'home');
  assert.equal(target?.team.id, 'home-row');
  assert.equal(target?.opponent.id, 'away-row');
  assert.equal(resolveForgeFixtureActionTarget(fixture, 'sideways' as 'home' | 'away'), null);
});

test('current Forge round is the earliest materialized round with unfinished fixtures', () => {
  const current = selectCurrentForgeRound([
    { round_number: 1, phase_status: 'materialized', matches: [{ completed: true }] },
    { round_number: 3, phase_status: 'materialized', matches: [{ completed: false }] },
    { round_number: 5, phase_status: 'materialized', matches: [{ completed: false }] },
  ]);
  assert.equal(current?.round_number, 3);
});

test('non-Forge request is rejected before loading tournament data', async () => {
  const previousForgeEnabled = process.env.FORGE_ENABLED;
  process.env.FORGE_ENABLED = 'true';
  let statusCode = 200;
  let payload: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(value: unknown) {
      payload = value;
      return response;
    },
  };
  try {
    await forgeMatchesHandler({ method: 'GET', headers: {}, query: {} } as never, response as never);
  } finally {
    if (previousForgeEnabled === undefined) delete process.env.FORGE_ENABLED;
    else process.env.FORGE_ENABLED = previousForgeEnabled;
  }
  assert.equal(statusCode, 401);
  assert.deepEqual(payload, { error: 'Forge authorization required.' });
});

test('base round loads without CHPP while bounded state reads affect only requested fixtures', async () => {
  const { buildForgeSessionCookie } = await import('../src/server/api/_lib/forge-session.js');
  const names = ['FORGE_ENABLED', 'APP_SESSION_SECRET', 'FORGE_SUPERADMIN_HT_ID', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'CHPP_CONSUMER_KEY', 'CHPP_CONSUMER_SECRET'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  process.env.FORGE_ENABLED = 'true';
  process.env.APP_SESSION_SECRET = 'forge-matches-test-secret';
  process.env.FORGE_SUPERADMIN_HT_ID = '8777402';
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_SECRET_KEY = 'test-secret-key';
  delete process.env.CHPP_CONSUMER_KEY;
  delete process.env.CHPP_CONSUMER_SECRET;
  const requestedMatchFilters: string[] = [];
  const profileSelects: string[] = [];
  let chppRequests = 0;
  let preferenceOff = false;
  const team = (id: number) => ({ id: `db-team-${id}`, name: `Team ${id}`, manager_name: `Manager ${id}`,
    hattrick_user_id: id, ht_team_id: id + 1000, active: true, is_placeholder: false,
    oauth_scope: 'manage_challenges', can_manage_challenges: true });
  const rows = [1, 2].map(id => ({ id: `match-${id}`, round_id: 'round-1', status: 'not_arranged',
    completed: false, ht_match_id: null, scheduled_for: null, home_team: team(id * 2), away_team: team(id * 2 + 1) }));
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.hostname === 'chpp.hattrick.org') chppRequests++;
    const table = url.pathname.split('/').at(-1);
    let data: unknown = [];
    if (table === 'tournaments') data = [{ id: 'tournament-1', name: 'Cup', slug: 'cup', season: 1,
      status: 'ongoing', is_archived: false, is_test: false, scoring_mode: null }];
    if (table === 'rounds') data = [{ id: 'round-1', tournament_id: 'tournament-1', created_at: '2026-10-15',
      season_number: 1, round_number: 1, phase: 'regular', phase_status: 'materialized', is_unscored: true,
      matches: rows.map(row => ({ completed: row.completed, status: row.status })) }];
    if (table === 'matches') {
      const filter = url.searchParams.get('id') || '';
      requestedMatchFilters.push(filter);
      data = filter ? rows.filter(row => filter.includes(row.id)) : rows;
    }
    if (table === 'profiles') profileSelects.push(url.searchParams.get('select') || '');
    if (table === 'tournament_team_auto_arrange_preferences' && preferenceOff) {
      data = [{ team_id: 'db-team-2', hattrick_user_id: 2, enabled: false }];
    }
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const cookie = buildForgeSessionCookie(8777402, false).split(';')[0];
    const invoke = async (query: Record<string, string>) => {
      let status = 200;
      let body: Record<string, unknown> = {};
      const res = { status(code: number) { status = code; return res; }, json(value: Record<string, unknown>) { body = value; return res; } };
      await forgeMatchesHandler({ method: 'GET', headers: { cookie }, query } as never, res as never);
      return { status, body };
    };
    const base = await invoke({ tournamentId: 'tournament-1', roundNumber: '1', view: 'base' });
    assert.equal(base.status, 200);
    assert.equal((base.body.currentRound as { roundLabel: string }).roundLabel, 'Round 1 · Unscored');
    assert.equal((base.body.roundOptions as Array<{ roundLabel: string }>)[0].roundLabel, 'Round 1 · Unscored');
    const baseFixtures = base.body.fixtures as Array<{ id: string; home: { chppState: string; canChallenge: boolean } }>;
    assert.deepEqual(baseFixtures.map(fixture => fixture.id), ['match-1', 'match-2']);
    assert.ok(baseFixtures.every(fixture => fixture.home.chppState === 'CHECKING' && !fixture.home.canChallenge));
    assert.deepEqual(profileSelects, ['hattrick_user_id,teams_json']);
    assert.equal(chppRequests, 0);
    const states = await invoke({ tournamentId: 'tournament-1', roundNumber: '1', view: 'states', matchIds: 'match-2' });
    assert.equal(states.status, 200);
    assert.deepEqual((states.body.fixtures as Array<{ id: string }>).map(fixture => fixture.id), ['match-2']);
    assert.deepEqual(requestedMatchFilters, ['', 'in.(match-2)']);
    const missing = await invoke({ tournamentId: 'tournament-1', roundNumber: '1', view: 'states', matchIds: 'missing-match' });
    assert.deepEqual(missing.body.fixtureErrors, [{ matchId: 'missing-match', error: 'Fixture is no longer in this round.' }]);
    assert.equal((await invoke({ tournamentId: 'tournament-1', roundNumber: '1', view: 'states', matchIds: '1,2,3,4,5' })).status, 400);
    preferenceOff = true;
    let actionStatus = 200;
    let actionBody: Record<string, unknown> = {};
    const actionResponse = {
      status(code: number) { actionStatus = code; return actionResponse; },
      json(value: Record<string, unknown>) { actionBody = value; return actionResponse; },
    };
    await forgeMatchesHandler({ method: 'POST', headers: { cookie }, body: {
      tournamentId: 'tournament-1', roundNumber: 1, matchId: 'match-1', actingSide: 'home',
      action: 'challenge', bulkAutoArrange: true,
    } } as never, actionResponse as never);
    assert.equal(actionStatus, 409);
    assert.deepEqual(actionBody, { error: 'Auto-arrange is off for a fixture team.' });
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
