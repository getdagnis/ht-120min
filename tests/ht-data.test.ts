import assert from 'node:assert/strict';
import test from 'node:test';

import { getCanonicalCountryName, getFlagUrl, getFriendlyTimeForCountry } from '../src/utils/ht-data';
import { parseTeamDetailsXml as parseApiTeamDetailsXml } from '../api/_lib/chpp-xml';
import { parseTeamDetailsXml as parseClientTeamDetailsXml } from '../src/utils/chpp-xml';

test('Latvia display is canonicalized from localized CHPP country values', () => {
  assert.equal(getCanonicalCountryName('Lettonia', 48), 'Latvia');
  assert.equal(getCanonicalCountryName('Latvija', 48), 'Latvia');
  assert.equal(getCanonicalCountryName('Lettonia'), 'Latvia');
});

test('Latvia flag resolves from either CHPP CountryID or localized country name', () => {
  assert.equal(getFlagUrl('Lettonia', 48), 'https://flagcdn.com/w80/lv.png');
  assert.equal(getFlagUrl('Latvija'), 'https://flagcdn.com/w80/lv.png');
  assert.equal(getFlagUrl(undefined, 48), 'https://flagcdn.com/w80/lv.png');
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
            <LeagueLevelUnit>
              <LeagueLevel>4</LeagueLevel>
            </LeagueLevelUnit>
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
});

test('teamdetails parser uses LeagueID as canonical country name over localized XML text', () => {
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
            <CountryID>12</CountryID>
            <CountryName>Finlandia</CountryName>
          </Country>
        </Team>
      </Teams>
    </HattrickData>
  `;

  assert.equal(parseApiTeamDetailsXml(xml, 123456).countryName, 'Finland');
  assert.equal(parseClientTeamDetailsXml(xml, 123456).countryName, 'Finland');
});
