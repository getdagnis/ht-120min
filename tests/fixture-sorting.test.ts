import assert from 'node:assert/strict';
import test from 'node:test';

import { compareFixtures } from '../src/utils/fixture-sorting';

test('fixture order is date, Hattrick match ID, then internal ID across date representations', () => {
  const fixtures = [
    { id: 'z', match_date: new Date('2026-09-23T02:15:00.000Z'), ht_match_id: 771594762 },
    { id: 'b', match_date: '2026-09-23T02:15:00.000Z', ht_match_id: 771594636 },
    { id: 'a', match_date: '2026-09-23T02:15:00.000Z', ht_match_id: 771594636 },
    { id: 'later', match_date: '2026-09-30T02:15:00.000Z', ht_match_id: 1 },
  ];

  assert.deepEqual(fixtures.toSorted(compareFixtures).map((fixture) => fixture.id), ['a', 'b', 'z', 'later']);
});
