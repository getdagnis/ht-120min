import assert from 'node:assert/strict';
import test from 'node:test';

import { getFocusedFixtureRoundIndex, getUpcomingFixtureRoundIndex } from '../src/utils/fixture-round-focus';

test('focuses the earliest unfinished round when multiple rounds share the current HT week', () => {
  const rounds = [
    {
      created_at: '2026-10-01T00:00:00.000Z',
      round_number: 2,
      matches: [{ scheduled_for: '2026-10-27T18:00:00.000Z', completed: false }],
    },
    {
      created_at: '2026-10-01T00:00:00.000Z',
      round_number: 3,
      matches: [{ scheduled_for: '2026-10-31T18:00:00.000Z', completed: false }],
    },
  ];
  const now = new Date('2026-10-26T12:00:00.000Z');

  assert.equal(getFocusedFixtureRoundIndex(rounds, 0, now), 0);

  rounds[0]!.matches[0]!.completed = true;
  assert.equal(getFocusedFixtureRoundIndex(rounds, 0, now), 1);
});

test('skips stale Round 1 and selects the weekend extra before next midweek', () => {
  const rounds = [
    { created_at: '2026-09-01T00:00:00Z', round_number: 1,
      matches: [{ scheduled_for: '2026-09-23T03:15:00Z', completed: false, status: 'not_arranged' }] },
    { created_at: '2026-10-01T00:00:00Z', round_number: 6,
      matches: [{ scheduled_for: '2026-10-28T03:15:00Z', completed: true, status: 'finished' }] },
    { created_at: '2026-10-01T00:00:00Z', round_number: 9,
      matches: [{ scheduled_for: '2026-11-01T03:10:00Z', completed: false, status: 'arranged' }] },
    { created_at: '2026-10-01T00:00:00Z', round_number: 7,
      matches: [{ scheduled_for: '2026-11-04T03:15:00Z', completed: false, status: 'arranged' }] },
  ];
  const now = new Date('2026-10-30T16:18:00Z');
  const upcoming = getUpcomingFixtureRoundIndex(rounds, now);
  assert.equal(upcoming, 2);
  assert.equal(getUpcomingFixtureRoundIndex(rounds), 2);
  assert.equal(getFocusedFixtureRoundIndex(rounds, upcoming, now), 2);
  Object.assign(rounds[0]!.matches[0]!, { schedule_resolution: 'finalized_unplayed' });
  assert.equal(getUpcomingFixtureRoundIndex(rounds, now), 2);
});
