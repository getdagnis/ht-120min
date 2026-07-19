import test from 'node:test';
import assert from 'node:assert/strict';
import { getAppgPoints, validateAppgOutcome } from '../src/utils/appg';
import { calculateStandings } from '../src/utils/standings';

const teams = [
  { id: 'home', name: 'Home', ht_team_id: 1, hattrick_user_id: null, active: true, replacement_for_team_id: null },
  { id: 'away', name: 'Away', ht_team_id: 2, hattrick_user_id: null, active: true, replacement_for_team_id: null },
];

test('APPG awards the documented points to an extra-time winner', () => {
  assert.deepEqual(
    getAppgPoints({ home_goals: 2, away_goals: 1, went_120: true, total_minutes: 121, appg_outcome: 'ET3' }),
    { home: 3, away: 0 },
  );
  assert.deepEqual(
    getAppgPoints({ home_goals: 1, away_goals: 2, went_120: true, total_minutes: 120, appg_outcome: 'ET2' }),
    { home: 0, away: 2 },
  );
});

test('APPG handles penalty, regulation zero, and open-play penalty outcomes', () => {
  assert.deepEqual(
    getAppgPoints({
      home_goals: 1,
      away_goals: 1,
      penalty_shootout_home_goals: 4,
      penalty_shootout_away_goals: 3,
      appg_outcome: 'PS1',
    }),
    { home: 1, away: 0 },
  );
  assert.deepEqual(getAppgPoints({ home_goals: 2, away_goals: 0, appg_outcome: 'RT0' }), { home: 0, away: 0 });
  assert.deepEqual(getAppgPoints({ home_goals: 1, away_goals: 1, appg_outcome: 'RT0' }), { home: 0, away: 0 });
  assert.deepEqual(getAppgPoints({ home_goals: 2, away_goals: 1, appg_outcome: 'OPW' }), { home: -1, away: 0 });
});

test('APPG requires evidence appropriate to the selected outcome', () => {
  assert.match(
    validateAppgOutcome({ home_goals: 2, away_goals: 1, total_minutes: 90, appg_outcome: 'ET3' }) || '',
    /extra time/i,
  );
  assert.match(
    validateAppgOutcome({ home_goals: 1, away_goals: 1, appg_outcome: 'PS1' }) || '',
    /shootout/i,
  );
  assert.equal(validateAppgOutcome({ home_goals: 2, away_goals: 1, total_minutes: 90, appg_outcome: 'OPW' }), null);
});

test('APPG standings sort by average APPG points per game', () => {
  const standings = calculateStandings(
    teams,
    [
      {
        home_team_id: 'home',
        away_team_id: 'away',
        home_goals: 2,
        away_goals: 1,
        completed: true,
        went_120: true,
        total_minutes: 121,
        appg_outcome: 'ET3',
      },
    ],
    'appg',
  );

  assert.equal(standings[0].teamId, 'home');
  assert.equal(standings[0].appgPoints, 3);
  assert.equal(standings[0].played, 1);
});
