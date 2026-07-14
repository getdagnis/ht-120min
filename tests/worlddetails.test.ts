import assert from 'node:assert/strict';
import test from 'node:test';
import { HATTRICK_WORLD_DETAILS, getLeagueIdByName, getLeagueNameById } from '../shared/worlddetails';

test('world details expose one English short name and a full name', () => {
  const hfi = HATTRICK_WORLD_DETAILS[3000];
  assert.equal(hfi.leagueName, 'HFI');
  assert.equal(hfi.fullName, 'Hattrick Femme International');
  assert.equal(hfi.emoji, '💃🏻');

  const latvia = HATTRICK_WORLD_DETAILS[53];
  assert.equal(latvia.leagueName, 'Latvia');
  assert.equal(latvia.fullName, 'Latvia');
  assert.equal(latvia.countryName, 'Latvija');
  assert.equal(latvia.isoCode, 'LV');
  assert.equal(latvia.emoji, '🇱🇻');
});

test('league lookup accepts both short and full names', () => {
  assert.equal(getLeagueIdByName('HFI'), '3000');
  assert.equal(getLeagueIdByName('Hattrick Femme International'), '3000');
  assert.equal(getLeagueNameById(3000), 'HFI');
});

test('every world-details country has flag metadata', () => {
  for (const entry of Object.values(HATTRICK_WORLD_DETAILS)) {
    assert.ok(entry.emoji, `missing emoji for league ${entry.leagueId}`);
    if (entry.countryId !== null && entry.countryId !== 13) {
      assert.ok(entry.isoCode, `missing ISO code for country ${entry.countryId}`);
    }
  }
});
