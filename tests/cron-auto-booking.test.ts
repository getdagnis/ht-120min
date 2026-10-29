import assert from 'node:assert/strict';
import test from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from '../src/server/api/cron/auto-booking.js';

const secret = 'local-test-cron-secret-with-more-than-32-characters';

async function invoke(options: {
  method?: string;
  authorization?: string;
  body?: unknown;
} = {}) {
  let status = 0;
  let payload: Record<string, unknown> = {};
  const response = {
    status(code: number) { status = code; return this; },
    json(value: Record<string, unknown>) { payload = value; return this; },
    setHeader() { return this; },
  };
  await handler({
    method: options.method || 'POST',
    headers: options.authorization ? { authorization: options.authorization } : {},
    body: options.body,
  } as unknown as VercelRequest, response as unknown as VercelResponse);
  return { status, payload };
}

test('cron worker rejects missing configuration, bad bearer tokens and non-POST methods', async (t) => {
  const oldSecret = process.env.AUTO_BOOKING_CRON_SECRET;
  const oldLive = process.env.AUTO_BOOKING_CRON_LIVE_ENABLED;
  const oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
    if (oldSecret === undefined) delete process.env.AUTO_BOOKING_CRON_SECRET;
    else process.env.AUTO_BOOKING_CRON_SECRET = oldSecret;
    if (oldLive === undefined) delete process.env.AUTO_BOOKING_CRON_LIVE_ENABLED;
    else process.env.AUTO_BOOKING_CRON_LIVE_ENABLED = oldLive;
  });
  delete process.env.AUTO_BOOKING_CRON_SECRET;
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; throw new Error('Unauthorized request reached Supabase.'); };
  assert.equal((await invoke()).status, 503);
  process.env.AUTO_BOOKING_CRON_SECRET = secret;
  assert.equal((await invoke({ authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await invoke({ method: 'GET', authorization: `Bearer ${secret}` })).status, 405);
  assert.equal(requests, 0);
});

test('cron endpoint discovers enabled current-season tournaments and defaults to audited dry-run', async (t) => {
  const keys = ['AUTO_BOOKING_CRON_SECRET', 'AUTO_BOOKING_CRON_LIVE_ENABLED', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY'];
  const old = keys.map((key) => process.env[key]);
  const oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
    keys.forEach((key, index) => { if (old[index] === undefined) delete process.env[key]; else process.env[key] = old[index]; });
  });
  process.env.AUTO_BOOKING_CRON_SECRET = secret;
  delete process.env.AUTO_BOOKING_CRON_LIVE_ENABLED;
  process.env.SUPABASE_URL = 'https://cron-worker-test.invalid';
  process.env.SUPABASE_SECRET_KEY = 'synthetic-service-key';
  const writes: Array<{ tournamentId: string; mode: string }> = [];
  const tournaments = [
    { id: '00000000-0000-4000-8000-000000000001', slug: 'one', name: 'One', season: 1, status: 'active', is_archived: false, is_test: false, scoring_mode: 'standard' },
    { id: '00000000-0000-4000-8000-000000000002', slug: 'two', name: 'Two', season: 3, status: 'active', is_archived: false, is_test: false, scoring_mode: 'standard' },
  ];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.hostname, 'cron-worker-test.invalid', 'the wrapper must not call CHPP');
    if (url.pathname === '/rest/v1/tournament_season_auto_booking_settings') {
      return Response.json([
        { tournament_id: tournaments[0].id, season_number: 1, enabled: true, updated_at: '2026-10-01T00:00:00Z', tournament: tournaments[0] },
        { tournament_id: tournaments[1].id, season_number: 3, enabled: true, updated_at: '2026-10-02T00:00:00Z', tournament: tournaments[1] },
        { tournament_id: '00000000-0000-4000-8000-000000000003', season_number: 1, enabled: true, updated_at: '2026-10-03T00:00:00Z', tournament: { ...tournaments[0], id: '00000000-0000-4000-8000-000000000003', status: 'finished' } },
        { tournament_id: '00000000-0000-4000-8000-000000000004', season_number: 1, enabled: true, updated_at: '2026-10-04T00:00:00Z', tournament: { ...tournaments[0], id: '00000000-0000-4000-8000-000000000004', is_archived: true } },
        { tournament_id: '00000000-0000-4000-8000-000000000005', season_number: 1, enabled: false, updated_at: '2026-10-05T00:00:00Z', tournament: { ...tournaments[0], id: '00000000-0000-4000-8000-000000000005' } },
        { tournament_id: '00000000-0000-4000-8000-000000000006', season_number: 2, enabled: true, updated_at: '2026-10-06T00:00:00Z', tournament: { ...tournaments[0], id: '00000000-0000-4000-8000-000000000006' } },
      ]);
    }
    if (url.pathname === '/rest/v1/forge_booking_worker_runs' && init?.method !== 'POST' && init?.method !== 'PATCH') return Response.json([]);
    if (url.pathname === '/rest/v1/tournaments') {
      const id = url.searchParams.get('id')?.replace(/^eq\./, '');
      return Response.json(tournaments.find((candidate) => candidate.id === id) || null);
    }
    if (url.pathname === '/rest/v1/rounds') {
      const tournamentId = url.searchParams.get('tournament_id')?.replace(/^eq\./, '') || tournaments[0].id;
      const candidate = tournaments.find((item) => item.id === tournamentId)!;
      return Response.json([{ id: `10000000-0000-4000-8000-${candidate.season.toString().padStart(12, '0')}`, tournament_id: tournamentId, created_at: '', season_number: candidate.season,
        round_number: 1, phase: 'regular', phase_status: 'materialized', matches: [{ id: 'fixture-id', completed: false, status: 'not_arranged' }] }]);
    }
    if (url.pathname === '/rest/v1/matches') return Response.json([]);
    if (url.pathname === '/rest/v1/forge_booking_worker_runs' && init?.method === 'POST') {
      const row = JSON.parse(String(init.body)) as { tournament_id: string; mode: string };
      assert.equal(row.mode, 'dry_run');
      writes.push({ tournamentId: row.tournament_id, mode: row.mode });
      return Response.json({ id: 'run-id' });
    }
    if (url.pathname === '/rest/v1/forge_booking_worker_runs' && init?.method === 'PATCH') return Response.json([]);
    if (url.pathname === '/rest/v1/matches') return Response.json([]);
    throw new Error(`Unexpected request: ${init?.method} ${url.pathname}`);
  };

  const result = await invoke({ authorization: `Bearer ${secret}`, body: {} });
  assert.equal(result.status, 200);
  assert.equal(result.payload.mode, 'dry_run');
  assert.equal(result.payload.enabledTournaments, 2);
  assert.equal(result.payload.attempted, 2);
  assert.deepEqual(writes, tournaments.map((row) => ({ tournamentId: row.id, mode: 'dry_run' })));
});

test('cron endpoint keeps live booking disabled until its server-only flag is enabled', async (t) => {
  const oldSecret = process.env.AUTO_BOOKING_CRON_SECRET;
  const oldLive = process.env.AUTO_BOOKING_CRON_LIVE_ENABLED;
  t.after(() => {
    if (oldSecret === undefined) delete process.env.AUTO_BOOKING_CRON_SECRET;
    else process.env.AUTO_BOOKING_CRON_SECRET = oldSecret;
    if (oldLive === undefined) delete process.env.AUTO_BOOKING_CRON_LIVE_ENABLED;
    else process.env.AUTO_BOOKING_CRON_LIVE_ENABLED = oldLive;
  });
  process.env.AUTO_BOOKING_CRON_SECRET = secret;
  delete process.env.AUTO_BOOKING_CRON_LIVE_ENABLED;
  assert.equal((await invoke({ authorization: `Bearer ${secret}`, body: { mode: 'real' } })).status, 409);
});
