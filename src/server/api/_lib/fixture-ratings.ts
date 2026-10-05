import { getAuthHeader } from './chpp-auth.js';
import { readChppTag } from './chpp-xml.js';
import { fetchManagerTeamsFromChpp, ManagerCompendiumRequestError } from './manager-compendium.js';
import { getManagerChppCredentials } from './matchmaker.js';
import { invalidatePublicTournament } from './tournament-cache.js';
import type { getServiceSupabase } from './supabase.js';
import type { SharedFixtureRatings } from '../../../types/fixture-ratings.js';

type Db = ReturnType<typeof getServiceSupabase>;
type Side = 'home' | 'away';
type Credentials = { oauth_token: string; oauth_token_secret: string };
type RatingValues = Pick<SharedFixtureRatings, 'left_attack' | 'centre_attack' | 'right_attack' | 'midfield' |
  'left_defence' | 'centre_defence' | 'right_defence' | 'formation' | 'tactic' | 'tactic_skill' | 'set_pieces_skill'>;

export class FixtureRatingsError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function assertExactClubOwnership(
  ownership: { hattrickUserId: number | null; teams: Array<{ teamId: number }> }, userId: number, teamId: number,
) {
  if (ownership.hattrickUserId !== userId || !ownership.teams.some((owned) => owned.teamId === teamId)) {
    throw new FixtureRatingsError(403, 'Your Hattrick account no longer owns this fixture club.');
  }
}

function block(xml: string, name: string): string {
  return xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] || '';
}

function requiredInteger(xml: string, tag: string, min: number, max: number): number {
  const raw = readChppTag(xml, tag);
  const value = Number(raw);
  if (!raw || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new FixtureRatingsError(502, `Hattrick returned an invalid ${tag} value.`);
  }
  return value;
}

export function convertSectorRating(raw: number): number {
  if (!Number.isSafeInteger(raw) || raw < 1 || raw > 80) throw new FixtureRatingsError(502, 'Hattrick returned an invalid sector rating.');
  return (raw + 3) / 4;
}

const TACTICS: Record<number, string> = {
  0: 'Normal', 1: 'Pressing', 2: 'Counter-attacks', 3: 'Attack in the middle',
  4: 'Attack in wings', 7: 'Play creatively', 8: 'Long shots',
};

export function parseSubmittedOrders(xml: string, matchId: number, teamId: number, opponentId: number) {
  if (Number(readChppTag(xml, 'MatchID')) !== matchId) throw new FixtureRatingsError(409, 'Hattrick returned a different match.');
  const data = block(xml, 'MatchData');
  if (!data || /<MatchData\b[^>]*Available=["']false["']/i.test(xml)) {
    throw new FixtureRatingsError(403, 'Hattrick denied access to these match orders. Reauthorize your account if needed.');
  }
  const homeId = Number(readChppTag(block(data, 'HomeTeam'), 'HomeTeamID'));
  const awayId = Number(readChppTag(block(data, 'AwayTeam'), 'AwayTeamID'));
  if (![homeId, awayId].includes(teamId) || ![homeId, awayId].includes(opponentId) || homeId === awayId) {
    throw new FixtureRatingsError(409, 'Hattrick returned a match with different clubs.');
  }
  const positions = block(block(data, 'Lineup'), 'Positions');
  const roleGroups = { defender: 0, midfielder: 0, forward: 0 };
  const roles = new Set<number>();
  for (const match of positions.matchAll(/<Player>([\s\S]*?)<\/Player>/gi)) {
    const player = match[1];
    const playerId = Number(readChppTag(player, 'PlayerID'));
    if (!Number.isSafeInteger(playerId) || playerId <= 0) continue;
    const role = requiredInteger(player, 'RoleID', 100, 113);
    if (roles.has(role)) throw new FixtureRatingsError(502, 'Hattrick returned duplicate starting roles.');
    roles.add(role);
    if (role === 100) continue;
    const behaviour = Number(readChppTag(player, 'Behaviour') || 0);
    const group = behaviour === 5 ? 'forward' : behaviour === 6 ? 'midfielder' : behaviour === 7 ? 'defender'
      : role <= 105 ? 'defender' : role <= 110 ? 'midfielder' : 'forward';
    roleGroups[group] += 1;
  }
  if (!roles.has(100) || roles.size < 2) throw new FixtureRatingsError(409, 'No submitted starting lineup is available for this match.');
  const tacticId = requiredInteger(data, 'TacticType', 0, 8);
  const tactic = TACTICS[tacticId];
  if (!tactic) throw new FixtureRatingsError(502, 'Hattrick returned an unknown tactic.');
  const takerId = Number(readChppTag(block(block(data, 'Lineup'), 'SetPieces'), 'PlayerID')) || null;
  return { formation: `${roleGroups.defender}-${roleGroups.midfielder}-${roleGroups.forward}`, tactic, takerId };
}

export function parsePredictedRatings(xml: string, matchId: number): Omit<RatingValues, 'formation' | 'tactic' | 'set_pieces_skill'> {
  if (Number(readChppTag(xml, 'MatchID')) !== matchId) throw new FixtureRatingsError(409, 'Hattrick returned a different match prediction.');
  if (/<MatchData\b[^>]*Available=["']false["']/i.test(xml)) {
    throw new FixtureRatingsError(403, 'Hattrick denied match-order prediction. Reauthorize your Hattrick account.');
  }
  const data = block(xml, 'MatchData');
  if (!data) throw new FixtureRatingsError(502, 'Hattrick returned no prediction.');
  const sector = (tag: string) => convertSectorRating(requiredInteger(data, tag, 1, 80));
  const tacticSkillRaw = readChppTag(data, 'TacticSkill');
  const tacticSkill = tacticSkillRaw ? requiredInteger(data, 'TacticSkill', 0, 30) : null;
  return {
    left_attack: sector('RatingLeftAtt'), centre_attack: sector('RatingMidAtt'), right_attack: sector('RatingRightAtt'),
    midfield: sector('RatingMidfield'), left_defence: sector('RatingLeftDef'),
    centre_defence: sector('RatingMidDef'), right_defence: sector('RatingRightDef'), tactic_skill: tacticSkill,
  };
}

export function parseSetPiecesSkill(xml: string, playerId: number): number | null {
  if (Number(readChppTag(xml, 'PlayerID')) !== playerId) return null;
  const raw = readChppTag(block(xml, 'PlayerSkills'), 'SetPiecesSkill');
  const value = Number(raw);
  return raw && Number.isSafeInteger(value) && value >= 0 && value <= 30 ? value : null;
}

async function chpp(file: string, version: string, credentials: Credentials, extra: Record<string, string>) {
  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) throw new FixtureRatingsError(500, 'CHPP is not configured.');
  const url = 'https://chpp.hattrick.org/chppxml.ashx';
  const params = { file, version, ...extra };
  const auth = getAuthHeader('GET', url, params, consumerKey, consumerSecret, credentials.oauth_token, credentials.oauth_token_secret);
  const response = await fetch(`${url}?${new URLSearchParams(params)}`, { headers: { Authorization: auth } });
  const xml = await response.text();
  const errorMessage = readChppTag(xml, 'ErrorMessage') || '';
  if (response.status === 401 || response.status === 403 ||
    /<ErrorCode>\s*(?:401|403)\s*<\/ErrorCode>/i.test(xml) ||
    /authoriz|permission|scope|access denied|not allowed/i.test(errorMessage)) {
    throw new FixtureRatingsError(403, 'Hattrick denied match-order access. Reauthorize your Hattrick account.');
  }
  if (!response.ok || /<ErrorCode>\s*[1-9]\d*\s*<\/ErrorCode>/i.test(xml)) {
    throw new FixtureRatingsError(502, `Hattrick could not return ${file}.`);
  }
  return xml;
}

export async function prediction(credentials: Credentials, matchId: number, teamId: number, opponentId: number): Promise<RatingValues> {
  const params = { matchID: String(matchId), teamID: String(teamId) };
  const orders = parseSubmittedOrders(await chpp('matchorders', '3.1', credentials, { ...params, actionType: 'view' }), matchId, teamId, opponentId);
  const ratings = parsePredictedRatings(await chpp('matchorders', '3.1', credentials, { ...params, actionType: 'predictratings' }), matchId);
  let setPiecesSkill: number | null = null;
  if (orders.takerId) {
    try {
      setPiecesSkill = parseSetPiecesSkill(await chpp('playerdetails', '3.2', credentials, { playerID: String(orders.takerId) }), orders.takerId);
    } catch { /* Optional enrichment cannot prevent a valid share. */ }
  }
  return { ...ratings, formation: orders.formation, tactic: orders.tactic, set_pieces_skill: setPiecesSkill };
}

export async function loadFixtureForRatings(db: Db, fixtureId: string) {
  const { data: fixture, error } = await db.from('matches')
    .select('id,round_id,home_team_id,away_team_id,ht_match_id,status,completed,scheduled_for,home_team:teams!matches_home_team_id_fkey(id,ht_team_id,hattrick_user_id,oauth_token,oauth_token_secret,active,is_placeholder),away_team:teams!matches_away_team_id_fkey(id,ht_team_id,hattrick_user_id,oauth_token,oauth_token_secret,active,is_placeholder)')
    .eq('id', fixtureId).maybeSingle();
  if (error) throw error;
  if (!fixture) throw new FixtureRatingsError(404, 'Fixture not found.');
  const { data: round, error: roundError } = await db.from('rounds').select('id,tournament_id,season_number').eq('id', fixture.round_id).maybeSingle();
  if (roundError) throw roundError;
  if (!round) throw new FixtureRatingsError(404, 'Fixture round not found.');
  const { data: tournament, error: tournamentError } = await db.from('tournaments').select('id,season,status,is_archived').eq('id', round.tournament_id).maybeSingle();
  if (tournamentError) throw tournamentError;
  if (!tournament) throw new FixtureRatingsError(404, 'Tournament not found.');
  return { fixture, round, tournament };
}

export function assertEligibleFixtureRatings(input: Awaited<ReturnType<typeof loadFixtureForRatings>>) {
  const { fixture, round, tournament } = input;
  const home = fixture.home_team;
  const away = fixture.away_team;
  const kickoff = fixture.scheduled_for ? new Date(fixture.scheduled_for).getTime() : NaN;
  if (tournament.is_archived || ['finished', 'archived', 'cancelled'].includes(tournament.status || '') ||
    Number(round.season_number) !== Number(tournament.season) || fixture.status !== 'arranged' || fixture.completed ||
    !Number.isSafeInteger(Number(fixture.ht_match_id)) || Number(fixture.ht_match_id) <= 0 ||
    !Number.isFinite(kickoff) || kickoff <= Date.now() ||
    !home || !away || home.active !== true || away.active !== true || home.is_placeholder || away.is_placeholder ||
    !Number.isSafeInteger(Number(home.ht_team_id)) || Number(home.ht_team_id) <= 0 ||
    !Number.isSafeInteger(Number(away.ht_team_id)) || Number(away.ht_team_id) <= 0 ||
    home.ht_team_id === away.ht_team_id || home.id === away.id) {
    throw new FixtureRatingsError(409, 'Only an upcoming arranged fixture with two active clubs can share ratings.');
  }
}

export async function updateExistingRatingShare(db: Db, rowId: string, payload: RatingValues & { ht_match_id: number; fetched_at: string }) {
  // The row ID is never reused. If Remove deleted it during CHPP fetch, this
  // update affects zero rows and cannot recreate sharing.
  const { data, error } = await db.from('fixture_predicted_rating_shares')
    .update(payload).eq('id', rowId).select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new FixtureRatingsError(409, 'Sharing was removed while ratings were loading.');
}

async function invalidateAfterRatingWrite(invalidate: typeof invalidatePublicTournament, tournamentId: string) {
  try {
    await invalidate(tournamentId);
  } catch (error) {
    // The database write has succeeded. A failed purge must not turn it into
    // an apparent failed Share/Remove or trigger a second CHPP read.
    console.error('[fixture-ratings] tournament cache invalidation failed', { tournamentId, error });
  }
}

export async function saveFixtureRatings(
  db: Db, fixtureId: string, side: Side, userId: number, action: 'share' | 'update' | 'remove',
  invalidate = invalidatePublicTournament,
) {
  const context = await loadFixtureForRatings(db, fixtureId);
  const { fixture, tournament } = context;
  const team = side === 'home' ? fixture.home_team : fixture.away_team;
  if (!team || Number(team.hattrick_user_id) !== userId) throw new FixtureRatingsError(403, 'You do not manage this fixture club.');
  const { data: existing, error: existingError } = await db.from('fixture_predicted_rating_shares').select('id,ht_match_id').eq('fixture_id', fixtureId).eq('team_id', team.id).maybeSingle();
  if (existingError) throw existingError;
  if (action !== 'remove') assertEligibleFixtureRatings(context);
  const credentials = await getManagerChppCredentials(db, userId);
  if (!credentials || !team.oauth_token || !team.oauth_token_secret) throw new FixtureRatingsError(401, 'Your Hattrick authorization is missing. Sign in with Hattrick again.');
  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) throw new FixtureRatingsError(500, 'CHPP is not configured.');
  let ownership;
  try {
    // Omit userID: a supplied ID can describe someone else's public clubs.
    ownership = await fetchManagerTeamsFromChpp(consumerKey, consumerSecret, credentials);
  } catch (error) {
    if (error instanceof ManagerCompendiumRequestError && [401, 403].includes(error.status)) {
      throw new FixtureRatingsError(403, 'Hattrick denied team access. Reauthorize your Hattrick account.');
    }
    throw error;
  }
  assertExactClubOwnership(ownership, userId, Number(team.ht_team_id));
  if (action === 'remove') {
    if (existing) {
      const { error } = await db.from('fixture_predicted_rating_shares').delete().eq('id', existing.id);
      if (error) throw error;
      await invalidateAfterRatingWrite(invalidate, tournament.id);
    }
    return null;
  }
  if (action === 'share' && existing && Number(existing.ht_match_id) === Number(fixture.ht_match_id)) throw new FixtureRatingsError(409, 'This club has already shared ratings.');
  if (action === 'update' && !existing) throw new FixtureRatingsError(409, 'This club has not shared ratings.');
  const opponent = side === 'home' ? fixture.away_team : fixture.home_team;
  const values = await prediction(credentials, Number(fixture.ht_match_id), Number(team.ht_team_id), Number(opponent?.ht_team_id));
  const latest = await loadFixtureForRatings(db, fixtureId);
  assertEligibleFixtureRatings(latest);
  const latestTeam = side === 'home' ? latest.fixture.home_team : latest.fixture.away_team;
  if (Number(latest.fixture.ht_match_id) !== Number(fixture.ht_match_id) ||
    latest.fixture.home_team_id !== fixture.home_team_id || latest.fixture.away_team_id !== fixture.away_team_id ||
    Number(latestTeam?.hattrick_user_id) !== userId) {
    throw new FixtureRatingsError(409, 'The fixture changed while Hattrick was loading. Try again.');
  }
  const payload = { ...values, ht_match_id: Number(fixture.ht_match_id), fetched_at: new Date().toISOString() };
  if (existing) {
    await updateExistingRatingShare(db, existing.id, payload);
  } else {
    const { error } = await db.from('fixture_predicted_rating_shares').insert({ fixture_id: fixtureId, team_id: team.id, ...payload });
    if (error) throw error;
  }
  await invalidateAfterRatingWrite(invalidate, tournament.id);
  return { ...payload, fixture_id: fixtureId, team_id: team.id };
}

export async function refreshSharedFixtureRatings(db: Db, tournamentId: string, roundId: string) {
  const { data: matches, error } = await db.from('matches').select('id').eq('round_id', roundId);
  if (error) throw error;
  const ids = (matches || []).map((match) => match.id);
  if (!ids.length) return 0;
  const { data: shares, error: sharesError } = await db.from('fixture_predicted_rating_shares').select('id,fixture_id,team_id').in('fixture_id', ids);
  if (sharesError) throw sharesError;
  let refreshed = 0;
  for (const share of shares || []) {
    try {
      const context = await loadFixtureForRatings(db, share.fixture_id);
      assertEligibleFixtureRatings(context);
      if (context.tournament.id !== tournamentId) continue;
      const side: Side = context.fixture.home_team_id === share.team_id ? 'home' : 'away';
      const team = side === 'home' ? context.fixture.home_team : context.fixture.away_team;
      if (!team || team.id !== share.team_id || !team.hattrick_user_id) continue;
      await saveFixtureRatings(db, share.fixture_id, side, Number(team.hattrick_user_id), 'update');
      refreshed++;
    } catch (error) {
      console.warn('[fixture-ratings] snapshot refresh failed', { fixtureId: share.fixture_id, reason: error instanceof Error ? error.message : 'unknown' });
    }
  }
  return refreshed;
}
