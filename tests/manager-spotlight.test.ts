import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildManagerSpotlight,
  classifyTrophy,
  composeManagerStory,
  countryFlagUrl,
  detectOfficialRole,
  getClubRankLabel,
  mapNationalTeamStaffType,
  normalizeNationalTeamRoles,
  selectStoryCandidates,
  type ManagerSpotlightTeam,
  type StoryCandidate,
  type StorySegment,
} from '../src/utils/manager-spotlight.js';

const dateKey = '2026-10-04';
const team = (id: number, name: string, fields: Partial<ManagerSpotlightTeam> = {}): ManagerSpotlightTeam => ({
  teamId: id, teamName: name, logoUrl: null, countryId: null, countryName: null, regionName: null,
  leagueId: null, leagueName: null, leagueSystemId: null, seriesName: null, leagueRank: null,
  powerRating: null, powerLeagueRank: null, foundedDate: null, youthTeamName: null, arenaName: null,
  fanclubSize: null, trophies: [], isPrimary: false, isTournamentTeam: false, ...fields,
});
const normalized = (input: {
  managerName: string; roles?: unknown; teams: ManagerSpotlightTeam[]; tournamentId?: number; managerId?: number;
  managerCountryId?: number | null; managerCountryName?: string | null; targetSentences?: number; maxSentences?: number;
}) => {
  const tournament = input.teams.find((item) => item.teamId === (input.tournamentId ?? input.teams.find((x) => x.isTournamentTeam)?.teamId))!;
  return composeManagerStory({ managerId: input.managerId ?? 1, managerName: input.managerName,
    nationalTeamRoles: normalizeNationalTeamRoles(input.roles), teams: input.teams, tournamentTeam: tournament,
    managerCountryId: input.managerCountryId, managerCountryName: input.managerCountryName,
    dateKey, targetSentences: input.targetSentences, maxSentences: input.maxSentences });
};
const flat = (segments: StorySegment[]) => segments.map((part) => typeof part === 'string' ? part : part.name).join('');
const storyText = (sentences: Array<{ segments: StorySegment[] }>) => sentences.map((sentence) => flat(sentence.segments));

const ninoTeams = [
  team(239397, 'Amaranto', { isPrimary: true, countryId: 4, countryName: 'Italy', regionName: 'Calabria', seriesName: 'V.210', foundedDate: '2004-08-04', leagueRank: 2705,
    trophies: [{ typeId: 17, kind: 'series' }] }),
  team(1631916, 'Erythrà', { countryId: 97, countryName: 'Malta', seriesName: 'III.2', leagueRank: 162,
    trophies: [{ typeId: 16, kind: 'national_cup', gainedDate: '2024-03-27', cupLeagueLevel: 0, cupLevel: 1 }] }),
  team(2132242, 'Athletic Grifo HGL', { countryId: 179, countryName: 'Guam', leagueId: 1003, seriesName: 'V.147', leagueRank: 1496 }),
  team(2152503, 'Amaranto _B', { countryId: 147, countryName: 'Benin', seriesName: 'III.12', leagueRank: 96 }),
  team(3220504, "'Nduje Amaranto", { countryId: 179, countryName: 'Guam', leagueId: 3000, seriesName: 'VI.976', leagueRank: 1229, foundedDate: '2026-03-16', isTournamentTeam: true }),
];
const ninoRoles = [
  { staffType: 1, nationalTeamId: 3174, nationalTeamName: 'Malta' },
  { staffType: 0, nationalTeamId: 3002, nationalTeamName: 'Guam' },
  { staffType: 2, nationalTeamId: 260, nationalTeamName: 'Zambia' },
  { staffType: 2, nationalTeamId: 6, nationalTeamName: 'U21 Ísland' },
  { staffType: 1, nationalTeamId: 3326, nationalTeamName: 'U21 Bahamas' },
  { staffType: 1, nationalTeamId: 3175, nationalTeamName: 'U21 Malta' },
  { staffType: 2, nationalTeamId: 3285, nationalTeamName: 'U21 Guam' },
];

test('official nickname role is derived with exact supported prefixes', () => {
  assert.equal(detectOfficialRole('LA-Pirats'), 'language_assistant');
  assert.equal(detectOfficialRole('Mod-Example'), 'moderator');
  assert.equal(detectOfficialRole('GM-Example'), 'game_master');
  assert.equal(detectOfficialRole('HT-Example'), 'hattrick_staff');
  assert.equal(detectOfficialRole('Moderator'), null);
});

test('staff types normalize and U21 derives from the national-team name prefix', () => {
  assert.equal(mapNationalTeamStaffType(0), 'coach');
  assert.equal(mapNationalTeamStaffType(1), 'assistant');
  assert.equal(mapNationalTeamStaffType(2), 'scout');
  assert.equal(mapNationalTeamStaffType(3), null);
  const roles = normalizeNationalTeamRoles([{ staffType: 1, nationalTeamId: 9, nationalTeamName: 'u21 Bahamas' }]);
  assert.equal(roles[0]?.isU21, true);
  const club = team(2, 'Club', { isPrimary: true, isTournamentTeam: true });
  const story = normalized({ managerName: 'Manager', roles: [{ staffType: 1, nationalTeamId: 172, nationalTeamName: 'U21 Bahamas' }], teams: [club] });
  assert.match(storyText(story.sentences)[0]!, /assistant coach with the U21 Bahamas/);
  const country = story.sentences[0]?.segments.find((segment) => typeof segment !== 'string');
  assert.equal(typeof country === 'string' ? null : country?.name, 'Bahamas');
  assert.ok(typeof country !== 'string' && country && countryFlagUrl(country.countryId, country.name));
});

test('NinoMed aggregates NT roles, prioritizes tournament club, main club, then trophy', () => {
  const result = normalized({ managerName: 'NinoMed', roles: ninoRoles, teams: ninoTeams, managerId: 1587569 });
  const sentences = storyText(result.sentences);
  assert.equal(sentences.length, 4);
  assert.match(sentences[0], /coaches Guam's national team/);
  assert.match(sentences[0], /six additional national-team staff roles/);
  assert.match(sentences[1], /'Nduje Amaranto represents NinoMed here, competing in HFI division VI\.976/);
  assert.doesNotMatch(sentences[1], /rank #1229/);
  assert.match(sentences[2], /main club, Amaranto/);
  assert.match(sentences[3], /Erythrà won Malta's National Cup/);
  const mentions = result.sentences.flatMap((sentence) => sentence.segments)
    .filter((segment): segment is Extract<StorySegment, { kind: 'country' }> => typeof segment !== 'string');
  assert.ok(mentions.length > 0);
  assert.ok(mentions.every((mention) => countryFlagUrl(mention.countryId, mention.name)));
});

test('LA prefix and NT scout role are independent facts in one P0 sentence', () => {
  const teams = [
    team(10, 'FK Pirates', { isPrimary: true, countryId: 48, countryName: 'Latvia', regionName: 'Rīga', seriesName: 'III.6', foundedDate: '2003-01-01' }),
    team(11, 'Lemon Pirates', { countryId: 77, countryName: 'Costa Rica', seriesName: 'II.1', leagueRank: 13, isTournamentTeam: true }),
  ];
  const result = normalized({ managerName: 'LA-Pirats', roles: [{ staffType: 2, nationalTeamId: 48, nationalTeamName: 'Latvia' }], teams });
  const sentences = storyText(result.sentences);
  assert.match(sentences[0], /Hattrick Language Assistant/);
  assert.match(sentences[0], /scout for Latvia's national team/);
  assert.match(sentences[1], /Lemon Pirates represents LA-Pirats here, playing in II\.1 at league rank #13/);
  assert.match(sentences[1], /league rank #13/);
  assert.match(sentences[2], /main club, FK Pirates/);
});

test('official-only and NT-only profiles each get an exceptional identity candidate', () => {
  const club = team(3, 'Club', { isPrimary: true, isTournamentTeam: true, seriesName: 'IV.1' });
  assert.match(storyText(normalized({ managerName: 'GM-Foo', teams: [club] }).sentences)[0], /Hattrick Game Master/);
  assert.match(storyText(normalized({ managerName: 'Foo', roles: [{ staffType: 0, nationalTeamId: 48, nationalTeamName: 'Latvia' }], teams: [club] }).sentences)[0], /coaches Latvia's national team/);
});

test('tournament identity names the club when it is also the primary club', () => {
  const club = team(4, 'FC Nachos', { isPrimary: true, isTournamentTeam: true, seriesName: 'IV.35', foundedDate: '2005-01-01' });
  const result = normalized({ managerName: 'procesors', teams: [club] });
  assert.match(storyText(result.sentences)[0], /FC Nachos, the main club, represents procesors here, playing in IV\.35/);
});

test('TeamRank is the regular league rank; PowerRating league rank is not substituted', () => {
  const club = team(5, 'Ranked Club', { isPrimary: true, isTournamentTeam: true, countryId: 48, countryName: 'Latvia', seriesName: 'IV.35', leagueRank: 13, powerLeagueRank: 1 });
  const sentences = storyText(normalized({ managerName: 'Manager', teams: [club] }).sentences);
  assert.match(sentences[0], /league rank #13/);
  assert.equal(getClubRankLabel(club), 'League rank #13');
  assert.doesNotMatch(sentences.join(' '), /#1\b/);
});

test('HFI suppresses TeamRank from story and club rank label regardless of value', () => {
  const club = team(6, 'HFI Club', { leagueId: 3000, seriesName: 'VI.1', leagueRank: 1, isTournamentTeam: true });
  const story = storyText(normalized({ managerName: 'Manager', teams: [club] }).sentences).join(' ');
  assert.match(story, /HFI Club represents Manager here, competing in HFI division VI\.1/);
  assert.doesNotMatch(story, /rank #1/);
  assert.equal(getClubRankLabel(club), null);
});

test('Homegrown league identity is centralized and does not reuse an HFI label', () => {
  const club = team(63, 'Homesick Pirates', { countryName: 'Guyana', leagueId: 1003, seriesName: 'V.147', isTournamentTeam: true });
  const story = storyText(normalized({ managerName: 'Manager', teams: [club] }).sentences).join(' ');
  assert.match(story, /Homesick Pirates represents Manager here, competing in Homegrown division V\.147/);
  assert.doesNotMatch(story, /HFI/);
});

test('rank zero is omitted, and a notably ranked non-tournament regular club is an independent fact', () => {
  const teams = [
    team(61, 'Tournament Club', { isTournamentTeam: true, countryId: 48, countryName: 'Latvia', seriesName: 'IV.1', leagueRank: 0 }),
    team(62, 'Ranked Club', { isPrimary: true, countryId: 48, countryName: 'Latvia', seriesName: 'II.1', leagueRank: 13 }),
  ];
  const result = normalized({ managerName: 'Manager', teams });
  assert.doesNotMatch(storyText(result.sentences)[0]!, /rank #0/);
  assert.ok(result.candidates.some((candidate) => candidate.id === 'rank:62'));
  assert.match(storyText(result.sentences).join(' '), /Ranked Club holds league rank #13/);
  assert.doesNotMatch(storyText(result.sentences).join(' '), /#13 in Latvia/);
});

test('cup, league, series and exceptional trophy IDs are classified from the documented enum', () => {
  assert.equal(classifyTrophy({ typeId: 16, cupLeagueLevel: 0, cupLevel: 1 }), 'national_cup');
  assert.equal(classifyTrophy({ typeId: 16, cupLevel: 2 }), 'challenger_cup');
  assert.equal(classifyTrophy({ typeId: 16, cupLevel: 3 }), 'consolation_cup');
  assert.equal(classifyTrophy({ typeId: 17 }), 'series');
  assert.equal(classifyTrophy({ typeId: 18 }), 'league');
  assert.equal(classifyTrophy({ typeId: 78 }), 'world_cup_gold');
  assert.equal(classifyTrophy({ typeId: 79 }), 'world_cup_silver');
  assert.equal(classifyTrophy({ typeId: 80 }), 'world_cup_bronze');
  assert.equal(classifyTrophy({ typeId: 91 }), 'masters');
  assert.equal(classifyTrophy({ typeId: 93 }), 'masters_top_scorer');
  assert.equal(classifyTrophy({ typeId: 103 }), 'tournament');
  assert.equal(classifyTrophy({ typeId: 203 }), 'tutorial_tournament');
});

test('major trophy and repeated series-title candidates are available; obscure types do not become wins', () => {
  const club = team(7, 'Cup Club', { isPrimary: true, isTournamentTeam: true, countryId: 48, countryName: 'Latvia', trophies: [
    { typeId: 17, kind: 'series', season: 1 }, { typeId: 17, kind: 'series', season: 2 },
    { typeId: 16, kind: 'national_cup', cupLeagueLevel: 0, cupLevel: 1 }, { typeId: 93, kind: 'masters_top_scorer' },
  ] });
  const result = normalized({ managerName: 'Manager', teams: [club], maxSentences: 4 });
  assert.ok(result.candidates.some((candidate) => candidate.id.startsWith('trophy:7:16')));
  assert.ok(result.candidates.some((candidate) => candidate.id === 'series-count:7'));
  assert.ok(!result.candidates.some((candidate) => candidate.segments.some((segment) => typeof segment === 'string' && /top scorer|tutorial tournament/i.test(segment))));
});

test('single old club gives a factual history and youth fallback', () => {
  const club = team(8, 'FC Nachos', { isPrimary: true, isTournamentTeam: true, countryId: 48, countryName: 'Latvia', regionName: 'Ogre', seriesName: 'IV.35', foundedDate: '2005-01-01', youthTeamName: 'Raitais solis' });
  const result = normalized({ managerName: 'procesors', teams: [club] });
  assert.match(storyText(result.sentences).join(' '), /founded in 2005/);
  assert.match(storyText(result.sentences).join(' '), /Raitais solis/);
});

test('single recent club, missing founding date, language, and region degrade cleanly', () => {
  const recent = team(9, 'Recent Club', { isPrimary: true, isTournamentTeam: true, foundedDate: '2025-03-01', seriesName: 'VI.1' });
  const withDate = normalized({ managerName: 'Manager', teams: [recent] });
  assert.match(storyText(withDate.sentences).join(' '), /relatively recent/);
  const missing = team(10, 'Sparse Club', { isPrimary: true, isTournamentTeam: true, foundedDate: null });
  const spotlight = buildManagerSpotlight({ tournamentId: 't', participants: [{ id: 'p', hattrick_user_id: 4, ht_team_id: 10 }], profiles: [{ hattrick_user_id: 4, manager_name: 'Manager', language_name: null, country_name: null, teams_json: [missing] }], dateKey });
  assert.equal(spotlight?.language, null);
  assert.deepEqual(spotlight?.location, []);
  assert.doesNotMatch(storyText(spotlight?.story ?? []).join(' '), /undefined|null/);
});

test('multi-country footprint retains every known country even when a flag mapping is unavailable', () => {
  const teams = [
    team(11, 'A', { countryId: 48, countryName: 'Latvia', isPrimary: true }),
    team(12, 'B', { countryId: 77, countryName: 'Costa Rica', isTournamentTeam: true }),
    team(13, 'C', { countryId: 179, countryName: 'Guam' }),
  ];
  const result = normalized({ managerName: 'Manager', teams });
  const footprint = result.candidates.find((candidate) => candidate.id === 'footprint');
  assert.ok(footprint);
  const mentions = footprint!.segments.filter((part): part is Extract<StorySegment, { kind: 'country' }> => typeof part !== 'string');
  assert.deepEqual(mentions.map((item) => item.name), ['Costa Rica', 'Guam', 'Latvia']);
  assert.ok(mentions.every((item) => countryFlagUrl(item.countryId, item.name)));
  const unknown = [
    team(15, 'Mapped', { countryId: 48, countryName: 'Latvia', isPrimary: true }),
    team(16, 'Unmapped', { countryId: 999999, countryName: 'Exampleland', isTournamentTeam: true }),
  ];
  const unknownResult = normalized({ managerName: 'Manager', teams: unknown });
  const unknownFootprint = unknownResult.candidates.find((candidate) => candidate.id === 'footprint');
  assert.ok(unknownFootprint);
  const unknownMentions = unknownFootprint!.segments.filter((part): part is Extract<StorySegment, { kind: 'country' }> => typeof part !== 'string');
  assert.deepEqual(unknownMentions.map((item) => item.name), ['Exampleland', 'Latvia']);
  assert.equal(countryFlagUrl(999999, 'Exampleland'), null);
});

test('footprint describes one home club and a foreign-country cluster, and detects shared regions', () => {
  const spread = [
    team(31, 'Home', { countryId: 48, countryName: 'Latvia', isPrimary: true }),
    team(32, 'Away One', { countryId: 179, countryName: 'Guam' }),
    team(33, 'Away Two', { countryId: 179, countryName: 'Guam', isTournamentTeam: true }),
  ];
  const spreadFact = normalized({ managerName: 'Manager', teams: spread, managerCountryId: 48, managerCountryName: 'Latvia' }).candidates.find((candidate) => candidate.id === 'footprint');
  assert.ok(spreadFact);
  assert.match(flat(spreadFact!.segments), /one current club in Latvia and two in Guam/);
  const sameRegion = [
    team(34, 'One', { countryId: 48, countryName: 'Latvia', regionName: 'Cēsis' }),
    team(35, 'Two', { countryId: 48, countryName: 'Latvia', regionName: 'Cēsis' }),
    team(36, 'Three', { countryId: 48, countryName: 'Latvia', regionName: 'Cēsis', isTournamentTeam: true }),
  ];
  const regionFact = normalized({ managerName: 'Manager', teams: sameRegion }).candidates.find((candidate) => candidate.id === 'footprint');
  assert.ok(regionFact);
  assert.match(flat(regionFact!.segments), /Cēsis region of Latvia/);
});

test('primary and tournament clubs remain distinct in the team model', () => {
  const spotlight = buildManagerSpotlight({ tournamentId: 't', participants: [{ id: 'p', hattrick_user_id: 12, ht_team_id: 16 }], profiles: [{ hattrick_user_id: 12, manager_name: 'Manager', teams_json: [
    { teamId: 15, teamName: 'Main', isPrimaryClub: true, foundedDate: '2003-01-01' },
    { teamId: 16, teamName: 'Tournament', isPrimaryClub: false, leagueLevelUnitName: 'II.1' },
  ] }], dateKey });
  assert.equal(spotlight?.currentTeams.find((item) => item.isPrimary)?.teamId, 15);
  assert.equal(spotlight?.currentTeams.find((item) => item.isTournamentTeam)?.teamId, 16);
});

test('home location prefers primary-club region and falls back to registered-country club without inventing a region', () => {
  const spotlight = buildManagerSpotlight({ tournamentId: 't', participants: [{ id: 'p', hattrick_user_id: 12, ht_team_id: 16 }], profiles: [{
    hattrick_user_id: 12, manager_name: 'Manager', country_id: 48, country_name: 'Latvia', teams_json: [
      { teamId: 15, teamName: 'Main', isPrimaryClub: true, countryId: 179, countryName: 'Guam', regionName: 'Tamuning' },
      { teamId: 16, teamName: 'Tournament', countryId: 48, countryName: 'Latvia', regionName: 'Rīga' },
    ],
  }], dateKey });
  assert.equal(typeof spotlight?.location[0], 'string');
  assert.match(String(spotlight?.location[0]), /^Tamuning, $/);
  const country = spotlight?.location[1];
  assert.equal(typeof country === 'string' ? null : country?.name, 'Latvia');

  const noRegion = buildManagerSpotlight({ tournamentId: 't', participants: [{ id: 'p', hattrick_user_id: 12, ht_team_id: 16 }], profiles: [{
    hattrick_user_id: 12, manager_name: 'Manager', country_id: 48, country_name: 'Latvia', teams_json: [
      { teamId: 16, teamName: 'Tournament', countryId: 48, countryName: 'Latvia' },
    ],
  }], dateKey });
  assert.equal(noRegion?.location.length, 1);
  assert.equal(typeof noRegion?.location[0] === 'string' ? null : noRegion?.location[0]?.name, 'Latvia');
});

test('selector orders priorities, deduplicates, and breaks ties deterministically', () => {
  const fact = (id: string, tier: StoryCandidate['tier'], score: number, tags: string[] = []): StoryCandidate => ({ id, topic: tier === 2 ? 'primary-club' : 'colour', tier, score, tags, segments: [id] });
  const candidateList = [fact('fallback', 5, 100), fact('primary', 2, 50), fact('same', 2, 50), fact('other', 3, 50)];
  const first = selectStoryCandidates(candidateList, 1, dateKey, 3, 4);
  assert.deepEqual(first.map((item) => item.tier), [2, 2, 3]);
  assert.deepEqual(selectStoryCandidates(candidateList, 1, dateKey, 3, 4).map((item) => item.id), first.map((item) => item.id));
  const duplicate = selectStoryCandidates([fact('a', 3, 90, ['team:1']), fact('b', 3, 80, ['team:1'])], 1, dateKey, 3, 4);
  assert.equal(duplicate.length, 1);
});

test('normal budget is three and hard budget never exceeds four', () => {
  const required = (id: string, tier: 0 | 1): StoryCandidate => ({ id, topic: tier === 0 ? 'exceptional-role' : 'tournament', tier, score: 100, mandatory: true, tags: [], segments: [id] });
  const optional: StoryCandidate[] = Array.from({ length: 8 }, (_, index) => ({ id: `o${index}`, topic: 'colour', tier: 5, score: 100 - index, tags: [], segments: [`o${index}`] }));
  optional.push({ id: 'major', topic: 'achievement', tier: 3, score: 90, tags: [], segments: ['major'] });
  assert.equal(selectStoryCandidates([required('p0', 0), required('p1', 1), ...optional], 1, dateKey).length, 3);
  assert.equal(selectStoryCandidates([required('p0', 0), required('p1', 1), ...optional], 1, dateKey, 10, 4).length, 4);
});

test('own-manager viewer copy stays third-person', () => {
  const club = team(20, 'Club', { isPrimary: true, isTournamentTeam: true, countryId: 48, countryName: 'Latvia', seriesName: 'IV.1' });
  const story = storyText(normalized({ managerName: 'OwnManager', teams: [club] }).sentences).join(' ');
  assert.match(story, /OwnManager/);
  assert.doesNotMatch(story, /\byou\b|\byour\b/i);
});
