import assert from 'node:assert/strict';
import test from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from '../src/server/api/chpp/live-matches.js';

test('live scores return successfully without scheduling or membership calls in a length tournament', async (t) => {
  const previousFetch = globalThis.fetch;
  const keys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'CHPP_CONSUMER_KEY', 'CHPP_CONSUMER_SECRET'];
  const previousEnv = keys.map((key) => process.env[key]);
  t.after(() => {
    globalThis.fetch = previousFetch;
    keys.forEach((key, index) => {
      if (previousEnv[index] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[index];
    });
  });
  process.env.SUPABASE_URL = 'https://incident-test.invalid';
  process.env.SUPABASE_SECRET_KEY = 'fake-test-key';
  process.env.CHPP_CONSUMER_KEY = 'fake-consumer';
  process.env.CHPP_CONSUMER_SECRET = 'fake-secret';
  const calls: string[] = [];
  let saved: Record<string, unknown> | undefined;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    if (url.pathname === '/rest/v1/tournaments') return json({ schedule_mode: 'length', scoring_mode: 'standard', season: 1 });
    if (url.pathname === '/rest/v1/rounds') return json([{ id: 'round-1' }]);
    if (url.pathname === '/rest/v1/matches') {
      if (init?.method === 'PATCH') {
        saved = JSON.parse(String(init.body));
        return new Response(null, { status: 204 });
      }
      return json([{ id: 'fixture-live', ht_match_id: 12345, status: 'ongoing', completed: false,
        home_team_id: 'home', away_team_id: 'away', home_goals: 0, away_goals: 0,
        home_team: { ht_team_id: 101, oauth_token: 'fake-token', oauth_token_secret: 'fake-token-secret' },
        away_team: { ht_team_id: 102 }, reserve_team: null, match_event_details: null }]);
    }
    if (url.hostname === 'chpp.hattrick.org') {
      const body = url.searchParams.get('file') === 'live'
        ? '<MatchList><Match><MatchID>12345</MatchID><HomeGoals>2</HomeGoals><AwayGoals>1</AwayGoals><MatchPart>2</MatchPart></Match></MatchList>'
        : '<Match><MatchID>12345</MatchID><MatchStatus>1</MatchStatus></Match>';
      return new Response(`<HattrickData><FileName>${url.searchParams.get("file")}.xml</FileName>${body}</HattrickData>`, { headers: { 'Content-Type': 'text/xml' } });
    }
    throw new Error(`Unexpected network operation: ${url.pathname}`);
  };
  let statusCode = 0;
  let payload: { results: Record<string, { homeGoals: number; awayGoals: number; status: string }> } | undefined;
  const response = {
    status(code: number) { statusCode = code; return this; },
    json(value: typeof payload) { payload = value; return this; },
  };
  await handler({ query: { tournament_id: 'cup', match_ids: '12345' } } as unknown as VercelRequest, response as unknown as VercelResponse);
  assert.equal(statusCode, 200);
  assert.equal(payload?.results['12345']?.homeGoals, 2);
  assert.equal(payload?.results['12345']?.awayGoals, 1);
  assert.equal(payload?.results['12345']?.status, 'ongoing');
  assert.equal(saved?.home_goals, 2);
  assert.equal(saved?.completed, false);
  assert.equal(calls.some((call) => call.includes('/rpc/')), false);
  assert.equal(calls.filter((call) => call.startsWith('PATCH')).length, 1);
});
