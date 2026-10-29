import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTO_BOOKING_RUN_LOOKBACK_MS,
  autoBookingRetryDelayMs,
  autoBookingRunIsDue,
  MAX_AUTO_BOOKING_TOURNAMENTS_PER_RUN,
  RECENTLY_BOOKED_FIXTURE_SKIP_MS,
  selectEnabledCurrentTournaments,
  shouldSkipRecentFixture,
  STALE_AUTO_BOOKING_RUN_MS,
  type AutoBookingRun,
  type EnabledAutoBookingSetting,
} from '../src/server/api/_lib/auto-booking-cron.js';

const tournament = (id: string, patch: Record<string, unknown> = {}) => ({
  id, name: id, slug: id, season: 2, status: 'active', is_archived: false, is_test: false, ...patch,
});

const setting = (id: string, patch: Record<string, unknown> = {}): EnabledAutoBookingSetting => ({
  tournament_id: id, season_number: 2, enabled: true, tournament: tournament(id), ...patch,
} as EnabledAutoBookingSetting);

test('automatic booking selects only enabled current-season, non-terminal tournaments', () => {
  const selected = selectEnabledCurrentTournaments([
    setting('enabled'),
    setting('old-season', { season_number: 1 }),
    setting('off', { enabled: false }),
    setting('finished', { tournament: tournament('finished', { status: 'finished' }) }),
    setting('archived', { tournament: tournament('archived', { is_archived: true }) }),
    setting('disabled', { tournament: tournament('disabled', { status: 'disabled' }) }),
    setting('test', { tournament: tournament('test', { is_test: true }) }),
  ]);
  assert.deepEqual(selected.map(({ tournament: row }) => row.id), ['enabled']);
});

test('persisted due times gate empty rounds while other fixtures can continue', () => {
  const run = (status: string, result?: string): AutoBookingRun => ({
    tournament_id: 't', season_number: 2, mode: 'real', status,
    outcome: result ? { result } : {}, fixture_id: 'fixture', started_at: new Date(1_000).toISOString(),
  });
  const now = 1_000 + 60 * 60 * 1000;
  const waiting = { ...run('skipped', 'no_outstanding_fixture'), started_at: new Date(now).toISOString(), outcome: { result: 'no_outstanding_fixture', nextAttemptAt: new Date(now + 10_000).toISOString() } };
  assert.equal(autoBookingRetryDelayMs(waiting), 10_000);
  assert.equal(autoBookingRunIsDue(waiting, now), false);
  assert.equal(autoBookingRunIsDue(waiting, now + 10_000), true);
  const fixtureWaiting = { ...run('pending', 'challenge_pending'), started_at: new Date(now).toISOString(), outcome: { result: 'challenge_pending', nextAttemptAt: new Date(now + 10_000).toISOString() } };
  assert.equal(autoBookingRunIsDue(fixtureWaiting, now), true, 'a waiting fixture must not block another fixture in the tournament');
  assert.equal(shouldSkipRecentFixture(fixtureWaiting, now), true);
  assert.equal(autoBookingRunIsDue(run('running'), now), false);
  assert.equal(autoBookingRunIsDue(undefined, now), true);
  assert.equal(shouldSkipRecentFixture(run('booked'), now), true);
  assert.equal(shouldSkipRecentFixture(run('skipped', 'no_safe_action'), now), false);
});

test('worker limits stay bounded and stale running records have a finite recovery window', () => {
  assert.equal(MAX_AUTO_BOOKING_TOURNAMENTS_PER_RUN, 5);
  assert.equal(AUTO_BOOKING_RUN_LOOKBACK_MS, 24 * 60 * 60 * 1000);
  assert.equal(RECENTLY_BOOKED_FIXTURE_SKIP_MS, 24 * 60 * 60 * 1000);
  assert.equal(STALE_AUTO_BOOKING_RUN_MS, 10 * 60 * 1000);
});
