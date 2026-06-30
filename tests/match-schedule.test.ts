import assert from 'node:assert/strict';
import test from 'node:test';

import { getMatchDateForRound } from '../src/utils/match-schedule';

test('scheduled_for takes precedence over calculated round dates', () => {
  const round = {
    created_at: '2026-01-01T00:00:00Z',
    round_number: 2,
  };

  const scheduled = getMatchDateForRound(round, { scheduled_for: '2026-01-13T12:34:00Z' }, 'Sweden');
  assert.equal(scheduled.toISOString(), '2026-01-13T12:34:00.000Z');
});

test('falls back to calculated date when scheduled_for is missing', () => {
  const round = {
    created_at: '2026-01-01T00:00:00Z',
    round_number: 1,
  };

  const calculated = getMatchDateForRound(round, {}, 'Sweden');
  assert.equal(Number.isNaN(calculated.getTime()), false);
});

