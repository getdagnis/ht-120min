import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  assertEligibleFixtureRatings, assertExactClubOwnership, convertSectorRating,
  parsePredictedRatings, parseSetPiecesSkill, parseSubmittedOrders, prediction, saveFixtureRatings,
  updateExistingRatingShare,
} from '../src/server/api/_lib/fixture-ratings.ts';
import { attachFixtureRatings, type SharedFixtureRatings } from '../src/types/fixture-ratings.ts';

const positions = [
  [100, 0], [101, 0], [102, 0], [104, 0], [105, 0],
  [106, 6], [107, 0], [108, 0], [109, 0], [110, 0], [111, 0],
];

function ordersXml(entries = positions, taker = 777) {
  return `<HattrickData><MatchID>123</MatchID><MatchData Available="True">
    <HomeTeam><HomeTeamID>11</HomeTeamID></HomeTeam><AwayTeam><AwayTeamID>22</AwayTeamID></AwayTeam>
    <TacticType>1</TacticType><Lineup><Positions>${entries.map(([role, behaviour], index) =>
      `<Player><PlayerID>${index + 1}</PlayerID><RoleID>${role}</RoleID><Behaviour>${behaviour}</Behaviour></Player>`).join('')}
    </Positions><SetPieces><PlayerID>${taker}</PlayerID></SetPieces></Lineup>
  </MatchData></HattrickData>`;
}

function ratingsXml(value = 1) {
  return `<HattrickData><MatchID>123</MatchID><MatchData><TacticSkill>8</TacticSkill>
    ${['RatingLeftAtt', 'RatingMidAtt', 'RatingRightAtt', 'RatingMidfield',
      'RatingLeftDef', 'RatingMidDef', 'RatingRightDef'].map((name) => `<${name}>${value}</${name}>`).join('')}
  </MatchData></HattrickData>`;
}

test('converts CHPP sublevels and rejects invalid sector values', () => {
  assert.equal(convertSectorRating(1), 1);
  assert.equal(convertSectorRating(4), 1.75);
  assert.equal(convertSectorRating(5), 2);
  assert.equal(convertSectorRating(80), 20.75);
  assert.throws(() => convertSectorRating(0));
  assert.throws(() => convertSectorRating(81));
  assert.equal(parsePredictedRatings(ratingsXml(80), 123).left_attack, 20.75);
});

test('formation counts occupied roles after extra-position behaviours', () => {
  const result = parseSubmittedOrders(ordersXml(), 123, 11, 22);
  assert.deepEqual(result, { formation: '4-5-1', tactic: 'Pressing', takerId: 777 });
  const extra = positions.map(([role, behaviour]) => role === 105 ? [role, 5] : [role, behaviour]);
  assert.equal(parseSubmittedOrders(ordersXml(extra, 0), 123, 11, 22).formation, '3-5-2');
  assert.throws(() => parseSubmittedOrders(ordersXml(), 123, 11, 33), /different clubs/);
  assert.throws(() => parseSubmittedOrders(ordersXml().replace('Available="True"', 'Available="False"'), 123, 11, 22), /denied access/);
});

test('optional set-pieces skill is parsed only for the selected player', () => {
  const xml = '<HattrickData><Player><PlayerID>777</PlayerID><PlayerSkills><SetPiecesSkill>9</SetPiecesSkill></PlayerSkills></Player></HattrickData>';
  assert.equal(parseSetPiecesSkill(xml, 777), 9);
  assert.equal(parseSetPiecesSkill(xml, 778), null);
  assert.equal(parseSetPiecesSkill('<HattrickData><PlayerID>777</PlayerID></HattrickData>', 777), null);
});

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('Share prediction requests view, prediction and selected taker, but tolerates unavailable optional skill', async () => {
  process.env.CHPP_CONSUMER_KEY = 'test-key';
  process.env.CHPP_CONSUMER_SECRET = 'test-secret';
  const calls: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.searchParams.get('actionType') === 'view') return new Response(ordersXml());
    if (url.searchParams.get('actionType') === 'predictratings') return new Response(ratingsXml(37));
    return new Response('Unavailable', { status: 403 });
  };
  const result = await prediction({ oauth_token: 'token', oauth_token_secret: 'secret' }, 123, 11, 22);
  assert.equal(result.midfield, 10);
  assert.equal(result.formation, '4-5-1');
  assert.equal(result.set_pieces_skill, null);
  assert.deepEqual(calls.map((call) => [call.searchParams.get('file'), call.searchParams.get('actionType')]), [
    ['matchorders', 'view'], ['matchorders', 'predictratings'], ['playerdetails', null],
  ]);
});

test('failed match-order authorization stops before prediction and cannot yield a partial snapshot', async () => {
  process.env.CHPP_CONSUMER_KEY = 'test-key';
  process.env.CHPP_CONSUMER_SECRET = 'test-secret';
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('Denied', { status: 403 }); };
  await assert.rejects(prediction({ oauth_token: 'token', oauth_token_secret: 'secret' }, 123, 11, 22), /denied match-order access/);
  assert.equal(calls, 1);
});

test('public attachment drops rows for changed MatchIDs', () => {
  const row = { id: 'share', fixture_id: 'fixture', team_id: 'team', ht_match_id: 123 } as SharedFixtureRatings;
  assert.deepEqual(attachFixtureRatings([{ id: 'fixture', ht_match_id: 124, home_team_id: 'team' }], [row])[0].shared_ratings, []);
  assert.deepEqual(attachFixtureRatings([{ id: 'fixture', ht_match_id: 123, home_team_id: 'other' }], [row])[0].shared_ratings, []);
  assert.deepEqual(attachFixtureRatings([{ id: 'fixture', ht_match_id: 123, home_team_id: 'team' }], [row])[0].shared_ratings, [row]);
});

test('a multi-club manager can act for either exact club, but another manager or club cannot', () => {
  const owned = { hattrickUserId: 7, teams: [{ teamId: 11 }, { teamId: 22 }] };
  assert.doesNotThrow(() => assertExactClubOwnership(owned, 7, 22));
  assert.throws(() => assertExactClubOwnership(owned, 7, 33), /no longer owns/);
  assert.throws(() => assertExactClubOwnership(owned, 8, 11), /no longer owns/);
});

test('only current, arranged, upcoming fixtures with two active clubs can publish', () => {
  const context = {
    fixture: { status: 'arranged', completed: false, ht_match_id: 123,
      scheduled_for: new Date(Date.now() + 86_400_000).toISOString(),
      home_team: { id: 'home', ht_team_id: 11, active: true, is_placeholder: false },
      away_team: { id: 'away', ht_team_id: 22, active: true, is_placeholder: false } },
    round: { season_number: 2 }, tournament: { season: 2, status: 'active', is_archived: false },
  };
  assert.doesNotThrow(() => assertEligibleFixtureRatings(context as never));
  assert.throws(() => assertEligibleFixtureRatings({ ...context, fixture: { ...context.fixture, ht_match_id: null } } as never));
  assert.throws(() => assertEligibleFixtureRatings({ ...context, fixture: { ...context.fixture, scheduled_for: new Date(Date.now() - 1000).toISOString() } } as never));
  assert.throws(() => assertEligibleFixtureRatings({ ...context, fixture: { ...context.fixture, status: 'finished' } } as never));
});

test('a removed share cannot be restored by an in-flight prediction update', async () => {
  const attempted: Array<[string, unknown]> = [];
  const db = {
    from(table: string) {
      assert.equal(table, 'fixture_predicted_rating_shares');
      return { update(payload: unknown) {
        attempted.push(['update', payload]);
        return { eq(key: string, id: string) {
          attempted.push([key, id]);
          return { select() { return { maybeSingle: async () => ({ data: null, error: null }) }; } };
        } };
      } };
    },
  };
  await assert.rejects(updateExistingRatingShare(db as never, 'deleted-row-id', {
    left_attack: 1, centre_attack: 1, right_attack: 1, midfield: 1,
    left_defence: 1, centre_defence: 1, right_defence: 1,
    formation: '4-5-1', tactic: 'Normal', tactic_skill: 1, set_pieces_skill: null,
    ht_match_id: 123, fetched_at: '2026-10-05T00:00:00.000Z',
  }), /removed while ratings were loading/);
  assert.equal(attempted[1][0], 'id');
  assert.equal(attempted[1][1], 'deleted-row-id');
});

test('home and away shares remain independent through update, failed refresh, and Remove racing an update', async () => {
  process.env.CHPP_CONSUMER_KEY = 'test-key';
  process.env.CHPP_CONSUMER_SECRET = 'test-secret';
  const rows: Record<string, Array<Record<string, unknown>>> = {
    matches: [{ id: 'fixture', round_id: 'round', home_team_id: 'home', away_team_id: 'away',
      ht_match_id: 123, status: 'arranged', completed: false,
      scheduled_for: new Date(Date.now() + 86_400_000).toISOString(),
      home_team: { id: 'home', ht_team_id: 11, hattrick_user_id: 7, oauth_token: 'home-token', oauth_token_secret: 'secret', active: true, is_placeholder: false },
      away_team: { id: 'away', ht_team_id: 22, hattrick_user_id: 8, oauth_token: 'away-token', oauth_token_secret: 'secret', active: true, is_placeholder: false } }],
    rounds: [{ id: 'round', tournament_id: 'tournament', season_number: 1 }],
    tournaments: [{ id: 'tournament', season: 1, status: 'active', is_archived: false }],
    profiles: [
      { hattrick_user_id: 7, oauth_token: 'home-token', oauth_token_secret: 'secret', teams_json: null },
      { hattrick_user_id: 8, oauth_token: 'away-token', oauth_token_secret: 'secret', teams_json: null },
    ],
    fixture_predicted_rating_shares: [],
  };
  const db = {
    from(table: string) {
      let mode = 'select';
      let payload: Record<string, unknown> = {};
      const filters: Array<[string, unknown]> = [];
      const query = {
        select() { return query; },
        eq(key: string, value: unknown) { filters.push([key, value]); return query; },
        update(value: Record<string, unknown>) { mode = 'update'; payload = value; return query; },
        delete() { mode = 'delete'; return query; },
        async insert(value: Record<string, unknown>) {
          rows[table].push({ id: `share-${rows[table].length + 1}`, ...value });
          return { error: null };
        },
        async maybeSingle() {
          const row = rows[table].find((item) => filters.every(([key, value]) => item[key] === value)) || null;
          if (row && mode === 'update') Object.assign(row, payload);
          return { data: row, error: null };
        },
        then(resolve: (value: { error: null }) => void) {
          if (mode === 'delete') rows[table] = rows[table].filter((item) => !filters.every(([key, value]) => item[key] === value));
          resolve({ error: null });
        },
      };
      return query;
    },
  };
  let predictionValue = 37;
  let denyPrediction = false;
  let pausePrediction = false;
  let releasePrediction: (() => void) | null = null;
  let notifyPaused: (() => void) | null = null;
  const paused = new Promise<void>((resolve) => { notifyPaused = resolve; });
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const authorization = String((init?.headers as Record<string, string>)?.Authorization || '');
    const managerId = authorization.includes('home-token') ? 7 : 8;
    if (url.searchParams.get('file') === 'managercompendium') {
      const clubId = managerId === 7 ? 11 : 22;
      return new Response(`<HattrickData><Manager><UserId>${managerId}</UserId><Loginname>Manager</Loginname><Teams><Team><TeamId>${clubId}</TeamId><TeamName>Club</TeamName></Team><Team><TeamId>99</TeamId><TeamName>Other club</TeamName></Team></Teams></Manager></HattrickData>`);
    }
    if (url.searchParams.get('actionType') === 'view') return new Response(ordersXml(positions, 0));
    if (url.searchParams.get('actionType') === 'predictratings') {
      if (pausePrediction) {
        notifyPaused?.();
        await new Promise<void>((resolve) => { releasePrediction = resolve; });
      }
      return denyPrediction ? new Response('Denied', { status: 403 }) : new Response(ratingsXml(predictionValue));
    }
    throw new Error(`Unexpected CHPP request: ${url.searchParams.get('file')}`);
  };
  const invalidate = async () => {};
  await saveFixtureRatings(db as never, 'fixture', 'home', 7, 'share', invalidate);
  await saveFixtureRatings(db as never, 'fixture', 'away', 8, 'share', invalidate);
  assert.equal(rows.fixture_predicted_rating_shares.length, 2);
  predictionValue = 41;
  await saveFixtureRatings(db as never, 'fixture', 'home', 7, 'update', invalidate);
  assert.equal(rows.fixture_predicted_rating_shares.find((row) => row.team_id === 'home')?.midfield, 11);
  assert.equal(rows.fixture_predicted_rating_shares.find((row) => row.team_id === 'away')?.midfield, 10);
  denyPrediction = true;
  const oldAway = { ...rows.fixture_predicted_rating_shares.find((row) => row.team_id === 'away') };
  await assert.rejects(saveFixtureRatings(db as never, 'fixture', 'away', 8, 'update', invalidate), /denied match-order access/);
  assert.deepEqual(rows.fixture_predicted_rating_shares.find((row) => row.team_id === 'away'), oldAway);
  denyPrediction = false;
  pausePrediction = true;
  const inFlight = saveFixtureRatings(db as never, 'fixture', 'away', 8, 'update', invalidate);
  await paused;
  await saveFixtureRatings(db as never, 'fixture', 'away', 8, 'remove', invalidate);
  releasePrediction?.();
  await assert.rejects(inFlight, /removed while ratings were loading/);
  assert.equal(rows.fixture_predicted_rating_shares.length, 1);
  assert.equal(rows.fixture_predicted_rating_shares[0].team_id, 'home');
  await assert.rejects(saveFixtureRatings(db as never, 'fixture', 'home', 8, 'update', invalidate), /do not manage/);
  rows.matches[0].ht_match_id = 124;
  pausePrediction = false;
  await assert.rejects(saveFixtureRatings(db as never, 'fixture', 'away', 8, 'share', invalidate), /different match/);
  rows.matches[0].status = 'finished';
  await assert.rejects(saveFixtureRatings(db as never, 'fixture', 'away', 8, 'share', invalidate), /upcoming arranged fixture/);
  assert.equal(rows.fixture_predicted_rating_shares.length, 1);
});
