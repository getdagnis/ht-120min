import assert from 'node:assert/strict';
import test from 'node:test';

import { selectUpcomingRefreshRound } from '../src/server/api/teams/refresh-fixtures.js';

const now = new Date('2026-09-28T05:00:00.000Z');

function round(id: string, roundNumber: number, matches: Array<{
  status: string;
  completed: boolean;
  scheduled_for: string;
  home_team_id: string | null;
  away_team_id: string | null;
}>) {
  return {
    id,
    round_number: roundNumber,
    created_at: '2026-09-01T00:00:00.000Z',
    matches,
  };
}

function misarranged(scheduledFor: string) {
  return { status: 'misarranged', completed: false, scheduled_for: scheduledFor, home_team_id: 'home', away_team_id: 'away' };
}

function unresolved(scheduledFor: string) {
  return { status: 'not_arranged', completed: false, scheduled_for: scheduledFor, home_team_id: 'home', away_team_id: 'away' };
}

test('past misarranged round no longer blocks a later unresolved round', () => {
  const selected = selectUpcomingRefreshRound(
    [
      round('round-1', 1, [misarranged('2026-09-23T02:15:00.000Z')]),
      round('round-2', 2, [unresolved('2026-09-30T02:15:00.000Z')]),
    ],
    now,
  );

  assert.equal(selected?.id, 'round-2');
});

test('future misarranged round remains actionable for reserve recovery', () => {
  const selected = selectUpcomingRefreshRound(
    [
      round('round-1', 1, [misarranged('2026-09-30T02:15:00.000Z')]),
      round('round-2', 2, [unresolved('2026-10-07T02:15:00.000Z')]),
    ],
    now,
  );

  assert.equal(selected?.id, 'round-1');
});

test('an empty fixture cannot hold refresh on an earlier round', () => {
  const selected = selectUpcomingRefreshRound(
    [
      round('round-1', 1, [{ ...unresolved('2026-09-30T02:15:00.000Z'), home_team_id: null, away_team_id: null }]),
      round('round-2', 2, [unresolved('2026-10-07T02:15:00.000Z')]),
    ],
    now,
  );
  assert.equal(selected?.id, 'round-2');
});

test('a single-team BYE cannot hold refresh on an earlier round', () => {
  const selected = selectUpcomingRefreshRound(
    [
      round('round-1', 1, [{ ...unresolved('2026-09-30T02:15:00.000Z'), away_team_id: null }]),
      round('round-2', 2, [unresolved('2026-10-07T02:15:00.000Z')]),
    ],
    now,
  );
  assert.equal(selected?.id, 'round-2');
});
