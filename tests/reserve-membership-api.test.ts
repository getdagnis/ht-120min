import assert from 'node:assert/strict';
import test from 'node:test';
import app from '../src/server/api/app.js';
import { buildAppSessionCookie } from '../src/server/api/_lib/app-session.js';

test('reserve membership actions authenticate operations access and send only scoped IDs to service RPCs', async () => {
  const oldEnv = { ...process.env }, oldFetch = globalThis.fetch;
  Object.assign(process.env, { APP_SESSION_SECRET: 'reserve-test-secret', SUPABASE_URL: 'https://reserve-test.invalid',
    SUPABASE_SECRET_KEY: 'test-service', FORGE_SUPERADMIN_HT_ID: '9999', ADMIN_HT_ID: '9999' });
  const tournamentId = '70000000-0000-0000-0000-000000000010';
  const teamId = '70000000-0000-0000-0000-000000000003';
  const roundId = '70000000-0000-0000-0000-000000000021';
  let allowed = true, rpcError = false;
  const writes: Array<{ name: string; values: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.hostname, 'reserve-test.invalid', 'never call real Supabase or CHPP');
    if (url.pathname.includes('/rpc/')) {
      writes.push({ name: url.pathname.split('/').at(-1)!, values: JSON.parse(String(init?.body)) });
      return rpcError ? Response.json({ code: '40001', message: 'The target round changed.' }, { status: 409 })
        : Response.json(teamId);
    }
    if (url.pathname.endsWith('/tournaments')) return Response.json({ organizer_id: allowed ? 7 : 8, organizer_name: 'Organizer' });
    if (url.pathname.endsWith('/profiles')) return Response.json({ manager_name: 'Manager' });
    assert.ok(url.pathname.endsWith('/tournament_roles'));
    return Response.json(null);
  };
  const cookie = buildAppSessionCookie(7, 'reserve-test-secret', false);
  const invoke = async (action: string, authenticated = true, extra: object = {}) => {
    let status = 200, body: unknown;
    const response = { status(value: number) { status = value; return this; }, json(value: unknown) { body = value; return this; }, setHeader() {} };
    await app({ method: 'POST', query: { route: 'reserve-admission' }, headers: { cookie: authenticated ? cookie : undefined },
      body: { action, tournamentId, teamId, roundId, ...extra } } as never, response as never);
    return { status, body };
  };
  try {
    for (const action of ['queue-next-round', 'move-to-past']) {
      assert.equal((await invoke(action, false)).status, 401);
      allowed = false;
      assert.equal((await invoke(action)).status, 403);
      allowed = true;
    }
    assert.equal(writes.length, 0);
    assert.equal((await invoke('queue-next-round', true, { roundId: 'bad' })).status, 400);
    assert.equal((await invoke('move-to-past', true, { teamId: 'bad' })).status, 400);
    assert.equal((await invoke('queue-next-round', true, { hattrick_user_id: 123, oauth_token: 'untrusted', bypass: true })).status, 200);
    assert.deepEqual(writes.pop(), { name: 'queue_tournament_reserve_for_next_round',
      values: { p_tournament_id: tournamentId, p_team_id: teamId, p_round_id: roundId } });
    assert.equal((await invoke('move-to-past')).status, 200);
    assert.deepEqual(writes.pop(), { name: 'move_tournament_reserve_to_past', values: { p_tournament_id: tournamentId, p_team_id: teamId } });
    rpcError = true;
    assert.deepEqual(await invoke('queue-next-round'), { status: 409, body: { error: 'The target round changed.' } });
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
  }
});

test('three-list membership uses verified roles and cannot accept a client override or manager identity', async () => {
  const oldEnv = { ...process.env }, oldFetch = globalThis.fetch;
  Object.assign(process.env, { APP_SESSION_SECRET: 'membership-test-secret', SUPABASE_URL: 'https://membership-test.invalid',
    SUPABASE_SECRET_KEY: 'test-service', FORGE_SUPERADMIN_HT_ID: '9999', ADMIN_HT_ID: '9999' });
  const tournamentId = '70000000-0000-0000-0000-000000000010';
  const teamId = '70000000-0000-0000-0000-000000000003';
  let allowed = true, rpcError = false, generated = false;
  const calls: Array<{ name: string; values: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.hostname, 'membership-test.invalid');
    if (url.pathname.includes('/rpc/')) {
      calls.push({ name: url.pathname.split('/').at(-1)!, values: JSON.parse(String(init?.body)) });
      if (rpcError) return Response.json({ code: '40001', message: 'Membership changed; refresh and retry.' }, { status: 409 });
      return Response.json(url.pathname.endsWith('get_waiting_admission_plan') ? { teamIds: [], rejected: [] } : { ok: true });
    }
    if (url.pathname.endsWith('/tournaments')) return Response.json({ organizer_id: allowed ? 7 : 8, organizer_name: 'Organizer', season: 1, schedule_generated_at: generated ? '2026-10-21' : null });
    if (url.pathname.endsWith('/tournament_team_admin_context')) return Response.json([{
      team_id: teamId, added_by_ht_user_id: 7, last_move_reason: 'warnings', last_move_note: 'Repeated misarrangements',
    }]);
    if (url.pathname.endsWith('/profiles')) return Response.json({ manager_name: 'Manager' });
    assert.ok(url.pathname.endsWith('/tournament_roles'));
    return Response.json(null);
  };
  const invoke = async (action: string, userId: number | null = 7, extra: object = {}, method = 'POST') => {
    let status = 200, body: unknown;
    const response = { status(value: number) { status = value; return this; }, json(value: unknown) { body = value; return this; }, setHeader() {} };
    await app({ method, query: { route: 'team-membership', tournamentId },
      headers: { cookie: userId ? buildAppSessionCookie(userId, 'membership-test-secret', false) : undefined },
      body: { tournamentId, teamId, action, ...extra } } as never, response as never);
    return { status, body };
  };
  try {
    assert.equal((await invoke('promote', null)).status, 401);
    const readContext = async (userId: number | null) => {
      let status = 200, body: unknown;
      const response = { status(value: number) { status = value; return this; }, json(value: unknown) { body = value; return this; }, setHeader() {} };
      await app({ method: 'GET', query: { route: 'team-admin-context', tournamentId },
        headers: { cookie: userId ? buildAppSessionCookie(userId, 'membership-test-secret', false) : undefined },
      } as never, response as never);
      return { status, body };
    };
    assert.equal((await readContext(null)).status, 401);
    allowed = false; assert.equal((await invoke('remove')).status, 403); allowed = true;
    allowed = false; assert.equal((await readContext(7)).status, 403); allowed = true;
    assert.deepEqual(await readContext(7), { status: 200, body: { teams: [{
      team_id: teamId, added_by_ht_user_id: 7, last_move_reason: 'warnings', last_move_note: 'Repeated misarrangements',
    }] } });
    assert.equal((await invoke('ready')).status, 400);
    assert.equal((await invoke('delete')).status, 400);
    assert.equal((await invoke('return', 7, { teamId: 'bad' })).status, 400);
    assert.equal(calls.length, 0);
    for (const action of ['promote', 'to_waiting', 'remove', 'return', 'ready']) {
      assert.equal((await invoke(action, 7, { ready: true, p_override: true, hattrick_user_id: 9999, oauth_token: 'untrusted' })).status, 200);
      assert.deepEqual(calls.pop(), { name: 'change_tournament_team_membership_with_context', values: {
        p_tournament_id: tournamentId, p_team_id: teamId, p_action: action, p_ready: action === 'ready' ? true : null, p_override: false,
        p_actor_id: 7, p_reason: 'admin_move', p_note: null,
      } });
    }
    generated = true;
    assert.equal((await invoke('promote', 7, { p_override: true })).status, 409);
    assert.equal((await invoke('to_waiting', 7, { p_override: true })).status, 409);
    assert.equal(calls.length, 0);
    assert.equal((await invoke('promote', 9999)).status, 200);
    assert.equal((calls.pop()!.values as { p_override: boolean }).p_override, true);
    assert.equal((await invoke('remove', 7, { reason: 'critical', note: 'Repeated failures' })).status, 400);
    assert.equal((await invoke('remove', 9999, { reason: 'critical' })).status, 400);
    assert.equal((await invoke('remove', 9999, { reason: 'critical', note: 'Repeated failures' })).status, 200);
    assert.equal((calls.pop()!.values as { p_reason: string }).p_reason, 'critical');
    assert.equal((await invoke('', 7, {}, 'GET')).status, 200);
    assert.deepEqual(calls.pop(), { name: 'get_waiting_admission_plan', values: { p_tournament_id: tournamentId, p_season_number: 1 } });
    generated = false; rpcError = true;
    assert.deepEqual(await invoke('promote'), { status: 409, body: { error: 'Membership changed; refresh and retry.' } });
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
  }
});

test('Lobby status ownership is server-derived and organizer rounds require operational access', async () => {
  const oldEnv = { ...process.env }, oldFetch = globalThis.fetch;
  Object.assign(process.env, { APP_SESSION_SECRET: 'lobby-test-secret', SUPABASE_URL: 'https://lobby-test.invalid', SUPABASE_SECRET_KEY: 'test-service', FORGE_SUPERADMIN_HT_ID: '9999' });
  const tournamentId = '70000000-0000-0000-0000-000000000010', teamId = '70000000-0000-0000-0000-000000000003';
  const writes: Array<Record<string, unknown>> = [];
  let operations = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.hostname, 'lobby-test.invalid');
    if (url.pathname.includes('/rpc/')) { writes.push(JSON.parse(String(init?.body))); return Response.json({ ok: true }); }
    if (url.pathname.endsWith('/tournaments')) return Response.json({ organizer_id: operations ? 7 : 8, season: 1, schedule_mode: 'length', schedule_generated_at: '2026-10-21' });
    if (url.pathname.endsWith('/profiles')) return Response.json({ manager_name: 'Manager' });
    if (url.pathname.endsWith('/tournament_roles')) return Response.json(null);
    throw new Error('Unexpected external request.');
  };
  async function invoke(route: string, signedIn = true, extra = {}) {
    let code = 200;
    const response = { status(value: number) { code = value; return this; }, json() { return this; }, setHeader() {} };
    await app({ method: 'POST', query: { route }, headers: { cookie: signedIn ? buildAppSessionCookie(7, 'lobby-test-secret', false) : undefined }, body: { tournamentId, teamId, status: 'open_to_invitations', p_manager_id: 9999, p_override: true, ...extra } } as never, response as never);
    return code;
  }
  try {
    assert.equal(await invoke('lobby-status', false), 401);
    assert.equal(await invoke('lobby-status', true, { status: 'invalid' }), 400);
    assert.equal(await invoke('organizer-round'), 403);
    assert.equal(writes.length, 0);
    assert.equal(await invoke('lobby-status'), 200);
    assert.deepEqual(writes.pop(), { p_tournament_id: tournamentId, p_team_id: teamId, p_status: 'open_to_invitations', p_manager_id: 7 });
    operations = true;
    assert.equal(await invoke('lobby-status'), 200);
    assert.equal(writes.pop()!.p_manager_id, null);
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
  }
});
