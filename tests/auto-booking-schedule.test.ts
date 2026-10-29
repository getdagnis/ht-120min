import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTO_BOOKING_PERSISTENT_BLOCK_MS,
  AUTO_BOOKING_RETRY_MS,
  AUTO_BOOKING_SLOW_CHECK_MS,
  internationalBookingOpensAt,
  nextAutoBookingAttemptAt,
  nextInternationalPrecheckAt,
} from '../src/server/api/_lib/auto-booking-schedule.js';

const international = {
  scheduled_for: '2026-10-28T17:00:00.000Z',
  schedule_slot_type: 'midweek_friendly',
  home_country_id: 1,
  away_country_id: 2,
};

test('Thursday 06:00 booking opening is derived from fixture week in Hattrick local time', () => {
  assert.equal(internationalBookingOpensAt(international)?.toISOString(), '2026-10-22T04:00:00.000Z');
  assert.equal(internationalBookingOpensAt({ ...international, scheduled_for: '2026-04-01T16:00:00Z' })?.toISOString(), '2026-03-26T05:00:00.000Z');
});

test('preliminary checks are sparse by day, then two-hourly overnight, and stop at opening', () => {
  assert.equal(nextInternationalPrecheckAt(international, new Date('2026-10-21T07:55:00Z'))?.toISOString(), '2026-10-21T08:00:00.000Z');
  assert.equal(nextInternationalPrecheckAt(international, new Date('2026-10-21T08:05:00Z'))?.toISOString(), '2026-10-21T12:00:00.000Z');
  assert.equal(nextInternationalPrecheckAt(international, new Date('2026-10-21T20:05:00Z'))?.toISOString(), '2026-10-21T22:00:00.000Z');
  assert.equal(nextInternationalPrecheckAt(international, new Date('2026-10-22T02:05:00Z'))?.toISOString(), '2026-10-22T04:00:00.000Z');
  assert.equal(nextInternationalPrecheckAt(international, new Date('2026-10-22T04:00:00Z')), null);
});

test('Thursday timing applies only to international midweek fixtures', () => {
  assert.equal(internationalBookingOpensAt({ ...international, away_country_id: 1 }), null);
  assert.equal(internationalBookingOpensAt({ ...international, schedule_slot_type: 'weekend_friendly' }), null);
  assert.equal(nextAutoBookingAttemptAt({ ...international, away_country_id: 1 }, new Date(0), 'no_safe_action')?.getTime(), AUTO_BOOKING_SLOW_CHECK_MS);
});

test('post-opening and error retries are bounded; persistent blocks back off', () => {
  const now = new Date('2026-10-22T04:00:00Z');
  assert.equal(nextAutoBookingAttemptAt(international, now, 'error_70')?.getTime(), now.getTime() + AUTO_BOOKING_RETRY_MS);
  assert.equal(nextAutoBookingAttemptAt(international, now, 'transient_error')?.getTime(), now.getTime() + AUTO_BOOKING_RETRY_MS);
  assert.equal(nextAutoBookingAttemptAt(international, now, 'persistent_block')?.getTime(), now.getTime() + AUTO_BOOKING_PERSISTENT_BLOCK_MS);
  const beforeOpening = new Date('2026-10-21T18:00:00Z');
  assert.equal(nextAutoBookingAttemptAt(international, beforeOpening, 'persistent_block')?.toISOString(), '2026-10-22T04:00:00.000Z');
});
