import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildManagerSpotlight,
  selectDailySpotlightParticipant,
} from '../src/utils/manager-spotlight.js';

const participants = [
  {
    id: 'team-a',
    ht_team_id: 101,
    name: 'Older Club',
    country_id: 4,
    country_name: 'Italy',
    manager_name: 'Renan',
    hattrick_user_id: 11,
  },
  {
    id: 'team-b',
    ht_team_id: 102,
    name: 'HFI Club',
    country_id: 191,
    country_name: 'San Marino',
    manager_name: 'Mika',
    hattrick_user_id: 12,
  },
];

test('daily participant selection is deterministic and cycles through the roster', () => {
  const first = selectDailySpotlightParticipant('tournament-1', participants, '2026-10-01');
  const sameDay = selectDailySpotlightParticipant('tournament-1', participants, '2026-10-01');
  const next = selectDailySpotlightParticipant('tournament-1', participants, '2026-10-02');

  assert.equal(first?.id, sameDay?.id);
  assert.notEqual(first?.id, next?.id);
});

test('spotlight story uses team founding dates and never account signup data', () => {
  const spotlight = buildManagerSpotlight({
    tournamentId: 'tournament-1',
    participants: participants.slice(0, 1),
    profiles: [
      {
        hattrick_user_id: 11,
        manager_name: 'Renan',
        country_id: 4,
        country_name: 'Italy',
        language_name: 'English',
        teams_json: [
          {
            teamId: 101,
            teamName: 'Older Club',
            isPrimaryClub: true,
            countryId: 4,
            countryName: 'Italy',
            leagueLevelUnitName: 'VI.12',
            foundedDate: '2013-01-15 10:00:00',
          },
          {
            teamId: 103,
            teamName: 'Newest Side',
            countryId: 191,
            countryName: 'San Marino',
            foundedDate: '2026-01-15 10:00:00',
          },
        ],
      },
    ],
    dateKey: '2026-10-01',
  });

  assert.ok(spotlight);
  assert.equal(spotlight?.language, 'English');
  assert.equal(spotlight?.oldestKnownClubDate, '2013-01-15 10:00:00');
  assert.match(spotlight?.story || '', /since at least 2013/);
  assert.doesNotMatch(spotlight?.story || '', /signup/i);
});
