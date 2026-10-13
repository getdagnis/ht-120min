import { getAuthHeader } from './chpp-auth.js';
import { readChppTag } from './chpp-xml.js';
import { fetchManagerTeamsFromChpp, fetchOwnedTeamPlayerSpecialtiesFromChpp, ManagerCompendiumRequestError } from './manager-compendium.js';
import { getManagerChppCredentials } from './matchmaker.js';
import { invalidatePublicTournament } from './tournament-cache.js';
import type { getServiceSupabase } from './supabase.js';
import { PRIVATE_FIXTURE_RATINGS_FIELDS, type SharedFixtureRatings } from '../../../types/fixture-ratings.js';
import { summarizeSpecialtyPositions, type PlayerLineupRole } from '../../../../shared/player-specialties.js';

// Local development only: set false to test normal participant visibility.
// Save this file, then reload the tournament page; no dev-server restart needed.
const LOCAL_ADMIN_VIEW_ALL_SHARED_RATINGS = true;

type Db = ReturnType<typeof getServiceSupabase>;
type Side = 'home' | 'away';
type Credentials = { oauth_token: string; oauth_token_secret: string };
type RatingValues = Pick<SharedFixtureRatings, 'left_attack' | 'centre_attack' | 'right_attack' | 'midfield' |
  'left_defence' | 'centre_defence' | 'right_defence' | 'formation' | 'tactic' | 'tactic_skill' |
  'coach_modifier' | 'set_pieces_skill'>;
type SharedRatingValues = RatingValues & { specialty_positions: SharedFixtureRatings['specialty_positions'] };
type FixtureClub = {
  id: string;
  ht_team_id: number | null;
  hattrick_user_id: number | null;
  oauth_token: string | null;
  oauth_token_secret: string | null;
  active: boolean | null;
  is_placeholder: boolean | null;
};

export class FixtureRatingsError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function isLocalRatingsAdmin(host: string, environment: string | undefined, configuredId: string | undefined, sessionId: number, enabled = LOCAL_ADMIN_VIEW_ALL_SHARED_RATINGS) {
  return enabled && environment === 'development' && configuredId === '8777402' && sessionId === 8777402 &&
    /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(:\d+)?$/i.test(host);
}

export function assertExactClubOwnership(
  ownership: { hattrickUserId: number | null; teams: Array<{ teamId: number }> }, userId: number, teamId: number,
) {
  if (ownership.hattrickUserId !== userId || !ownership.teams.some((owned) => owned.teamId === teamId)) {
    throw new FixtureRatingsError(403, 'Your Hattrick account no longer owns this fixture club.');
  }
}

async function verifiedManagerClubs(db: Db, userId: number, specialtyTeamId?: number) {
  const credentials = await getManagerChppCredentials(db, userId);
  if (!credentials) throw new FixtureRatingsError(401, 'Your Hattrick authorization is missing. Sign in with Hattrick again.');
  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) throw new FixtureRatingsError(500, 'CHPP is not configured.');
  let ownership;
  let specialties: Map<number, number> | undefined;
  try {
    // Omitting userID asks CHPP for the token holder's clubs, not a public manager profile.
    ownership = await fetchManagerTeamsFromChpp(consumerKey, consumerSecret, credentials);
  } catch (error) {
    if (error instanceof ManagerCompendiumRequestError && [401, 403].includes(error.status)) {
      throw new FixtureRatingsError(403, 'Hattrick denied team access. Reauthorize your Hattrick account.');
    }
    throw error;
  }
  if (ownership.hattrickUserId !== userId) {
    throw new FixtureRatingsError(403, 'Your Hattrick account does not match this session. Sign in again.');
  }
  if (specialtyTeamId !== undefined) {
    assertExactClubOwnership(ownership, userId, specialtyTeamId);
    try {
      specialties = await fetchOwnedTeamPlayerSpecialtiesFromChpp(consumerKey, consumerSecret, credentials, specialtyTeamId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown CHPP error';
      console.warn(`[fixture-ratings] player specialties unavailable for team ${specialtyTeamId}: ${message}`);
    }
  }
  return { credentials, teamIds: new Set(ownership.teams.map((team) => team.teamId)), specialties };
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

function optionalIntegerTag(xml: string, tag: string, min: number, max: number): number | null {
  const match = xml.match(new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!match || /\bAvailable\s*=\s*["']false["']/i.test(match[1] || '')) return null;
  const raw = match[2].trim();
  const value = Number(raw);
  return raw && Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
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
  const lineup: PlayerLineupRole[] = [];
  for (const match of positions.matchAll(/<Player>([\s\S]*?)<\/Player>/gi)) {
    const player = match[1];
    const playerId = Number(readChppTag(player, 'PlayerID'));
    if (!Number.isSafeInteger(playerId) || playerId <= 0) continue;
    const role = requiredInteger(player, 'RoleID', 100, 113);
    if (roles.has(role)) throw new FixtureRatingsError(502, 'Hattrick returned duplicate starting roles.');
    roles.add(role);
    lineup.push({ playerId, roleId: role });
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
  const coachModifier = optionalIntegerTag(data, 'CoachModifier', -10, 10);
  const takerId = Number(readChppTag(block(block(data, 'Lineup'), 'SetPieces'), 'PlayerID')) || null;
  return { formation: `${roleGroups.defender}-${roleGroups.midfielder}-${roleGroups.forward}`, tactic, coachModifier, takerId, lineup };
}

export function parsePredictedRatings(xml: string, matchId: number): Omit<RatingValues, 'formation' | 'tactic' | 'coach_modifier' | 'set_pieces_skill'> {
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

export async function fetchSetPiecesSkillForPlayer(credentials: Credentials, playerId: number) {
  if (!Number.isSafeInteger(playerId) || playerId <= 0) return null;
  const xml = await chpp('playerdetails', '3.2', credentials, { playerID: String(playerId) });
  const skill = parseSetPiecesSkill(xml, playerId);
  return skill === null ? null : { skill, checkedAt: new Date().toISOString() };
}

export function parseMatchLineupSetPiecesTaker(xml: string, matchId: number, teamId: number) {
  if (Number(readChppTag(xml, 'MatchID')) !== matchId) return null;
  const team = [...xml.matchAll(/<Team(?:\s[^>]*)?>([\s\S]*?)<\/Team>/gi)]
    .map((match) => match[1])
    .find((candidate) => Number(readChppTag(candidate, 'TeamID')) === teamId);
  if (!team) return null;

  // MatchLineup records the resolved set-pieces taker in role 17. Prefer the
  // kickoff lineup; the final lineup is a fallback for payloads that omit it.
  const lineup = (name: 'StartingLineup' | 'Lineup') => {
    const content = block(team, name);
    for (const match of content.matchAll(/<Player(?:\s[^>]*)?>([\s\S]*?)<\/Player>/gi)) {
      const player = match[1];
      if (Number(readChppTag(player, 'RoleID')) !== 17) continue;
      const playerId = Number(readChppTag(player, 'PlayerID'));
      if (!Number.isSafeInteger(playerId) || playerId <= 0) continue;
      const name = [readChppTag(player, 'FirstName'), readChppTag(player, 'NickName'), readChppTag(player, 'LastName')]
        .filter(Boolean).join(' ');
      return { playerId, playerName: name || null };
    }
    return null;
  };

  return lineup('StartingLineup') || lineup('Lineup');
}

export function parseMatchLineupStartingPlayers(xml: string, matchId: number, teamId: number): PlayerLineupRole[] {
  if (Number(readChppTag(xml, 'MatchID')) !== matchId) return [];
  const team = [...xml.matchAll(/<Team(?:\s[^>]*)?>([\s\S]*?)<\/Team>/gi)]
    .map((match) => match[1])
    .find((candidate) => Number(readChppTag(candidate, 'TeamID')) === teamId);
  const lineup = team ? block(team, 'StartingLineup') : '';
  const players: PlayerLineupRole[] = [];
  for (const match of lineup.matchAll(/<Player(?:\s[^>]*)?>([\s\S]*?)<\/Player>/gi)) {
    const playerId = Number(readChppTag(match[1], 'PlayerID'));
    const roleId = Number(readChppTag(match[1], 'RoleID'));
    if (Number.isSafeInteger(playerId) && playerId > 0 && Number.isInteger(roleId) && roleId >= 100 && roleId <= 113) {
      players.push({ playerId, roleId });
    }
  }
  return players;
}

export function parseMatchLineupStyleOfPlay(xml: string, matchId: number, teamId: number): number | null {
  if (Number(readChppTag(xml, 'MatchID')) !== matchId) return null;
  const team = [...xml.matchAll(/<Team(?:\s[^>]*)?>([\s\S]*?)<\/Team>/gi)]
    .map((match) => match[1])
    .find((candidate) => Number(readChppTag(candidate, 'TeamID')) === teamId);
  return team ? optionalIntegerTag(team, 'StyleOfPlay', -1000, 1000) : null;
}

export async function fetchMatchLineupDetails(credentials: Credentials, matchId: number, teamId: number) {
  const xml = await chpp('matchlineup', '2.1', credentials, {
    matchID: String(matchId),
    teamID: String(teamId),
    actionType: 'view',
  });
  return {
    taker: parseMatchLineupSetPiecesTaker(xml, matchId, teamId),
    lineup: parseMatchLineupStartingPlayers(xml, matchId, teamId),
    styleOfPlay: parseMatchLineupStyleOfPlay(xml, matchId, teamId),
  };
}

export async function fetchMatchLineupSetPiecesTaker(credentials: Credentials, matchId: number, teamId: number) {
  const xml = await chpp('matchlineup', '2.1', credentials, {
    matchID: String(matchId),
    teamID: String(teamId),
    actionType: 'view',
  });
  return parseMatchLineupSetPiecesTaker(xml, matchId, teamId);
}

async function chpp(file: string, version: string, credentials: Credentials, extra: Record<string, string>) {
  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) throw new FixtureRatingsError(500, 'CHPP is not configured.');
  const url = 'https://chpp.hattrick.org/chppxml.ashx';
  const params = { file, version, ...extra };
  const auth = getAuthHeader('GET', url, params, consumerKey, consumerSecret, credentials.oauth_token, credentials.oauth_token_secret);
  const response = await fetch(`${url}?${new URLSearchParams(params)}`, {
    headers: { Authorization: auth }, signal: AbortSignal.timeout(15_000),
  });
  const xml = await response.text();
  const errorMessage = readChppTag(xml, 'ErrorMessage') || '';
  if (response.status === 401 || response.status === 403 ||
    /<ErrorCode>\s*(?:401|403)\s*<\/ErrorCode>/i.test(xml) ||
    /authoriz|permission|scope|access denied|not allowed/i.test(errorMessage)) {
    throw new FixtureRatingsError(403, 'Hattrick denied CHPP access. Reauthorize your Hattrick account.');
  }
  if (!response.ok || /<ErrorCode>\s*[1-9]\d*\s*<\/ErrorCode>/i.test(xml)) {
    throw new FixtureRatingsError(502, `Hattrick could not return ${file}.`);
  }
  return xml;
}

export async function prediction(credentials: Credentials, matchId: number, teamId: number, opponentId: number, specialties?: ReadonlyMap<number, number>): Promise<SharedRatingValues> {
  const params = { matchID: String(matchId), teamID: String(teamId) };
  const orders = parseSubmittedOrders(await chpp('matchorders', '3.1', credentials, { ...params, actionType: 'view' }), matchId, teamId, opponentId);
  const ratings = parsePredictedRatings(await chpp('matchorders', '3.1', credentials, { ...params, actionType: 'predictratings' }), matchId);
  let setPiecesSkill: number | null = null;
  if (orders.takerId) {
    try {
      setPiecesSkill = parseSetPiecesSkill(await chpp('playerdetails', '3.2', credentials, { playerID: String(orders.takerId) }), orders.takerId);
    } catch { /* Optional enrichment cannot prevent a valid share. */ }
  }
  return {
    ...ratings,
    formation: orders.formation,
    tactic: orders.tactic,
    coach_modifier: orders.coachModifier,
    set_pieces_skill: setPiecesSkill,
    specialty_positions: specialties ? summarizeSpecialtyPositions(orders.lineup, specialties) : null,
  };
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
  // These two FK aliases are singular clubs. Without a generated database
  // schema Supabase infers them as arrays, so state the actual query contract.
  const typedFixture = fixture as unknown as Omit<typeof fixture, 'home_team' | 'away_team'> & {
    home_team: FixtureClub | null; away_team: FixtureClub | null;
  };
  return { fixture: typedFixture, round, tournament };
}

/** Private, uncached read for the exact managers of upcoming arranged fixtures. */
export async function loadVisibleFixtureRatings(db: Db, tournamentId: string, userId: number, localAdmin = false) {
  const { data: tournament, error: tournamentError } = await db.from('tournaments')
    .select('id,season,status,is_archived').eq('id', tournamentId).maybeSingle();
  if (tournamentError) throw tournamentError;
  if (!tournament || tournament.is_archived || ['finished', 'archived', 'cancelled'].includes(tournament.status || '')) {
    return [];
  }
  const { data: rounds, error: roundsError } = await db.from('rounds')
    .select('id,season_number').eq('tournament_id', tournamentId).eq('season_number', tournament.season);
  if (roundsError) throw roundsError;
  const roundIds = (rounds || []).map((round) => round.id);
  if (!roundIds.length) return [];
  const { data: matches, error: matchesError } = await db.from('matches')
    .select('id,round_id,home_team_id,away_team_id,ht_match_id,status,completed,scheduled_for,home_team:teams!matches_home_team_id_fkey(id,ht_team_id,hattrick_user_id,active,is_placeholder),away_team:teams!matches_away_team_id_fkey(id,ht_team_id,hattrick_user_id,active,is_placeholder)')
    .in('round_id', roundIds).eq('status', 'arranged').eq('completed', false);
  if (matchesError) throw matchesError;
  const roundById = new Map((rounds || []).map((round) => [round.id, round]));
  const candidates = (matches || []).filter((fixture) => {
    const round = roundById.get(fixture.round_id);
    if (!round || (!localAdmin && ![fixture.home_team, fixture.away_team].some((team) => Number(team?.hattrick_user_id) === userId))) return false;
    try { assertEligibleFixtureRatings({ fixture, round, tournament } as unknown as Awaited<ReturnType<typeof loadFixtureForRatings>>); return true; }
    catch { return false; }
  });
  if (!candidates.length) return [];
  const teamIds = localAdmin ? null : (await verifiedManagerClubs(db, userId)).teamIds;
  const authorized = candidates.flatMap((fixture) => {
    const ownedSides: Side[] = [];
    if (Number(fixture.home_team?.hattrick_user_id) === userId && (localAdmin || teamIds?.has(Number(fixture.home_team.ht_team_id)))) ownedSides.push('home');
    if (Number(fixture.away_team?.hattrick_user_id) === userId && (localAdmin || teamIds?.has(Number(fixture.away_team.ht_team_id)))) ownedSides.push('away');
    return localAdmin || ownedSides.length ? [{ fixture, ownedSides }] : [];
  });
  if (!authorized.length) return [];
  const fixtureIds = authorized.map(({ fixture }) => fixture.id);
  const [{ data: shares, error: sharesError }, { data: latestMatches, error: latestError }] = await Promise.all([
    db.from('fixture_predicted_rating_shares').select(PRIVATE_FIXTURE_RATINGS_FIELDS).in('fixture_id', fixtureIds),
    db.from('matches').select('id,home_team_id,away_team_id,ht_match_id,status,completed,scheduled_for').in('id', fixtureIds),
  ]);
  if (sharesError) throw sharesError;
  if (latestError) throw latestError;
  const latestById = new Map((latestMatches || []).map((match) => [match.id, match]));
  return authorized.flatMap(({ fixture, ownedSides }) => {
    const latest = latestById.get(fixture.id);
    if (!latest || latest.home_team_id !== fixture.home_team_id || latest.away_team_id !== fixture.away_team_id ||
      Number(latest.ht_match_id) !== Number(fixture.ht_match_id) || latest.status !== 'arranged' || latest.completed ||
      !latest.scheduled_for || new Date(latest.scheduled_for).getTime() <= Date.now()) return [];
    return [{
      fixtureId: fixture.id,
      ownedSides,
      ratings: ((shares || []) as SharedFixtureRatings[]).filter((share) =>
        share.fixture_id === fixture.id && Number(share.ht_match_id) === Number(latest.ht_match_id) &&
        [latest.home_team_id, latest.away_team_id].includes(share.team_id)),
    }];
  });
}

export function assertEligibleFixtureRatings(input: Awaited<ReturnType<typeof loadFixtureForRatings>>) {
  const { fixture, round, tournament } = input;
  const home = fixture.home_team;
  const away = fixture.away_team;
  const kickoff = fixture.scheduled_for ? new Date(fixture.scheduled_for).getTime() : NaN;
  if (tournament.is_archived || ['finished', 'archived', 'cancelled', 'stopped'].includes(tournament.status || '') ||
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

function ratingFixtureContext(fixture: Awaited<ReturnType<typeof loadFixtureForRatings>>['fixture']) {
  return {
    home_team_id: fixture.home_team_id, away_team_id: fixture.away_team_id,
    home_ht_team_id: Number(fixture.home_team?.ht_team_id), away_ht_team_id: Number(fixture.away_team?.ht_team_id),
  };
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
  const { credentials, teamIds, specialties } = await verifiedManagerClubs(
    db, userId, action === 'remove' ? undefined : Number(team.ht_team_id),
  );
  if (!teamIds.has(Number(team.ht_team_id))) throw new FixtureRatingsError(403, 'Your Hattrick account no longer owns this fixture club.');
  if (action === 'remove') {
    await ratingSharingAction(db, fixtureId, team.id, userId, Number(fixture.ht_match_id), 'remove');
    await invalidateAfterRatingWrite(invalidate, tournament.id);
    return null;
  }
  if (action === 'share' && existing && Number(existing.ht_match_id) === Number(fixture.ht_match_id)) throw new FixtureRatingsError(409, 'This club has already shared ratings.');
  if (action === 'update' && !existing) throw new FixtureRatingsError(409, 'This club has not shared ratings.');
  const opponent = side === 'home' ? fixture.away_team : fixture.home_team;
  const values = await prediction(credentials, Number(fixture.ht_match_id), Number(team.ht_team_id), Number(opponent?.ht_team_id), specialties);
  const latest = await loadFixtureForRatings(db, fixtureId);
  assertEligibleFixtureRatings(latest);
  const latestTeam = side === 'home' ? latest.fixture.home_team : latest.fixture.away_team;
  if (Number(latest.fixture.ht_match_id) !== Number(fixture.ht_match_id) ||
    latest.fixture.home_team_id !== fixture.home_team_id || latest.fixture.away_team_id !== fixture.away_team_id ||
    Number(latestTeam?.hattrick_user_id) !== userId) {
    throw new FixtureRatingsError(409, 'The fixture changed while Hattrick was loading. Try again.');
  }
  const payload = { ...values, ht_match_id: Number(fixture.ht_match_id), fetched_at: new Date().toISOString() };
  await ratingSharingAction(db, fixtureId, team.id, userId, Number(fixture.ht_match_id), action, {
    p_payload: { ...payload, fixture_context: ratingFixtureContext(fixture) }, p_existing_id: existing?.id || null,
  });
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

type RatingSharingAction = 'claim' | 'automatic' | 'release' | 'share' | 'update' | 'remove';

export async function ratingSharingAction(
  db: Db, fixtureId: string, teamId: string, managerId: number, htMatchId: number,
  action: RatingSharingAction,
  extra: { p_claim_id?: string; p_payload?: Record<string, unknown>; p_existing_id?: string | null } = {},
) {
  const { data, error } = await db.rpc('fixture_rating_sharing_action', {
    p_fixture_id: fixtureId, p_team_id: teamId, p_manager_id: managerId,
    p_ht_match_id: htMatchId > 0 ? htMatchId : null, p_action: action, ...extra,
  });
  if (error) {
    if (['40001', '23505', '42501', 'P0002'].includes(error.code || '')) {
      throw new FixtureRatingsError(error.code === '42501' ? 403 : 409, error.message);
    }
    throw error;
  }
  return data as { claim_id?: string; saved?: boolean } | null;
}

export async function loadRatingSharingPreferences(db: Db, tournamentId: string, managerId: number) {
  const { data: tournament, error: tournamentError } = await db.from('tournaments')
    .select('id,status,is_archived').eq('id', tournamentId).maybeSingle();
  if (tournamentError) throw tournamentError;
  if (!tournament || tournament.is_archived || ['finished', 'archived', 'cancelled', 'stopped'].includes(tournament.status || '')) {
    throw new FixtureRatingsError(404, 'Tournament not found or no longer active.');
  }
  const { data: teams, error: teamError } = await db.from('teams')
    .select('id,name,ht_team_id').eq('tournament_id', tournamentId).eq('hattrick_user_id', managerId)
    .eq('active', true).eq('reserve_active', false).not('is_placeholder', 'is', true);
  if (teamError) throw teamError;
  if (!teams?.length) return [];
  const { teamIds } = await verifiedManagerClubs(db, managerId);
  const { data: preferences, error: preferenceError } = await db.from('tournament_team_rating_preferences')
    .select('team_id,enabled').eq('tournament_id', tournamentId).eq('hattrick_user_id', managerId);
  if (preferenceError) throw preferenceError;
  const enabledByTeam = new Map((preferences || []).map((row) => [row.team_id, row.enabled]));
  return teams.filter((team) => teamIds.has(Number(team.ht_team_id))).map((team) => ({
    teamId: team.id, teamName: team.name, enabled: enabledByTeam.get(team.id) ?? true,
  }));
}

export async function setRatingSharingPreference(
  db: Db, tournamentId: string, teamId: string, managerId: number, enabled: boolean,
  invalidate = invalidatePublicTournament,
) {
  const teams = await loadRatingSharingPreferences(db, tournamentId, managerId);
  if (!teams.some((team) => team.teamId === teamId)) throw new FixtureRatingsError(403, 'You do not manage this tournament club.');
  const { error } = await db.rpc('set_team_rating_sharing', {
    p_tournament_id: tournamentId, p_team_id: teamId, p_manager_id: managerId, p_enabled: enabled,
  });
  if (error?.code === '42501') throw new FixtureRatingsError(403, error.message);
  if (error) throw error;
  await invalidateAfterRatingWrite(invalidate, tournamentId);
}

/** Orders map contains only responses fetched using that team's own credentials. */
export async function autoShareFixtureRatings(
  db: Db, tournamentId: string, roundId: string, ordersByTeam: ReadonlyMap<string, ReadonlyMap<number, boolean | null>>,
  invalidate = invalidatePublicTournament,
  loadOrders?: (teamId: string) => Promise<ReadonlyMap<number, boolean | null> | undefined>,
) {
  const { data: matches, error } = await db.from('matches').select('id').eq('round_id', roundId)
    .eq('status', 'arranged').eq('completed', false).gt('scheduled_for', new Date().toISOString());
  if (error) throw error;
  let shared = 0;
  let statusChanged = false;
  for (const match of matches || []) {
    const context = await loadFixtureForRatings(db, match.id);
    try { assertEligibleFixtureRatings(context); } catch { continue; }
    if (context.tournament.id !== tournamentId) continue;
    for (const team of [context.fixture.home_team, context.fixture.away_team]) {
      if (!team?.hattrick_user_id) continue;
      if (!loadOrders && !ordersByTeam.has(team.id)) continue;
      const matchId = Number(context.fixture.ht_match_id);
      const managerId = Number(team.hattrick_user_id);
      let claimId: string | undefined;
      try {
        const claim = await ratingSharingAction(db, match.id, team.id, managerId, matchId, 'claim');
        claimId = claim?.claim_id;
        if (!claimId) continue;
        const orders = ordersByTeam.get(team.id) || await loadOrders?.(team.id);
        const ordersGiven = orders?.get(matchId) ?? null;
        // Confirm live ownership before storing a definite status, including false.
        const owner = ordersGiven !== null
          ? await verifiedManagerClubs(db, managerId, ordersGiven ? Number(team.ht_team_id) : undefined)
          : null;
        if (owner && !owner.teamIds.has(Number(team.ht_team_id))) throw new FixtureRatingsError(403, 'Your Hattrick account no longer owns this fixture club.');
        const { data: recorded, error: statusError } = await db.rpc('record_fixture_order_status', {
          p_fixture_id: match.id, p_team_id: team.id, p_manager_id: managerId, p_ht_match_id: matchId,
          p_claim_id: claimId, p_orders_given: ordersGiven, p_fixture_context: ratingFixtureContext(context.fixture),
        });
        if (statusError) throw statusError;
        statusChanged ||= recorded === true;
        if (ordersGiven !== true) {
          await ratingSharingAction(db, match.id, team.id, managerId, matchId, 'release', { p_claim_id: claimId });
          continue;
        }
        const { credentials, specialties } = owner!;
        const opponent = team.id === context.fixture.home_team_id ? context.fixture.away_team : context.fixture.home_team;
        const values = await prediction(credentials, matchId, Number(team.ht_team_id), Number(opponent?.ht_team_id), specialties);
        const result = await ratingSharingAction(db, match.id, team.id, managerId, matchId, 'automatic', {
          p_claim_id: claimId, p_payload: { ...values, fetched_at: new Date().toISOString(), fixture_context: ratingFixtureContext(context.fixture) },
        });
        if (result?.saved) shared++;
      } catch (error) {
        if (claimId) {
          // A failed check must not leave a previous confirmed-false notice.
          await db.rpc('record_fixture_order_status', {
            p_fixture_id: match.id, p_team_id: team.id, p_manager_id: managerId, p_ht_match_id: matchId,
            p_claim_id: claimId, p_orders_given: null, p_fixture_context: ratingFixtureContext(context.fixture),
          }).then(({ data }) => { statusChanged ||= data === true; }, () => {});
          await ratingSharingAction(db, match.id, team.id, managerId, matchId, 'release', { p_claim_id: claimId })
            .catch(() => {}); // The lease still expires if the retry write fails.
        }
        console.warn('[fixture-ratings] automatic sharing failed', {
          fixtureId: match.id, reason: error instanceof Error ? error.message : 'unknown',
        });
      }
    }
  }
  if (shared || statusChanged) await invalidateAfterRatingWrite(invalidate, tournamentId);
  return shared;
}
