import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSeasonPollResults,
  getSeasonPollCloseDate,
  getSeasonPollVoteTotal,
  isSeasonPollClosed,
} from '../src/utils/season-poll';

const round = (roundNumber: number, scheduledFor?: string) => ({
  round_number: roundNumber,
  matches: scheduledFor ? [{ scheduled_for: scheduledFor }] : [],
});

test('a five-round poll closes at the start of round three calendar date', () => {
  const closeDate = getSeasonPollCloseDate([
    round(1, '2026-05-01T19:00:00.000Z'),
    round(2, '2026-05-08T19:00:00.000Z'),
    round(3, '2026-05-15T19:00:00.000Z'),
    round(4, '2026-05-22T19:00:00.000Z'),
    round(5, '2026-05-29T19:00:00.000Z'),
  ]);

  assert.equal(closeDate?.toISOString(), '2026-05-15T00:00:00.000Z');
  assert.equal(isSeasonPollClosed(closeDate!, new Date('2026-05-14T23:59:59.000Z')), false);
  assert.equal(isSeasonPollClosed(closeDate!, new Date('2026-05-15T00:00:00.000Z')), true);
});

test('an even-round poll uses ceil(total rounds divided by two)', () => {
  const closeDate = getSeasonPollCloseDate([
    round(1, '2026-05-01T19:00:00.000Z'),
    round(2, '2026-05-08T19:00:00.000Z'),
    round(3, '2026-05-15T19:00:00.000Z'),
    round(4, '2026-05-22T19:00:00.000Z'),
  ]);

  assert.equal(closeDate?.toISOString(), '2026-05-08T00:00:00.000Z');
});

test('a missing middle-round schedule date does not guess a poll closing date', () => {
  assert.equal(
    getSeasonPollCloseDate([round(1, '2026-05-01T19:00:00.000Z'), round(2), round(3, '2026-05-15T19:00:00.000Z')]),
    null,
  );
});

test('poll results sort by votes then team name and retain the total number of votes', () => {
  const votes = [{ team_id: 'b' }, { team_id: 'a' }, { team_id: 'b' }, { team_id: 'missing' }];
  assert.equal(getSeasonPollVoteTotal(votes), 4);
  assert.deepEqual(
    buildSeasonPollResults(
      [
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Bravo' },
        { id: 'c', name: 'Charlie' },
      ],
      votes,
    ),
    [
      { id: 'b', name: 'Bravo', votes: 2 },
      { id: 'a', name: 'Alpha', votes: 1 },
      { id: 'c', name: 'Charlie', votes: 0 },
    ],
  );
});
