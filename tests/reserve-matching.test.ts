import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findReserveFixtureMatch,
  getReserveEligibilityDeadline,
  isReserveUseAllowed,
  type ReserveFriendlyCandidate,
} from '../src/server/api/teams/reserve-matching';

const targetDate = new Date('2026-09-30T03:15:00.000Z');
const reserve = { id: 'reserve-row', ht_team_id: 300 };
const friendly = (homeId: number, awayId: number, matchId: number): ReserveFriendlyCandidate => ({
  homeId,
  awayId,
  matchId,
  matchType: 5,
  date: targetDate,
});
const resolve = (homeFriendlies: ReserveFriendlyCandidate[], awayFriendlies: ReserveFriendlyCandidate[], now = new Date('2026-09-25T16:00:00.000Z')) =>
  findReserveFixtureMatch({
    homeHtTeamId: 100,
    awayHtTeamId: 200,
    homeFriendlies,
    awayFriendlies,
    reserveTeams: [reserve],
    targetDate,
    isInsideWindow: (date, expected) => date.getTime() === expected.getTime(),
    reserveAllowed: isReserveUseAllowed({ status: 'not_arranged', targetDate, now }),
  });

test('prefers the original scheduled pair', () => {
  const result = resolve([friendly(100, 200, 1), friendly(100, 300, 2)], []);
  assert.equal(result?.kind, 'original');
  assert.equal(result?.fixture.matchId, 1);
});

test('accepts one reserve replacement after the deadline', () => {
  const result = resolve([friendly(100, 300, 2)], []);
  assert.equal(result?.kind, 'reserve');
  if (result?.kind === 'reserve') {
    assert.equal(result.reserve.id, reserve.id);
    assert.equal(result.replaces, 'away');
  }
});

test('does not accept a reserve before Friday 17:00 Hattrick Time', () => {
  const result = findReserveFixtureMatch({
    homeHtTeamId: 100,
    awayHtTeamId: 200,
    homeFriendlies: [friendly(100, 300, 2)],
    awayFriendlies: [],
    reserveTeams: [reserve],
    targetDate,
    isInsideWindow: (date, expected) => date.getTime() === expected.getTime(),
    reserveAllowed: isReserveUseAllowed({
      status: 'not_arranged',
      targetDate,
      now: new Date('2026-09-25T14:59:00.000Z'),
    }),
  });
  assert.equal(result, null);
  assert.equal(getReserveEligibilityDeadline(targetDate).toISOString(), '2026-09-25T15:00:00.000Z');
});

test('reopens a misarranged fixture immediately for reserve recovery', () => {
  assert.equal(
    isReserveUseAllowed({ status: 'misarranged', targetDate, now: new Date('2026-09-24T12:00:00.000Z') }),
    true,
  );
});

test('keeps both independently booked reserves misarranged', () => {
  const secondReserve = { id: 'reserve-row-2', ht_team_id: 400 };
  const result = findReserveFixtureMatch({
    homeHtTeamId: 100,
    awayHtTeamId: 200,
    homeFriendlies: [friendly(100, 300, 2)],
    awayFriendlies: [friendly(200, 400, 3)],
    reserveTeams: [reserve, secondReserve],
    targetDate,
    isInsideWindow: (date, expected) => date.getTime() === expected.getTime(),
    reserveAllowed: true,
  });
  assert.deepEqual(result, { kind: 'both-reserves' });
});

test('valid reserve wins over an outsider booking by the other original team', () => {
  const result = resolve([friendly(100, 300, 2)], [friendly(200, 999, 4)]);
  assert.equal(result?.kind, 'reserve');
  assert.equal(result?.fixture.matchId, 2);
});
