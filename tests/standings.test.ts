import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSeasonSlotStandings, calculateStandings } from '../src/utils/standings';

test('completed BYE result counts for the one tournament team', () => {
  const standings = calculateStandings(
    [
      {
        id: 'team-a',
        name: 'Team A',
        ht_team_id: 123,
        hattrick_user_id: 456,
        active: true,
        replacement_for_team_id: null,
      },
    ],
    [
      {
        home_team_id: 'team-a',
        away_team_id: null,
        home_goals: 3,
        away_goals: 2,
        went_120: true,
        completed: true,
        total_minutes: 121,
      },
    ],
    '120min',
  );

  assert.equal(standings.length, 1);
  assert.equal(standings[0].played, 1);
  assert.equal(standings[0].won, 1);
  assert.equal(standings[0].gf, 3);
  assert.equal(standings[0].ga, 2);
  assert.equal(standings[0].achievements120min, 1);
  assert.equal(standings[0].totalMinutes, 121);
});

test('stored TeamRank is carried into standings as informational team metadata', () => {
  const standings = calculateStandings(
    [{ id: 'team-a', name: 'Team A', ht_team_id: 123, hattrick_user_id: 456, active: true, replacement_for_team_id: null, team_rank: 27 }],
    [],
    'points',
  );

  assert.equal(standings[0].teamRank, 27);
});

test('penalty shootouts award 2 points to the winner and 1 point to the loser', () => {
  const teams = [
    { id: 'away', name: 'Away', ht_team_id: 2, hattrick_user_id: 2, active: true, replacement_for_team_id: null },
    { id: 'home', name: 'Home', ht_team_id: 1, hattrick_user_id: 1, active: true, replacement_for_team_id: null },
  ];
  const shootout = {
    home_team_id: 'home',
    away_team_id: 'away',
    home_goals: 0,
    away_goals: 0,
    penalty_shootout_home_goals: 3,
    penalty_shootout_away_goals: 2,
    match_type: 5,
    went_120: true,
    completed: true,
  };

  const pointsStandings = calculateStandings(teams, [shootout], 'points');
  assert.equal(pointsStandings[0].teamId, 'home');
  assert.equal(pointsStandings[0].pts, 2);
  assert.equal(pointsStandings[1].pts, 1);

  const standings120min = calculateStandings(teams, [shootout], '120min');
  assert.equal(standings120min[0].teamId, 'home');
  assert.equal(standings120min[0].achievements120min, 1);
  assert.equal(standings120min[0].pts, 3);
  assert.equal(standings120min[1].pts, 2);
});

test('120-minute scoring gives no points for Normal Rules regardless of result', () => {
  const teams = [
    { id: 'home', name: 'Home', ht_team_id: 1, hattrick_user_id: 1, active: true, replacement_for_team_id: null },
    { id: 'away', name: 'Away', ht_team_id: 2, hattrick_user_id: 2, active: true, replacement_for_team_id: null },
  ];
  const matches = [
    { home_team_id: 'home', away_team_id: 'away', home_goals: 3, away_goals: 0, match_type: 4, went_120: false, completed: true },
    { home_team_id: 'home', away_team_id: 'away', home_goals: 0, away_goals: 2, match_type: 8, went_120: true, completed: true },
  ];
  const standings = calculateStandings(teams, matches, '120min');

  assert.equal(standings.find((team) => team.teamId === 'home')?.pts, 0);
  assert.equal(standings.find((team) => team.teamId === 'away')?.pts, 0);
});

test('120-minute Cup Rules points reward a scoreless loss more than a scoring loss', () => {
  const teams = [
    { id: 'home', name: 'Home', ht_team_id: 1, hattrick_user_id: 1, active: true, replacement_for_team_id: null },
    { id: 'away', name: 'Away', ht_team_id: 2, hattrick_user_id: 2, active: true, replacement_for_team_id: null },
    { id: 'other', name: 'Other', ht_team_id: 3, hattrick_user_id: 3, active: true, replacement_for_team_id: null },
  ];
  const matches = [
    { home_team_id: 'home', away_team_id: 'away', home_goals: 2, away_goals: 0, match_type: 5, went_120: false, completed: true },
    { home_team_id: 'home', away_team_id: 'other', home_goals: 2, away_goals: 1, match_type: 9, went_120: false, completed: true },
  ];
  const standings = calculateStandings(teams, matches, '120min');

  assert.equal(standings.find((team) => team.teamId === 'home')?.pts, 0);
  assert.equal(standings.find((team) => team.teamId === 'away')?.pts, 2);
  assert.equal(standings.find((team) => team.teamId === 'other')?.pts, 1);
});

test('120-minute goals and goal difference include only matches that reached extra time', () => {
  const teams = [
    { id: 'home', name: 'Home', ht_team_id: 1, hattrick_user_id: 1, active: true, replacement_for_team_id: null },
    { id: 'away', name: 'Away', ht_team_id: 2, hattrick_user_id: 2, active: true, replacement_for_team_id: null },
  ];
  const standings = calculateStandings(teams, [
    { home_team_id: 'home', away_team_id: 'away', home_goals: 3, away_goals: 0, match_type: 5, went_120: false, completed: true },
    { home_team_id: 'home', away_team_id: 'away', home_goals: 1, away_goals: 2, match_type: 5, went_120: true, completed: true },
  ], '120min');
  const home = standings.find((team) => team.teamId === 'home');
  const away = standings.find((team) => team.teamId === 'away');

  assert.equal(home?.gf, 1);
  assert.equal(home?.ga, 2);
  assert.equal(home?.gd, -1);
  assert.equal(away?.gf, 2);
  assert.equal(away?.ga, 1);
  assert.equal(away?.gd, 1);
  assert.equal(home?.pts, 2);
  assert.equal(away?.pts, 5);
});

test('inactive current-season teams keep their stats as an open spot', () => {
  const standings = calculateStandings(
    [
      {
        id: 'team-a',
        name: 'Team A',
        ht_team_id: 123,
        hattrick_user_id: 456,
        active: false,
        replacement_for_team_id: null,
      },
    ],
    [
      {
        home_team_id: 'team-a',
        away_team_id: null,
        home_goals: 3,
        away_goals: 2,
        went_120: true,
        completed: true,
        total_minutes: 121,
      },
    ],
    '120min',
  );

  assert.equal(standings.length, 1);
  assert.equal(standings[0].teamName, 'Open spot');
  assert.equal(standings[0].isOpenSpot, true);
  assert.equal(standings[0].played, 1);
  assert.equal(standings[0].won, 1);
});

test('a current slot renders its incoming team while completed statistics stay on the physical slot', () => {
  const standings = calculateSeasonSlotStandings(
    [
      { id: 'ffc', name: 'FFC', ht_team_id: 1, hattrick_user_id: 1, active: false, replacement_for_team_id: null },
      { id: 'zermatt', name: 'Zermatt', ht_team_id: 2, hattrick_user_id: 2, active: true, replacement_for_team_id: null },
      { id: 'other', name: 'Other', ht_team_id: 3, hattrick_user_id: 3, active: true, replacement_for_team_id: null },
    ],
    [{ home_team_id: 'ffc', away_team_id: 'other', home_slot_id: 'slot-ffc', away_slot_id: 'slot-other', home_goals: 2, away_goals: 1, went_120: false, completed: true }],
    [{ id: 'slot-ffc', current_team_id: 'zermatt' }, { id: 'slot-other', current_team_id: 'other' }],
    'points',
  );
  const zermatt = standings.find((standing) => standing.teamName === 'Zermatt');
  assert.ok(zermatt);
  assert.equal(zermatt.played, 1);
  assert.equal(zermatt.pts, 3);
  assert.equal(zermatt.teamId, 'slot-ffc');
});
