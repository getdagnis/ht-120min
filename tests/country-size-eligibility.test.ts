import test from 'node:test';
import assert from 'node:assert/strict';
import { getCountryActiveTeamCount } from '../shared/country-active-team-counts';
import { managerHasQualifyingCountryParticipant, managerCountrySizeAllowance, validateCountrySizeEligibility } from '../shared/country-size-eligibility';
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

const smallCountry = HATTRICK_WORLD_DETAILS[22]!.countryId!;
const largeCountry = HATTRICK_WORLD_DETAILS[54]!.countryId!;
const entry = (country_id: number, waiting = false, manager = 123) => ({
  country_id, hattrick_user_id: manager, active: !waiting, reserve_active: waiting,
});

test('one small entry unlocks exactly one larger entry; another manager cannot unlock it', () => {
  assert.deepEqual(managerCountrySizeAllowance([], 123, 420), { active: 0, waiting: 0 });
  assert.deepEqual(managerCountrySizeAllowance([entry(smallCountry)], 123, 420), { active: 1, waiting: 1 });
  assert.deepEqual(managerCountrySizeAllowance([entry(smallCountry), entry(largeCountry)], 123, 420), { active: 0, waiting: 0 });
  assert.deepEqual(managerCountrySizeAllowance([entry(smallCountry, false, 456)], 123, 420), { active: 0, waiting: 0 });
});

test('waiting small teams unlock waiting entries only and consume the shared allowance', () => {
  assert.deepEqual(managerCountrySizeAllowance([entry(smallCountry, true)], 123, 420), { active: 0, waiting: 1 });
  assert.deepEqual(managerCountrySizeAllowance([entry(smallCountry, true), entry(largeCountry, true)], 123, 420), { active: 0, waiting: 0 });
  assert.deepEqual(managerCountrySizeAllowance([entry(smallCountry), entry(largeCountry, true)], 123, 420), { active: 0, waiting: 0 });
});

test('departures and placeholders do not unlock entries; two small entries unlock two larger entries', () => {
  const rows = [entry(smallCountry), entry(smallCountry), entry(largeCountry),
    { ...entry(smallCountry), active: false }, { ...entry(smallCountry), is_placeholder: true }];
  assert.deepEqual(managerCountrySizeAllowance(rows, 123, 420), { active: 1, waiting: 1 });
  assert.deepEqual(managerCountrySizeAllowance([entry(largeCountry)], 123, 420), { active: -1, waiting: -1 });
});

test('unknown-country entries consume allowance and vacant rows do not unlock it', () => {
  assert.deepEqual(managerCountrySizeAllowance([entry(smallCountry), entry(999999, true)], 123, 420), { active: 0, waiting: 0 });
  assert.deepEqual(managerCountrySizeAllowance([{ ...entry(smallCountry), ht_team_id: null }], 123, 420), { active: 0, waiting: 0 });
});

test('promotion requires active allowance but does not recheck grandfathered waiting surplus', () => {
  const rows = [entry(smallCountry), entry(largeCountry, true), entry(largeCountry, true)];
  assert.equal(managerCountrySizeAllowance(rows, 123, 420).active, -1);
  assert.equal(managerCountrySizeAllowance(rows, 123, 420, true).active, 1);
});
