import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HATTRICK_WORLD_DETAILS,
  getCountryIdByName,
  getCountryNameById,
  getLeagueIdByName,
  getLeagueNameById,
  normalizeLeagueLimit,
  resolveCountryRestriction,
} from '../shared/worlddetails';

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

test('country lookup uses CHPP CountryID instead of Hattrick LeagueID', () => {
  assert.equal(getLeagueNameById(11), 'Denmark');
  assert.equal(getCountryNameById(11), 'Finland');
  assert.equal(getCountryIdByName('Finland'), '11');
  assert.equal(normalizeLeagueLimit('Finland'), '11');
  assert.equal(normalizeLeagueLimit('11'), '11');
});

test('country restriction display handles current and legacy numeric formats', () => {
  assert.equal(resolveCountryRestriction('179')?.leagueName, 'Guam');
  assert.equal(resolveCountryRestriction('179')?.leagueId, 154);
  assert.equal(resolveCountryRestriction('53')?.leagueName, 'Latvia');
  assert.equal(resolveCountryRestriction('53')?.leagueId, 53);
});

test('every world-details country has flag metadata', () => {
  for (const entry of Object.values(HATTRICK_WORLD_DETAILS)) {
    assert.ok(entry.emoji, `missing emoji for league ${entry.leagueId}`);
    if (entry.countryId !== null && entry.countryId !== 13) {
      assert.ok(entry.isoCode, `missing ISO code for country ${entry.countryId}`);
    }
  }
});
