import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildManagerStory,
  detectOfficialRole,
  type ManagerSnapshot,
} from './manager-spotlight-story-engine.js';

const c = (name: string) => ({ name });

test('reserved Hattrick prefixes map to official roles', () => {
  assert.equal(detectOfficialRole('LA-Pirats'), 'language_assistant');
  assert.equal(detectOfficialRole('Mod-Foo'), 'moderator');
  assert.equal(detectOfficialRole('GM-Bar'), 'game_master');
  assert.equal(detectOfficialRole('HT-Baz'), 'hattrick_staff');
});

test('NinoMed: exceptional NT role > tournament > primary club > major trophy', () => {
  const manager: ManagerSnapshot = {
    managerId: 1587569,
    managerName: 'NinoMed',
    managerCountry: c('Italy'),
    managerRegion: 'Calabria',
    spotlightDateKey: '2026-10-04',
    nationalTeamRoles: [
      { type: 'assistant', nationalTeamId: 3174, nationalTeamName: 'Malta', isU21: false },
      { type: 'coach', nationalTeamId: 3302, nationalTeamName: 'Guam', isU21: false },
      { type: 'scout', nationalTeamId: 3309, nationalTeamName: 'Zambia', isU21: false },
      { type: 'scout', nationalTeamId: 3062, nationalTeamName: 'U21 Ísland', isU21: true },
      { type: 'assistant', nationalTeamId: 3326, nationalTeamName: 'U21 Bahamas', isU21: true },
      { type: 'assistant', nationalTeamId: 3175, nationalTeamName: 'U21 Malta', isU21: true },
      { type: 'scout', nationalTeamId: 3285, nationalTeamName: 'U21 Guam', isU21: true },
    ],
    currentTeams: [
      {
        teamId: 239397,
        teamName: 'Amaranto',
        isPrimaryClub: true,
        isTournamentTeam: false,
        country: c('Italy'),
        regionName: 'Calabria',
        division: 'V.210',
        foundedDate: '2004-08-04 03:22:00',
        teamRank: 2705,
        trophies: [{ kind: 'series' }],
      },
      {
        teamId: 1631916,
        teamName: 'Erythrà',
        isPrimaryClub: false,
        isTournamentTeam: false,
        country: c('Malta'),
        regionName: 'Birkirkara',
        division: 'III.2',
        teamRank: 162,
        trophies: [{ kind: 'national_cup', gainedDate: '2024-03-27 19:01:00' }],
      },
      {
        teamId: 2132242,
        teamName: 'Athletic Grifo HGL',
        isPrimaryClub: false,
        isTournamentTeam: false,
        country: c('Guam'),
        specialLeague: 'Homegrown',
        division: 'V.147',
        teamRank: 1496,
      },
      {
        teamId: 2152503,
        teamName: 'Amaranto _B',
        isPrimaryClub: false,
        isTournamentTeam: false,
        country: c('Benin'),
        division: 'III.12',
        teamRank: 96,
      },
      {
        teamId: 3220504,
        teamName: "'Nduje Amaranto",
        isPrimaryClub: false,
        isTournamentTeam: true,
        country: c('Guam'),
        specialLeague: 'HFI',
        division: 'VI.976',
        foundedDate: '2026-03-16 17:49:00',
        teamRank: 1229,
      },
    ],
  };

  const story = buildManagerStory(manager, { targetSentences: 3, maxSentences: 4 });

  assert.match(story.sentences[0], /coaches Guam's national team/);
  assert.match(story.sentences[0], /six additional national-team staff roles/);
  assert.match(story.text, /'Nduje Amaranto represents NinoMed here/);
  assert.match(story.text, /Their main club, Amaranto/);

  // A major achievement is strong enough to become sentence 4.
  assert.match(story.text, /Erythrà has won Malta's National Cup/);
});

test('official role + NT role combine into the highest-priority sentence', () => {
  const manager: ManagerSnapshot = {
    managerId: 1,
    managerName: 'LA-Pirats',
    spotlightDateKey: '2026-10-04',
    nationalTeamRoles: [
      { type: 'scout', nationalTeamId: 48, nationalTeamName: 'Latvia', isU21: false },
    ],
    currentTeams: [
      {
        teamId: 10,
        teamName: 'FK Pirates',
        isPrimaryClub: true,
        isTournamentTeam: false,
        country: c('Latvia'),
        regionName: 'Rīga',
        division: 'III.6',
        foundedDate: '2003-01-01',
      },
      {
        teamId: 11,
        teamName: 'Lemon Pirates',
        isPrimaryClub: false,
        isTournamentTeam: true,
        country: c('Costa Rica'),
        division: 'II.1',
        teamRank: 13,
      },
    ],
  };

  const story = buildManagerStory(manager);
  assert.match(story.sentences[0], /Hattrick Language Assistant/);
  assert.match(story.sentences[0], /scout for Latvia/);
  assert.match(story.text, /Lemon Pirates represents LA-Pirats here/);
  assert.match(story.text, /league rank #13/);
  assert.match(story.text, /main club, FK Pirates/);
});

test('sparse one-club manager still gets a useful story', () => {
  const manager: ManagerSnapshot = {
    managerId: 2,
    managerName: 'procesors',
    spotlightDateKey: '2026-10-04',
    currentTeams: [
      {
        teamId: 677887,
        teamName: 'FC Nachos',
        isPrimaryClub: true,
        isTournamentTeam: true,
        country: c('Latvia'),
        regionName: 'Ogre',
        division: 'IV.35',
        foundedDate: '2005-01-01',
        youthTeamName: 'Raitais solis',
      },
    ],
  };

  const story = buildManagerStory(manager, { targetSentences: 3, maxSentences: 3 });

  assert.match(story.text, /Their main club, FC Nachos, represents procesors here/);
  assert.match(story.text, /Raitais solis/);
});
