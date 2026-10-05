import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseManagerNationalTeamRolesXml,
  parseManagerTeamDetailsXml,
  parseTeamDetailsXml,
} from '../src/server/api/_lib/chpp-xml.js';
import { getEligibleSpotlightManagerIds, getSpotlightRefreshLimitError, MAX_SPOTLIGHT_REFRESH_CHPP_CALLS, MAX_SPOTLIGHT_REFRESH_MANAGERS, mergeManagerTeamSnapshot } from '../src/server/api/_lib/manager-compendium.js';

const xml = `<?xml version="1.0"?>
<HattrickData><User><UserID>42</UserID><NationalTeams>
  <NationalTeam><NationalTeamStaffType>0</NationalTeamStaffType><NationalTeamID>154</NationalTeamID><NationalTeamName>Guam</NationalTeamName></NationalTeam>
  <NationalTeam><NationalTeamStaffType>1</NationalTeamStaffType><NationalTeamID>172</NationalTeamID><NationalTeamName>U21 Bahamas</NationalTeamName></NationalTeam>
  <NationalTeam><NationalTeamStaffType>8</NationalTeamStaffType><NationalTeamID>1</NationalTeamID><NationalTeamName>Unknown</NationalTeamName></NationalTeam>
</NationalTeams></User><Teams><Team>
  <TeamID>10</TeamID><TeamName>Primary club</TeamName><IsPrimaryClub>True</IsPrimaryClub><GenderID>2</GenderID><FoundedDate>2004-01-02 00:00:00</FoundedDate>
  <LeagueSystemID>1</LeagueSystemID><League><LeagueID>154</LeagueID><LeagueName>Guam</LeagueName></League>
  <Country><CountryID>179</CountryID><CountryName>Guam</CountryName></Country><Region><RegionID>9</RegionID><RegionName>Hagåtña</RegionName></Region>
  <LeagueLevelUnit><LeagueLevelUnitID>100</LeagueLevelUnitID><LeagueLevelUnitName>IV.1</LeagueLevelUnitName><LeagueLevel>4</LeagueLevel></LeagueLevelUnit>
  <TeamRank>12</TeamRank><NumberOfVictories>4</NumberOfVictories><PowerRating><PowerRating>888</PowerRating><GlobalRanking>40</GlobalRanking><LeagueRanking>7</LeagueRanking><RegionRanking>2</RegionRanking></PowerRating>
  <Flags><HomeFlags><Flag><LeagueID>154</LeagueID></Flag><Flag><LeagueID>4</LeagueID></Flag><Flag><LeagueID>154</LeagueID></Flag><Flag><LeagueID>0</LeagueID></Flag><Flag><LeagueID>bad</LeagueID></Flag></HomeFlags>
    <AwayFlags><Flag><LeagueID>174</LeagueID></Flag><Flag><LeagueID>3</LeagueID></Flag><Flag><LeagueID>3</LeagueID></Flag></AwayFlags></Flags>
  <Arena><ArenaID>3</ArenaID><ArenaName>Primary Arena</ArenaName></Arena><Fanclub><FanclubSize>12345</FanclubSize></Fanclub>
  <YouthTeamName>Youth Club</YouthTeamName><LogoURL>https://res.hattrick.org/teamlogo/example.png</LogoURL>
  <TrophyList>
    <Trophy><TrophyTypeId>16</TrophyTypeId><TrophySeason>88</TrophySeason><CupLeagueLevel>0</CupLeagueLevel><CupLevel>1</CupLevel><CupLevelIndex>1</CupLevelIndex><GainedDate>2024-04-01 00:00:00</GainedDate></Trophy>
    <Trophy><TrophyTypeId>91</TrophyTypeId><TrophySeason>84</TrophySeason><CupLeagueLevel></CupLeagueLevel><CupLevel></CupLevel></Trophy>
  </TrophyList>
</Team><Team><TeamID>11</TeamID><TeamName>Secondary</TeamName><NumberOfVictories></NumberOfVictories></Team></Teams></HattrickData>`;

test('manager-wide teamdetails parser captures roles, U21 and all owned teams', () => {
  const roles = parseManagerNationalTeamRolesXml(xml);
  assert.deepEqual(roles, [
    { staffType: 0, nationalTeamId: 154, nationalTeamName: 'Guam', isU21: false },
    { staffType: 1, nationalTeamId: 172, nationalTeamName: 'U21 Bahamas', isU21: true },
  ]);
  const teams = parseManagerTeamDetailsXml(xml);
  assert.deepEqual(teams.map((team) => team.teamId), [10, 11]);
  assert.equal(teams[0]?.isPrimaryClub, true);
  assert.equal(teams[0]?.teamName, 'Primary club');
  assert.equal(teams[0]?.genderId, 2);
  assert.equal(teams[0]?.leagueId, 154);
  assert.equal(teams[0]?.leagueSystemId, 1);
  assert.equal(teams[0]?.countryId, 179);
  assert.equal(teams[0]?.countryName, 'Guam');
  assert.equal(teams[0]?.regionId, 9);
  assert.equal(teams[0]?.foundedDate, '2004-01-02 00:00:00');
  assert.equal(teams[0]?.leagueLevel, 4);
  assert.equal(teams[0]?.leagueLevelUnitId, 100);
  assert.equal(teams[0]?.leagueLevelUnitName, 'IV.1');
  assert.equal(teams[0]?.teamRank, 12);
  assert.equal(teams[0]?.numberOfVictories, 4);
  assert.deepEqual(teams[0]?.homeFlagLeagueIds, [4, 154]);
  assert.deepEqual(teams[0]?.awayFlagLeagueIds, [3, 174]);
  assert.equal(teams[0]?.powerLeagueRank, 7);
  assert.equal(teams[0]?.regionName, 'Hagåtña');
  assert.equal(teams[0]?.arenaName, 'Primary Arena');
  assert.equal(teams[0]?.fanclubSize, 12345);
  assert.equal(teams[0]?.youthTeamName, 'Youth Club');
  assert.equal(teams[0]?.arenaId, 3);
  assert.equal(teams[0]?.logoUrl, 'https://res.hattrick.org/teamlogo/example.png');
  assert.deepEqual(teams[0]?.trophies?.map((trophy) => [trophy.typeId, trophy.kind]), [[16, 'national_cup'], [91, 'masters']]);
  assert.equal(teams[1]?.numberOfVictories, null);
  assert.deepEqual(teams[1]?.homeFlagLeagueIds, []);
  assert.deepEqual(teams[1]?.awayFlagLeagueIds, []);
});

test('profile team snapshot merges managercompendium and details by teamId without changing array ownership', () => {
  const teams = mergeManagerTeamSnapshot(
    [{ teamId: 10, teamName: 'Primary club' }, { teamId: 11, teamName: 'Secondary' }],
    parseManagerTeamDetailsXml(xml),
    [
      { teamId: 10, teamName: 'Old name', activeTournament: { name: 'Old cup', slug: 'old-cup' } },
      { teamId: 11, teamName: 'Secondary', numberOfVictories: 8, homeFlagLeagueIds: [1], awayFlagLeagueIds: [2] },
    ],
  );
  assert.equal(teams.length, 2);
  assert.deepEqual(teams.map((team) => team.teamId), [10, 11]);
  assert.equal(teams[0]?.isPrimaryClub, true);
  assert.equal(teams[0]?.teamRank, 12);
  assert.equal(teams[0]?.numberOfVictories, 4);
  assert.deepEqual(teams[0]?.homeFlagLeagueIds, [4, 154]);
  assert.deepEqual(teams[0]?.awayFlagLeagueIds, [3, 174]);
  assert.equal(teams[0]?.genderId, 2);
  assert.equal(teams[0]?.powerRating, 888);
  assert.equal(teams[0]?.powerGlobalRank, 40);
  assert.equal(teams[0]?.powerLeagueRank, 7);
  assert.equal(teams[0]?.powerRegionRank, 2);
  assert.deepEqual(teams[0]?.trophies?.map((trophy) => trophy.kind), ['national_cup', 'masters']);
  assert.equal(teams[0]?.foundedDate, '2004-01-02 00:00:00');
  assert.equal(teams[0]?.arenaName, 'Primary Arena');
  assert.equal(teams[0]?.fanclubSize, 12345);
  assert.equal(teams[0]?.youthTeamName, 'Youth Club');
  assert.equal(teams[0]?.leagueLevelUnitName, 'IV.1');
  assert.equal(teams[0]?.activeTournament?.slug, 'old-cup');
  assert.equal(teams[1]?.teamRank, undefined);
  assert.equal(teams[1]?.numberOfVictories, null);
  assert.deepEqual(teams[1]?.homeFlagLeagueIds, []);
  assert.deepEqual(teams[1]?.awayFlagLeagueIds, []);
});

test('missing or zero winning streak and missing flags replace stale snapshot values', () => {
  for (const value of ['', '<NumberOfVictories>0</NumberOfVictories>']) {
    const detail = parseTeamDetailsXml(`<Team><TeamID>12</TeamID><TeamName>Club</TeamName>${value}</Team>`, 12);
    assert.equal(detail.numberOfVictories, null);
    assert.deepEqual(detail.homeFlagLeagueIds, []);
    assert.deepEqual(detail.awayFlagLeagueIds, []);
    const merged = mergeManagerTeamSnapshot([{ teamId: 12, teamName: 'Club' }], [detail], [
      { teamId: 12, teamName: 'Club', numberOfVictories: 5, homeFlagLeagueIds: [3], awayFlagLeagueIds: [4] },
    ]);
    assert.equal(merged[0]?.numberOfVictories, null);
    assert.deepEqual(merged[0]?.homeFlagLeagueIds, []);
    assert.deepEqual(merged[0]?.awayFlagLeagueIds, []);
  }
});

test('manual refresh scope deduplicates eligible managers and budget validator rejects over 25', () => {
  const participants = Array.from({ length: 26 }, (_, index) => ({
    hattrick_user_id: index + 1, active: true, reserve_active: false, is_placeholder: false,
  }));
  participants.push({ hattrick_user_id: 1, active: true, reserve_active: false, is_placeholder: false });
  participants.push({ hattrick_user_id: 98, active: false, reserve_active: false, is_placeholder: false });
  participants.push({ hattrick_user_id: 99, active: true, reserve_active: true, is_placeholder: false });
  participants.push({ hattrick_user_id: 100, active: true, reserve_active: false, is_placeholder: true });
  participants.push({ hattrick_user_id: 0, active: true, reserve_active: false, is_placeholder: false });
  const ids = getEligibleSpotlightManagerIds(participants);
  assert.equal(ids.length, 26);
  assert.deepEqual(ids.slice(0, 3), [1, 2, 3]);
  assert.equal(MAX_SPOTLIGHT_REFRESH_MANAGERS, 25);
  assert.equal(MAX_SPOTLIGHT_REFRESH_CHPP_CALLS, 50);
  assert.match(getSpotlightRefreshLimitError(ids.length) ?? '', /26 eligible managers.*25-manager \/ 50-CHPP-call limit/);
  assert.equal(getSpotlightRefreshLimitError(25), null);
});
