import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterTeamsForCategory,
  getCompatibleLeagueRestrictionOptions,
  validateTeamEligibility,
} from '../src/utils/team-eligibility';

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

test('numeric country limits match CHPP CountryID, not Hattrick LeagueID', () => {
  assert.deepEqual(filterTeamsForCategory([latviaTeam], 'male', { countryLimit: '48' }), [latviaTeam]);
  assert.equal(validateTeamEligibility(latviaTeam, { category: 'male', countryLimit: '48' }).eligible, true);
  assert.equal(validateTeamEligibility(latviaTeam, { category: 'male', countryLimit: '53' }).eligible, false);
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

test('restriction options only include values compatible with all registered teams', () => {
  const polandTeam = {
    ...latviaTeam,
    teamId: 123456,
    leagueId: 26,
    countryId: 23,
    countryName: 'Poland',
  };

  assert.deepEqual(getCompatibleLeagueRestrictionOptions([latviaTeam, polandTeam], 'male'), []);
  assert.deepEqual(
    getCompatibleLeagueRestrictionOptions([latviaTeam], 'male').find((option) => option.value === '48'),
    { value: '48', label: 'Latvia' },
  );
});

test('restriction options do not confuse neighboring league IDs with country IDs', () => {
  const finlandTeam = {
    ...latviaTeam,
    teamId: 255523,
    leagueId: 12,
    leagueName: 'Finland',
    countryId: 11,
    countryName: 'Finland',
  };

  const options = getCompatibleLeagueRestrictionOptions([finlandTeam], 'male');
  assert.deepEqual(options, [{ value: '11', label: 'Finland' }]);
  assert.equal(options.some((option) => option.label === 'Denmark'), false);
});

test('HFI restrictions use team countries and exclude countryless leagues', () => {
  const guamHfiTeam = {
    ...latviaTeam,
    teamId: 3220518,
    leagueId: 3000,
    leagueName: 'HFI',
    leagueSystemId: 2,
    genderId: 2,
    countryId: 179,
    countryName: 'Guam',
  };

  const hfiOptions = getCompatibleLeagueRestrictionOptions([guamHfiTeam], 'hfi');
  assert.deepEqual(hfiOptions, [{ value: '179', label: 'Guam' }]);
  assert.equal(getCompatibleLeagueRestrictionOptions([], 'male').some((option) => option.value === '3000'), false);
});
