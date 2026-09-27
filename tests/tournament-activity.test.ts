import assert from 'node:assert/strict';
import test from 'node:test';

import { buildArrangedFixtureStory, buildMisarrangedFixtureStory } from '../src/utils/fixture-story.js';
import { buildTournamentJoinStory } from '../src/server/api/_lib/join-story.js';

test('join story preserves manager nickname and captures the registration snapshot', () => {
  const story = buildTournamentJoinStory({
    manager: {
      hattrickUserId: 12895530,
      managerName: 'klaus82',
      countryId: 4,
      countryName: 'Italy',
      teams: [
        {
          teamId: 723264,
          teamName: 'Oracolo',
          isPrimaryClub: true,
          regionName: 'Liguria',
          countryId: 4,
          countryName: 'Italy',
        },
      ],
    },
    managerName: 'klaus82',
    managerId: 12895530,
    team: {
      teamId: 999,
      teamName: 'FC Potatoes Woman',
      leagueId: 3000,
      leagueSystemId: 2,
      countryId: 191,
      countryName: 'San Marino',
    },
    teamDetails: {
      teamId: 999,
      teamName: 'FC Potatoes Woman',
      leagueId: 3000,
      leagueSystemId: 2,
      leagueLevelUnitId: 272168,
      leagueLevelUnitName: 'VI.492',
      countryId: 191,
      countryName: 'San Marino',
      regionId: 2901,
      regionName: 'Acquaviva',
      foundedDate: '2026-03-16 11:32:00',
      teamRank: 4,
    },
  });

  const renderedStory = story.map((part) => part.text).join('');
  for (const fact of ['klaus82', 'Liguria', 'Italy', 'FC Potatoes Woman', 'HFI', 'VI.492', '4', '16.03.2026', 'Acquaviva', 'San Marino']) {
    assert.ok(renderedStory.includes(fact), `join story should retain ${fact}`);
  }
  assert.equal(story.find((part) => part.text === 'klaus82')?.href, 'https://www.hattrick.org/goto.ashx?path=/Club/Manager/?userId=12895530');
  assert.equal(story.find((part) => part.text === 'VI.492')?.href, 'https://www.hattrick.org/goto.ashx?path=/World/Series/?LeagueLevelUnitID=272168');
  assert.equal(story.find((part) => part.text === 'Acquaviva')?.href, 'https://www.hattrick.org/goto.ashx?path=/World/Regions/Region.aspx?RegionID=2901');
});

test('arranged fixture story uses the confirmed home venue and keeps links in the snapshot', () => {
  const story = buildArrangedFixtureStory({
    roundNumber: 2,
    matchDate: new Date('2026-09-30T05:15:00Z'),
    homeTeam: {
      name: 'Amaranto',
      htTeamId: 123,
      regionName: 'Dededo',
      regionId: 456,
      countryName: 'Guam',
      countryId: 154,
    },
    awayTeam: { name: 'Guåhan Goddesses', htTeamId: 789 },
    venue: { arenaName: 'Amaranto Arena', capacity: 17700, fanclubSize: 1195 },
  });

  const renderedStory = story.map((part) => part.text).join('');
  for (const fact of ['Amaranto', 'Guåhan Goddesses', 'Round 2', '30 Sept at 05:15', 'Dededo', 'Guam', 'Amaranto Arena', '17,700-seat', '1,195 supporters']) {
    assert.ok(renderedStory.includes(fact), `arranged story should retain ${fact}`);
  }
  assert.equal(story.find((part) => part.text === 'Amaranto')?.href, 'https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=123');
  assert.equal(story.find((part) => part.text === 'Dededo')?.href, 'https://www.hattrick.org/goto.ashx?path=/World/Regions/Region.aspx?RegionID=456');
});

test('misarranged story names the offending team and leaves the opponent blameless', () => {
  const story = buildMisarrangedFixtureStory({
    roundNumber: 2,
    offendingTeams: [{ name: 'F-GUAM-FCSB', htTeamId: 123 }],
    opponentTeams: [{ name: 'Tamuning Amazons', htTeamId: 456 }],
  });

  const renderedStory = story.map((part) => part.text).join('');
  assert.match(renderedStory, /F-GUAM-FCSB has been detected arranging a friendly outside the tournament/);
  assert.match(renderedStory, /Tamuning Amazons is now left without their tournament training partner/);
  assert.equal(story.find((part) => part.text === 'F-GUAM-FCSB')?.href, 'https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=123');
});
