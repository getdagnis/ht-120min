import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSeasonFixturesSnapshot } from '../src/utils/season-fixtures';

test('season fixture snapshots retain the rendered fixture data without refetching teams', () => {
  const snapshot = buildSeasonFixturesSnapshot(
    1,
    [
      {
        id: 'round-1',
        round_number: 1,
        created_at: '2026-07-01T00:00:00.000Z',
        matches: [
          {
            id: 'match-1',
            round_id: 'round-1',
            home_team_id: 'home-id',
            away_team_id: 'away-id',
            home_goals: 2,
            away_goals: 1,
            completed: true,
            went_120: true,
            total_minutes: 121,
            status: 'finished',
            ht_match_id: 123456789,
            match_type: 9,
            match_date: new Date('2026-07-14T19:30:00.000Z'),
            home_team: {
              name: 'Historic Home Name',
              ht_team_id: 101,
              logo_url: 'https://example.com/home.png',
              country_name: 'Guam',
              country_id: 179,
              league_id: 3000,
              manager_name: 'home-manager',
              hattrick_user_id: 11,
            },
            away_team: {
              name: 'Historic Away Name',
              ht_team_id: 202,
              logo_url: 'https://example.com/away.png',
              country_name: 'Latvia',
              country_id: 48,
              league_id: 53,
              manager_name: 'away-manager',
              hattrick_user_id: 22,
            },
          },
        ],
      },
    ],
    '2026-08-01T00:00:00.000Z',
  );

  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.seasonNumber, 1);
  assert.equal(snapshot.savedAt, '2026-08-01T00:00:00.000Z');
  assert.equal(snapshot.rounds[0].matches[0].match_date, '2026-07-14T19:30:00.000Z');
  assert.equal(snapshot.rounds[0].matches[0].home_team?.name, 'Historic Home Name');
  assert.equal(snapshot.rounds[0].matches[0].away_team?.manager_name, 'away-manager');
  assert.equal(snapshot.rounds[0].matches[0].total_minutes, 121);
});
