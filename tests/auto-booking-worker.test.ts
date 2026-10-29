import assert from 'node:assert/strict';
import test from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from '../src/server/api/forge/matches.js';
import { buildForgeSessionCookie } from '../src/server/api/_lib/forge-session.js';
import {
  bookingWorkerMode,
  chooseWorkerFixture,
  hasRealBookingConfirmation,
  isAmbiguousChallengeFailure,
  isWorkerTournamentId,
  workerInitialAction,
  type WorkerFixture,
} from '../src/server/api/_lib/auto-booking-worker.js';

const fixture = (id: string, patch: Partial<WorkerFixture> = {}): WorkerFixture => ({
  id, status: 'not_arranged', completed: false, htMatchId: null,
  home: { autoArrangeEnabled: true, canChallenge: true, canAccept: false, canWithdraw: false },
  away: { autoArrangeEnabled: true, canChallenge: false, canAccept: false, canWithdraw: false },
  ...patch,
});

test('worker defaults to dry-run and only enables real mode for explicit request and confirmation', () => {
  assert.equal(bookingWorkerMode(undefined), 'dry_run');
  assert.equal(bookingWorkerMode('dry_run'), 'dry_run');
  assert.equal(bookingWorkerMode('real'), 'real');
  assert.equal(hasRealBookingConfirmation(undefined), false);
  assert.equal(hasRealBookingConfirmation('BOOK ONE STABURAGA KAUSS FIXTURE'), true);
  assert.equal(isWorkerTournamentId('TOURNAMENT_UUID'), false);
  assert.equal(isWorkerTournamentId('00000000-0000-4000-8000-000000000001'), true);
});

test('worker selects no more than the first open consenting fixture and leaves protected states alone', () => {
  const booked = fixture('booked', { status: 'arranged', htMatchId: 123 });
  const optedOut = fixture('opted-out', { home: { autoArrangeEnabled: false, canChallenge: true, canAccept: false, canWithdraw: false } });
  const misarranged = fixture('misarranged', { status: 'misarranged' });
  const firstOpen = fixture('first');
  const secondOpen = fixture('second');
  assert.equal(chooseWorkerFixture([booked, optedOut, misarranged, firstOpen, secondOpen])?.id, 'first');
  assert.equal(chooseWorkerFixture([booked, optedOut, misarranged]), null);
});

test('worker accepts an exact incoming offer before challenging and never treats outgoing as ready to accept', () => {
  assert.deepEqual(workerInitialAction(fixture('incoming', {
    away: { autoArrangeEnabled: true, canChallenge: false, canAccept: true, canWithdraw: false },
  })), { action: 'accept', side: 'away' });
  assert.equal(workerInitialAction(fixture('outgoing', {
    home: { autoArrangeEnabled: true, canChallenge: true, canAccept: false, canWithdraw: true },
  })), null);
  assert.deepEqual(workerInitialAction(fixture('new')), { action: 'challenge', side: 'home' });
});

test('Hattrick error 70 is identified for state reread and is not considered a retryable challenge refusal', () => {
  assert.equal(isAmbiguousChallengeFailure(70), true);
  assert.equal(isAmbiguousChallengeFailure('70'), true);
  assert.equal(isAmbiguousChallengeFailure(1), false);
});

test('Forge worker defaults to audited dry-run and does not call CHPP when there is no fixture row', async (t) => {
  const keys = ['FORGE_ENABLED', 'APP_SESSION_SECRET', 'FORGE_SUPERADMIN_HT_ID', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY'];
  const old = keys.map((key) => process.env[key]);
  const oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
    keys.forEach((key, index) => { if (old[index] === undefined) delete process.env[key]; else process.env[key] = old[index]; });
  });
  process.env.FORGE_ENABLED = 'true';
  process.env.APP_SESSION_SECRET = 'forge-worker-test-secret';
  process.env.FORGE_SUPERADMIN_HT_ID = '12345';
  process.env.SUPABASE_URL = 'https://worker-test.invalid';
  process.env.SUPABASE_SECRET_KEY = 'synthetic-service-key';
  const cookie = buildForgeSessionCookie(12345, false).split(';')[0];
  const writes: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.hostname, 'worker-test.invalid', 'CHPP must not be called in this test');
    if (url.pathname === '/rest/v1/tournaments') {
      return Response.json({ id: '00000000-0000-4000-8000-000000000001', name: 'Staburaga kauss', slug: 'staburaga-kauss', season: 1, status: 'active', is_archived: false, is_test: false, scoring_mode: 'standard' });
    }
    if (url.pathname === '/rest/v1/rounds') {
      return Response.json([{ id: '00000000-0000-4000-8000-000000000002', tournament_id: '00000000-0000-4000-8000-000000000001', created_at: '', season_number: 1,
        round_number: 1, phase: 'regular', phase_status: 'materialized', matches: [{ id: 'fixture-id', completed: false, status: 'not_arranged' }] }]);
    }
    if (url.pathname === '/rest/v1/matches') return Response.json([]);
    if (url.pathname === '/rest/v1/forge_booking_worker_runs' && init?.method === 'POST') {
      writes.push('insert');
      const row = JSON.parse(String(init.body)) as { mode: string; status: string; started_at: string };
      assert.equal(row.mode, 'dry_run');
      assert.equal(row.status, 'running');
      assert.ok(Date.parse(row.started_at));
      return Response.json({ id: 'run-id' });
    }
    if (url.pathname === '/rest/v1/forge_booking_worker_runs' && init?.method === 'PATCH') {
      writes.push('finish');
      const row = JSON.parse(String(init.body)) as { status: string; fixture_id: string | null; outcome: { result: string } };
      assert.equal(row.status, 'dry_run');
      assert.equal(row.fixture_id, null);
      assert.equal(row.outcome.result, 'no_outstanding_fixture');
      return Response.json([]);
    }
    throw new Error(`Unexpected worker request: ${init?.method} ${url.pathname}`);
  };
  let status = 0;
  let payload: Record<string, unknown> = {};
  const response = { status(code: number) { status = code; return this; }, json(value: Record<string, unknown>) { payload = value; return this; } };
  await handler({ method: 'POST', headers: { cookie }, body: { action: 'run-auto-booking-worker', tournamentId: '00000000-0000-4000-8000-000000000001' } } as unknown as VercelRequest,
    response as unknown as VercelResponse);
  assert.equal(status, 200);
  assert.equal(payload.mode, 'dry_run');
  assert.equal(payload.status, 'dry_run');
  assert.deepEqual(writes, ['insert', 'finish']);
});
