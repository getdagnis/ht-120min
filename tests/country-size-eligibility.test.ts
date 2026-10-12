import test from 'node:test';
import assert from 'node:assert/strict';
import { getCountryActiveTeamCount } from '../shared/country-active-team-counts';
import { managerHasQualifyingCountryParticipant, validateCountrySizeEligibility } from '../shared/country-size-eligibility';
import { HATTRICK_WORLD_DETAILS } from '../shared/worlddetails';

test('country snapshot includes the inclusive 420-team boundary set through Japan', () => {
  const japanCountryId = HATTRICK_WORLD_DETAILS[22]!.countryId!;
  assert.equal(getCountryActiveTeamCount(japanCountryId), 407);
  assert.equal(validateCountrySizeEligibility({
    countryId: japanCountryId,
    maximumActiveTeams: 420,
    allowManagerException: false,
    hasQualifyingParticipant: false,
  }).eligible, true);
});

test('unknown country data fails closed and qualifying participant exception is explicit', () => {
  const unknown = validateCountrySizeEligibility({
    countryId: 999999,
    maximumActiveTeams: 420,
    allowManagerException: false,
    hasQualifyingParticipant: false,
  });
  assert.equal(unknown.eligible, false);
  if (!unknown.eligible) assert.match(unknown.reason, /could not be verified/);

  assert.deepEqual(validateCountrySizeEligibility({
    countryId: 999999,
    maximumActiveTeams: 420,
    allowManagerException: true,
    hasQualifyingParticipant: true,
  }), { eligible: true });
});

test('an available known country above the configured threshold is rejected', () => {
  const indonesiaCountryId = HATTRICK_WORLD_DETAILS[54]!.countryId!;
  assert.equal(getCountryActiveTeamCount(indonesiaCountryId), 510);
  const result = validateCountrySizeEligibility({
    countryId: indonesiaCountryId,
    maximumActiveTeams: 420,
    allowManagerException: false,
    hasQualifyingParticipant: false,
  });
  assert.equal(result.eligible, false);
  if (!result.eligible) assert.match(result.reason, /510/);
});

test('only an admitted qualifying participant unlocks a manager exception', () => {
  const managerId = 123;
  const japanCountryId = HATTRICK_WORLD_DETAILS[22]!.countryId!;
  assert.equal(managerHasQualifyingCountryParticipant([
    { hattrick_user_id: managerId, country_id: japanCountryId, active: false, reserve_active: true },
    { hattrick_user_id: managerId, country_id: japanCountryId, active: true, reserve_active: false, is_placeholder: true },
    { hattrick_user_id: managerId, country_id: japanCountryId, active: true, reserve_active: false },
  ], managerId, 420), true);
  assert.equal(managerHasQualifyingCountryParticipant([
    { hattrick_user_id: managerId, country_id: japanCountryId, active: false, reserve_active: true },
  ], managerId, 420), false);
});
