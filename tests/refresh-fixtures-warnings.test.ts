import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getFixtureWarningRoundIdsToDeactivate,
  getMisarrangedWarningTeamIds,
  planFixtureWarningRefresh,
} from '../src/server/api/teams/refresh-fixtures.js';

const upcomingRoundId = 'round-2';
const homeTeamId = 'home-team';
const awayTeamId = 'away-team';

const warning = (round_id: string, team_id: string) => ({ round_id, team_id });

test('first refresh creates one warning for the team with the wrong booking', () => {
  const offendingTeamIds = getMisarrangedWarningTeamIds({
    homeTeamId,
    awayTeamId,
    homeOffending: true,
    awayOffending: false,
  });
  const plan = planFixtureWarningRefresh([], upcomingRoundId, offendingTeamIds.map((team_id) => warning(upcomingRoundId, team_id)));

  assert.deepEqual(plan.resultingWarnings, [warning(upcomingRoundId, homeTeamId)]);
});

test('a later refresh with the same wrong booking keeps exactly that warning', () => {
  const offendingTeamIds = getMisarrangedWarningTeamIds({
    homeTeamId,
    awayTeamId,
    homeOffending: true,
    awayOffending: false,
  });
  const plan = planFixtureWarningRefresh(
    [warning(upcomingRoundId, homeTeamId)],
    upcomingRoundId,
    offendingTeamIds.map((team_id) => warning(upcomingRoundId, team_id)),
  );

  assert.deepEqual(plan.resultingWarnings, [warning(upcomingRoundId, homeTeamId)]);
});

test('a later refresh does not warn the opponent after the first team was already detected', () => {
  assert.deepEqual(getMisarrangedWarningTeamIds({
    homeTeamId,
    awayTeamId,
    homeOffending: false,
    awayOffending: true,
    homeAlreadyWarned: true,
  }), []);

  const plan = planFixtureWarningRefresh(
    [warning(upcomingRoundId, homeTeamId)],
    upcomingRoundId,
    [],
  );
  assert.deepEqual(plan.resultingWarnings, [warning(upcomingRoundId, homeTeamId)]);
});

test('both teams are warned when both are first detected in the same refresh', () => {
  assert.deepEqual(getMisarrangedWarningTeamIds({
    homeTeamId,
    awayTeamId,
    homeOffending: true,
    awayOffending: true,
  }), [homeTeamId, awayTeamId]);

  assert.deepEqual(getMisarrangedWarningTeamIds({
    homeTeamId,
    awayTeamId,
    homeOffending: true,
    awayOffending: true,
    homeAlreadyWarned: true,
  }), []);
});

test('the innocent opponent is not warned when only the other side is offending', () => {
  assert.deepEqual(getMisarrangedWarningTeamIds({
    homeTeamId,
    awayTeamId,
    homeOffending: true,
    awayOffending: false,
  }), [homeTeamId]);
});

test('historical warning records survive a later upcoming-round refresh', () => {
  const historicalWarning = warning('round-1', homeTeamId);
  const plan = planFixtureWarningRefresh(
    [historicalWarning, warning(upcomingRoundId, homeTeamId)],
    upcomingRoundId,
    [],
  );

  assert.deepEqual(plan.historicalWarnings, [historicalWarning]);
  assert.deepEqual(plan.resultingWarnings, [historicalWarning, warning(upcomingRoundId, homeTeamId)]);
});

test('warning stays visible until a later round has started', () => {
  const rounds = [
    {
      id: 'round-1',
      round_number: 1,
      created_at: '2026-09-30T12:00:00Z',
      matches: [{ home_team_id: homeTeamId, away_team_id: awayTeamId, scheduled_for: '2026-10-07T17:45:00Z' }],
    },
    {
      id: 'round-2',
      round_number: 2,
      created_at: '2026-09-30T12:00:00Z',
      matches: [{ home_team_id: homeTeamId, away_team_id: awayTeamId, scheduled_for: '2026-10-14T17:45:00Z' }],
    },
  ];

  assert.deepEqual(
    getFixtureWarningRoundIdsToDeactivate({
      warnings: [{ round_id: 'round-1' }],
      rounds,
      now: new Date('2026-10-07T18:00:00Z'),
    }),
    [],
  );
  assert.deepEqual(
    getFixtureWarningRoundIdsToDeactivate({
      warnings: [{ round_id: 'round-1' }],
      rounds,
      now: new Date('2026-10-14T18:00:00Z'),
    }),
    ['round-1'],
  );
});
