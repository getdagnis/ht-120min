import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildManagerSpotlight, getClubRankLabel, selectDailySpotlightParticipant,
  type ManagerSpotlightProfile, type ManagerSpotlightParticipant,
} from '../src/utils/manager-spotlight.js';
import { mergeManagerTeamSnapshot } from '../src/server/api/_lib/manager-compendium.js';
import { parseManagerTeamDetailsXml } from '../src/server/api/_lib/chpp-xml.js';

const dateKey = '2026-10-04';
const countries = {
  Latvia: 48, Germany: 3, Guam: 179, 'Costa Rica': 77, 'Puerto Rico': 190, Guyana: 197,
} as const;
type Country = keyof typeof countries;
const club = (teamId: number, teamName: string, country: Country, extra: Record<string, unknown> = {}) => ({
  teamId, teamName, countryId: countries[country], countryName: country,
  leagueId: countries[country], leagueLevelUnitName: 'IV.35', ...extra,
});
const participant = (teamId: number, teamName: string, country: Country, extra: Record<string, unknown> = {}) => ({
  id: `row-${teamId}`, ht_team_id: teamId, name: teamName,
  country_id: countries[country], country_name: country,
  hattrick_user_id: 9, manager_name: 'manager', ...extra,
});
const spotlight = (
  teams: Record<string, unknown>[],
  tournamentId = Number(teams[0].teamId),
  overrides: Partial<ManagerSpotlightProfile> = {},
  extraParticipants: ManagerSpotlightParticipant[] = [],
) => buildManagerSpotlight({
  tournamentId: 'cup',
  participants: [
    participant(tournamentId, String(teams.find((team) => team.teamId === tournamentId)?.teamName ?? 'Club'), 'Latvia'),
    ...extraParticipants,
  ],
  profiles: [{
    hattrick_user_id: 9, manager_name: 'manager', country_id: 48,
    country_name: 'Latvia', teams_json: teams, ...overrides,
  }],
  dateKey,
});

test('daily selection is deterministic and rotates through participants', () => {
  const rows = [participant(1, 'A', 'Latvia'), participant(2, 'B', 'Latvia')];
  assert.deepEqual(selectDailySpotlightParticipant('cup', rows, '2026-10-01'),
    selectDailySpotlightParticipant('cup', rows, '2026-10-01'));
  assert.notEqual(selectDailySpotlightParticipant('cup', rows, '2026-10-01')?.id,
    selectDailySpotlightParticipant('cup', rows, '2026-10-02')?.id);
});

test('old single club gets established wording, third person, and no signup claim', () => {
  const card = spotlight([club(1, 'FC Nachos', 'Latvia', {
    isPrimaryClub: true, regionName: 'Ogre', foundedDate: '2005-01-01',
  })], 1, { manager_name: 'procesors' });
  assert.match(card?.story ?? '', /^procesors is based in Ogre, Latvia 🇱🇻/);
  assert.match(card?.story ?? '', /long established.*2005/);
  assert.doesNotMatch(card?.story ?? '', /\byou\b|signup|Hattrick since/i);
});

test('recent single club and youth fallback', () => {
  const card = spotlight([club(1, 'Young Club', 'Latvia', {
    foundedDate: '2025-01-01', youthTeamName: 'Junior Club',
  })]);
  assert.match(card?.story ?? '', /relatively recent/);
  assert.match(card?.story ?? '', /youth side, Junior Club/);
});

test('multiple clubs in one country', () => {
  const card = spotlight([club(1, 'A', 'Latvia'), club(2, 'B', 'Latvia')]);
  assert.match(card?.story ?? '', /two clubs, all in Latvia 🇱🇻/);
});

test('multiple countries and every club in a different country', () => {
  const card = spotlight([
    club(1, 'FK Pirates', 'Latvia', { regionName: 'Rīga', isPrimaryClub: true }),
    club(2, 'Lemon Pirates', 'Costa Rica'),
    club(3, 'Island Club', 'Puerto Rico'),
    club(4, 'Homesick Pirates', 'Guyana'),
  ], 2);
  assert.match(card?.story ?? '', /four clubs across four countries/);
  for (const country of ['Latvia 🇱🇻', 'Costa Rica 🇨🇷', 'Puerto Rico 🇵🇷', 'Guyana 🇬🇾']) {
    assert.ok(card?.story.includes(country));
  }
});

test('one home club and two in the same foreign country', () => {
  const card = spotlight([
    club(1, 'Rapid Sendling', 'Germany', { isPrimaryClub: true, regionName: 'München' }),
    club(2, 'Kicker', 'Guam'), club(3, 'Amazons', 'Guam'),
  ], 3, { country_id: 3, country_name: 'Germany', manager_name: 'CCalm' });
  assert.match(card?.story ?? '', /Germany 🇩🇪 and Guam 🇬🇺/);
  assert.match(card?.story ?? '', /Guam 🇬🇺 is home to two/);
});

test('all clubs in one region use the regional structure', () => {
  const card = spotlight([
    club(1, 'A', 'Latvia', { regionName: 'Cēsis' }),
    club(2, 'B', 'Latvia', { regionName: 'Cēsis' }),
  ]);
  assert.match(card?.story ?? '', /all based in the Cēsis region/);
});

test('HFI team has special identity and no unproved TeamRank label', () => {
  const card = spotlight([
    club(1, 'A', 'Latvia'),
    club(2, 'Guåhan Goddesses', 'Guam', {
      leagueId: 3000, leagueLevelUnitName: 'VI.105', teamRank: 12, powerLeagueRank: 0,
    }),
  ], 2);
  assert.match(card?.story ?? '', /an HFI side in Guam 🇬🇺 currently playing in VI.105/);
  assert.equal(getClubRankLabel(card!.currentTeams.find((team) => team.teamId === 2)!), null);
  assert.doesNotMatch(card?.story ?? '', /#12|#0/);
});

test('Homegrown special club adds a higher priority story fact', () => {
  const card = spotlight([
    club(1, 'FK Pirates', 'Latvia'),
    club(2, 'Homesick Pirates', 'Guyana', { leagueId: 1003 }),
  ]);
  assert.match(card?.story ?? '', /Homesick Pirates adds a Homegrown League side in Guyana 🇬🇾/);
});

test('tournament participant is resolved by team ID, separately from primary club', () => {
  const card = spotlight([
    club(1, 'Primary', 'Latvia', { isPrimaryClub: true }),
    club(2, 'Tournament Club', 'Costa Rica', { powerLeagueRank: 13, leagueLevelUnitName: 'II.1' }),
  ], 2);
  assert.equal(card?.tournamentTeamId, 2);
  assert.match(card?.story ?? '', /participating in this tournament with Tournament Club, ranked #13 in Costa Rica 🇨🇷 and currently playing in II.1/);
});

test('zero and missing regular league rank are omitted', () => {
  for (const rank of [0, undefined]) {
    const card = spotlight([club(1, 'A', 'Latvia', { powerLeagueRank: rank })]);
    assert.doesNotMatch(card?.story ?? '', /ranked|#0/);
    assert.equal(getClubRankLabel(card!.currentTeams[0]), null);
  }
});

test('strongest other club appears when richer story facts are absent', () => {
  const card = spotlight([
    club(1, 'Tournament', 'Latvia', { powerLeagueRank: 50 }),
    club(2, 'Strongest', 'Latvia', { powerLeagueRank: 4 }),
  ]);
  assert.match(card?.story ?? '', /Strongest is highest ranked among/);
  assert.match(card?.story ?? '', /#4 in Latvia 🇱🇻/);
});

test('missing founding date, language, region and primary metadata remain factual', () => {
  const card = spotlight([club(1, 'A', 'Latvia')], 1, { language_name: null });
  assert.equal(card?.language, null);
  assert.equal(card?.location, 'Latvia 🇱🇻');
  assert.doesNotMatch(card?.story ?? '', /founded|history|undefined/);
});

test('location uses a current home-country club when primary metadata is missing', () => {
  const card = spotlight([
    club(1, 'Foreign', 'Guam', { regionName: 'Tamuning' }),
    club(2, 'Home', 'Latvia', { regionName: 'Rīga' }),
  ]);
  assert.equal(card?.location, 'Rīga, Latvia 🇱🇻');
});

test('all explicit country names in story carry their flags', () => {
  const card = spotlight([
    club(1, 'A', 'Latvia', { regionName: 'Rīga', isPrimaryClub: true }),
    club(2, 'B', 'Costa Rica', { powerLeagueRank: 13 }),
    club(3, 'C', 'Guam', { leagueId: 3000 }),
  ], 2);
  for (const [country, flag] of [['Latvia', '🇱🇻'], ['Costa Rica', '🇨🇷'], ['Guam', '🇬🇺']]) {
    assert.doesNotMatch(card?.story ?? '', new RegExp(`${country}(?! ${flag})`));
  }
});

test('teamdetails all-teams response parses each club by team ID', () => {
  const xml = '<HattrickData><Teams>' +
    '<Team><TeamID>1</TeamID><TeamName>A</TeamName><RegionName>Rīga</RegionName><FoundedDate>2005-01-01</FoundedDate><LeagueRanking>13</LeagueRanking></Team>' +
    '<Team><TeamID>2</TeamID><TeamName>B</TeamName><LeagueRanking>0</LeagueRanking></Team>' +
    '</Teams></HattrickData>';
  const teams = parseManagerTeamDetailsXml(xml);
  assert.deepEqual(teams.map((team) => team.teamId), [1, 2]);
  assert.equal(teams[0].foundedDate, '2005-01-01');
  assert.equal(teams[0].powerLeagueRank, 13);
});

test('regional branch distinguishes clubs in one country but different regions', () => {
  const card = spotlight([
    club(1, 'A', 'Latvia', { regionName: 'Rīga' }),
    club(2, 'B', 'Latvia', { regionName: 'Cēsis' }),
  ]);
  assert.match(card?.story ?? '', /two clubs, all in Latvia 🇱🇻/);
  assert.doesNotMatch(card?.story ?? '', /same region|Cēsis region/);
});

test('one home club and one foreign club describes country spread plainly', () => {
  const card = spotlight([
    club(1, 'Home', 'Germany', { isPrimaryClub: true, regionName: 'München' }),
    club(2, 'Away', 'Guam'),
  ], 1, { country_id: 3, country_name: 'Germany' });
  assert.match(card?.story ?? '', /two clubs across two countries: Germany 🇩🇪 and Guam 🇬🇺/);
});

test('missing manager country does not invent a country or region', () => {
  const card = spotlight([club(1, 'A', 'Latvia')], 1, { country_id: null, country_name: null });
  assert.equal(card?.location, 'an unlisted location');
  assert.match(card?.story ?? '', /based in an unlisted location/);
});

test('localized country names reuse canonical flag mapping', () => {
  const card = spotlight(
    [club(1, 'A', 'Latvia', { countryId: null, countryName: 'Latvija' })],
    1,
    { country_id: null, country_name: 'Latvija' },
  );
  assert.equal(card?.location, 'Latvia 🇱🇻');
  assert.match(card?.story ?? '', /Latvia 🇱🇻/);
});

test('localized home country still finds its region without CountryID', () => {
  const card = spotlight(
    [club(1, 'A', 'Latvia', { countryId: null, countryName: 'Latvija', regionName: 'Rīga' })],
    1,
    { country_id: null, country_name: 'Latvija' },
  );
  assert.equal(card?.location, 'Rīga, Latvia 🇱🇻');
});

test('missing language stays absent from identity and prose', () => {
  const card = spotlight([club(1, 'A', 'Latvia')], 1, { language_name: null });
  assert.equal(card?.language, null);
  assert.doesNotMatch(card?.story ?? '', /language/i);
});

test('fourteen and fifteen year history wording follows the age thresholds', () => {
  const atFourteen = spotlight([
    club(1, 'A', 'Latvia', { foundedDate: '2012-01-01' }),
    club(2, 'B', 'Latvia', { foundedDate: '2019-01-01' }),
  ]);
  const atFifteen = spotlight([
    club(1, 'A', 'Latvia', { foundedDate: '2011-01-01' }),
    club(2, 'B', 'Latvia', { foundedDate: '2019-01-01' }),
  ]);
  assert.match(atFourteen?.story ?? '', /history goes back to 2012/);
  assert.match(atFifteen?.story ?? '', /stretches back to 2011/);
});

test('a strongest club is not compared across different country scopes', () => {
  const card = spotlight([
    club(1, 'Tournament', 'Latvia', { powerLeagueRank: 50 }),
    club(2, 'Other', 'Costa Rica', { powerLeagueRank: 4 }),
  ]);
  assert.doesNotMatch(card?.story ?? '', /lowest country league rank/);
});

test('snapshot enrichment merges managercompendium and teamdetails by ID while retaining cached stable fields', () => {
  const merged = mergeManagerTeamSnapshot(
    [{ teamId: 1, teamName: 'Current Name', isPrimaryClub: true }],
    [{
      teamId: 1, foundedDate: '2005-01-01', regionName: 'Ogre',
      powerLeagueRank: 7, youthTeamName: 'Youth',
    }],
    [{ teamId: 1, teamName: 'Old Name', countryName: 'Latvia', countryId: 48, leagueLevelUnitName: 'IV.35' },
      { teamId: 2, teamName: 'Former Club' }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].teamName, 'Current Name');
  assert.equal(merged[0].isPrimaryClub, true);
  assert.equal(merged[0].countryName, 'Latvia');
  assert.equal(merged[0].regionName, 'Ogre');
  assert.equal(merged[0].foundedDate, '2005-01-01');
  assert.equal(merged[0].powerLeagueRank, 7);
  assert.equal(merged[0].youthTeamName, 'Youth');
});
