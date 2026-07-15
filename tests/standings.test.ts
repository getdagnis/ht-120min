import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateStandings } from '../src/utils/standings';

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
