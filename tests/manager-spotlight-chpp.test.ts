import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseManagerNationalTeamRolesXml,
  parseManagerTeamDetailsXml,
} from '../src/server/api/_lib/chpp-xml.js';
import { mergeManagerTeamSnapshot } from '../src/server/api/_lib/manager-compendium.js';

const xml = `<?xml version="1.0"?>
<HattrickData><User><UserID>42</UserID><NationalTeams>
  <NationalTeam><NationalTeamStaffType>0</NationalTeamStaffType><NationalTeamID>154</NationalTeamID><NationalTeamName>Guam</NationalTeamName></NationalTeam>
  <NationalTeam><NationalTeamStaffType>1</NationalTeamStaffType><NationalTeamID>172</NationalTeamID><NationalTeamName>U21 Bahamas</NationalTeamName></NationalTeam>
  <NationalTeam><NationalTeamStaffType>8</NationalTeamStaffType><NationalTeamID>1</NationalTeamID><NationalTeamName>Unknown</NationalTeamName></NationalTeam>
</NationalTeams></User><Teams><Team>
  <TeamID>10</TeamID><TeamName>Primary club</TeamName><IsPrimaryClub>True</IsPrimaryClub><FoundedDate>2004-01-02 00:00:00</FoundedDate>
  <LeagueSystemID>1</LeagueSystemID><League><LeagueID>154</LeagueID><LeagueName>Guam</LeagueName></League>
  <Country><CountryID>179</CountryID><CountryName>Guam</CountryName></Country><Region><RegionID>9</RegionID><RegionName>Hagåtña</RegionName></Region>
  <LeagueLevelUnit><LeagueLevelUnitID>100</LeagueLevelUnitID><LeagueLevelUnitName>IV.1</LeagueLevelUnitName><LeagueLevel>4</LeagueLevel></LeagueLevelUnit>
  <TeamRank>12</TeamRank><PowerRating><PowerRating>888</PowerRating><GlobalRanking>40</GlobalRanking><LeagueRanking>7</LeagueRanking><RegionRanking>2</RegionRanking></PowerRating>
  <Arena><ArenaID>3</ArenaID><ArenaName>Primary Arena</ArenaName></Arena><Fanclub><FanclubSize>12345</FanclubSize></Fanclub>
  <YouthTeamName>Youth Club</YouthTeamName><LogoURL>https://res.hattrick.org/teamlogo/example.png</LogoURL>
  <TrophyList>
    <Trophy><TrophyTypeId>16</TrophyTypeId><TrophySeason>88</TrophySeason><CupLeagueLevel>0</CupLeagueLevel><CupLevel>1</CupLevel><CupLevelIndex>1</CupLevelIndex><GainedDate>2024-04-01 00:00:00</GainedDate></Trophy>
    <Trophy><TrophyTypeId>91</TrophyTypeId><TrophySeason>84</TrophySeason><CupLeagueLevel></CupLeagueLevel><CupLevel></CupLevel></Trophy>
  </TrophyList>
</Team><Team><TeamID>11</TeamID><TeamName>Secondary</TeamName></Team></Teams></HattrickData>`;

test('manager-wide teamdetails parser captures roles, U21 and all owned teams', () => {
  const roles = parseManagerNationalTeamRolesXml(xml);
  assert.deepEqual(roles, [
    { staffType: 0, nationalTeamId: 154, nationalTeamName: 'Guam', isU21: false },
    { staffType: 1, nationalTeamId: 172, nationalTeamName: 'U21 Bahamas', isU21: true },
  ]);
  const teams = parseManagerTeamDetailsXml(xml);
  assert.deepEqual(teams.map((team) => team.teamId), [10, 11]);
  assert.equal(teams[0]?.isPrimaryClub, true);
  assert.equal(teams[0]?.teamRank, 12);
  assert.equal(teams[0]?.powerLeagueRank, 7);
  assert.equal(teams[0]?.regionName, 'Hagåtña');
  assert.equal(teams[0]?.arenaName, 'Primary Arena');
  assert.equal(teams[0]?.fanclubSize, 12345);
  assert.equal(teams[0]?.youthTeamName, 'Youth Club');
  assert.deepEqual(teams[0]?.trophies?.map((trophy) => [trophy.typeId, trophy.kind]), [[16, 'national_cup'], [91, 'masters']]);
});

test('profile team snapshot merges managercompendium and details by teamId without changing array ownership', () => {
  const teams = mergeManagerTeamSnapshot(
    [{ teamId: 10, teamName: 'Primary club' }, { teamId: 11, teamName: 'Secondary' }],
    parseManagerTeamDetailsXml(xml),
    [{ teamId: 10, teamName: 'Old name', activeTournament: { name: 'Old cup', slug: 'old-cup' } }],
  );
  assert.equal(teams.length, 2);
  assert.deepEqual(teams.map((team) => team.teamId), [10, 11]);
  assert.equal(teams[0]?.isPrimaryClub, true);
  assert.equal(teams[0]?.teamRank, 12);
  assert.equal(teams[0]?.powerLeagueRank, 7);
  assert.equal(teams[0]?.activeTournament?.slug, 'old-cup');
  assert.equal(teams[1]?.teamRank, undefined);
});
