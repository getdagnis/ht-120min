import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildManagerSpotlight,
  classifyTrophy,
  composeManagerStory,
  countryFlagUrl,
  detectOfficialRole,
  getClubRankLabel,
  getFoundedYearLabel,
  getSpecialLeagueLabel,
  getSpotlightTournamentLabel,
  getVisibleClubTeams,
  normalizeNationalTeamRoles,
  selectStoryCandidates,
  type ManagerSpotlightTeam,
  type StoryCandidate,
  type StorySegment,
  type TrophyFact,
} from '../src/utils/manager-spotlight.js';

const dateKey = '2026-10-04';
const club = (teamId: number, teamName: string, fields: Partial<ManagerSpotlightTeam> = {}): ManagerSpotlightTeam => ({
  teamId, teamName, logoUrl: null, countryId: null, countryName: null, regionName: null,
  leagueId: null, leagueName: null, leagueSystemId: null, seriesName: null, leagueRank: null,
  powerRating: null, powerLeagueRank: null, foundedDate: null, youthTeamName: null, arenaName: null,
  fanclubSize: null, trophies: [], isPrimary: false, isTournamentTeam: false, ...fields,
});
const seriesTitles = (count: number): TrophyFact[] => Array.from({ length: count }, (_, season) => ({ typeId: 17, kind: 'series', season: season + 1 }));
const compose = (managerName: string, teams: ManagerSpotlightTeam[], roles: unknown = [], managerId = 1) => {
  const tournamentTeam = teams.find((team) => team.isTournamentTeam)!;
  return composeManagerStory({ managerId, managerName, nationalTeamRoles: normalizeNationalTeamRoles(roles), teams, tournamentTeam, dateKey });
};
const plain = (segments: StorySegment[]) => segments.map((part) => typeof part === 'string' ? part : part.name).join('');
const story = (result: ReturnType<typeof compose>) => result.sentences.map((sentence) => plain(sentence.segments));
const countryMentions = (segments: StorySegment[]) => segments.filter((part): part is Extract<StorySegment, { kind: 'country' }> => typeof part !== 'string');

const fixtures = {
  cellm8: [
    club(1, 'Borderline Athletic', { leagueId: 3000, seriesName: 'VII.375', leagueRank: 42, isTournamentTeam: true }),
    club(2, 'Astonishing Apparatus', { isPrimary: true, foundedDate: '2007-01-01', leagueRank: 410, seriesName: 'IV.7', trophies: seriesTitles(17) }),
  ],
  DavidLafata: [
    club(10, 'Lískači', { isPrimary: true, countryId: 46, countryName: 'Czechia', regionName: 'Kraj Vysočina', leagueId: 52, foundedDate: '2024-09-07', leagueRank: 835, powerLeagueRank: 1756, seriesName: 'V.219' }),
    club(11, 'Stóra Dímun', { countryId: 71, countryName: 'Faroe Islands', trophies: seriesTitles(1) }),
    club(12, 'The princesses of Zermatt', { countryId: 179, countryName: 'Guam', leagueId: 3000, seriesName: 'VII.71', leagueRank: 8015, foundedDate: '2026-03-16', isTournamentTeam: true }),
    club(13, 'Tribute to Penguins', { countryId: 103, countryName: 'Jordan', trophies: seriesTitles(2) }),
    club(14, 'Wallersee Boys', { countryId: 145, countryName: 'Cambodia' }),
  ],
  barreneru: [
    club(20, 'Las Mamachichos', { leagueId: 3000, seriesName: 'VII.377', isTournamentTeam: true }),
    club(21, 'Atletico Konoha', { isPrimary: true, foundedDate: '2024-01-01', leagueRank: 461, seriesName: 'VI.654', trophies: seriesTitles(3) }),
  ],
  lebotte: [
    club(30, 'aloha FC', { countryId: 141, countryName: 'Tahiti', leagueId: 3000, seriesName: 'VI.977', isTournamentTeam: true }),
    club(31, 'FC lebotte', { isPrimary: true, countryId: 5, countryName: 'France', leagueId: 5, foundedDate: '2024-01-01', leagueRank: 1942, seriesName: 'V.12', trophies: seriesTitles(1) }),
  ],
  SteFrix: [
    club(40, 'La Cadrega Witches', { leagueId: 3000, seriesName: 'VI.772', isTournamentTeam: true }),
    club(41, 'Deportivo La Cadrega', { isPrimary: true, countryId: 4, countryName: 'Italy', leagueId: 4, foundedDate: '2018-01-01', leagueRank: 3001, seriesName: 'VI.129', trophies: seriesTitles(9) }),
    club(42, 'Another club', { countryId: 145, countryName: 'Cambodia' }),
  ],
  branko_zebec93: [
    club(50, 'Victoria_FC', { leagueId: 3000, seriesName: 'VII.661', isTournamentTeam: true }),
    club(51, 'AS Red Star 93', { isPrimary: true, countryId: 3, countryName: 'Germany', leagueId: 3, foundedDate: '2008-01-01', leagueRank: 70, seriesName: 'VI.84', trophies: [{ typeId: 16, kind: 'national_cup', cupLeagueLevel: 0, cupLevel: 1, gainedDate: '2021-08-01' }] }),
  ],
  NinoMed: [
    club(239397, 'Amaranto', { isPrimary: true, countryId: 4, countryName: 'Italy', regionName: 'Calabria', leagueId: 4, foundedDate: '2004-08-04', leagueRank: 2705, seriesName: 'V.210', trophies: seriesTitles(17) }),
    club(1631916, 'Erythrà', { countryId: 97, countryName: 'Malta', trophies: [{ typeId: 16, kind: 'national_cup', cupLeagueLevel: 0, cupLevel: 1, gainedDate: '2024-03-27' }] }),
    club(2132242, 'Athletic Grifo HGL', { countryId: 179, countryName: 'Guam', leagueId: 1003 }),
    club(2152503, 'Amaranto _B', { countryId: 147, countryName: 'Benin' }),
    club(3220504, "'Nduje Amaranto", { countryId: 179, countryName: 'Guam', leagueId: 3000, seriesName: 'VI.976', leagueRank: 1229, isTournamentTeam: true }),
  ],
  'LA-Pirats': [
    club(116432, 'FK Pirates', { isPrimary: true, countryId: 48, countryName: 'Latvia', regionName: 'Rīga', leagueId: 53, foundedDate: '2003-01-01', seriesName: 'III.6' }),
    club(458425, 'Lemon Pirates', { countryId: 77, countryName: 'Costa Rica', leagueId: 81, leagueRank: 13, seriesName: 'II.1', isTournamentTeam: true }),
    club(2066977, 'Pirates Academy', { countryId: 190, countryName: 'Puerto Rico' }),
    club(2130552, 'Homesick Pirates', { countryId: 197, countryName: 'Guyana', leagueId: 1003 }),
  ],
};
const ninoRoles = [
  { staffType: 0, nationalTeamId: 3002, nationalTeamName: 'Guam' },
  { staffType: 1, nationalTeamId: 3174, nationalTeamName: 'Malta' },
  { staffType: 1, nationalTeamId: 3326, nationalTeamName: 'U21 Bahamas' },
  { staffType: 1, nationalTeamId: 3175, nationalTeamName: 'U21 Malta' },
  { staffType: 2, nationalTeamId: 260, nationalTeamName: 'Zambia' },
  { staffType: 2, nationalTeamId: 6, nationalTeamName: 'U21 Ísland' },
  { staffType: 2, nationalTeamId: 3285, nationalTeamName: 'U21 Guam' },
];


test('worlddetails supplies every special league label through one formatter', () => {
  const leagueIds = [1000, 1001, 1002, 1003, 3000];
  assert.deepEqual(leagueIds.map(getSpecialLeagueLabel), ['HTI', 'AL', 'HAL', 'HGL', 'HFI']);
  assert.deepEqual(leagueIds.map((leagueId) => getClubRankLabel(club(leagueId, 'Special club', { leagueId, leagueRank: 12 }))),
    ['Ranked #12 in HTI', 'Ranked #12 in AL', 'Ranked #12 in HAL', 'Ranked #12 in HGL', 'Ranked #12 in HFI']);
  assert.equal(getSpecialLeagueLabel(4), null);
});

test('club heading keeps the tournament title and renders its restricted country as a flagged segment', () => {
  const label = getSpotlightTournamentLabel({ name: 'Exotic HFI — Saint Kitts and Nevis 🇰🇳', countryLimit: '202', countryLimitFormat: 'country_id' });
  assert.equal(plain(label), 'Exotic HFI — Saint Kitts and Nevis');
  assert.deepEqual(countryMentions(label).map((mention) => mention.name), ['Saint Kitts and Nevis']);
  assert.ok(countryFlagUrl(countryMentions(label)[0]!.countryId, countryMentions(label)[0]!.name));
  assert.equal(plain(getSpotlightTournamentLabel({ name: 'Exotic HFI', countryLimit: '202', countryLimitFormat: 'country_id' })),
    'Exotic HFI — Saint Kitts and Nevis');
  assert.equal(plain(getSpotlightTournamentLabel({ name: 'Exotic HFI — Saint Kitts and Nevis 🇰🇳 (test)', countryLimit: '202', countryLimitFormat: 'country_id' })),
    'Exotic HFI — Saint Kitts and Nevis (test)');
});

test('TeamRank follows country leagues or special leagues, separate from PowerRating rank', () => {
  const regular = fixtures.DavidLafata[0]!;
  assert.equal(getClubRankLabel(regular), 'Ranked #835');
  assert.match(story(compose('DavidLafata', fixtures.DavidLafata))[1]!, /Kraj Vysočina.*ranked #835/);
  assert.doesNotMatch(story(compose('DavidLafata', fixtures.DavidLafata)).join(' '), /#1756/);
  const hfi = fixtures.DavidLafata[2]!;
  assert.equal(getClubRankLabel(hfi), 'Ranked #8015 in HFI');
  assert.match(story(compose('DavidLafata', fixtures.DavidLafata))[0]!, /ranked #8015 in HFI/);
  assert.equal(getClubRankLabel(club(98, 'Homegrown', { leagueId: 1003, leagueRank: 12 })), 'Ranked #12 in HGL');
  assert.equal(getClubRankLabel(club(99, 'Zero', { leagueRank: 0 })), null);
});

test('regular TeamRank omits a redundant country scope while club mentions keep flagged countries', () => {
  const result = compose('LA-Pirats', fixtures['LA-Pirats']);
  const tournament = result.sentences.find((sentence) => sentence.candidateId.startsWith('tournament:'))!.segments;
  const main = result.sentences.find((sentence) => sentence.candidateId.startsWith('primary:'))!.segments;
  assert.match(plain(tournament), /Lemon Pirates.*based in Costa Rica, ranked #13/);
  assert.match(plain(main), /FK Pirates.*Rīga, Latvia.*founded in 2003/);
  assert.deepEqual(countryMentions(tournament).map((mention) => mention.name), ['Costa Rica']);
  assert.deepEqual(countryMentions(main).map((mention) => mention.name), ['Latvia']);
  assert.ok([...countryMentions(tournament), ...countryMentions(main)]
    .every((mention) => countryFlagUrl(mention.countryId, mention.name)));
});

test('special TeamRank uses the special league while country remains club location', () => {
  const result = compose('LA-Pirats', [
    club(200, 'FK Pirates', { isPrimary: true, regionName: 'Rīga', countryId: 48, countryName: 'Latvia', foundedDate: '2003-01-01', seriesName: 'III.6' }),
    club(201, 'Lemon Pirates', { isTournamentTeam: true, leagueId: 3000, countryId: 77, countryName: 'Costa Rica', leagueRank: 1332, seriesName: 'VI.1' }),
  ]);
  const tournament = result.sentences.find((sentence) => sentence.candidateId === 'tournament:201')!.segments;
  const tournamentText = plain(tournament);
  assert.match(tournamentText, /Lemon Pirates/);
  assert.match(tournamentText, /based in Costa Rica/);
  assert.match(tournamentText, /ranked #1332 in HFI/);
  assert.match(tournamentText, /series VI\.1/);
  assert.deepEqual(countryMentions(tournament).map((mention) => mention.name), ['Costa Rica']);
  assert.equal(getClubRankLabel(club(201, 'Lemon Pirates', { leagueId: 3000, leagueRank: 1332 })), 'Ranked #1332 in HFI');
  assert.match(story(result)[2]!, /FK Pirates.*Rīga, Latvia.*founded in 2003/);
});

test('ordinary series titles below five have no story candidate; five or more may be selected', () => {
  for (const count of [1, 2, 3, 4]) {
    const result = compose('Manager', [club(80, 'Cup Club', { isPrimary: true, isTournamentTeam: true, trophies: seriesTitles(count) })]);
    assert.ok(!result.candidates.some((candidate) => candidate.id.startsWith('series-count:')));
    assert.doesNotMatch(story(result).join(' '), /series titles?/);
  }
  const five = compose('Manager', [club(81, 'Cup Club', { isPrimary: true, isTournamentTeam: true, trophies: seriesTitles(5) })]);
  assert.match(story(five).join(' '), /five|5 series titles/);
});

test('a third club trophy cannot add a third club to the story', () => {
  const result = compose('Manager', [
    club(82, 'Main', { isPrimary: true, countryId: 3, countryName: 'Germany', trophies: seriesTitles(17) }),
    club(83, 'Cup Team', { countryId: 97, countryName: 'Malta', trophies: [{ typeId: 16, kind: 'national_cup', gainedDate: '2021-01-01' }] }),
    club(84, 'Tournament', { leagueId: 3000, countryId: 179, countryName: 'Guam', isTournamentTeam: true }),
    club(85, 'Other', { countryId: 145, countryName: 'Cambodia' }),
  ]);
  assert.doesNotMatch(story(result).join(' '), /Cup Team|Other/);
  assert.match(story(result).join(' '), /Main has collected 17 series titles/);
});

test('story names no more than the tournament club and main club', () => {
  const result = compose('CCalm', [
    club(301, 'Rapid Sendling', { isPrimary: true, countryId: 4, countryName: 'Germany' }),
    club(302, 'Tamuning Amazons', { isTournamentTeam: true, leagueId: 3000, countryId: 179, countryName: 'Guam' }),
    club(303, 'Kaiser’s krasseste Kicker', { countryId: 179, countryName: 'Guam', powerRating: 979, powerLeagueRank: 34 }),
  ]);
  const text = story(result).join(' ');
  assert.match(text, /Rapid Sendling/);
  assert.match(text, /Tamuning Amazons/);
  assert.doesNotMatch(text, /Kaiser’s krasseste Kicker/);
});

test('main-club sentence avoids repeating the manager name and uses neutral possessive', () => {
  const result = compose('Mod-visiburn', [
    club(321, 'visiburn reloaded', { isPrimary: true, foundedDate: '2020-01-01' }),
    club(322, 'visiburn resurrections', { isTournamentTeam: true, leagueId: 3000, seriesName: 'VI.451' }),
  ]);
  const main = story(result).find((sentence) => sentence.includes('visiburn reloaded'))!;
  assert.match(main, /(?:Their|The) main club.*visiburn reloaded/);
  assert.doesNotMatch(main, /Mod-visiburn/);
});

test('PowerRating facts use the rating value, never the PowerRating rank', () => {
  const result = compose('Manager', [
    club(311, 'Main', { isPrimary: true, powerRating: 979, powerLeagueRank: 34 }),
    club(312, 'Tournament', { isTournamentTeam: true, leagueId: 3000, leagueRank: 7237, seriesName: 'VI.289', powerRating: 726 }),
  ]);
  const mainPower = result.candidates.find((candidate) => candidate.id === 'power-rating:311');
  assert.equal(plain(mainPower!.segments), 'Main has a PowerRating of 979.');
  assert.doesNotMatch(plain(mainPower!.segments), /rank|#34/i);
  assert.ok(!result.candidates.some((candidate) => candidate.id === 'power-rating:312'));
});

test('auxiliary footprint names only other-club countries and keeps structured flag references', () => {
  const result = compose('DavidLafata', fixtures.DavidLafata);
  const footprint = result.sentences.find((sentence) => sentence.candidateId === 'footprint');
  assert.ok(footprint);
  assert.equal(plain(footprint.segments), 'DavidLafata also runs clubs in the Faroe Islands, Jordan and Cambodia.');
  assert.deepEqual(countryMentions(footprint.segments).map((mention) => mention.name), ['Faroe Islands', 'Jordan', 'Cambodia']);
  assert.ok(countryMentions(footprint.segments).every((mention) => countryFlagUrl(mention.countryId, mention.name)));
  assert.doesNotMatch(plain(footprint.segments), /Czechia|Guam|Stóra|Tribute|Wallersee|spans/);
});

test('unknown country remains a country segment if a flag URL is unavailable', () => {
  const result = compose('Manager', [
    club(90, 'Main', { isPrimary: true, countryId: 48, countryName: 'Latvia' }),
    club(91, 'Tournament', { isTournamentTeam: true, countryId: 179, countryName: 'Guam' }),
    club(92, 'Other', { countryId: 999999, countryName: 'Exampleland' }),
  ]);
  const footprint = result.sentences.find((sentence) => sentence.candidateId === 'footprint');
  assert.equal(countryMentions(footprint!.segments)[0]?.name, 'Exampleland');
  assert.equal(countryFlagUrl(999999, 'Exampleland'), null);
});

test('club rows include all current clubs, oldest founded first, and expose founding years', () => {
  const teams = fixtures.DavidLafata;
  assert.deepEqual(getVisibleClubTeams({ currentTeams: teams, tournamentTeamId: 12 }).map((item) => item.teamId), [12, 10, 11, 13, 14]);
  assert.equal(getFoundedYearLabel(teams[0]!), 'Founded 2024');
  assert.equal(getFoundedYearLabel(teams[2]!), 'Founded 2026');
  const same = club(93, 'FC Nachos', { isPrimary: true, isTournamentTeam: true, foundedDate: '2005-01-01' });
  assert.deepEqual(getVisibleClubTeams({ currentTeams: [same, club(94, 'Other')], tournamentTeamId: 93 }).map((item) => item.teamId), [93, 94]);
  assert.equal(getFoundedYearLabel(same), 'Founded 2005');
});

test('exceptional role, tournament, main club, and major cup fit the four-sentence ceiling', () => {
  const result = compose('NinoMed', fixtures.NinoMed, ninoRoles, 1587569);
  assert.equal(result.sentences.length, 4);
  assert.ok(result.sentences.some((sentence) => sentence.candidateId === 'exceptional-role'));
  const tournament = result.sentences.find((sentence) => sentence.candidateId === 'tournament:3220504')!;
  assert.match(plain(tournament.segments), /'Nduje Amaranto/);
  assert.ok(countryMentions(tournament.segments).some((mention) => mention.name === 'Guam'));
  assert.match(plain(tournament.segments), /1229/);
  assert.match(plain(tournament.segments), /VI\.976/);
  const primary = result.sentences.find((sentence) => sentence.candidateId === 'primary:239397')!;
  assert.match(plain(primary.segments), /Amaranto/);
  assert.match(plain(primary.segments), /Calabria/);
  assert.match(plain(primary.segments), /2004/);
  assert.match(plain(primary.segments), /2705/);
  assert.match(plain(primary.segments), /V\.210/);
  assert.doesNotMatch(story(result).join(' '), /Erythrà/);
  assert.ok(result.sentences.some((sentence) => sentence.candidateId === 'series-count:239397'));
});

test('official prefix and NT role share P0; U21 comes from the name', () => {
  assert.equal(detectOfficialRole('LA-Pirats'), 'language_assistant');
  assert.equal(detectOfficialRole('Moderator'), null);
  const moderator = compose('Mod-visiburn', [
    club(320, 'visiburn reloaded', { isPrimary: true }),
    club(321, 'visiburn resurrections', { isTournamentTeam: true, leagueId: 3000, seriesName: 'VI.451' }),
  ]);
  assert.match(story(moderator)[0]!, /^As the title already suggests, Mod-visiburn is a Hattrick moderator\./);
  const result = compose('LA-Pirats', fixtures['LA-Pirats'], [{ staffType: 2, nationalTeamId: 48, nationalTeamName: 'Latvia' }]);
  assert.match(story(result)[0]!, /As the title already suggests, LA-Pirats is a Hattrick Language Assistant and also serves as a scout for the national team of Latvia/);
  assert.match(story(result)[1]!, /Lemon Pirates.*based in Costa Rica, ranked #13 and playing in series II\.1/);
  assert.match(story(result)[2]!, /FK Pirates.*Rīga, Latvia.*founded in 2003.*plays in series III\.6/);
  assert.equal(result.sentences.length, 3);
  assert.equal(normalizeNationalTeamRoles([{ staffType: 1, nationalTeamId: 1, nationalTeamName: 'U21 Guam' }])[0]?.isU21, true);
});

test('single old club gets main history and youth fallback without a duplicate row', () => {
  const single = club(95, 'FC Nachos', { isPrimary: true, isTournamentTeam: true, foundedDate: '2005-01-01', seriesName: 'IV.35', youthTeamName: 'Raitais solis' });
  const result = compose('procesors', [single]);
  assert.equal(result.sentences.length, 3);
  assert.match(story(result)[1]!, /FC Nachos.*founded in 2005/);
  assert.doesNotMatch(story(result)[1]!, /IV\.35/);
  assert.match(story(result)[2]!, /Raitais solis/);
});

test('trophy IDs and classification keep major cup semantics', () => {
  assert.equal(classifyTrophy({ typeId: 16, cupLeagueLevel: 0, cupLevel: 1 }), 'national_cup');
  assert.equal(classifyTrophy({ typeId: 17 }), 'series');
  assert.equal(classifyTrophy({ typeId: 18 }), 'league');
  assert.equal(classifyTrophy({ typeId: 91 }), 'masters');
  assert.equal(classifyTrophy({ typeId: 103 }), 'tournament');
});

test('selector is deterministic, deduplicates facts, and never exceeds four sentences', () => {
  const fact = (id: string, topic: StoryCandidate['topic'], tier: StoryCandidate['tier'], score: number, tags: string[] = [], mandatory = false): StoryCandidate =>
    ({ id, topic, tier, score, tags, mandatory, segments: [id] });
  const candidates = [
    fact('role', 'exceptional-role', 0, 100, [], true),
    fact('tournament', 'tournament', 1, 100, ['team:1'], true),
    fact('main', 'primary-club', 2, 100, ['team:2']),
    fact('major-a', 'achievement', 3, 100, ['team:2']),
    fact('major-b', 'achievement', 3, 100, ['team:3']),
    fact('footprint', 'footprint', 4, 50),
  ];
  const first = selectStoryCandidates(candidates, 5, dateKey);
  assert.equal(first.length, 4);
  assert.deepEqual(first.map((item) => item.topic), ['exceptional-role', 'tournament', 'primary-club', 'achievement']);
  assert.deepEqual(selectStoryCandidates(candidates, 5, dateKey).map((item) => item.id), first.map((item) => item.id));
  const sameTeam = selectStoryCandidates([fact('tournament', 'tournament', 1, 100, [], true), fact('a', 'achievement', 3, 90, ['team:1']), fact('b', 'achievement', 3, 80, ['team:1'])], 1, dateKey);
  assert.equal(sameTeam.length, 2);
});

test('snapshot conversion preserves full current-club data while tournament relation stays distinct', () => {
  const spotlight = buildManagerSpotlight({ tournamentId: 't', dateKey, participants: [{ id: 'p', hattrick_user_id: 12, ht_team_id: 101 }], profiles: [{
    hattrick_user_id: 12, manager_name: 'Manager', country_id: 48, country_name: 'Latvia', language_name: 'Latviešu', teams_json: [
      { teamId: 100, teamName: 'Main', isPrimaryClub: true, foundedDate: '2003-01-01', teamRank: 83, powerLeagueRank: 2, countryId: 48, countryName: 'Latvia', regionName: 'Rīga' },
      { teamId: 101, teamName: 'Tournament', leagueId: 3000, leagueLevelUnitName: 'VI.1', teamRank: 12, countryId: 179, countryName: 'Guam' },
      { teamId: 102, teamName: 'Other', countryId: 145, countryName: 'Cambodia' },
    ],
  }], });
  assert.equal(spotlight?.currentTeams.length, 3);
  assert.deepEqual(getVisibleClubTeams(spotlight!).map((team) => team.teamId), [101, 100, 102]);
  assert.equal(spotlight?.language, 'Latviešu');
  assert.equal(spotlight?.currentTeams.find((team) => team.isPrimary)?.leagueRank, 83);
  assert.equal(spotlight?.currentTeams.find((team) => team.isPrimary)?.powerLeagueRank, 2);
  assert.equal(spotlight?.location[0], 'Rīga, ');
});
