import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAppSessionSecret, verifyAppSessionCookie } from './_lib/app-session.js';
import {
  clearForgeSessionCookie,
  getForgeSuperadminId,
  isForgeAdminRequest,
  verifyForgeSessionCookie,
} from './_lib/forge-session.js';
import { cleanupActivityEvents, recordActivity } from './_lib/activity.js';
import { findSeasonParticipant, validateSeasonComment } from './_lib/season-comments.js';
import { validateTournamentLeave } from './_lib/tournament-participation.js';
import { getServiceSupabase, getSupabase } from './_lib/supabase.js';
import { hasSuperAdminBypassCookie } from './_lib/superadmin-bypass.js';
import {
  loadTournamentAccess,
  loadTournamentRoleRecords,
} from './_lib/tournament-access.js';
import { isTournamentRole, type TournamentRole } from '../../../shared/tournament-roles.js';
import { isForgeEnabled } from '../forge-availability.js';
import { isTournamentRegistrationOpen } from '../../utils/tournament-joinability.js';
import {
  checkChppChallengeable,
  isOpponentChallengeable,
  sendChppChallenge,
} from './_lib/chpp-challenges.js';
import {
  getFixtureChallengeMatchPlace,
  getFixtureChallengeMatchType,
  resolveFixtureChallengeOptions,
  getFixtureChallengeSide,
  type FixtureChallengeSide,
} from './_lib/fixture-challenge.js';
import { fetchManagerTeamsFromChpp, getManagerChppCredentials } from './_lib/matchmaker.js';
import { getAuthHeader } from './_lib/chpp-auth.js';
import {
  getFootballScore,
  getPenaltyShootoutScore,
  mapMatchEventDetailsToFixture,
  parseMatchEventDetails,
} from './_lib/chpp-match-events.js';
import { buildRoundPressInput, type RoundPressMatchSource, type RoundPressRoundSource, type RoundPressTeamSource } from './_lib/round-press-input.js';
import { getEligibleRoundPressNumber, type RoundPressEligibilityRound } from './_lib/round-press-eligibility.js';
import {
  CloudflareAiConfigurationError,
  CloudflareAiTemporarilyUnavailableError,
} from './_lib/round-press-cloudflare-writer.js';
import {
  generateConfiguredRoundPressDraft,
  roundPressModelForProvider,
  RoundPressProviderConfigurationError,
  resolveRoundPressProvider,
} from './_lib/round-press-provider.js';
import {
  GeminiTemporarilyUnavailableError,
  ROUND_PRESS_PROMPT_VERSION,
  ROUND_PRESS_THINKING_LEVEL,
} from './_lib/round-press-writer.js';
import type { MatchEventDetails } from '../../../shared/match-events.js';
import type { PersistedScoringMode } from '../../../shared/scoring-profile.js';
import type { SeasonFixturesSnapshot } from '../../utils/season-fixtures.js';

const COMMENT_SELECT = 'id, season_id, team_id, team_name, manager_name, comment, created_at';
const HISTORY_REPORT_DISMISSED_NOTICE = 'history-report-dismissed';
const HISTORY_REPORT_VIEWED_NOTICE = 'history-report-viewed';
const HISTORY_REPORT_STATUS_NOTICE = 'history-report-status';

async function requireTournamentRoleSession(req: VercelRequest, res: VercelResponse, tournamentId: string) {
  const secret = getAppSessionSecret();
  const session = secret ? verifyAppSessionCookie(req.headers.cookie, secret) : null;
  const bypass = hasSuperAdminBypassCookie(req.headers.cookie);
  const userId = session?.userId || (bypass ? getForgeSuperadminId() : null);
  if (!userId) {
    res.status(401).json({ error: 'Please sign in with Hattrick first.' });
    return null;
  }

  const access = await loadTournamentAccess(getServiceSupabase(), tournamentId, userId, bypass);
  if (!access) {
    res.status(404).json({ error: 'Tournament not found.' });
    return null;
  }
  return { userId, access };
}

async function handleTournamentAccess(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.query.tournamentId);
  if (!tournamentId) return res.status(400).json({ error: 'Missing tournamentId.' });
  const actor = await requireTournamentRoleSession(req, res, tournamentId);
  if (!actor) return;
  return res.status(200).json(actor.access);
}

async function handleManagedTournaments(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  const secret = getAppSessionSecret();
  const session = secret ? verifyAppSessionCookie(req.headers.cookie, secret) : null;
  const userId = session?.userId || (hasSuperAdminBypassCookie(req.headers.cookie) ? getForgeSuperadminId() : null);
  if (!userId) return res.status(401).json({ error: 'Please sign in with Hattrick first.' });

  const supabase = getServiceSupabase();
  const [{ data: organizerRows, error: organizerError }, { data: roleRows, error: rolesError }] = await Promise.all([
    supabase.from('tournaments').select('id').eq('organizer_id', userId),
    supabase.from('tournament_roles').select('tournament_id').eq('hattrick_user_id', userId),
  ]);
  if (organizerError) throw organizerError;
  if (rolesError && rolesError.code !== '42P01' && rolesError.code !== 'PGRST205') throw rolesError;
  const tournamentIds = Array.from(new Set([
    ...(organizerRows || []).map((row) => row.id),
    ...(roleRows || []).map((row) => row.tournament_id),
  ]));
  if (tournamentIds.length === 0) return res.status(200).json({ tournaments: [] });

  const { data: tournaments, error: tournamentsError } = await supabase
    .from('tournaments')
    .select('id, name, slug, is_featured, status, is_archived, is_test, registration_type, created_at')
    .in('id', tournamentIds)
    .neq('status', 'archived');
  if (tournamentsError) throw tournamentsError;
  return res.status(200).json({ tournaments: tournaments || [] });
}

async function handleTournamentParticipation(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (readString(req.body?.action) !== 'leave') {
    return res.status(400).json({ error: 'Unknown tournament participation action.' });
  }

  const tournamentId = readString(req.body?.tournamentId);
  const teamId = readString(req.body?.teamId);
  if (!tournamentId || !teamId) return res.status(400).json({ error: 'Missing tournament or team.' });

  const secret = getAppSessionSecret();
  if (!secret) return res.status(500).json({ error: 'Session configuration is missing.' });
  const session = verifyAppSessionCookie(req.headers.cookie, secret);
  if (!session) return res.status(401).json({ error: 'Please sign in with Hattrick first.' });

  const supabase = getServiceSupabase();
  const { data: tournament, error: tournamentError } = await supabase
    .from('tournaments')
    .select('id, season, status, registration_closed_at')
    .eq('id', tournamentId)
    .maybeSingle();
  if (tournamentError) throw tournamentError;
  if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });

  const { data: team, error: teamError } = await supabase
    .from('teams')
    .select('id, active, reapply_season_number, hattrick_user_id')
    .eq('id', teamId)
    .eq('tournament_id', tournamentId)
    .maybeSingle();
  if (teamError) throw teamError;
  if (!team) return res.status(404).json({ error: 'Team not found.' });

  const { count: roundCount, error: roundCountError } = await supabase
    .from('rounds')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('season_number', tournament.season);
  if (roundCountError) throw roundCountError;

  const validationError = validateTournamentLeave({
    viewerUserId: session.userId,
    tournamentSeason: Number(tournament.season) || 1,
    registrationOpen: isTournamentRegistrationOpen({
      isGenerated: (roundCount ?? 0) > 0,
      status: tournament.status,
      registrationClosedAt: tournament.registration_closed_at,
    }),
    team: {
      active: team.active,
      hattrickUserId: team.hattrick_user_id,
      reapplySeasonNumber: team.reapply_season_number,
    },
  });
  if (validationError) return res.status(validationError.status).json({ error: validationError.error });

  let updateQuery = supabase
    .from('teams')
    .update({ active: false, reapply_season_number: null })
    .eq('id', teamId)
    .eq('tournament_id', tournamentId)
    .eq('active', team.active);
  if (!team.active) {
    updateQuery = updateQuery.eq('reapply_season_number', tournament.season);
  }
  const { data: removedTeam, error: updateError } = await updateQuery.select('id').maybeSingle();
  if (updateError) throw updateError;
  if (!removedTeam) {
    return res.status(409).json({ error: 'The team participation changed. Refresh and try again.' });
  }

  return res.status(200).json({ removed: true, teamId: removedTeam.id });
}

async function handleSeasonSlotReplacement(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.body?.tournamentId);
  const formerTeamId = readString(req.body?.formerTeamId);
  const incomingHtTeamId = Number(req.body?.incomingHtTeamId);
  const seasonNumber = Number(req.body?.seasonNumber);
  if (!tournamentId || !formerTeamId || !Number.isSafeInteger(incomingHtTeamId) || incomingHtTeamId <= 0 || !Number.isSafeInteger(seasonNumber) || seasonNumber < 1) {
    return res.status(400).json({ error: 'Invalid replacement request.' });
  }
  const actor = await requireTournamentRoleSession(req, res, tournamentId);
  if (!actor) return;
  if (!actor.access.canManageOperations) return res.status(403).json({ error: 'This role cannot replace a scheduled team.' });

  const { data, error } = await getServiceSupabase().rpc('replace_known_team_in_current_season', {
    p_tournament_id: tournamentId,
    p_season_number: seasonNumber,
    p_former_team_id: formerTeamId,
    p_incoming_ht_team_id: incomingHtTeamId,
  });
  if (error) {
    const status = ['22023', '23505', 'P0002'].includes(error.code || '') ? 409 : 500;
    return res.status(status).json({ error: error.message });
  }
  return res.status(200).json({ replacement: Array.isArray(data) ? data[0] : data });
}

async function handleTournamentRoles(req: VercelRequest, res: VercelResponse) {
  const tournamentId = readString(req.method === 'GET' ? req.query.tournamentId : req.body?.tournamentId);
  if (!tournamentId) return res.status(400).json({ error: 'Missing tournamentId.' });

  let actor;
  try {
    actor = await requireTournamentRoleSession(req, res, tournamentId);
  } catch (error) {
    console.error('Tournament role access error:', error);
    return res.status(500).json({ error: 'Could not load tournament roles.' });
  }
  if (!actor) return;

  if (req.method === 'GET') {
    if (!actor.access.canViewRoles) return res.status(403).json({ error: 'This role cannot view tournament roles.' });
    const roleRecords = await loadTournamentRoleRecords(getServiceSupabase(), tournamentId);
    if (!roleRecords) return res.status(404).json({ error: 'Tournament not found.' });
    return res.status(200).json({
      ...actor.access,
      ...roleRecords,
      currentRole: actor.access.actualRole,
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (!actor.access.canManageAdmins && !actor.access.canManagePressOfficer && !actor.access.canManageCoOrganizer) {
    return res.status(403).json({ error: 'This role cannot manage tournament roles.' });
  }

  const action = readString(req.body?.action);
  const targetUserId = Number(req.body?.hattrickUserId) || 0;
  if (!targetUserId) return res.status(400).json({ error: 'A valid Hattrick user ID is required.' });
  if (targetUserId === actor.userId) {
    return res.status(400).json({ error: 'The original organizer cannot be delegated through this panel.' });
  }

  const supabase = getServiceSupabase();
  const { data: tournamentOwner, error: tournamentOwnerError } = await supabase
    .from('tournaments')
    .select('organizer_id')
    .eq('id', tournamentId)
    .single();
  if (tournamentOwnerError) throw tournamentOwnerError;
  if (targetUserId === Number(tournamentOwner.organizer_id)) {
    return res.status(400).json({ error: 'The original organizer cannot be delegated through this panel.' });
  }
  if (action === 'remove') {
    const { data: targetRole, error: targetRoleError } = await supabase
      .from('tournament_roles')
      .select('role')
      .eq('tournament_id', tournamentId)
      .eq('hattrick_user_id', targetUserId)
      .maybeSingle();
    if (targetRoleError) throw targetRoleError;
    if (!targetRole) return res.status(404).json({ error: 'Delegated role not found.' });
    if (targetRole.role === 'co_organizer' && !actor.access.canManageCoOrganizer) return res.status(403).json({ error: 'Only the original organizer can manage the co-organizer.' });
    if (targetRole.role === 'admin' && !actor.access.canManageAdmins) return res.status(403).json({ error: 'This role cannot manage tournament admins.' });
    if (targetRole.role === 'press_officer' && !actor.access.canManagePressOfficer) return res.status(403).json({ error: 'This role cannot manage the press officer.' });
    const { error } = await supabase.from('tournament_roles').delete().eq('tournament_id', tournamentId).eq('hattrick_user_id', targetUserId);
    if (error) throw error;
  } else if (action === 'assign') {
    if (!isTournamentRole(req.body?.role)) return res.status(400).json({ error: 'Invalid tournament role.' });
    const role = req.body.role as TournamentRole;
    if (role === 'co_organizer' && !actor.access.canManageCoOrganizer) return res.status(403).json({ error: 'Only the original organizer can manage the co-organizer.' });
    if (role === 'admin' && !actor.access.canManageAdmins) return res.status(403).json({ error: 'This role cannot manage tournament admins.' });
    if (role === 'press_officer' && !actor.access.canManagePressOfficer) return res.status(403).json({ error: 'This role cannot manage the press officer.' });
    const { data: targetProfile, error: targetProfileError } = await supabase
      .from('profiles')
      .select('hattrick_user_id, manager_name')
      .eq('hattrick_user_id', targetUserId)
      .maybeSingle();
    if (targetProfileError) throw targetProfileError;
    if (!targetProfile) return res.status(422).json({ error: 'This manager has not signed into HT-120min yet.' });
    const { data: currentRoles, error: currentRolesError } = await supabase.from('tournament_roles').select('hattrick_user_id, role').eq('tournament_id', tournamentId);
    if (currentRolesError) throw currentRolesError;
    if (role === 'admin' && !currentRoles?.some((item) => item.hattrick_user_id === targetUserId && item.role === 'admin') && (currentRoles ?? []).filter((item) => item.role === 'admin').length >= 4) {
      return res.status(409).json({ error: 'This tournament already has four tournament admins.' });
    }
    if (role === 'co_organizer' || role === 'press_officer') {
      const existingSlot = currentRoles?.find((item) => item.role === role && item.hattrick_user_id !== targetUserId);
      if (existingSlot) return res.status(409).json({ error: `This tournament already has a ${role === 'co_organizer' ? 'co-organizer' : 'press officer'}. Remove the current one before assigning another.` });
    }
    const { error: removeExistingError } = await supabase.from('tournament_roles').delete().eq('tournament_id', tournamentId).eq('hattrick_user_id', targetUserId);
    if (removeExistingError) throw removeExistingError;
    const { error } = await supabase.from('tournament_roles').insert({
      tournament_id: tournamentId,
      hattrick_user_id: targetUserId,
      role,
      added_by_ht_user_id: actor.userId,
    });
    if (error) throw error;
  } else {
    return res.status(400).json({ error: 'Unknown role action.' });
  }

  const refreshed = await loadTournamentRoleRecords(supabase, tournamentId);
  return res.status(200).json({
    ok: true,
    roles: refreshed?.roles ?? [],
  });
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

type FixtureChallengeTeamRow = {
  id: string;
  ht_team_id: number | null;
  hattrick_user_id: number | null;
  active: boolean | null;
  is_placeholder: boolean | null;
  name: string | null;
};

type FixtureChallengeMatchRow = {
  id: string;
  round_id: string;
  status: string | null;
  completed: boolean | null;
  home_team: FixtureChallengeTeamRow | null;
  away_team: FixtureChallengeTeamRow | null;
};

type FixtureChallengeRoundRow = {
  id: string;
  round_number: number;
  matches: Array<Pick<FixtureChallengeMatchRow, 'id' | 'status' | 'completed'>> | null;
};

type ResolvedFixtureChallenge = {
  side: FixtureChallengeSide;
  actorTeam: FixtureChallengeTeamRow;
  opponentTeam: FixtureChallengeTeamRow;
  matchType: 0 | 1;
  matchPlace: 0 | 1;
};

function fixtureChallengeUnavailable(reason: string) {
  return { available: false as const, reason };
}

async function resolveFixtureChallenge(
  req: VercelRequest,
  res: VercelResponse,
): Promise<{ sessionUserId: number; tournamentId: string; matchId: string; resolved?: ResolvedFixtureChallenge } | null> {
  const values = req.method === 'GET' ? req.query : req.body;
  const tournamentId = readString(Array.isArray(values?.tournamentId) ? values.tournamentId[0] : values?.tournamentId);
  const matchId = readString(Array.isArray(values?.matchId) ? values.matchId[0] : values?.matchId);
  if (!tournamentId || !matchId) {
    res.status(400).json({ error: 'Missing tournamentId or matchId.' });
    return null;
  }

  const secret = getAppSessionSecret();
  const session = secret ? verifyAppSessionCookie(req.headers.cookie, secret) : null;
  if (!session) {
    res.status(401).json({ error: 'Please sign in with Hattrick first.' });
    return null;
  }

  const supabase = getServiceSupabase();
  const { data: tournament, error: tournamentError } = await supabase
    .from('tournaments')
    .select('id, season, scoring_mode, status, is_archived')
    .eq('id', tournamentId)
    .maybeSingle();
  if (tournamentError) throw tournamentError;
  if (!tournament || tournament.is_archived || ['finished', 'archived', 'cancelled'].includes(tournament.status || '')) {
    res.status(404).json({ error: 'Tournament is not available for fixture challenges.' });
    return null;
  }

  const { data: rounds, error: roundsError } = await supabase
    .from('rounds')
    .select('id, round_number, matches(id, status, completed)')
    .eq('tournament_id', tournamentId)
    .eq('season_number', tournament.season)
    .order('round_number', { ascending: true });
  if (roundsError) throw roundsError;
  const currentRound = (rounds as FixtureChallengeRoundRow[] | null)?.find((round) =>
    (round.matches || []).some((match) => !match.completed && match.status !== 'misarranged'),
  );
  if (!currentRound) {
    res.status(409).json(fixtureChallengeUnavailable('There is no active tournament round to arrange.'));
    return null;
  }

  const { data: match, error: matchError } = await supabase
    .from('matches')
    .select(`
      id,
      round_id,
      status,
      completed,
      home_team:teams!matches_home_team_id_fkey(id, ht_team_id, hattrick_user_id, active, is_placeholder, name),
      away_team:teams!matches_away_team_id_fkey(id, ht_team_id, hattrick_user_id, active, is_placeholder, name)
    `)
    .eq('id', matchId)
    .eq('round_id', currentRound.id)
    .maybeSingle();
  if (matchError) throw matchError;
  const fixture = match as FixtureChallengeMatchRow | null;
  if (!fixture) {
    res.status(404).json({ error: 'Fixture not found in the active round.' });
    return null;
  }
  if (fixture.completed || (fixture.status && fixture.status !== 'not_arranged')) {
    res.status(409).json(fixtureChallengeUnavailable('This fixture is already arranged or no longer active.'));
    return null;
  }

  const side = getFixtureChallengeSide({
    viewerUserId: session.userId,
    homeOwnerId: fixture.home_team?.hattrick_user_id,
    awayOwnerId: fixture.away_team?.hattrick_user_id,
  });
  if (!side) {
    res.status(403).json(fixtureChallengeUnavailable('You do not own a team in this fixture.'));
    return null;
  }

  const actorTeam = side === 'home' ? fixture.home_team : fixture.away_team;
  const opponentTeam = side === 'home' ? fixture.away_team : fixture.home_team;
  if (
    !actorTeam ||
    !opponentTeam ||
    actorTeam.active === false ||
    opponentTeam.active === false ||
    actorTeam.is_placeholder ||
    opponentTeam.is_placeholder ||
    !Number.isSafeInteger(actorTeam.ht_team_id) ||
    !Number.isSafeInteger(opponentTeam.ht_team_id) ||
    (actorTeam.ht_team_id ?? 0) <= 0 ||
    (opponentTeam.ht_team_id ?? 0) <= 0
  ) {
    res.status(409).json(fixtureChallengeUnavailable('This fixture does not have two active Hattrick teams.'));
    return null;
  }

  return {
    sessionUserId: session.userId,
    tournamentId,
    matchId,
    resolved: {
      side,
      actorTeam,
      opponentTeam,
      matchType: getFixtureChallengeMatchType(tournament.scoring_mode),
      matchPlace: getFixtureChallengeMatchPlace(side),
    },
  };
}

async function handleFixtureChallenge(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const resolvedRequest = await resolveFixtureChallenge(req, res);
  if (!resolvedRequest?.resolved) return;

  const { sessionUserId, resolved } = resolvedRequest;
  const options = resolveFixtureChallengeOptions(
    req.method === 'POST'
      ? {
          matchType: readString(req.body?.matchType),
          venue: readString(req.body?.venue),
        }
      : {},
    { matchType: resolved.matchType, matchPlace: resolved.matchPlace },
  );
  if (!options) {
    return res.status(400).json({ error: 'Challenge type and venue must be Cup Rules or Normal Rules, and Home or Away.' });
  }
  const supabase = getServiceSupabase();
  const credentials = await getManagerChppCredentials(supabase, sessionUserId);
  if (!credentials) {
    return res.status(401).json({ error: 'Your Hattrick authorization has expired. Please sign in with Hattrick again.' });
  }

  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) {
    return res.status(500).json({ error: 'CHPP configuration is missing.' });
  }

  const ownedTeams = await fetchManagerTeamsFromChpp(consumerKey, consumerSecret, credentials, sessionUserId);
  const actorTeamId = resolved.actorTeam.ht_team_id as number;
  const opponentTeamId = resolved.opponentTeam.ht_team_id as number;
  if (!ownedTeams.teams.some((team) => team.teamId === actorTeamId)) {
    return res.status(403).json({ error: 'Your Hattrick account no longer owns this fixture team.' });
  }

  const challengeable = await checkChppChallengeable({
    consumerKey,
    consumerSecret,
    oauthToken: credentials.oauth_token,
    oauthTokenSecret: credentials.oauth_token_secret,
    teamId: actorTeamId,
    suggestedTeamIds: [opponentTeamId],
    isWeekendFriendly: 0,
  });
  const check = isOpponentChallengeable(challengeable.parsed, opponentTeamId);
  if (!check.ok) {
    const body = fixtureChallengeUnavailable(check.reason || 'This opponent cannot be challenged right now.');
    return res.status(req.method === 'GET' ? 200 : 409).json(body);
  }

  const availability = {
    available: true as const,
    side: resolved.side,
    opponent: { name: resolved.opponentTeam.name || 'opposing team', htTeamId: opponentTeamId },
    matchType: options.matchType === 1 ? 'cup_rules' : 'normal',
    venue: options.matchPlace === 0 ? 'home' : 'away',
  };
  if (req.method === 'GET') return res.status(200).json(availability);

  const sent = await sendChppChallenge({
    consumerKey,
    consumerSecret,
    oauthToken: credentials.oauth_token,
    oauthTokenSecret: credentials.oauth_token_secret,
    teamId: actorTeamId,
    opponentTeamId,
    matchType: options.matchType,
    matchPlace: options.matchPlace,
    isWeekendFriendly: 0,
  });
  if (!sent.success) {
    console.warn('[Fixture challenge] CHPP challenge failed', {
      tournamentId: resolvedRequest.tournamentId,
      matchId: resolvedRequest.matchId,
      actorTeamId,
      opponentTeamId,
      errorCode: sent.errorCode,
    });
    return res.status(502).json({ error: sent.errorMessage || 'Hattrick could not send this challenge.' });
  }

  console.info('[Fixture challenge] sent', {
    tournamentId: resolvedRequest.tournamentId,
    matchId: resolvedRequest.matchId,
    actorTeamId,
    opponentTeamId,
    matchType: options.matchType,
    matchPlace: options.matchPlace,
    trainingMatchId: sent.trainingMatchId,
  });
  return res.status(200).json({
    ...availability,
    sent: true,
    trainingMatchId: sent.trainingMatchId,
    message: 'Challenge sent. Waiting for the opponent to accept.',
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return asRecord(value[0]);
  return asRecord(value);
}

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function roundPressTeam(value: unknown, id: string | null): RoundPressTeamSource | null {
  const team = asRecord(value);
  if (!team || !id) return null;
  return {
    id,
    name: typeof team.name === 'string' && team.name ? team.name : 'Unknown team',
    ht_team_id: positiveInteger(team.ht_team_id),
    manager_name: typeof team.manager_name === 'string' ? team.manager_name : null,
    country_name: typeof team.country_name === 'string' ? team.country_name : null,
    country_id: positiveInteger(team.country_id),
    league_id: positiveInteger(team.league_id),
  };
}

function roundPressMatch(value: unknown, snapshotTeams?: Map<string, RoundPressTeamSource>): RoundPressMatchSource | null {
  const row = asRecord(value);
  if (!row || typeof row.id !== 'string' || typeof row.round_id !== 'string') return null;
  const homeTeamId = typeof row.home_team_id === 'string' ? row.home_team_id : null;
  const awayTeamId = typeof row.away_team_id === 'string' ? row.away_team_id : null;
  const homeSnapshot = homeTeamId ? snapshotTeams?.get(homeTeamId) || null : null;
  const awaySnapshot = awayTeamId ? snapshotTeams?.get(awayTeamId) || null : null;
  const homeTeam = roundPressTeam(firstRecord(row.home_team) || homeSnapshot, homeTeamId) || homeSnapshot || null;
  const awayTeam = roundPressTeam(firstRecord(row.away_team) || awaySnapshot, awayTeamId) || awaySnapshot || null;
  return {
    id: row.id,
    round_id: row.round_id,
    home_team_id: homeTeamId,
    away_team_id: awayTeamId,
    home_goals: typeof row.home_goals === 'number' ? row.home_goals : null,
    away_goals: typeof row.away_goals === 'number' ? row.away_goals : null,
    completed: row.completed === true,
    status: typeof row.status === 'string' ? row.status : 'not_arranged',
    went_120: row.went_120 === true,
    total_minutes: typeof row.total_minutes === 'number' ? row.total_minutes : null,
    penalty_shootout_home_goals: typeof row.penalty_shootout_home_goals === 'number' ? row.penalty_shootout_home_goals : null,
    penalty_shootout_away_goals: typeof row.penalty_shootout_away_goals === 'number' ? row.penalty_shootout_away_goals : null,
    home_yellow_cards: typeof row.home_yellow_cards === 'number' ? row.home_yellow_cards : 0,
    home_red_cards: typeof row.home_red_cards === 'number' ? row.home_red_cards : 0,
    home_injuries: typeof row.home_injuries === 'number' ? row.home_injuries : 0,
    away_yellow_cards: typeof row.away_yellow_cards === 'number' ? row.away_yellow_cards : 0,
    away_red_cards: typeof row.away_red_cards === 'number' ? row.away_red_cards : 0,
    away_injuries: typeof row.away_injuries === 'number' ? row.away_injuries : 0,
    match_event_details: (asRecord(row.match_event_details) as unknown as MatchEventDetails | null) || null,
    scheduled_for: typeof row.scheduled_for === 'string' ? row.scheduled_for : null,
    home_team: homeTeam,
    away_team: awayTeam,
  };
}

function roundPressRounds(rows: unknown[], snapshotTeams?: Map<string, RoundPressTeamSource>): RoundPressRoundSource[] {
  return rows
    .map((value) => {
      const row = asRecord(value);
      const roundNumber = row ? positiveInteger(row.round_number) : null;
      if (!row || typeof row.id !== 'string' || !roundNumber) return null;
      return {
        id: row.id,
        round_number: roundNumber,
        matches: Array.isArray(row.matches)
          ? row.matches.map((match) => roundPressMatch(match, snapshotTeams)).filter((match): match is RoundPressMatchSource => Boolean(match))
          : [],
      };
    })
    .filter((round): round is RoundPressRoundSource => Boolean(round));
}

/**
 * Archived fixture snapshots are authoritative for historical fixture identity
 * and scheduling. Rich MatchDetails facts live on the persistent match row so
 * they can be improved by an explicit backfill without mutating the snapshot.
 */
function hydrateHistoricalRoundPressFacts(
  rounds: RoundPressRoundSource[],
  rows: unknown[],
): RoundPressRoundSource[] {
  const factsByMatchId = new Map<string, Record<string, unknown>>();
  rows.forEach((value) => {
    const row = asRecord(value);
    if (row && typeof row.id === 'string') factsByMatchId.set(row.id, row);
  });

  return rounds.map((round) => ({
    ...round,
    matches: round.matches.map((match) => {
      const facts = factsByMatchId.get(match.id);
      if (!facts) return match;
      return {
        ...match,
        home_goals: typeof facts.home_goals === 'number' ? facts.home_goals : match.home_goals,
        away_goals: typeof facts.away_goals === 'number' ? facts.away_goals : match.away_goals,
        went_120: typeof facts.went_120 === 'boolean' ? facts.went_120 : match.went_120,
        total_minutes: typeof facts.total_minutes === 'number' ? facts.total_minutes : match.total_minutes,
        penalty_shootout_home_goals: typeof facts.penalty_shootout_home_goals === 'number'
          ? facts.penalty_shootout_home_goals
          : match.penalty_shootout_home_goals,
        penalty_shootout_away_goals: typeof facts.penalty_shootout_away_goals === 'number'
          ? facts.penalty_shootout_away_goals
          : match.penalty_shootout_away_goals,
        match_event_details: (asRecord(facts.match_event_details) as unknown as MatchEventDetails | null) || match.match_event_details,
      };
    }),
  }));
}

function snapshotTeamsFromRounds(snapshot: SeasonFixturesSnapshot): Map<string, RoundPressTeamSource> {
  const teams = new Map<string, RoundPressTeamSource>();
  snapshot.rounds.forEach((round) => {
    round.matches.forEach((match) => {
      if (match.home_team_id && match.home_team) {
        teams.set(match.home_team_id, { id: match.home_team_id, ...match.home_team });
      }
      if (match.away_team_id && match.away_team) {
        teams.set(match.away_team_id, { id: match.away_team_id, ...match.away_team });
      }
    });
  });
  return teams;
}

/**
 * Explicit, bounded repair operation for archived MatchDetails facts.
 *
 * This deliberately derives CHPP credentials from the signed-in manager rather
 * than accepting a manager id from the browser. It is not used by round-press
 * generation itself: generated drafts always read persisted facts.
 */
async function handleRoundPressMatchDetailsBackfill(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.body?.tournamentId);
  const seasonNumber = positiveInteger(req.body?.seasonNumber);
  const roundNumber = positiveInteger(req.body?.roundNumber);
  const apply = req.body?.apply === true;
  if (!tournamentId || !seasonNumber || !roundNumber) {
    return res.status(400).json({ error: 'tournamentId, seasonNumber, and roundNumber are required.' });
  }

  const actor = await requireTournamentRoleSession(req, res, tournamentId);
  if (!actor) return;
  if (!actor.access.canPublishAnnouncements) {
    return res.status(403).json({ error: 'This role cannot backfill tournament match facts.' });
  }

  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) {
    return res.status(500).json({ error: 'CHPP server configuration is unavailable.' });
  }

  const supabase = getServiceSupabase();
  const credentials = await getManagerChppCredentials(supabase, actor.userId);
  if (!credentials) return res.status(401).json({ error: 'Please link Hattrick before refreshing match details.' });

  const { data: round, error: roundError } = await supabase
    .from('rounds')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('season_number', seasonNumber)
    .eq('round_number', roundNumber)
    .maybeSingle();
  if (roundError) throw roundError;
  if (!round) return res.status(404).json({ error: 'Round not found.' });

  const { data: matches, error: matchesError } = await supabase
    .from('matches')
    .select('id, ht_match_id, home_team:teams!matches_home_team_id_fkey(ht_team_id), away_team:teams!matches_away_team_id_fkey(ht_team_id)')
    .eq('round_id', round.id)
    .not('ht_match_id', 'is', null);
  if (matchesError) throw matchesError;
  if (!matches?.length) return res.status(422).json({ error: 'Round has no linked Hattrick matches.' });
  if (matches.length > 10) return res.status(422).json({ error: 'Backfill is limited to ten matches per request.' });

  const chppUrl = 'https://chpp.hattrick.org/chppxml.ashx';
  const refreshed: Array<Record<string, unknown>> = [];
  for (const match of matches) {
    const htMatchId = Number(match.ht_match_id);
    const params = { file: 'matchdetails', version: '3.1', matchID: String(htMatchId), matchEvents: 'true' };
    const authorization = getAuthHeader(
      'GET', chppUrl, params, consumerKey, consumerSecret,
      credentials.oauth_token, credentials.oauth_token_secret,
    );
    const response = await fetch(
      `${chppUrl}?file=matchdetails&version=3.1&matchEvents=true&matchID=${htMatchId}`,
      { headers: { Authorization: authorization } },
    );
    const xml = await response.text();
    if (!response.ok || /<Error/i.test(xml)) {
      refreshed.push({ matchId: match.id, htMatchId, refreshed: false, error: 'CHPP MatchDetails was unavailable.' });
      continue;
    }

    const homeTeam = match.home_team as { ht_team_id?: number | null } | null;
    const awayTeam = match.away_team as { ht_team_id?: number | null } | null;
    const details = mapMatchEventDetailsToFixture(
      parseMatchEventDetails(xml),
      typeof homeTeam?.ht_team_id === 'number' ? homeTeam.ht_team_id : null,
      typeof awayTeam?.ht_team_id === 'number' ? awayTeam.ht_team_id : null,
    );
    const footballScore = getFootballScore(details);
    const shootout = getPenaltyShootoutScore(details);
    if (apply) {
      const { error } = await supabase.from('matches').update({
        match_event_details: details,
        home_goals: footballScore?.home ?? null,
        away_goals: footballScore?.away ?? null,
        went_120: details.result?.reached120 ?? false,
        penalty_shootout_home_goals: shootout.home,
        penalty_shootout_away_goals: shootout.away,
      }).eq('id', match.id);
      if (error) throw error;
    }
    refreshed.push({
      matchId: match.id,
      htMatchId,
      refreshed: true,
      persisted: apply,
      version: details.version,
      result: details.result,
      // The dry-run is an explicit admin inspection operation. Return parsed,
      // non-secret facts so a backfill can be reviewed before it is persisted;
      // never return the source XML or CHPP credentials.
      ...(apply ? {} : { details }),
    });
  }

  return res.status(200).json({
    tournamentId,
    seasonNumber,
    roundNumber,
    dryRun: !apply,
    refreshed,
  });
}

async function loadRoundPressEligibility(
  supabase: ReturnType<typeof getServiceSupabase>,
  tournamentId: string,
  seasonNumber: number,
  allowMultipleReports = false,
) {
  const { data, error } = await supabase
    .from('rounds')
    .select('round_number, matches(home_team_id, away_team_id, completed, status, scheduled_for)')
    .eq('tournament_id', tournamentId)
    .eq('season_number', seasonNumber)
    .order('round_number', { ascending: true });
  if (error) throw error;
  const eligibleRoundNumber = getEligibleRoundPressNumber((data || []) as RoundPressEligibilityRound[]);
  if (eligibleRoundNumber === null || allowMultipleReports) return eligibleRoundNumber;

  const { data: reports, error: reportsError } = await supabase
    .from('news_posts')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('season_number', seasonNumber)
    .eq('round_number', eligibleRoundNumber)
    .eq('is_round_report', true)
    .limit(1);
  if (reportsError) throw reportsError;
  return reports && reports.length > 0 ? null : eligibleRoundNumber;
}

async function handleRoundSummaryEligibility(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.query.tournamentId);
  if (!tournamentId) return res.status(400).json({ error: 'Missing tournamentId.' });

  const actor = await requireTournamentRoleSession(req, res, tournamentId);
  if (!actor) return;
  if (!actor.access.canPublishAnnouncements) return res.status(403).json({ error: 'Not available.' });

  const supabase = getServiceSupabase();
  const { data: tournament, error } = await supabase
    .from('tournaments')
    .select('season, registration_type')
    .eq('id', tournamentId)
    .maybeSingle();
  if (error) throw error;
  if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });

  const seasonNumber = positiveInteger(tournament.season) || 1;
  const roundNumber = await loadRoundPressEligibility(
    supabase,
    tournamentId,
    seasonNumber,
    tournament.registration_type === 'sandbox',
  );
  return res.status(200).json(roundNumber === null
    ? { available: false }
    : { available: true, roundNumber });
}

async function handleGenerateRoundSummary(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.body?.tournamentId);
  const seasonNumber = positiveInteger(req.body?.seasonNumber);
  const roundNumber = positiveInteger(req.body?.roundNumber);
  if (!tournamentId || !seasonNumber || !roundNumber) {
    return res.status(400).json({ error: 'tournamentId, seasonNumber, and roundNumber are required.' });
  }

  const actor = await requireTournamentRoleSession(req, res, tournamentId);
  if (!actor) return;
  if (!actor.access.canPublishAnnouncements) {
    return res.status(403).json({ error: 'This role cannot generate tournament press drafts.' });
  }

  const supabase = getServiceSupabase();
  const { data: tournament, error: tournamentError } = await supabase
    .from('tournaments')
    .select('id, name, season, scoring_mode, registration_type')
    .eq('id', tournamentId)
    .maybeSingle();
  if (tournamentError) throw tournamentError;
  if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });

  const currentSeasonNumber = positiveInteger(tournament.season) || 1;
  const protectedHistoricalRequest = isForgeAdminRequest(req.headers.cookie) || hasSuperAdminBypassCookie(req.headers.cookie);
  if (seasonNumber !== currentSeasonNumber && !protectedHistoricalRequest) {
    return res.status(400).json({ error: 'Public round summaries are available only for the current season.' });
  }
  if (seasonNumber === currentSeasonNumber || !protectedHistoricalRequest) {
    const eligibleRoundNumber = await loadRoundPressEligibility(
      supabase,
      tournamentId,
      currentSeasonNumber,
      tournament.registration_type === 'sandbox',
    );
    if (eligibleRoundNumber !== roundNumber) {
      return res.status(409).json({ error: 'This round is not currently eligible for a public summary.' });
    }
  }
  const scoringMode: PersistedScoringMode = tournament.scoring_mode === 'points' || tournament.scoring_mode === 'appg' || tournament.scoring_mode === '120m'
    ? tournament.scoring_mode
    : '120min';
  let rounds: RoundPressRoundSource[];
  let teams: RoundPressTeamSource[];

  if (seasonNumber !== currentSeasonNumber) {
    const { data: season, error: seasonError } = await supabase
      .from('tournament_seasons')
      .select('season_number, fixtures_snapshot_json')
      .eq('tournament_id', tournamentId)
      .eq('season_number', seasonNumber)
      .maybeSingle();
    if (seasonError) throw seasonError;
    if (!season) return res.status(400).json({ error: 'Requested season does not belong to this tournament.' });
    const snapshot = season.fixtures_snapshot_json as SeasonFixturesSnapshot | null;
    if (!snapshot?.rounds) return res.status(422).json({ error: `Season ${seasonNumber} has no archived fixture data.` });
    const snapshotTeams = snapshotTeamsFromRounds(snapshot);
    rounds = roundPressRounds(snapshot.rounds as unknown as unknown[], snapshotTeams);
    const historicalRoundIds = rounds.map((round) => round.id);
    if (historicalRoundIds.length > 0) {
      const { data: persistedMatchFacts, error: persistedMatchFactsError } = await supabase
        .from('matches')
        .select('id, home_goals, away_goals, went_120, total_minutes, penalty_shootout_home_goals, penalty_shootout_away_goals, match_event_details')
        .in('round_id', historicalRoundIds);
      if (persistedMatchFactsError) throw persistedMatchFactsError;
      rounds = hydrateHistoricalRoundPressFacts(rounds, persistedMatchFacts || []);
    }
    teams = Array.from(snapshotTeams.values());
  } else {
    const [{ data: roundRows, error: roundsError }, { data: teamRows, error: teamsError }] = await Promise.all([
      supabase.from('rounds').select('id, round_number').eq('tournament_id', tournamentId).eq('season_number', seasonNumber).order('round_number', { ascending: true }),
      supabase.from('teams').select('id, name, ht_team_id, manager_name, country_name, country_id, league_id').eq('tournament_id', tournamentId),
    ]);
    if (roundsError) throw roundsError;
    if (teamsError) throw teamsError;
    const roundIds = (roundRows || []).map((row) => row.id).filter((id): id is string => typeof id === 'string');
    if (roundIds.length === 0) return res.status(404).json({ error: `Season ${seasonNumber} has no rounds.` });
    const { data: matchRows, error: matchesError } = await supabase
      .from('matches')
      .select(`*, home_team:teams!matches_home_team_id_fkey(id, name, ht_team_id, manager_name, country_name, country_id, league_id), away_team:teams!matches_away_team_id_fkey(id, name, ht_team_id, manager_name, country_name, country_id, league_id)`)
      .in('round_id', roundIds);
    if (matchesError) throw matchesError;
    const sourceTeams = (teamRows || []).map((row) => roundPressTeam(row, typeof row.id === 'string' ? row.id : null)).filter((team): team is RoundPressTeamSource => Boolean(team));
    teams = sourceTeams;
    const matchesByRound = new Map<string, RoundPressMatchSource[]>();
    (matchRows || []).forEach((row) => {
      const match = roundPressMatch(row);
      if (!match) return;
      const list = matchesByRound.get(match.round_id) || [];
      list.push(match);
      matchesByRound.set(match.round_id, list);
    });
    rounds = (roundRows || []).map((row) => ({ id: row.id, round_number: Number(row.round_number), matches: matchesByRound.get(row.id) || [] }));
  }

  const selectedRound = rounds.find((round) => round.round_number === roundNumber);
  if (!selectedRound) return res.status(404).json({ error: `Round ${roundNumber} was not found for Season ${seasonNumber}.` });
  const realMatches = selectedRound.matches.filter((match) => match.home_team && match.away_team);
  if (realMatches.length === 0) return res.status(422).json({ error: `Round ${roundNumber} does not contain any real fixtures.` });
  const incomplete = realMatches.find((match) => !match.completed && match.status !== 'misarranged');
  if (incomplete) return res.status(409).json({ error: `Round ${roundNumber} is not complete yet.` });

  const input = buildRoundPressInput({
    tournament: { id: tournament.id, name: tournament.name, scoringMode },
    seasonNumber,
    roundNumber,
    rounds: rounds.map((round) => ({ ...round, matches: round.matches.filter((match) => match.home_team && match.away_team) })),
    teams,
  });
  const startedAt = Date.now();
  console.log('[Round press input]', JSON.stringify(input, null, 2));
  let provider = 'unknown';
  let model = 'unknown';
  try {
    const configuredProvider = resolveRoundPressProvider();
    provider = configuredProvider;
    model = roundPressModelForProvider(configuredProvider);
    const result = await generateConfiguredRoundPressDraft(input, { providerValue: configuredProvider });
    console.info('[Round press] generated', {
      tournamentId,
      seasonNumber,
      roundNumber,
      matchCount: input.matches.length,
      provider,
      model,
      success: true,
      thinkingLevel: ROUND_PRESS_THINKING_LEVEL,
      promptVersion: ROUND_PRESS_PROMPT_VERSION,
      repaired: result.repaired,
      durationMs: Date.now() - startedAt,
    });
    return res.status(200).json({
      ...result.draft,
      promptRevision: ROUND_PRESS_PROMPT_VERSION,
    });
  } catch (error) {
    console.error('[Round press] generation failed', {
      tournamentId,
      seasonNumber,
      roundNumber,
      provider,
      model,
      success: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    const message = error instanceof Error ? error.message : '';
    if (error instanceof GeminiTemporarilyUnavailableError) {
      return res.status(503).json({ error: 'Gemini is temporarily unavailable. Please try again shortly.' });
    }
    if (error instanceof CloudflareAiTemporarilyUnavailableError) {
      return res.status(503).json({ error: 'Cloudflare AI is temporarily unavailable. Please try again shortly.' });
    }
    if (error instanceof RoundPressProviderConfigurationError) {
      return res.status(500).json({ error: 'Round press provider configuration is invalid.' });
    }
    if (error instanceof CloudflareAiConfigurationError) {
      return res.status(500).json({ error: 'Cloudflare AI configuration is unavailable.' });
    }
    if (message === 'Gemini configuration is missing.') return res.status(500).json({ error: message });
    return res.status(502).json({ error: 'Could not generate a valid round summary.' });
  }
}

async function handlePostRoundSummary(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.body?.tournamentId);
  const seasonNumber = positiveInteger(req.body?.seasonNumber);
  const roundNumber = positiveInteger(req.body?.roundNumber);
  const title = readString(req.body?.title);
  const content = readString(req.body?.content);
  if (!tournamentId || !seasonNumber || !roundNumber || !content) {
    return res.status(400).json({ error: 'tournamentId, seasonNumber, roundNumber, and content are required.' });
  }

  const actor = await requireTournamentRoleSession(req, res, tournamentId);
  if (!actor) return;
  if (!actor.access.canPublishAnnouncements) return res.status(403).json({ error: 'Not available.' });

  const supabase = getServiceSupabase();
  const [{ data: tournament, error: tournamentError }, { data: round, error: roundError }] = await Promise.all([
    supabase.from('tournaments').select('registration_type').eq('id', tournamentId).maybeSingle(),
    supabase
      .from('rounds')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('season_number', seasonNumber)
      .eq('round_number', roundNumber)
      .maybeSingle(),
  ]);
  if (tournamentError) throw tournamentError;
  if (roundError) throw roundError;
  if (!tournament || !round) return res.status(404).json({ error: 'Round not found.' });

  const { data: post, error: postError } = await supabase
    .from('news_posts')
    .insert({
      tournament_id: tournamentId,
      season_number: seasonNumber,
      round_number: roundNumber,
      is_round_report: tournament.registration_type !== 'sandbox',
      title: title || null,
      content,
      author_name: `Cup Press Release by ${actor.access.viewerManagerName || 'Tournament organizer'}`,
      author_team_id: null,
      is_admin: true,
    })
    .select('*')
    .single();
  if (postError?.code === '23505') {
    return res.status(409).json({ error: `A Round ${roundNumber} report has already been published.` });
  }
  if (postError) throw postError;
  return res.status(201).json(post);
}

function routeFor(request: VercelRequest) {
  const raw = request.query.route;
  return readString(Array.isArray(raw) ? raw[0] : raw) || 'activity';
}

function isSecureRequest(request: VercelRequest) {
  const host = String(request.headers.host || '').split(':')[0].toLowerCase();
  return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
}

async function handlePresence(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const secret = getAppSessionSecret();
  if (!secret) return res.status(500).json({ error: 'Server misconfigured' });

  const session = verifyAppSessionCookie(req.headers.cookie, secret);
  const devFallbackUserId =
    process.env.NODE_ENV !== 'production' ? Number(req.headers['x-ht-user-id'] || '0') || null : null;
  if (!session && !devFallbackUserId) {
    return res.status(401).json({ error: 'Unauthorized', details: 'Missing or invalid application session.' });
  }

  const supabase = getSupabase();
  const now = new Date();
  const userId = session?.userId || devFallbackUserId;
  const { data: profile, error: readError } = await supabase
    .from('profiles')
    .select('last_seen_at')
    .eq('hattrick_user_id', userId)
    .maybeSingle();
  if (readError) return res.status(500).json({ error: 'Failed to read presence state', details: readError.message });
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const currentSeenAt = profile.last_seen_at ? new Date(profile.last_seen_at) : null;
  if (currentSeenAt && Number.isFinite(currentSeenAt.getTime()) && now.getTime() - currentSeenAt.getTime() < 120000) {
    return res.status(200).json({ last_seen_at: profile.last_seen_at, updated: false });
  }

  const nextSeenAt = now.toISOString();
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ last_seen_at: nextSeenAt })
    .eq('hattrick_user_id', userId);
  if (updateError) return res.status(500).json({ error: 'Failed to update presence', details: updateError.message });

  return res.status(200).json({ last_seen_at: nextSeenAt, updated: true });
}

async function handleActivity(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const eventType = readString(req.body?.eventType);
  if (!eventType || !/^[a-z0-9_.:-]{2,80}$/i.test(eventType)) {
    return res.status(400).json({ error: 'Invalid activity event.' });
  }

  try {
    const result = await recordActivity(req, res, {
      eventType,
      route: readString(req.body?.route) || null,
      tournamentId: readString(req.body?.tournamentId) || null,
      teamId: readString(req.body?.teamId) || null,
      metadata: typeof req.body?.metadata === 'object' && req.body.metadata ? req.body.metadata : {},
    });
    return res.status(201).json({ ok: true, userId: result.userId });
  } catch (error) {
    console.error('Activity ledger error:', error);
    return res.status(503).json({ error: 'Activity tracking is unavailable.' });
  }
}

async function handleForgeSession(req: VercelRequest, res: VercelResponse) {
  if (!isForgeEnabled()) return res.status(404).json({ error: 'Not found.' });
  if (req.method === 'GET') {
    const session = verifyForgeSessionCookie(req.headers.cookie);
    if (!session) return res.status(200).json({ authorized: false });
    const { data: profile } = await getServiceSupabase()
      .from('profiles')
      .select('manager_name')
      .eq('hattrick_user_id', session.userId)
      .maybeSingle();
    return res.status(200).json({ authorized: true, userId: session.userId, managerName: profile?.manager_name || null });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Set-Cookie', clearForgeSessionCookie(isSecureRequest(req)));
  return res.status(200).json({ authorized: false });
}

async function handleHistory(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (req.method === 'GET') {
    const supabase = getSupabase();
    const seasonId = readString(req.query.seasonId);
    if (!seasonId) return res.status(400).json({ error: 'Missing seasonId' });

    if (req.query.notice === HISTORY_REPORT_STATUS_NOTICE) {
      const tournamentId = readString(req.query.tournamentId);
      const secret = getAppSessionSecret();
      const session = secret ? verifyAppSessionCookie(req.headers.cookie, secret) : null;
      if (!tournamentId || !session) return res.status(200).json({ dismissed: false, seen: false, tracked: false });

      const { data, error } = await supabase
        .from('tournament_announcement_dismissals')
        .select('notice_key')
        .eq('tournament_id', tournamentId)
        .in('notice_key', [
          `${HISTORY_REPORT_DISMISSED_NOTICE}:${seasonId}`,
          `${HISTORY_REPORT_VIEWED_NOTICE}:${seasonId}`,
        ])
        .eq('hattrick_user_id', session.userId)
        .limit(2);
      if (error) throw error;
      const noticeKeys = new Set((data || []).map((row) => row.notice_key));
      return res.status(200).json({
        dismissed: noticeKeys.has(`${HISTORY_REPORT_DISMISSED_NOTICE}:${seasonId}`),
        seen: noticeKeys.has(`${HISTORY_REPORT_VIEWED_NOTICE}:${seasonId}`),
        tracked: true,
      });
    }

    const { data, error } = await supabase
      .from('tournament_season_comments')
      .select(COMMENT_SELECT)
      .eq('season_id', seasonId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return res.status(200).json({ comments: data ?? [] });
  }

  const action = readString(req.body?.action);
  let supabase: ReturnType<typeof getServiceSupabase>;
  try {
    supabase = getServiceSupabase();
  } catch (error) {
    console.error('Tournament history service configuration error:', error);
    return res.status(503).json({ error: 'Season comments are unavailable right now.' });
  }

  const secret = getAppSessionSecret();
  if (!secret) return res.status(500).json({ error: 'Session configuration is missing.' });
  const session = verifyAppSessionCookie(req.headers.cookie, secret);
  if (!session) return res.status(401).json({ error: 'Please sign in with Hattrick first.' });

  if (action === 'mark-history-report-dismissed' || action === 'mark-history-report-seen') {
    const seasonId = readString(req.body?.seasonId);
    const tournamentId = readString(req.body?.tournamentId);
    if (!seasonId || !tournamentId) return res.status(400).json({ error: 'Missing season or tournament.' });
    const noticePrefix = action === 'mark-history-report-dismissed' ? HISTORY_REPORT_DISMISSED_NOTICE : HISTORY_REPORT_VIEWED_NOTICE;
    const { data, error } = await supabase
      .from('tournament_announcement_dismissals')
      .insert({
        tournament_id: tournamentId,
        notice_key: `${noticePrefix}:${seasonId}`,
        announcement_id: null,
        hattrick_user_id: session.userId,
      })
      .select('id')
      .single();
    if (error?.code === '23505') return res.status(200).json({ seen: action === 'mark-history-report-seen' });
    if (error) throw error;
    return res.status(200).json({ seen: action === 'mark-history-report-seen', id: data?.id });
  }

  const seasonId = readString(req.body?.seasonId);
  const teamId = readString(req.body?.teamId);
  const validatedComment = validateSeasonComment(req.body?.comment);
  if (!seasonId || !teamId) return res.status(400).json({ error: 'Missing season or team.' });
  if (validatedComment.error) return res.status(400).json({ error: validatedComment.error });

  const { data: season, error: seasonError } = await supabase
    .from('tournament_seasons')
    .select('id, tournament_id, status, snapshot_json')
    .eq('id', seasonId)
    .single();
  if (seasonError || !season) return res.status(404).json({ error: 'Season not found.' });
  if (season.status !== 'finished') return res.status(409).json({ error: 'Season comments open after the season is finished.' });

  const participant = findSeasonParticipant(season.snapshot_json, teamId);
  if (!participant) return res.status(403).json({ error: 'Only this season’s team owner can leave its final comment.' });

  const { data: ownedTeam, error: ownedTeamError } = await supabase
    .from('teams')
    .select('id')
    .eq('id', teamId)
    .eq('tournament_id', season.tournament_id)
    .eq('hattrick_user_id', session.userId)
    .maybeSingle();
  if (ownedTeamError) throw ownedTeamError;
  if (!ownedTeam) return res.status(403).json({ error: 'This team is not linked to your Hattrick account.' });

  const { data, error } = await supabase
    .from('tournament_season_comments')
    .insert({
      season_id: season.id,
      tournament_id: season.tournament_id,
      team_id: teamId,
      hattrick_user_id: session.userId,
      team_name: participant.teamName || 'Unknown team',
      manager_name: participant.managerName || null,
      comment: validatedComment.comment,
    })
    .select(COMMENT_SELECT)
    .single();
  if (error?.code === '23505') return res.status(409).json({ error: 'This team has already left its final season comment.' });
  if (error) throw error;
  return res.status(201).json({ comment: data });
}

function toDate(value: unknown, fallback: Date) {
  const parsed = typeof value === 'string' ? new Date(value) : fallback;
  return Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

async function handleForgeStats(req: VercelRequest, res: VercelResponse) {
  if (!isForgeEnabled()) return res.status(404).json({ error: 'Not found.' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!isForgeAdminRequest(req.headers.cookie) && !hasSuperAdminBypassCookie(req.headers.cookie)) {
    return res.status(401).json({ error: 'Forge authorization required.' });
  }

  const now = new Date();
  const since = toDate(req.query.since, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
  const selectedUserId = Number(req.query.userId || 0) || null;
  const selectedVisitorId = readString(req.query.visitorId) || null;
  const includeAdmin = String(req.query.includeAdmin || '') === '1';
  const adminId = getForgeSuperadminId();
  const supabase = getServiceSupabase();

  await cleanupActivityEvents().catch((error) => console.warn('Activity cleanup failed:', error));

  const { data: rawEvents, error: eventError } = await supabase
    .from('activity_events')
    .select('id, occurred_at, visitor_id, visit_id, hattrick_user_id, manager_name, event_type, route, tournament_id, team_id, referrer, country_code, language, platform, browser, user_agent, ip_address, metadata')
    .gte('occurred_at', since.toISOString())
    .order('occurred_at', { ascending: false })
    .limit(10000);
  if (eventError) throw eventError;

  const adminVisitorIds = new Set(
    (rawEvents || [])
      .filter((event) => adminId && event.hattrick_user_id === adminId)
      .map((event) => event.visitor_id),
  );
  const visibleEvents = (rawEvents || []).filter(
    (event) => includeAdmin || (event.hattrick_user_id !== adminId && !adminVisitorIds.has(event.visitor_id)),
  );
  const identityByVisitor = new Map<string, { userId: number; managerName: string | null }>();
  for (const event of visibleEvents) {
    if (event.hattrick_user_id) {
      identityByVisitor.set(event.visitor_id, {
        userId: event.hattrick_user_id,
        managerName: event.manager_name,
      });
    }
  }
  const events = visibleEvents.map((event) => {
    const identity = identityByVisitor.get(event.visitor_id);
    return {
      ...event,
      resolved_user_id: event.hattrick_user_id || identity?.userId || null,
      resolved_manager_name: event.manager_name || identity?.managerName || null,
    };
  });
  const users = new Map<number, {
    userId: number;
    managerName: string;
    visits: number;
    events: number;
    firstSeen: string;
    lastSeen: string;
    tournaments: Set<string>;
    teams: Set<string>;
  }>();
  const visitorsById = new Map<string, {
    visitorId: string;
    userId: number | null;
    managerName: string | null;
    visits: number;
    events: number;
    firstSeen: string;
    lastSeen: string;
    countries: Set<string>;
    platforms: Set<string>;
    browsers: Set<string>;
    routes: Set<string>;
  }>();
  const visitors = new Set<string>();
  let visitEvents = 0;
  let actionEvents = 0;
  for (const event of events) {
    visitors.add(event.visitor_id);
    if (event.event_type === 'page_view') visitEvents += 1;
    else actionEvents += 1;
    const visitor = visitorsById.get(event.visitor_id) || {
      visitorId: event.visitor_id,
      userId: event.resolved_user_id,
      managerName: event.resolved_manager_name,
      visits: 0,
      events: 0,
      firstSeen: event.occurred_at,
      lastSeen: event.occurred_at,
      countries: new Set<string>(),
      platforms: new Set<string>(),
      browsers: new Set<string>(),
      routes: new Set<string>(),
    };
    visitor.events += 1;
    if (event.event_type === 'page_view') visitor.visits += 1;
    visitor.userId = event.resolved_user_id || visitor.userId;
    visitor.managerName = event.resolved_manager_name || visitor.managerName;
    visitor.firstSeen = event.occurred_at < visitor.firstSeen ? event.occurred_at : visitor.firstSeen;
    visitor.lastSeen = event.occurred_at > visitor.lastSeen ? event.occurred_at : visitor.lastSeen;
    if (event.country_code) visitor.countries.add(event.country_code);
    if (event.platform) visitor.platforms.add(event.platform);
    if (event.browser) visitor.browsers.add(event.browser);
    if (event.route) visitor.routes.add(event.route);
    visitorsById.set(event.visitor_id, visitor);

    if (!event.resolved_user_id) continue;
    const existing = users.get(event.resolved_user_id) || {
      userId: event.resolved_user_id,
      managerName: event.resolved_manager_name || 'Unknown manager',
      visits: 0,
      events: 0,
      firstSeen: event.occurred_at,
      lastSeen: event.occurred_at,
      tournaments: new Set<string>(),
      teams: new Set<string>(),
    };
    existing.events += 1;
    if (event.event_type === 'page_view') existing.visits += 1;
    existing.firstSeen = event.occurred_at < existing.firstSeen ? event.occurred_at : existing.firstSeen;
    existing.lastSeen = event.occurred_at > existing.lastSeen ? event.occurred_at : existing.lastSeen;
    if (event.resolved_manager_name) existing.managerName = event.resolved_manager_name;
    if (event.tournament_id) existing.tournaments.add(event.tournament_id);
    if (event.team_id) existing.teams.add(event.team_id);
    users.set(event.resolved_user_id, existing);
  }

  const userRows = Array.from(users.values()).map((user) => ({
    ...user,
    tournaments: user.tournaments.size,
    teams: user.teams.size,
  })).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  const visitorRows = Array.from(visitorsById.values()).map((visitor) => ({
    ...visitor,
    countries: Array.from(visitor.countries),
    platforms: Array.from(visitor.platforms),
    browsers: Array.from(visitor.browsers),
    routes: Array.from(visitor.routes),
  })).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  const selectedEvents = selectedVisitorId
    ? events.filter((event) => event.visitor_id === selectedVisitorId).slice(0, 500)
    : selectedUserId
      ? events.filter((event) => event.resolved_user_id === selectedUserId).slice(0, 500)
      : events.slice(0, 100);

  const breakdown = (values: Array<string | null | undefined>) => {
    const counts = new Map<string, number>();
    for (const value of values) {
      if (!value) continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  };
  const metadataValues = (key: string) =>
    events.map((event) => (typeof event.metadata?.[key] === 'string' ? String(event.metadata[key]) : null));

  const { data: daily, error: dailyError } = await supabase
    .from('activity_daily')
    .select('activity_date, event_type, route, event_count')
    .gte('activity_date', since.toISOString().slice(0, 10))
    .order('activity_date', { ascending: true });
  if (dailyError) throw dailyError;

  return res.status(200).json({
    since: since.toISOString(),
    summary: {
      events: events.length,
      visits: visitEvents,
      actions: actionEvents,
      uniqueVisitors: visitors.size,
      identifiedUsers: userRows.length,
    },
    users: userRows,
    visitors: visitorRows,
    events: selectedEvents,
    breakdowns: {
      countries: breakdown(events.map((event) => event.country_code)),
      platforms: breakdown(events.map((event) => event.platform)),
      browsers: breakdown(events.map((event) => event.browser)),
      languages: breakdown(events.map((event) => event.language)),
      routes: breakdown(events.map((event) => event.route)),
      referrers: breakdown(events.map((event) => event.referrer)),
      themes: breakdown(metadataValues('theme')),
      screens: breakdown(metadataValues('screen')),
      times: breakdown(
        events.map((event) => {
          const hour = new Date(event.occurred_at).getHours();
          return `${String(hour).padStart(2, '0')}:00`;
        }),
      ),
    },
    selectedVisitorId,
    daily: daily || [],
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    switch (routeFor(req)) {
      case 'presence':
        return await handlePresence(req, res);
      case 'history':
        return await handleHistory(req, res);
      case 'forge-session':
        return await handleForgeSession(req, res);
      case 'forge-stats':
        return await handleForgeStats(req, res);
      case 'tournament-roles':
        return await handleTournamentRoles(req, res);
      case 'tournament-access':
        return await handleTournamentAccess(req, res);
      case 'managed-tournaments':
        return await handleManagedTournaments(req, res);
      case 'tournament-participation':
        return await handleTournamentParticipation(req, res);
      case 'season-slot-replacement':
        return await handleSeasonSlotReplacement(req, res);
      case 'fixture-challenge':
        return await handleFixtureChallenge(req, res);
      case 'backfill-round-matchdetails':
        return await handleRoundPressMatchDetailsBackfill(req, res);
      case 'generate-round-summary':
        return req.method === 'GET'
          ? await handleRoundSummaryEligibility(req, res)
          : await handleGenerateRoundSummary(req, res);
      case 'post-round-summary':
        return await handlePostRoundSummary(req, res);
      case 'activity':
      default:
        return await handleActivity(req, res);
    }
  } catch (error) {
    console.error('Application API error:', error);
    return res.status(500).json({ error: 'Application request failed.' });
  }
}
