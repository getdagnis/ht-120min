import assert from 'node:assert/strict';
import test from 'node:test';

import {
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

test('the innocent opponent is not warned for the other side booking a wrong friendly', () => {
  assert.deepEqual(getMisarrangedWarningTeamIds({
    homeTeamId,
    awayTeamId,
    homeOffending: false,
    awayOffending: true,
  }), [awayTeamId]);
});

test('historical warning records survive a later upcoming-round refresh', () => {
  const historicalWarning = warning('round-1', homeTeamId);
  const plan = planFixtureWarningRefresh(
    [historicalWarning, warning(upcomingRoundId, homeTeamId)],
    upcomingRoundId,
    [warning(upcomingRoundId, awayTeamId)],
  );

  assert.deepEqual(plan.historicalWarnings, [historicalWarning]);
  assert.deepEqual(plan.resultingWarnings, [historicalWarning, warning(upcomingRoundId, awayTeamId)]);
});
