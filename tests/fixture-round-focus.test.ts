import assert from 'node:assert/strict';
import test from 'node:test';

import { getFocusedFixtureRoundIndex } from '../src/utils/fixture-round-focus';

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
