import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTO_BOOKING_RUN_LOOKBACK_MS,
  autoBookingRetryDelayMs,
  autoBookingRunIsDue,
  MAX_AUTO_BOOKING_TOURNAMENTS_PER_RUN,
  NO_SAFE_ACTION_FIXTURE_SKIP_MS,
  RECENTLY_BOOKED_FIXTURE_SKIP_MS,
  selectEnabledCurrentTournaments,
  shouldSkipRecentFixture,
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

test('retry delays back off pending, failed and opt-out runs, but booked fixtures do not block the next fixture', () => {
  const run = (status: string, result?: string): AutoBookingRun => ({
    tournament_id: 't', season_number: 2, mode: 'real', status,
    outcome: result ? { result } : {}, fixture_id: 'fixture', started_at: new Date(1_000).toISOString(),
  });
  const now = 1_000 + 60 * 60 * 1000;
  assert.equal(autoBookingRetryDelayMs(run('pending')), 10 * 60 * 1000);
  assert.equal(autoBookingRetryDelayMs(run('pending', 'error_70_unresolved')), 15 * 60 * 1000);
  assert.equal(autoBookingRetryDelayMs(run('failed')), 10 * 60 * 1000);
  assert.equal(autoBookingRetryDelayMs(run('skipped', 'no_safe_action')), 60 * 60 * 1000);
  assert.equal(autoBookingRetryDelayMs(run('booked')), 0);
  assert.equal(autoBookingRunIsDue(run('pending'), now), true);
  assert.equal(autoBookingRunIsDue(run('skipped', 'no_safe_action'), now), true);
  assert.equal(autoBookingRunIsDue(run('running'), now), false);
  assert.equal(autoBookingRunIsDue(undefined, now), true);
  assert.equal(autoBookingRunIsDue(run('skipped', 'no_safe_action'), 2_000), true);
  assert.equal(shouldSkipRecentFixture(run('booked'), now), true);
  assert.equal(shouldSkipRecentFixture(run('skipped', 'no_safe_action'), now), false);
  assert.equal(shouldSkipRecentFixture(run('skipped', 'no_safe_action'), 2_000), true);
});

test('worker run limits stay bounded and recently booked fixture skip window is finite', () => {
  assert.equal(MAX_AUTO_BOOKING_TOURNAMENTS_PER_RUN, 5);
  assert.equal(AUTO_BOOKING_RUN_LOOKBACK_MS, 24 * 60 * 60 * 1000);
  assert.equal(RECENTLY_BOOKED_FIXTURE_SKIP_MS, 24 * 60 * 60 * 1000);
  assert.equal(NO_SAFE_ACTION_FIXTURE_SKIP_MS, 60 * 60 * 1000);
});
