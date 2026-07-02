import assert from 'node:assert/strict';
import test from 'node:test';

import { filterTeamsForCategory, validateTeamEligibility } from '../src/utils/team-eligibility';

const latviaTeam = {
  teamId: 681813,
  teamName: 'This bot team is a bot',
  leagueId: 53,
  leagueName: 'Latvia',
  leagueSystemId: 1,
  countryId: 48,
  countryName: 'Latvia',
  genderId: 1,
};

test('numeric league limits match Hattrick LeagueID before CHPP CountryID', () => {
  assert.deepEqual(filterTeamsForCategory([latviaTeam], 'male', { countryLimit: '53' }), [latviaTeam]);
  assert.equal(validateTeamEligibility(latviaTeam, { category: 'male', countryLimit: '53' }).eligible, true);
});

test('category filtering excludes HFI teams from regular tournaments', () => {
  const hfiTeam = {
    ...latviaTeam,
    teamId: 3220518,
    teamName: 'Guåhan Goddesses',
    leagueId: 3000,
    leagueName: 'Hattrick Femme International',
    leagueSystemId: 2,
    genderId: 2,
  };

  assert.deepEqual(filterTeamsForCategory([hfiTeam], 'male'), []);
  assert.equal(validateTeamEligibility(hfiTeam, { category: 'male' }).eligible, false);
});
