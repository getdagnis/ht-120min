import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildArchiveDateChunks,
  mergeChppMatchesById,
  parseChppMatchesXml,
  type ParsedChppMatch,
} from '../shared/matches-archive';

function matchXml(matchId: number, date: string, matchType = 4, homeId = 10, awayId = 20) {
  return `<Match><MatchID>${matchId}</MatchID><HomeTeam><HomeTeamID>${homeId}</HomeTeamID><HomeTeamName>Home</HomeTeamName></HomeTeam><AwayTeam><AwayTeamID>${awayId}</AwayTeamID><AwayTeamName>Away</AwayTeamName></AwayTeam><MatchDate>${date} 12:00:00</MatchDate><MatchType>${matchType}</MatchType><HomeGoals>1</HomeGoals><AwayGoals>0</AwayGoals></Match>`;
}

test('archive chunks and merges more than 50 source matches without losing matches', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  const end = new Date('2026-04-01T00:00:00Z');
  const chunks = buildArchiveDateChunks(start, end, 4);
  assert.equal(chunks.length, 4);

  const source = Array.from({ length: 60 }, (_, index) => ({
    matchId: index + 1,
    date: new Date(start.getTime() + index * 24 * 60 * 60 * 1000),
  }));
  const parsedChunks = chunks.map((chunk) => {
    const matches = source.filter((item) => item.date >= chunk.firstDate && item.date <= chunk.lastDate);
    const xml = matches.map((item) => matchXml(item.matchId, item.date.toISOString().slice(0, 10))).join('');
    return parseChppMatchesXml(xml, { archive: true, matchTypes: new Set([4]), ...chunk }).matches;
  });

  assert.equal(mergeChppMatchesById(parsedChunks).length, 60);
});

test('archive parsing filters categories before team and imported-match filtering', () => {
  const parsed = parseChppMatchesXml(
    `${matchXml(1, '2026-01-02', 4, 10, 20)}${matchXml(2, '2026-01-03', 3, 10, 20)}${matchXml(3, '2026-01-04', 4, 10, 30)}`,
    { archive: true, matchTypes: new Set([4]) },
  );
  const registered = new Set([10, 20]);
  const imported = new Set([1]);
  const eligible = parsed.matches.filter(
    (match) => registered.has(match.homeId) && registered.has(match.awayId) && !imported.has(match.matchId),
  );

  assert.equal(parsed.rawMatchesReturned, 3);
  assert.equal(parsed.selectedCategoryMatches, 2);
  assert.deepEqual(eligible.map((match) => match.matchId), []);
});

test('duplicate archive matches returned through both teams merge by Match ID', () => {
  const match: ParsedChppMatch = {
    matchId: 42,
    homeId: 10,
    awayId: 20,
    homeName: 'Home',
    awayName: 'Away',
    date: new Date('2026-01-02T12:00:00Z'),
    matchType: 4,
    homeGoals: 1,
    awayGoals: 0,
    status: 'FINISHED',
  };
  assert.equal(mergeChppMatchesById([[match], [{ ...match }]]).length, 1);
});
