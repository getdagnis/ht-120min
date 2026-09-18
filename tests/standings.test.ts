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
