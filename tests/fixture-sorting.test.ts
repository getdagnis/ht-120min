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

test('fixture order follows live, finished, arranged, unarranged, misarranged, then kickoff time', () => {
  const fixtures = [
    { id: 'misarranged-a', status: 'misarranged', match_date: null },
    { id: 'arranged-later', status: 'arranged', match_date: '2026-10-07T21:05:00.000Z' },
    { id: 'unarranged', status: 'not_arranged', match_date: '2026-10-07T19:05:00.000Z' },
    { id: 'finished-later', status: 'finished', match_date: '2026-10-07T18:05:00.000Z' },
    { id: 'live-later', status: 'ongoing', match_date: '2026-10-07T17:05:00.000Z' },
    { id: 'arranged-earlier', status: 'arranged', match_date: '2026-10-07T20:05:00.000Z' },
    { id: 'finished-earlier', status: 'finished', match_date: '2026-10-07T16:05:00.000Z' },
    { id: 'live-earlier', status: 'ongoing', match_date: '2026-10-07T15:05:00.000Z' },
    { id: 'misarranged-b', status: 'misarranged', match_date: null },
  ];

  assert.deepEqual(
    fixtures.toSorted(compareFixtures).map((fixture) => fixture.id),
    ['live-earlier', 'live-later', 'finished-earlier', 'finished-later', 'arranged-earlier', 'arranged-later', 'unarranged', 'misarranged-a', 'misarranged-b'],
  );
});
