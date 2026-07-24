import test from 'node:test';
import assert from 'node:assert/strict';
import { getAppgPoints, validateAppgOutcome } from '../src/utils/appg';
import { calculateStandings } from '../src/utils/standings';

const teams = [
  { id: 'home', name: 'Home', ht_team_id: 1, hattrick_user_id: null, active: true, replacement_for_team_id: null },
  { id: 'away', name: 'Away', ht_team_id: 2, hattrick_user_id: null, active: true, replacement_for_team_id: null },
];

test('APPG awards the same cooperative points to both teams', () => {
  assert.deepEqual(
    getAppgPoints({ home_goals: 2, away_goals: 1, went_120: true, total_minutes: 121, appg_outcome: 'ET3' }),
    { home: 3, away: 3 },
  );
  assert.deepEqual(
    getAppgPoints({ home_goals: 1, away_goals: 2, went_120: true, total_minutes: 120, appg_outcome: 'ET2' }),
    { home: 2, away: 2 },
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
    { home: 1, away: 1 },
  );
  assert.deepEqual(getAppgPoints({ home_goals: 2, away_goals: 0, appg_outcome: 'RT0' }), { home: 0, away: 0 });
  assert.deepEqual(getAppgPoints({ home_goals: 1, away_goals: 1, appg_outcome: 'RT0' }), { home: 0, away: 0 });
  assert.deepEqual(getAppgPoints({ home_goals: 2, away_goals: 1, appg_outcome: 'OPW' }), { home: -1, away: -1 });
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
  assert.equal(validateAppgOutcome({ home_goals: 2, away_goals: 1, total_minutes: 93, appg_outcome: 'RT0' }), null);
  assert.match(
    validateAppgOutcome({ home_goals: 2, away_goals: 1, total_minutes: 93, appg_outcome: 'ET2' }) || '',
    /extra time/i,
  );
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

  assert.equal(standings[0].appgPoints, 3);
  assert.equal(standings[1].appgPoints, 3);
  assert.equal(standings[0].played, 1);
  assert.equal(standings[0].appgPlayed, 1);
});

test('APPG counts every completed match in the average denominator', () => {
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
      {
        home_team_id: 'home',
        away_team_id: 'away',
        home_goals: 1,
        away_goals: 0,
        completed: true,
        went_120: false,
        total_minutes: 90,
        appg_outcome: 'needs_review',
      },
    ],
    'appg',
  );

  const home = standings.find((standing) => standing.teamId === 'home');
  assert.ok(home);
  assert.equal(home.played, 2);
  assert.equal(home.appgPlayed, 2);
  assert.equal(home.appgPoints / home.appgPlayed, 1.5);
});

test('APPG example averages use all played matches without a minimum threshold', () => {
  const ealing = { id: 'ealing', name: 'Ealing', ht_team_id: 3, hattrick_user_id: null, active: true, replacement_for_team_id: null };
  const hemsworth = { id: 'hemsworth', name: 'Hemsworth', ht_team_id: 4, hattrick_user_id: null, active: true, replacement_for_team_id: null };
  const opponents = Array.from({ length: 9 }, (_, index) => ({
    id: `opponent-${index}`,
    name: `Opponent ${index}`,
    ht_team_id: 10 + index,
    hattrick_user_id: null,
    active: true,
    replacement_for_team_id: null,
  }));
  const exampleTeams = [ealing, hemsworth, ...opponents];
  const ealingMatches = [
    { home_team_id: 'ealing', away_team_id: 'opponent-0', home_goals: 2, away_goals: 1, completed: true, appg_outcome: 'ET2' as const },
    { home_team_id: 'ealing', away_team_id: 'opponent-1', home_goals: 1, away_goals: 0, completed: true, appg_outcome: 'RT0' as const },
  ];
  const hemsworthMatches = [
    ...Array.from({ length: 2 }, (_, index) => ({ home_team_id: 'hemsworth', away_team_id: `opponent-${index + 2}`, home_goals: 2, away_goals: 1, completed: true, appg_outcome: 'ET2' as const })),
    ...Array.from({ length: 4 }, (_, index) => ({ home_team_id: 'hemsworth', away_team_id: `opponent-${index + 4}`, home_goals: 1, away_goals: 0, completed: true, appg_outcome: 'PS1' as const })),
    ...Array.from({ length: 3 }, (_, index) => ({ home_team_id: 'hemsworth', away_team_id: `opponent-${index + 6}`, home_goals: 0, away_goals: 0, completed: true, appg_outcome: 'RT0' as const })),
  ];
  const standings = calculateStandings(exampleTeams, [...ealingMatches, ...hemsworthMatches], 'appg');
  const ealingStanding = standings.find((standing) => standing.teamId === 'ealing');
  const hemsworthStanding = standings.find((standing) => standing.teamId === 'hemsworth');

  assert.equal(ealingStanding?.played, 2);
  assert.equal(ealingStanding?.appgPoints, 2);
  assert.equal(ealingStanding && ealingStanding.appgPoints / ealingStanding.appgPlayed, 1);
  assert.equal(hemsworthStanding?.played, 9);
  assert.equal(hemsworthStanding?.appgPoints, 8);
  assert.equal(hemsworthStanding && Number((hemsworthStanding.appgPoints / hemsworthStanding.appgPlayed).toFixed(2)), 0.89);
});
