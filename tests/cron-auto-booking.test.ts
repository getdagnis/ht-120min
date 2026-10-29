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

test('cron endpoint invokes the shared worker without Forge session and defaults to audited dry-run', async (t) => {
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
  const writes: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.hostname, 'cron-worker-test.invalid', 'the wrapper must not call CHPP');
    if (url.pathname === '/rest/v1/tournaments') {
      return Response.json({ id: '00000000-0000-4000-8000-000000000001', slug: 'staburaga-kauss', name: 'Staburaga kauss', season: 1, status: 'active', is_archived: false, is_test: false, scoring_mode: 'standard' });
    }
    if (url.pathname === '/rest/v1/rounds') {
      return Response.json([{ id: '00000000-0000-4000-8000-000000000002', tournament_id: '00000000-0000-4000-8000-000000000001', created_at: '', season_number: 1,
        round_number: 1, phase: 'regular', phase_status: 'materialized', matches: [{ id: 'fixture-id', completed: false, status: 'not_arranged' }] }]);
    }
    if (url.pathname === '/rest/v1/matches') return Response.json([]);
    if (url.pathname === '/rest/v1/forge_booking_worker_runs' && init?.method === 'POST') {
      writes.push('insert');
      const row = JSON.parse(String(init.body)) as { mode: string };
      assert.equal(row.mode, 'dry_run');
      return Response.json({ id: 'run-id' });
    }
    if (url.pathname === '/rest/v1/forge_booking_worker_runs' && init?.method === 'PATCH') {
      writes.push('finish');
      return Response.json([]);
    }
    throw new Error(`Unexpected request: ${init?.method} ${url.pathname}`);
  };

  const result = await invoke({ authorization: `Bearer ${secret}`, body: {
    tournamentId: '00000000-0000-4000-8000-000000000001',
  } });
  assert.equal(result.status, 200);
  assert.equal(result.payload.mode, 'dry_run');
  assert.equal(result.payload.status, 'dry_run');
  assert.deepEqual(writes, ['insert', 'finish']);
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
