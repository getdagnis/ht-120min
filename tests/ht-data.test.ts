import assert from 'node:assert/strict';
import test from 'node:test';

import { getCanonicalCountryName, getFlagUrl, getFriendlyTimeForCountry, getLeagueFlagUrl } from '../src/utils/ht-data';
import { parseTeamDetailsXml as parseApiTeamDetailsXml, teamDetailsKitForMatchSide } from '../src/server/api/_lib/chpp-xml';
import { fetchFixtureHomeAwayKits } from '../src/server/api/_lib/chpp-fixture-kits';
import { parseTeamDetailsXml as parseClientTeamDetailsXml } from '../src/utils/chpp-xml';
import { toLargeMatchKitUrl } from '../shared/match-kits';

test('stored kits use the large asset', () => {
  assert.equal(
    toLargeMatchKitUrl('https://res.hattrick.org/kits/1/1/1/6/matchKitSmall.png'),
    'https://res.hattrick.org/kits/1/1/1/6/matchKitLarge.png',
  );
  assert.equal(
    toLargeMatchKitUrl('https://res.hattrick.org/kits/34/335/3350/3349446/matchKitSmall.png'),
    'https://res.hattrick.org/kits/34/335/3350/3349446/matchKitLarge.png',
  );
});

test('TeamDetails exposes a current kit URL separately from its logo fallback', () => {
  const xml = `<TeamDetails><Team><TeamID>11</TeamID><LogoURL>https://res.hattrick.org/teamlogo/11.jpg</LogoURL><DressURI>//res.hattrick.org/kits/34/335/3350/3349446/matchKitSmall.png</DressURI><DressAlternateURI>//res.hattrick.org/kits/34/335/3350/3349447/matchKitSmall.png</DressAlternateURI></Team></TeamDetails>`;
  const details = parseApiTeamDetailsXml(xml, 11);
  assert.equal(details.logoUrl, 'https://res.hattrick.org/teamlogo/11.jpg');
  assert.equal(details.matchKitUrl, 'https://res.hattrick.org/kits/34/335/3350/3349446/matchKitLarge.png');
  assert.equal(details.alternateMatchKitUrl, 'https://res.hattrick.org/kits/34/335/3350/3349447/matchKitLarge.png');
  assert.equal(teamDetailsKitForMatchSide(details, 11, 22), details.matchKitUrl);
  assert.equal(teamDetailsKitForMatchSide(details, 22, 11), details.alternateMatchKitUrl);
  assert.equal(teamDetailsKitForMatchSide(details, 22, 33), null);
  const noKits = parseApiTeamDetailsXml('<Team><TeamID>11</TeamID></Team>', 11);
  assert.equal(noKits.matchKitUrl, undefined);
  assert.equal(teamDetailsKitForMatchSide(noKits, 22, 11), null);
});

test('finished fixture kits use TeamDetails home and away dresses across a venue reversal', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const teamId = new URL(String(input)).searchParams.get('teamID');
    return new Response(`<HattrickData><Team><TeamID>${teamId}</TeamID><DressURI>//res.hattrick.org/kits/${teamId}/matchKitSmall.png</DressURI><DressAlternateURI>//res.hattrick.org/kits/${teamId}-away/matchKitSmall.png</DressAlternateURI></Team></HattrickData>`);
  };
  try {
    assert.deepEqual(await fetchFixtureHomeAwayKits({
      consumerKey: 'key',
      consumerSecret: 'secret',
      credentials: { oauth_token: 'token', oauth_token_secret: 'token-secret' },
      actualHomeTeamId: 22,
      actualAwayTeamId: 11,
      homeTeamIds: [11],
      awayTeamIds: [22],
    }), {
      home_match_kit_url: 'https://res.hattrick.org/kits/11-away/matchKitLarge.png',
      away_match_kit_url: 'https://res.hattrick.org/kits/22/matchKitLarge.png',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Latvia display is canonicalized from localized CHPP country values', () => {
  assert.equal(getCanonicalCountryName('Lettonia', 48), 'Latvia');
  assert.equal(getCanonicalCountryName('Latvija', 48), 'Latvia');
  assert.equal(getCanonicalCountryName('Lettonia'), 'Latvia');
});

test('Latvia flag resolves from either CHPP CountryID or localized country name', () => {
  assert.equal(getFlagUrl('Lettonia', 48), 'https://flagcdn.com/lv.svg');
  assert.equal(getFlagUrl('Latvija'), 'https://flagcdn.com/lv.svg');
  assert.equal(getFlagUrl(undefined, 48), 'https://flagcdn.com/lv.svg');
});

test('country flags resolve from CountryID even when CHPP returns localized names', () => {
  assert.equal(getFlagUrl('Croazia', 42), 'https://flagcdn.com/hr.svg');
  assert.equal(getFlagUrl('Polonia', 26), 'https://flagcdn.com/pl.svg');
  assert.equal(getFlagUrl('Repubblica Ceca', 46), 'https://flagcdn.com/cz.svg');
  assert.equal(getFlagUrl('Cuba', 93), 'https://flagcdn.com/cu.svg');
});

test('Guam country ID resolves to its FlagCDN ISO asset', () => {
  assert.equal(getFlagUrl('Guam', 179), 'https://flagcdn.com/gu.svg');
});

test('only countryless leagues render an additional Hattrick league flag', () => {
  assert.equal(getLeagueFlagUrl(3000), 'https://www.hattrick.org/Img/flags/3000.png');
  assert.equal(getLeagueFlagUrl(1000), 'https://www.hattrick.org/Img/flags/1000.png');
  assert.equal(getLeagueFlagUrl(58), null);
});

test('localized Latvia names still use Latvia kickoff metadata', () => {
  assert.deepEqual(getFriendlyTimeForCountry('Lettonia'), { day: 3, time: '13:45' });
});

test('teamdetails parser keeps CHPP CountryID but canonicalizes Latvia display name', () => {
  const parsed = parseApiTeamDetailsXml(
    `
      <HattrickData>
        <Teams>
          <Team>
            <TeamID>681813</TeamID>
            <TeamName>This bot team is a bot</TeamName>
            <Cup><StillInCup>True</StillInCup></Cup>
            <GenderID>1</GenderID>
            <LeagueSystemID>1</LeagueSystemID>
            <League>
              <LeagueID>53</LeagueID>
              <LeagueName>Lettonia</LeagueName>
            </League>
            <Country>
              <CountryID>48</CountryID>
              <CountryName>Lettonia</CountryName>
            </Country>
            <FoundedDate>2026-03-16 11:32:00</FoundedDate>
            <Region>
              <RegionID>1956</RegionID>
              <RegionName>Talsi</RegionName>
            </Region>
            <LeagueLevelUnit>
              <LeagueLevelUnitID>14183</LeagueLevelUnitID>
              <LeagueLevelUnitName>IV.35</LeagueLevelUnitName>
              <LeagueLevel>4</LeagueLevel>
            </LeagueLevelUnit>
            <PowerRating>
              <GlobalRanking>30136</GlobalRanking>
              <LeagueRanking>222</LeagueRanking>
              <RegionRanking>9</RegionRanking>
              <PowerRating>967</PowerRating>
            </PowerRating>
            <TeamRank>4</TeamRank>
          </Team>
        </Teams>
      </HattrickData>
    `,
    681813,
  );

  assert.equal(parsed.countryId, 48);
  assert.equal(parsed.countryName, 'Latvia');
  assert.equal(parsed.leagueId, 53);
  assert.equal(parsed.genderId, 1);
  assert.equal(parsed.leagueLevel, 4);
  assert.equal(parsed.leagueLevelUnitId, 14183);
  assert.equal(parsed.leagueLevelUnitName, 'IV.35');
  assert.equal(parsed.regionId, 1956);
  assert.equal(parsed.regionName, 'Talsi');
  assert.equal(parsed.foundedDate, '2026-03-16 11:32:00');
  assert.equal(parsed.teamRank, 4);
  assert.equal(parsed.powerRating, 967);
  assert.equal(parsed.powerGlobalRank, 30136);
  assert.equal(parsed.powerLeagueRank, 222);
  assert.equal(parsed.powerRegionRank, 9);
  assert.equal(parsed.stillInCup, true);
  assert.equal(parseClientTeamDetailsXml(
    `
      <HattrickData>
        <Teams><Team><TeamID>681813</TeamID><Cup><StillInCup>True</StillInCup></Cup></Team></Teams>
      </HattrickData>
    `,
    681813,
  ).stillInCup, true);
});

test('teamdetails parser uses CountryID from worlddetails as canonical country name over localized XML text', () => {
  const xml = `
    <HattrickData>
      <Teams>
        <Team>
          <TeamID>123456</TeamID>
          <TeamName>Localized Country FC</TeamName>
          <League>
            <LeagueID>12</LeagueID>
            <LeagueName>Finlandia</LeagueName>
          </League>
          <Country>
            <CountryID>11</CountryID>
            <CountryName>Finlandia</CountryName>
          </Country>
        </Team>
      </Teams>
    </HattrickData>
  `;

  assert.equal(parseApiTeamDetailsXml(xml, 123456).countryName, 'Finland');
  assert.equal(parseClientTeamDetailsXml(xml, 123456).countryName, 'Finland');
});

test('teamdetails parsers decode XML entities in team names', () => {
  const xml = `
    <HattrickData>
      <Teams>
        <Team>
          <TeamID>3228058</TeamID>
          <TeamName>FC SK&amp;N Womans Team</TeamName>
        </Team>
      </Teams>
    </HattrickData>
  `;

  assert.equal(parseApiTeamDetailsXml(xml, 3228058).teamName, 'FC SK&N Womans Team');
  assert.equal(parseClientTeamDetailsXml(xml, 3228058).teamName, 'FC SK&N Womans Team');
});
