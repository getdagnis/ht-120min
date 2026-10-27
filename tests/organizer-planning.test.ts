import assert from 'node:assert/strict';
import test from 'node:test';
import { insideSlot, previousFriendlyWindowEnd, importPairingCsv, exportPairingCsv, validateFinalObservations, type SlotObservation } from '../shared/organizer-planning.js';
import { parseChppStockholmDate } from '../shared/chpp-dates.js';
import { cachedCollection, checkSlot, proposalHash, readVerification, startVerification } from '../src/server/api/_lib/organizer-planning.js';
import { getServiceSupabase } from '../src/server/api/_lib/supabase.js';
import { persistTeamFlagSnapshot } from '../src/server/api/_lib/flag-collections.js';
import { createScarcityDraft, FLAG_COUNTRIES, reviewFlagDraft } from '../shared/flag-pairing.js';
import { getLeagueWorldDetails } from '../shared/worlddetails.js';
import type { FlagCollection, FlagHunterTeam } from '../shared/flag-hunters.js';
import { proposeOrganizerPairs } from '../src/utils/organizer-pairing-assistant.js';
import type { OrganizerRoundTeam } from '../src/utils/organizer-round.js';
import type { CalendarSlot } from '../src/utils/hattrick-calendar.js';

const weekend = { kind: 'weekend_friendly', nominalDate: new Date('2026-10-31T00:00:00+01:00') } as CalendarSlot;
const teams: OrganizerRoundTeam[] = Array.from({ length: 6 }, (_, i) => ({ id: `local-${i + 1}`, ht_team_id: i + 1,
  hattrick_user_id: i + 1, name: `Team ${i + 1}`, active: true, reserve_active: false, league_id: 1, country_id: 1, gender_id: 1 }));
const pair = { homeTeamId: teams[0].id, awayTeamId: teams[1].id, isBye: false };
const free = (teamId: string): SlotObservation => ({ teamId, state: 'free', checkedAt: '2026-10-26T12:00:00Z',
  reason: 'Checked', pendingOpponentIds: [], challengesKnown: true });

test('selected weekend ignores Wednesday bookings and handles Stockholm midnight boundaries', () => {
  assert.equal(insideSlot(parseChppStockholmDate('2026-10-28 14:00:00')!, weekend), false);
  assert.equal(insideSlot(parseChppStockholmDate('2026-10-31 00:00:00')!, weekend), true);
  assert.equal(insideSlot(parseChppStockholmDate('2026-11-01 23:59:59')!, weekend), true);
  assert.equal(insideSlot(parseChppStockholmDate('2026-11-02 00:00:00')!, weekend), false);
  assert.equal(previousFriendlyWindowEnd(weekend), Date.parse('2026-10-29T11:00:00Z'));
});

test('weekend slot covers both sides of the autumn DST transition', () => {
  const dst = { ...weekend, nominalDate: new Date('2026-10-24T00:00:00+02:00') };
  assert.equal(insideSlot(new Date('2026-10-23T22:00:00Z'), dst), true);
  assert.equal(insideSlot(new Date('2026-10-25T22:59:59Z'), dst), true);
  assert.equal(insideSlot(new Date('2026-10-25T23:00:00Z'), dst), false);
});

test('legacy flag caches are unknown until directional uncertainty has been persisted', () => {
  const cached = { teamId: 1, teamName: 'Team 1', leagueId: 1, countryId: 1,
    homeFlagLeagueIds: [], awayFlagLeagueIds: [], flagsFetchedAt: '2026-10-30T00:00:00Z' };
  assert.equal(cachedCollection(teams[0], cached)?.homeUnknown, true);
  const explicit = cachedCollection(teams[0], { ...cached, homeFlagsUnknown: false, awayFlagsUnknown: true });
  assert.equal(explicit?.homeUnknown, false); assert.equal(explicit?.awayUnknown, true);
  assert.equal(cachedCollection({ ...teams[0], country_id: 2 }, cached), undefined);
});

test('CSV keeps venue and stable Hattrick identities and rejects foreign teams', () => {
  assert.deepEqual(importPairingCsv(exportPairingCsv([pair], teams), teams), [pair]);
  assert.throws(() => importPairingCsv('home_ht_team_id,away_ht_team_id\n1,999', teams), /Unknown/);
  const bye = importPairingCsv('home_ht_team_id,away_ht_team_id\n1,', teams);
  assert.equal(bye[0].awayTeamId, null); assert.equal(bye[0].isBye, true);
});

test('final verification refuses missing, unknown, conflicting and pending observations', () => {
  const checks = { [teams[0].id]: free(teams[0].id), [teams[1].id]: free(teams[1].id) };
  assert.equal(validateFinalObservations([pair], teams, checks, [], false), null);
  assert.match(validateFinalObservations([pair], teams, {}, [], false)!, /incomplete/);
  assert.match(validateFinalObservations([pair], teams, { ...checks, [teams[0].id]: { ...checks[teams[0].id], state: 'unknown' } }, [], false)!, /unknown/);
  const pending = { ...checks, [teams[0].id]: { ...checks[teams[0].id], pendingOpponentIds: [2] } };
  assert.match(validateFinalObservations([pair], teams, pending, [], true)!, /outgoing challenges/);
  assert.equal(validateFinalObservations([pair], teams, pending, [], true, [pair]), null);
  const booked = { ...checks[teams[0].id], state: 'booked' as const, booking: { matchId: 100, homeId: 1, awayId: 2, kickoff: '2026-10-31T10:00:00Z' } };
  assert.equal(validateFinalObservations([pair], teams, { ...checks, [teams[0].id]: booked }, [], false), null);
  assert.match(validateFinalObservations([pair], teams, { ...checks, [teams[0].id]: booked }, [], true)!, /Refresh tournament fixtures/);
  const conflict = { ...checks, [teams[0].id]: booked, [teams[1].id]: { ...booked, teamId: teams[1].id, booking: { ...booked.booking, awayId: 99 } } };
  assert.match(validateFinalObservations([pair], teams, conflict, [], false)!, /changed/);
  assert.equal(validateFinalObservations([pair], teams, conflict, [pair], true), null, 'protected fixtures remain unchanged');
});

test('verification signatures bind the exact proposal, actor, tournament and slot', () => {
  const previous = process.env.APP_SESSION_SECRET;
  process.env.APP_SESSION_SECRET = 'organizer-planning-test-only';
  try {
    const hash = proposalHash({ pairs: [pair], rosterVersion: 'v1' });
    const token = startVerification(hash, 10, 'tournament', 'weekend');
    assert.ok(readVerification(token, hash, 10, 'tournament', 'weekend').id);
    assert.throws(() => readVerification(token, hash, 11, 'tournament', 'weekend'));
    assert.throws(() => readVerification(token, proposalHash({ pairs: [] }), 10, 'tournament', 'weekend'));
    assert.throws(() => readVerification(`${token}x`, hash, 10, 'tournament', 'weekend'));
  } finally { if (previous === undefined) delete process.env.APP_SESSION_SECRET; else process.env.APP_SESSION_SECRET = previous; }
});

test('manager-first proposals can trade a higher-priority second gain for another manager', () => {
  const makeTeam = (id: number, country: number, managerId: number): FlagHunterTeam => ({ id: `local-${id}`, htTeamId: id, name: `Team ${id}`,
    managerId, managerName: '', leagueId: country, countryId: getLeagueWorldDetails(country)!.countryId,
    flagCountryId: country, countryName: '', managerCountryId: null, genderId: 1 });
  const roster = [makeTeam(1, 1, 10), makeTeam(2, 2, 10), makeTeam(3, 3, 20), makeTeam(4, 154, 30), makeTeam(5, 133, 40), makeTeam(6, 4, 50)];
  const flags = Object.fromEntries(roster.map(team => {
    const missing = team.htTeamId === 1 ? [154] : team.htTeamId === 2 ? [133] : team.htTeamId === 3 ? [154, 124] : [];
    const collection: FlagCollection = { htTeamId: team.htTeamId, managerId: team.managerId, leagueId: team.leagueId,
      home: FLAG_COUNTRIES.filter(id => !missing.includes(id)), away: FLAG_COUNTRIES.filter(id => !missing.includes(id)),
      homeUnknown: false, awayUnknown: false, fetchedAt: '2026-10-30T00:00:00Z' };
    return [String(team.htTeamId), collection];
  }));
  const draft = createScarcityDraft(roster, flags, 'coverage', null, { managerFirst: true });
  const review = reviewFlagDraft(draft, roster, flags);
  assert.equal(review.summary.gainingManagers, 2);
  assert.equal(review.rows.find(row => row.teamId === 3)?.gainCountryId, 154);
});

test('repair preserves surviving pairs, excludes unavailable teams, and rematches the broken partner', () => {
  const previous = [pair, { homeTeamId: teams[2].id, awayTeamId: teams[3].id, isBye: false },
    { homeTeamId: teams[4].id, awayTeamId: teams[5].id, isBye: false }];
  const checks = Object.fromEntries(teams.map(team => [team.id, free(team.id)]));
  checks[teams[0].id] = { ...checks[teams[0].id], state: 'blocked' };
  const result = proposeOrganizerPairs({ teams, checks, flags: {}, previous, protectedPairs: [], history: [], seed: 'repair', repair: true, balanced: false });
  assert.equal(result.pairs.some(row => row.homeTeamId === teams[0].id || row.awayTeamId === teams[0].id), false);
  for (const intact of previous.slice(1)) assert.ok(result.pairs.some(row => row.homeTeamId === intact.homeTeamId && row.awayTeamId === intact.awayTeamId));
  assert.equal(result.pairs.filter(row => row.homeTeamId && row.awayTeamId).length, 2);
});

test('synthetic 160-team proposal covers the available roster without same-manager pairs', () => {
  const roster: OrganizerRoundTeam[] = Array.from({ length: 160 }, (_, i) => ({ ...teams[0], id: `large-${i}`, ht_team_id: i + 100,
    hattrick_user_id: Math.floor(i / 2) + 100, name: `Team ${i}` }));
  const checks = Object.fromEntries(roster.map(team => [team.id, free(team.id)]));
  const result = proposeOrganizerPairs({ teams: roster, checks, flags: {}, previous: [], protectedPairs: [], history: [], seed: 'large', repair: false, balanced: false });
  assert.equal(result.pairs.length, 80);
  assert.equal(new Set(result.pairs.flatMap(row => [row.homeTeamId, row.awayTeamId])).size, 160);
  for (const pair of result.pairs) assert.notEqual(roster.find(team => team.id === pair.homeTeamId)?.hattrick_user_id, roster.find(team => team.id === pair.awayTeamId)?.hattrick_user_id);
});

test('CHPP checks inspect every match in the selected slot and fail closed on incomplete responses', async () => {
  const originalFetch = globalThis.fetch, originalEnv = { ...process.env };
  Object.assign(process.env, { SUPABASE_URL: 'https://organizer-test.invalid', SUPABASE_SECRET_KEY: 'test-service',
    CHPP_CONSUMER_KEY: 'test-consumer', CHPP_CONSUMER_SECRET: 'test-secret' });
  let fixtures = '', offers = '<ChallengesByMe/><OffersByOthers/>', complete = true, failed = false;
  const match = (id: number, date: string, type = 4) => `<Match><MatchID>${id}</MatchID><MatchDate>${date}</MatchDate><MatchType>${type}</MatchType><HomeTeamID>1</HomeTeamID><AwayTeamID>2</AwayTeamID><Status>UPCOMING</Status></Match>`;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(init?.method || 'GET', 'GET', 'checks must never issue a challenge or database write');
    if (url.hostname === 'organizer-test.invalid') return Response.json({ hattrick_user_id: 1, oauth_token: 'test-token', oauth_token_secret: 'test-token-secret' });
    assert.equal(url.hostname, 'chpp.hattrick.org');
    if (url.searchParams.get('file') === 'matches') {
      assert.equal(url.searchParams.get('teamID'), '1');
      return failed ? new Response('failed', { status: 503 }) : new Response(`<HattrickData><Team><TeamID>1</TeamID>${complete ? `<MatchList>${fixtures}</MatchList>` : ''}</Team></HattrickData>`);
    }
    assert.equal(url.searchParams.get('file'), 'challenges'); assert.equal(url.searchParams.get('actionType'), 'view');
    assert.equal(url.searchParams.get('teamId'), '1'); assert.equal(url.searchParams.get('isWeekendFriendly'), '1');
    return new Response(`<HattrickData><Team><TeamID>1</TeamID>${offers}</Team></HattrickData>`);
  };
  try {
    const db = getServiceSupabase();
    fixtures = match(100, '2026-10-28 14:00:00');
    assert.equal((await checkSlot(db, teams[0], weekend)).state, 'free');
    fixtures += match(101, '2026-10-31 14:00:00');
    const booked = await checkSlot(db, teams[0], weekend);
    assert.equal(booked.state, 'booked'); assert.equal(booked.booking?.matchId, 101);
    fixtures = match(102, '2026-10-31 14:00:00', 2);
    const qualifier = await checkSlot(db, teams[0], weekend, new Set(), { includeOccupiedChallenges: true });
    assert.equal(qualifier.state, 'blocked'); assert.equal(qualifier.matchType, 2);
    assert.equal(qualifier.booking?.matchId, 102); assert.equal(qualifier.challengesKnown, true);
    offers = '<OffersByOthers/>';
    const failedOffers = await checkSlot(db, teams[0], weekend, new Set(), { includeOccupiedChallenges: true });
    assert.equal(failedOffers.state, 'blocked'); assert.equal(failedOffers.challengesKnown, false);
    const fallback = await checkSlot(db, { ...teams[0], hattrick_user_id: null }, weekend, new Set(), { fallback: { oauth_token: 'fallback', oauth_token_secret: 'fallback-secret' } });
    assert.equal(fallback.state, 'blocked');
    fixtures = '';
    offers = '<ChallengesByMe/><OffersByOthers/>';
    offers = '<ChallengesByMe><Challenge><TrainingMatchID>5</TrainingMatchID><MatchTime>2026-10-28 14:00:00</MatchTime><IsAgreed>False</IsAgreed><Opponent><TeamID>2</TeamID></Opponent></Challenge></ChallengesByMe><OffersByOthers/>';
    assert.deepEqual((await checkSlot(db, teams[0], weekend)).pendingOpponentIds, []);
    offers = offers.replace('2026-10-28', '2026-10-31');
    assert.deepEqual((await checkSlot(db, teams[0], weekend)).pendingOpponentIds, [2]);
    offers = offers.replace('False', 'True');
    assert.equal((await checkSlot(db, teams[0], weekend)).state, 'unknown', 'accepted offer missing from matches needs a recheck');
    complete = false;
    assert.equal((await checkSlot(db, teams[0], weekend)).state, 'unknown');
    complete = true; failed = true;
    assert.equal((await checkSlot(db, teams[0], weekend)).state, 'unknown');
  } finally { globalThis.fetch = originalFetch; process.env = originalEnv; }
});

test('flag persistence uses a narrow merge RPC rather than a full profile update', async () => {
  const originalFetch = globalThis.fetch, originalEnv = { ...process.env };
  Object.assign(process.env, { SUPABASE_URL: 'https://organizer-test.invalid', SUPABASE_SECRET_KEY: 'test-service' });
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.hostname, 'organizer-test.invalid');
    assert.ok(url.pathname.endsWith('/rpc/save_team_flag_snapshot')); assert.equal(init?.method, 'POST');
    const body = JSON.parse(String(init.body));
    assert.equal(body.p_manager_id, 1); assert.equal(body.p_team_id, 1);
    assert.equal(body.p_patch.awayFlagsUnknown, true);
    assert.equal(body.p_missing_team, null); assert.equal('teams_json' in body, false);
    calls++; return Response.json(true);
  };
  try {
    await persistTeamFlagSnapshot(getServiceSupabase(), 1, 1, { homeFlagLeagueIds: [], awayFlagLeagueIds: [],
      homeFlagsUnknown: false, awayFlagsUnknown: true, flagsFetchedAt: '2026-10-30T00:00:00Z' });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; process.env = originalEnv; }
});
