import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { attachRefreshedTakerSkills } from '../src/server/api/chpp/live-matches.ts';
import type { MatchEventDetails } from '../shared/match-events.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function emptyDetails(homeTeamId: number, awayTeamId: number): MatchEventDetails {
  const side = (teamId: number) => ({
    teamId,
    cards: [],
    injuries: [],
    performance: {
      formation: '5-5-0', tacticType: 1, tacticName: 'Pressing', tacticSkill: 5,
      setPiecesTaker: null,
      possessionFirstHalf: null, possessionSecondHalf: null,
      ratings: { midfield: null, rightDefence: null, centralDefence: null, leftDefence: null, rightAttack: null, centralAttack: null, leftAttack: null },
      chances: { left: null, centre: null, right: null, specialEvents: null, other: null },
    },
  });
  return {
    version: 3,
    source: 'matchdetails-3.1',
    actualHomeTeamId: homeTeamId,
    actualAwayTeamId: awayTeamId,
    home: side(homeTeamId),
    away: side(awayTeamId),
  };
}

test('automatically reads each finished side with its own stored owner credentials and reuses captured skills', async () => {
  process.env.CHPP_CONSUMER_KEY = 'test-consumer';
  process.env.CHPP_CONSUMER_SECRET = 'test-secret';
  const calls: Array<{ file: string | null; teamId: string | null; playerId: string | null; authorization: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const file = url.searchParams.get('file');
    const teamId = url.searchParams.get('teamID');
    const playerId = url.searchParams.get('playerID');
    calls.push({ file, teamId, playerId, authorization: new Headers(init?.headers).get('Authorization') });
    if (file === 'matchlineup') {
      const takerId = teamId === '3220514' ? 511613256 : 510206216;
      const firstName = teamId === '3220514' ? 'Sandra' : 'Dorothy';
      const lastName = teamId === '3220514' ? 'Primo' : 'Lobaton';
      return new Response(`<HattrickData><MatchID>771759602</MatchID><Team><TeamID>${teamId}</TeamID><Lineup><Player><PlayerID>${takerId}</PlayerID><RoleID>17</RoleID><FirstName>${firstName}</FirstName><LastName>${lastName}</LastName></Player></Lineup></Team></HattrickData>`);
    }
    const skill = playerId === '511613256' ? 10 : 6;
    return new Response(`<HattrickData><Player><PlayerID>${playerId}</PlayerID><PlayerSkills><SetPiecesSkill>${skill}</SetPiecesSkill></PlayerSkills></Player></HattrickData>`);
  };

  const fixture = {
    scheduledHomeHtId: 3220514,
    scheduledAwayHtId: 3220516,
    reserveHtTeamId: null,
    reserveReplacesSide: null,
    teams: [
      { htTeamId: 3220514, oauthToken: 'home-owner-token', oauthTokenSecret: 'home-owner-secret' },
      { htTeamId: 3220516, oauthToken: 'away-owner-token', oauthTokenSecret: 'away-owner-secret' },
    ],
  };
  const actual = emptyDetails(3220514, 3220516);
  const refreshed = emptyDetails(3220514, 3220516);

  await attachRefreshedTakerSkills(actual, refreshed, null, fixture, 771759602);

  assert.equal(refreshed.home.performance?.setPiecesTaker?.playerId, 511613256);
  assert.equal(refreshed.home.performance?.setPiecesTaker?.playerName, 'Sandra Primo');
  assert.equal(refreshed.home.performance?.setPiecesTaker?.skill, 10);
  assert.ok(refreshed.home.performance?.setPiecesTaker?.skillCheckedAt);
  assert.equal(refreshed.away.performance?.setPiecesTaker?.playerName, 'Dorothy Lobaton');
  assert.equal(refreshed.away.performance?.setPiecesTaker?.skill, 6);
  assert.ok(calls.find((call) => call.file === 'matchlineup' && call.teamId === '3220514')?.authorization?.includes('oauth_token="home-owner-token"'));
  assert.ok(calls.find((call) => call.file === 'matchlineup' && call.teamId === '3220516')?.authorization?.includes('oauth_token="away-owner-token"'));
  assert.deepEqual(calls.map((call) => call.file), ['matchlineup', 'playerdetails', 'matchlineup', 'playerdetails']);

  const persisted = JSON.parse(JSON.stringify(refreshed)) as MatchEventDetails;
  delete persisted.home.performance?.setPiecesTaker?.playerId;
  delete persisted.away.performance?.setPiecesTaker?.playerId;
  const nextRefresh = emptyDetails(3220514, 3220516);
  await attachRefreshedTakerSkills(actual, nextRefresh, persisted, fixture, 771759602);
  assert.equal(calls.length, 4);
  assert.equal(nextRefresh.home.performance?.setPiecesTaker?.skill, 10);
  assert.equal(nextRefresh.away.performance?.setPiecesTaker?.skill, 6);
});
