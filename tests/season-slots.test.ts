import test from 'node:test';
import assert from 'node:assert/strict';
import { getSeasonSlotBoxSize, getSeasonSlotIndexes } from '../src/utils/season-slots';
import { calculateSeasonSlotStandings } from '../src/utils/standings';

test('season slot boxes are always even and preserve one physical slot for odd rosters', () => {
  assert.equal(getSeasonSlotBoxSize(2), 2);
  assert.equal(getSeasonSlotBoxSize(5), 6);
  assert.equal(getSeasonSlotBoxSize(6), 6);
  assert.equal(getSeasonSlotBoxSize(11), 12);
});

test('season slot indexes are stable and one-based', () => {
  assert.deepEqual(getSeasonSlotIndexes(5), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(getSeasonSlotIndexes(6), [1, 2, 3, 4, 5, 6]);
});

test('season slot boxes reject invalid roster sizes', () => {
  assert.throws(() => getSeasonSlotBoxSize(0), /at least two teams/);
  assert.throws(() => getSeasonSlotBoxSize(1), /at least two teams/);
  assert.throws(() => getSeasonSlotBoxSize(2.5), /at least two teams/);
});

test('vacant slots retain a team that already has completed current-season results', () => {
  const standings = calculateSeasonSlotStandings(
    [
      {
        id: 'team-a',
        name: 'Team A',
        ht_team_id: 1,
        hattrick_user_id: null,
        active: true,
        replacement_for_team_id: null,
      },
      {
        id: 'team-b',
        name: 'Team B',
        ht_team_id: 2,
        hattrick_user_id: null,
        active: false,
        replacement_for_team_id: null,
      },
    ],
    [
      {
        home_team_id: 'team-a',
        away_team_id: 'team-b',
        home_goals: 2,
        away_goals: 1,
        completed: true,
        went_120: false,
        total_minutes: 90,
        home_slot_id: 'slot-a',
        away_slot_id: 'slot-b',
      },
    ],
    [
      { id: 'slot-a', current_team_id: 'team-a' },
      { id: 'slot-b', current_team_id: null },
    ],
    '120min',
    [
      {
        id: 'assignment-b',
        tournament_season_slot_id: 'slot-b',
        team_id: 'team-b',
        assigned_at: '2026-01-01T00:00:00Z',
        released_at: '2026-01-02T00:00:00Z',
        team_name: 'Team B',
        ht_team_id: 2,
        manager_name: null,
        hattrick_user_id: null,
        logo_url: null,
      },
    ],
  );

  assert.deepEqual(
    standings.map((standing) => [standing.teamId, standing.teamName, standing.played]),
    [
      ['slot-a', 'Team A', 1],
      ['slot-b', 'Team B', 1],
    ],
  );
});

test('vacant slots without completed results do not create a standings row', () => {
  const standings = calculateSeasonSlotStandings(
    [
      {
        id: 'team-a',
        name: 'Team A',
        ht_team_id: 1,
        hattrick_user_id: null,
        active: true,
        replacement_for_team_id: null,
      },
    ],
    [],
    [
      { id: 'slot-a', current_team_id: 'team-a' },
      { id: 'slot-b', current_team_id: null },
    ],
    '120min',
  );

  assert.deepEqual(standings.map((standing) => standing.teamName), ['Team A']);
});

test('vacant slots use the latest released assignment instead of arbitrary match order', () => {
  const standings = calculateSeasonSlotStandings(
    [
      {
        id: 'team-a',
        name: 'Team A',
        ht_team_id: 1,
        hattrick_user_id: null,
        active: false,
        replacement_for_team_id: null,
      },
      {
        id: 'team-b',
        name: 'Team B',
        ht_team_id: 2,
        hattrick_user_id: null,
        active: false,
        replacement_for_team_id: null,
      },
      {
        id: 'team-c',
        name: 'Team C',
        ht_team_id: 3,
        hattrick_user_id: null,
        active: true,
        replacement_for_team_id: null,
      },
    ],
    [
      {
        home_team_id: 'team-a',
        away_team_id: 'team-b',
        home_goals: 2,
        away_goals: 1,
        completed: true,
        went_120: false,
        total_minutes: 90,
        home_slot_id: 'slot-a',
        away_slot_id: 'slot-c',
      },
      {
        home_team_id: 'team-b',
        away_team_id: 'team-c',
        home_goals: 0,
        away_goals: 1,
        completed: true,
        went_120: false,
        total_minutes: 90,
        home_slot_id: 'slot-a',
        away_slot_id: 'slot-c',
      },
    ],
    [
      { id: 'slot-a', current_team_id: null },
      { id: 'slot-c', current_team_id: 'team-c' },
    ],
    '120min',
    [
      {
        id: 'assignment-a',
        tournament_season_slot_id: 'slot-a',
        team_id: 'team-a',
        assigned_at: '2026-01-01T00:00:00Z',
        released_at: '2026-01-02T00:00:00Z',
        team_name: 'Team A',
        ht_team_id: 1,
        manager_name: null,
        hattrick_user_id: null,
        logo_url: null,
      },
      {
        id: 'assignment-b',
        tournament_season_slot_id: 'slot-a',
        team_id: 'team-b',
        assigned_at: '2026-01-03T00:00:00Z',
        released_at: '2026-01-04T00:00:00Z',
        team_name: 'Team B',
        ht_team_id: 2,
        manager_name: null,
        hattrick_user_id: null,
        logo_url: null,
      },
    ],
  );

  assert.deepEqual(
    standings.map((standing) => [standing.teamName, standing.played]),
    [
      ['Team B', 2],
      ['Team C', 2],
    ],
  );
});
