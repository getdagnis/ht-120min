import assert from 'node:assert/strict';
import test from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handleFlagHunters from '../src/server/api/testing/flag-hunters.js';
import { buildForgeSessionCookie } from '../src/server/api/_lib/forge-session.js';

// Exercise real Supabase query construction and the handler, while every HTTP call stays mocked.
test('Flag Hunters API protects reads, filters admissions and retrieves flags without writes or credential exposure', async () => {
  const oldFetch = globalThis.fetch;
  const oldEnv = { ...process.env };
  Object.assign(process.env, { FORGE_ENABLED: 'true', FORGE_SUPERADMIN_HT_ID: '42', APP_SESSION_SECRET: 'mock-session',
    SUPABASE_URL: 'https://flag-hunters-test.invalid', SUPABASE_SECRET_KEY: 'mock-service-key', CHPP_CONSUMER_KEY: 'mock-consumer', CHPP_CONSUMER_SECRET: 'mock-secret' });
  const calls: Array<{ url: URL; method: string }> = [];
  let flagsPresent = true;
  const base = { id: 'local-1', ht_team_id: 1, name: 'A', hattrick_user_id: 10, manager_name: 'Manager', country_name: 'Display', country_id: 130, league_id: 1003, active: true, reserve_active: false, is_placeholder: false };
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method || (input instanceof Request ? input.method : 'GET');
    calls.push({ url, method });
    assert.equal(method, 'GET', 'handler must never mutate the database or send a challenge');
    if (url.hostname === 'chpp.hattrick.org') {
      assert.equal(url.searchParams.get('file'), 'teamdetails'); assert.equal(url.searchParams.get('includeFlags'), 'true');
      assert.equal(url.searchParams.has('flags'), false);
      assert.equal(url.searchParams.get('teamID'), '1'); assert.equal(url.searchParams.get('version'), '3.9');
      return new Response(`<HattrickData><Team><TeamID>1</TeamID><League><LeagueID>1003</LeagueID></League><Country><CountryID>130</CountryID></Country>${flagsPresent ? '<Flags><HomeFlags/><AwayFlags/></Flags>' : ''}</Team></HattrickData>`);
    }
    assert.equal(url.hostname, 'flag-hunters-test.invalid', 'no real Supabase calls');
    if (url.pathname.endsWith('/tournaments')) return Response.json({ id: 'tournament', slug: 'around-the-world', name: 'Around the World' });
    if (url.pathname.endsWith('/profiles') && !url.searchParams.get('select')?.includes('oauth_token')) return Response.json([{ hattrick_user_id: 10, country_id: 48 }]);
    if (url.pathname.endsWith('/profiles')) return Response.json({ hattrick_user_id: 10, oauth_token: 'mock-token', oauth_token_secret: 'mock-token-secret' });
    assert.ok(url.pathname.endsWith('/teams'));
    assert.equal(url.searchParams.get('tournament_id'), 'eq.tournament'); assert.equal(url.searchParams.get('active'), 'eq.true');
    return Response.json([base, { ...base, id: 'reserve', ht_team_id: 2, reserve_active: true },
      { ...base, id: 'placeholder', ht_team_id: 3, is_placeholder: true }, { ...base, id: 'inactive', ht_team_id: 4, active: false }]);
  };
  const cookie = buildForgeSessionCookie(42, false);
  const invoke = async (method: string, authorized: boolean, body?: object) => {
    let status = 200, payload: unknown;
    const headers: Record<string, string> = {};
    const res = { setHeader(key: string, value: string) { headers[key] = value; }, status(code: number) { status = code; return this; }, json(value: unknown) { payload = value; return this; } } as unknown as VercelResponse;
    const req = { method, query: { slug: 'around-the-world' }, body, headers: { cookie: authorized ? cookie : undefined } } as unknown as VercelRequest;
    await handleFlagHunters(req, res);
    return { status, payload, headers };
  };
  try {
    assert.equal((await invoke('GET', false)).status, 401); assert.equal(calls.length, 0);
    process.env.FORGE_ENABLED = 'false'; assert.equal((await invoke('GET', true)).status, 404); assert.equal(calls.length, 0);
    process.env.FORGE_ENABLED = 'true';
    const roster = await invoke('GET', true);
    assert.equal(roster.status, 200); assert.equal(roster.headers['Cache-Control'], 'no-store');
    assert.equal((roster.payload as { teams: unknown[] }).teams.length, 1);
    assert.deepEqual((roster.payload as { teams: { leagueId: number; countryId: number; flagCountryId: number; managerCountryId: number }[] }).teams.map(({ leagueId, countryId, flagCountryId, managerCountryId }) => ({ leagueId, countryId, flagCountryId, managerCountryId })), [{ leagueId: 1003, countryId: 130, flagCountryId: 124, managerCountryId: 48 }]);
    assert.equal(calls.filter(call => call.url.hostname === 'chpp.hattrick.org').length, 0);
    assert.equal((await invoke('POST', true, { htTeamId: 2 })).status, 409);
    const result = await invoke('POST', true, { htTeamId: 1 });
    assert.equal(result.status, 200);
    assert.deepEqual((result.payload as { flags: { home: number[]; away: number[] } }).flags.home, []);
    assert.deepEqual((result.payload as { flags: { home: number[]; away: number[] } }).flags.away, []);
    const serialized = JSON.stringify(result.payload);
    assert.equal(serialized.includes('mock-token'), false); assert.equal(serialized.includes('oauth'), false);
    flagsPresent = false;
    await assert.rejects(() => invoke('POST', true, { htTeamId: 1 }), /omitted/);
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
  }
});
