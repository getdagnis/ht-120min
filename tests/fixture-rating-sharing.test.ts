import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  autoShareFixtureRatings, loadRatingSharingPreferences, setRatingSharingPreference,
} from '../src/server/api/_lib/fixture-ratings.js';
import app from '../src/server/api/app.js';
import { buildAppSessionCookie } from '../src/server/api/_lib/app-session.js';

const originalFetch = globalThis.fetch;
const envNames = ['CHPP_CONSUMER_KEY', 'CHPP_CONSUMER_SECRET', 'APP_SESSION_SECRET'];
const priorEnv = Object.fromEntries(envNames.map((key) => [key, process.env[key]]));
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of envNames) {
    if (priorEnv[key] === undefined) delete process.env[key]; else process.env[key] = priorEnv[key];
  }
});

function fixtureDb() {
  const club = (id: string, htTeam: number, owner: number) => ({ id, ht_team_id: htTeam, name: id,
    hattrick_user_id: owner, active: true, reserve_active: false, is_placeholder: false,
    tournament_id: 'cup', oauth_token: `${owner}-token`, oauth_token_secret: 'secret' });
  const home = club('home', 11, 7), away = club('away', 22, 8), second = club('second', 33, 7);
  const rows: Record<string, Array<Record<string, unknown>>> = {
    tournaments: [{ id: 'cup', status: 'active', season: 1, is_archived: false }],
    rounds: [{ id: 'round', tournament_id: 'cup', season_number: 1 }],
    teams: [home, away, second],
    matches: [{ id: 'fixture', round_id: 'round', status: 'arranged', completed: false, ht_match_id: 123,
      home_team_id: home.id, away_team_id: away.id, home_team: home, away_team: away,
      scheduled_for: new Date(Date.now() + 86_400_000).toISOString() }],
    profiles: [7, 8].map((owner) => ({ hattrick_user_id: owner, oauth_token: `${owner}-token`, oauth_token_secret: 'secret' })),
    fixture_predicted_rating_shares: [], tournament_team_rating_preferences: [],
  };
  const disabled = new Set<string>(), suppressed = new Set<string>(), claimed = new Set<string>();
  const calls: string[] = [];
  const db = {
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const result = () => ({ data: (rows[table] || []).filter((row) => filters.every((filter) => filter(row))), error: null });
      const query = {
        select() { return query; },
        eq(key: string, value: unknown) { filters.push((row) => row[key] === value); return query; },
        gt(key: string, value: string) { filters.push((row) => String(row[key]) > value); return query; },
        not(key: string, _op: string, value: unknown) { filters.push((row) => row[key] !== value); return query; },
        async maybeSingle() { return { ...result(), data: result().data[0] || null }; },
        then(resolve: (value: ReturnType<typeof result>) => void) { resolve(result()); },
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push(String(args.p_action || name));
      const teamId = String(args.p_team_id);
      if (name === 'set_team_rating_sharing') {
        if (args.p_enabled === false) disabled.add(teamId); else disabled.delete(teamId);
        return { data: null, error: null };
      }
      const exists = rows.fixture_predicted_rating_shares.some((row) => row.team_id === teamId);
      if (args.p_action === 'claim') {
        if (exists || disabled.has(teamId) || suppressed.has(teamId) || claimed.has(teamId)) return { data: null, error: null };
        claimed.add(teamId);
        return { data: { claim_id: `claim-${teamId}` }, error: null };
      }
      if (args.p_action === 'release') { claimed.delete(teamId); return { data: null, error: null }; }
      if (args.p_action === 'automatic' && !disabled.has(teamId) && !suppressed.has(teamId) && claimed.has(teamId)) {
        rows.fixture_predicted_rating_shares.push({ team_id: teamId, fixture_id: args.p_fixture_id, ...args.p_payload as object });
        return { data: { saved: true }, error: null };
      }
      return { data: null, error: null };
    },
  };
  return { db, rows, disabled, suppressed, calls };
}

function fakeChpp(owned = [11, 33], onPrediction?: () => void) {
  process.env.CHPP_CONSUMER_KEY = 'test-key'; process.env.CHPP_CONSUMER_SECRET = 'test-secret';
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const file = url.searchParams.get('file')!;
    calls.push(`${file}:${url.searchParams.get('actionType') || ''}`);
    const owner = String((init?.headers as Record<string, string>).Authorization).includes('7-token') ? 7 : 8;
    if (file === 'managercompendium') return new Response(`<HattrickData><Manager><UserId>${owner}</UserId><Loginname>Manager</Loginname><Teams>${(owner === 7 ? owned : [22]).map((team) => `<Team><TeamId>${team}</TeamId><TeamName>Club</TeamName></Team>`).join('')}</Teams></Manager></HattrickData>`);
    if (file === 'players') return new Response('<HattrickData/>');
    if (url.searchParams.get('actionType') === 'view') return new Response(`<HattrickData><MatchID>123</MatchID><MatchData Available="True"><HomeTeam><HomeTeamID>11</HomeTeamID></HomeTeam><AwayTeam><AwayTeamID>22</AwayTeamID></AwayTeam><TacticType>0</TacticType><Lineup><Positions><Player><PlayerID>1</PlayerID><RoleID>100</RoleID></Player><Player><PlayerID>2</PlayerID><RoleID>101</RoleID></Player></Positions></Lineup></MatchData></HattrickData>`);
    onPrediction?.();
    return new Response(`<HattrickData><MatchID>123</MatchID><MatchData>${['RatingLeftAtt', 'RatingMidAtt', 'RatingRightAtt', 'RatingMidfield', 'RatingLeftDef', 'RatingMidDef', 'RatingRightDef'].map((sector) => `<${sector}>37</${sector}>`).join('')}</MatchData></HattrickData>`);
  };
  return calls;
}

test('background publishes each side once, then performs no prediction or orders reads', async () => {
  const { db, rows } = fixtureDb(); const requests = fakeChpp();
  const orders = new Map([['home', new Map([[123, true]])], ['away', new Map([[123, true]])]]);
  assert.equal(await autoShareFixtureRatings(db as never, 'cup', 'round', orders, async () => {}), 2);
  assert.equal(rows.fixture_predicted_rating_shares.length, 2);
  const before = requests.length;
  let ordersReads = 0;
  assert.equal(await autoShareFixtureRatings(db as never, 'cup', 'round', new Map(), async () => {}, async () => {
    ordersReads++; return new Map([[123, true]]);
  }), 0);
  assert.equal(requests.length, before); assert.equal(ordersReads, 0);
});

test('false/missing orders and unavailable ownership never publish, and opt-out racing prediction prevents publication', async () => {
  const { db, rows, disabled } = fixtureDb(); const requests = fakeChpp();
  for (const value of [false, null]) {
    assert.equal(await autoShareFixtureRatings(db as never, 'cup', 'round', new Map([['home', new Map([[123, value]])]]), async () => {}), 0);
  }
  assert.equal(requests.length, 0);
  fakeChpp([]);
  const orders = new Map([['home', new Map([[123, true]])]]);
  assert.equal(await autoShareFixtureRatings(db as never, 'cup', 'round', orders, async () => {}), 0);
  fakeChpp([11], () => disabled.add('home'));
  assert.equal(await autoShareFixtureRatings(db as never, 'cup', 'round', orders, async () => {}), 0);
  assert.equal(rows.fixture_predicted_rating_shares.length, 0);
});

test('default-on preferences cover multiple exact clubs and reject unrelated or no-longer-owned clubs', async () => {
  const { db, rows, calls } = fixtureDb(); fakeChpp();
  rows.tournament_team_rating_preferences.push({ tournament_id: 'cup', hattrick_user_id: 7, team_id: 'second', enabled: false });
  assert.deepEqual(await loadRatingSharingPreferences(db as never, 'cup', 7), [
    { teamId: 'home', teamName: 'home', enabled: true }, { teamId: 'second', teamName: 'second', enabled: false },
  ]);
  await assert.rejects(setRatingSharingPreference(db as never, 'cup', 'away', 7, false), /do not manage/);
  assert.equal(calls.length, 0);
  fakeChpp([33]);
  await assert.rejects(setRatingSharingPreference(db as never, 'cup', 'home', 7, false), /do not manage/);
  fakeChpp();
  await setRatingSharingPreference(db as never, 'cup', 'second', 7, false, async () => {});
  assert.deepEqual(calls, ['set_team_rating_sharing']);
  rows.tournaments[0].season = 2;
  assert.equal((await loadRatingSharingPreferences(db as never, 'cup', 7))[1].enabled, false);
});

test('a manager profile can authorize an exact club without a team-row token; missing orders still cannot share', async () => {
  const { db, rows } = fixtureDb(); fakeChpp();
  rows.teams[0].oauth_token = null; rows.teams[0].oauth_token_secret = null;
  const reads: string[] = [];
  assert.equal(await autoShareFixtureRatings(db as never, 'cup', 'round', new Map(), async () => {}, async (teamId) => {
    reads.push(teamId);
    return new Map([[123, teamId === 'home' ? true : null]]);
  }), 1);
  assert.deepEqual(reads, ['home', 'away']);
  assert.equal(rows.fixture_predicted_rating_shares[0].team_id, 'home');
});

test('preference API requires a signed-in manager and validates writes before database access', async () => {
  process.env.APP_SESSION_SECRET = 'ratings-test-secret';
  const invoke = async (cookie?: string, body: Record<string, unknown> = {}) => {
    let status = 200;
    const response = { status(value: number) { status = value; return response; }, json() { return response; }, setHeader() {} };
    await app({ method: 'POST', query: { route: 'rating-sharing-preferences' }, headers: { cookie }, body } as never, response as never);
    return status;
  };
  assert.equal(await invoke(), 401);
  const cookie = buildAppSessionCookie(7, 'ratings-test-secret', false);
  assert.equal(await invoke(cookie, { tournamentId: 'invalid', enabled: false }), 400);
  assert.equal(await invoke(cookie, { tournamentId: '20000000-0000-0000-0000-000000000001', teamId: '20000000-0000-0000-0000-000000000002', enabled: 'false' }), 400);
});
