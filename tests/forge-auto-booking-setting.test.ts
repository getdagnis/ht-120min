import assert from 'node:assert/strict';
import test from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from '../src/server/api/forge/matches.js';
import { buildForgeSessionCookie } from '../src/server/api/_lib/forge-session.js';

test('Forge automatic booking defaults off, persists by season, and never calls CHPP', async (t) => {
  const keys = ['FORGE_ENABLED', 'APP_SESSION_SECRET', 'FORGE_SUPERADMIN_HT_ID', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY'];
  const old = keys.map((key) => process.env[key]);
  const oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
    keys.forEach((key, index) => { if (old[index] === undefined) delete process.env[key]; else process.env[key] = old[index]; });
  });
  process.env.FORGE_ENABLED = 'true';
  process.env.APP_SESSION_SECRET = 'forge-auto-booking-test-secret';
  process.env.FORGE_SUPERADMIN_HT_ID = '12345';
  process.env.SUPABASE_URL = 'https://auto-booking-test.invalid';
  process.env.SUPABASE_SECRET_KEY = 'synthetic-service-key';
  const cookie = buildForgeSessionCookie(12345, false).split(';')[0];
  const settings = new Map<string, boolean>();
  let season = 1;
  const requests: string[] = [];
  const activityRows = [{
    id: 'run-1', fixture_id: 'fixture-1', status: 'pending', mode: 'real',
    outcome: { result: 'error_70_unresolved', actionAttempted: true, action: 'challenge', errorCode: 70,
      explanation: 'Hattrick error 70; state was rechecked.', nextAttemptAt: '2026-10-29T04:00:00.000Z' },
    started_at: '2026-10-29T03:55:00.000Z', finished_at: '2026-10-29T03:55:05.000Z',
  }];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(`${init?.method || 'GET'} ${url.pathname}`);
    assert.equal(url.hostname, 'auto-booking-test.invalid', 'CHPP and other services must not be called');
    if (url.pathname === '/rest/v1/tournaments') {
      return Response.json({ id: 'cup', name: 'Cup', slug: 'cup', season, status: 'active', is_archived: false, is_test: false, scoring_mode: 'standard' });
    }
    if (url.pathname === '/rest/v1/forge_booking_worker_runs') return Response.json(activityRows);
    if (url.pathname === '/rest/v1/matches') return Response.json([{
      id: 'fixture-1', home_team: { name: 'Home' }, away_team: { name: 'Away' },
    }]);
    assert.equal(url.pathname, '/rest/v1/tournament_season_auto_booking_settings');
    assert.equal(init?.headers && new Headers(init.headers).get('apikey'), 'synthetic-service-key');
    if (init?.method === 'POST') {
      const row = JSON.parse(String(init.body)) as { tournament_id: string; season_number: number; enabled: boolean };
      assert.equal(row.tournament_id, 'cup');
      assert.equal(row.season_number, season);
      settings.set(`${row.tournament_id}:${row.season_number}`, row.enabled);
      return new Response(null, { status: 201 });
    }
    const key = `${url.searchParams.get('tournament_id')?.slice(3)}:${url.searchParams.get('season_number')?.slice(3)}`;
    const enabled = settings.get(key);
    return enabled === undefined
      ? Response.json([])
      : Response.json({ enabled });
  };

  async function request(method: 'GET' | 'POST', options: { authorized?: boolean; body?: unknown } = {}) {
    let status = 0;
    let payload: Record<string, unknown> = {};
    const response = { status(code: number) { status = code; return this; }, json(value: Record<string, unknown>) { payload = value; return this; } };
    await handler({ method, headers: { cookie: options.authorized === false ? '' : cookie },
      query: { setting: 'auto-booking', tournamentId: 'cup' }, body: options.body } as unknown as VercelRequest,
    response as unknown as VercelResponse);
    return { status, payload };
  }

  const firstRead = await request('GET');
  assert.equal(firstRead.status, 200);
  assert.equal((firstRead.payload as { enabled: boolean }).enabled, false);
  assert.deepEqual((firstRead.payload as { activity: unknown[] }).activity, [{
    id: 'run-1', fixtureId: 'fixture-1', fixture: { home: 'Home', away: 'Away' },
    status: 'pending', result: 'error_70_unresolved', action: 'challenge', actualAction: true,
    errorCode: 70, explanation: 'Hattrick error 70; state was rechecked.',
    startedAt: '2026-10-29T03:55:00.000Z', finishedAt: '2026-10-29T03:55:05.000Z',
    nextAttemptAt: '2026-10-29T04:00:00.000Z',
  }]);
  assert.equal((await request('POST', { body: { action: 'set-auto-booking', tournamentId: 'cup', enabled: true } })).status, 200);
  assert.equal((await request('GET')).status, 200);
  season = 2;
  assert.equal((await request('GET')).status, 200);
  assert.equal((await request('POST', { body: { action: 'set-auto-booking', tournamentId: 'cup', enabled: true } })).status, 200);
  season = 1;
  assert.equal((await request('GET')).status, 200);

  const before = requests.length;
  assert.equal((await request('GET', { authorized: false })).status, 401);
  assert.equal((await request('POST', { authorized: false, body: { action: 'set-auto-booking', tournamentId: 'cup', enabled: false } })).status, 401);
  assert.equal(requests.length, before, 'unauthorized requests must not reach Supabase');
  for (const body of [
    { action: 'set-auto-booking', tournamentId: 'cup', enabled: 'true' },
    { action: 'set-auto-booking', tournamentId: '', enabled: true },
    { action: 'set-auto-booking', tournamentId: 'cup' },
  ]) {
    assert.equal((await request('POST', { body })).status, 400);
  }
  assert.equal(requests.length, before, 'invalid requests must not reach Supabase');
  assert.ok(requests.every((entry) => [
    '/rest/v1/tournaments', '/rest/v1/tournament_season_auto_booking_settings',
    '/rest/v1/forge_booking_worker_runs', '/rest/v1/matches',
  ].some((pathname) => entry.includes(pathname))));
});
