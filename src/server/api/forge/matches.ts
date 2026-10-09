import type { VercelRequest, VercelResponse } from '@vercel/node';
import { hasSuperAdminBypassCookie } from '../_lib/superadmin-bypass.js';
import { isForgeAdminRequest } from '../_lib/forge-session.js';
import { getServiceSupabase } from '../_lib/supabase.js';
import { isForgeEnabled } from '../../forge-availability.js';
import { compareTournamentListing } from '../../../utils/tournament-collections.js';
import { getMatchDateForRound } from '../../../utils/match-schedule.js';
import {
  acceptChppChallengeDirect,
  parseChppChallengeOffers,
  parseChppOutgoingChallenges,
  sendChppChallengeDirect,
  viewChppChallenges,
} from '../_lib/chpp-challenges.js';
import {
  fetchManagerTeamsFromChpp,
  getManagerChppCredentials,
  type ManagerChppCredentials,
} from '../_lib/matchmaker.js';
import { resolveChallengeManagementStatus } from '../_lib/fixture-challenge.js';
import {
  findExactPendingIncomingChallenge,
  findExactPendingOutgoingChallenge,
  hasExactAgreedChallenge,
  isForgeFixtureAlreadyBooked,
  isForgeFixtureMisarranged,
  resolveForgeFixtureActionTarget,
  resolveForgeTeamActions,
  selectCurrentForgeRound,
  type ForgeFixtureRecord,
  type ForgeFixtureTeam,
  type ForgeMatchSide,
  type ForgeTeamChallengeInspection,
} from '../_lib/forge-matches.js';

type ForgeTournamentRow = {
  id: string;
  name: string;
  slug: string | null;
  season: number | null;
  status: string | null;
  is_archived: boolean | null;
  is_test: boolean | null;
  scoring_mode: string | null;
  created_at?: string;
  schedule_start_slot?: string | null;
  registration_closed_at?: string | null;
};

type ForgeTeamRow = {
  id: string;
  name: string;
  manager_name: string | null;
  hattrick_user_id: number | null;
  ht_team_id: number | null;
  active: boolean | null;
  is_placeholder: boolean | null;
  oauth_scope: string | null;
  can_manage_challenges: boolean | null;
};

type ForgeMatchRow = {
  id: string;
  round_id: string;
  status: string | null;
  completed: boolean | null;
  ht_match_id: number | null;
  scheduled_for: string | null;
  home_team: ForgeTeamRow | ForgeTeamRow[] | null;
  away_team: ForgeTeamRow | ForgeTeamRow[] | null;
};

type ForgeRoundRow = {
  id: string;
  tournament_id: string;
  created_at: string;
  season_number: number;
  round_number: number;
  phase: 'regular' | 'postseason';
  phase_status: 'pending' | 'materialized' | 'completed';
  matches?: Array<{ completed: boolean | null; status?: string | null }> | null;
};

type ForgeProfileRow = {
  hattrick_user_id: number;
  oauth_scope: string | null;
};

type ForgeTournamentOverviewTeamRow = {
  id: string;
  tournament_id: string;
  name: string;
  ht_team_id: number | null;
  manager_name: string | null;
  hattrick_user_id: number | null;
  country_name: string | null;
  active: boolean | null;
  reserve_active: boolean | null;
  is_placeholder: boolean | null;
};

type ForgeOverviewProfileRow = {
  hattrick_user_id: number;
  manager_name: string | null;
  country_name: string | null;
  last_seen_at: string | null;
};

type ForgeOverviewMatchRow = {
  id: string;
  round_id: string;
  status: string | null;
  completed: boolean | null;
  ht_match_id: number | null;
  scheduled_for: string | null;
  chpp_match_date: string | null;
  schedule_slot_type: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_team: { country_name: string | null } | Array<{ country_name: string | null }> | null;
};

type ForgeAutoArrangePreferenceRow = {
  tournament_id: string;
  season_number: number;
  team_id: string;
  hattrick_user_id: number;
  enabled: boolean;
};

type ForgeTournamentOverviewTeam = {
  id: string;
  name: string;
  htTeamId: number | null;
  managerName: string | null;
  managerCountryName: string | null;
  managerLastSeenAt: string | null;
  autoArrangeEnabled: boolean;
};

type ChallengeSnapshot = {
  inspection: ForgeTeamChallengeInspection;
  challengeManagement: 'enabled' | 'reauthorization_required' | 'unknown';
  credentials: ManagerChppCredentials | null;
  ownershipVerified: boolean;
};

type ManagerCache = {
  credentials: Map<number, Promise<ManagerChppCredentials | null>>;
  ownership: Map<number, Promise<Set<number> | null>>;
};

const TERMINAL_TOURNAMENT_STATUSES = new Set(['finished', 'archived', 'cancelled']);

function readString(value: unknown) {
  if (Array.isArray(value)) return String(value[0] ?? '').trim();
  return String(value ?? '').trim();
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function isRelevantTournament(tournament: Pick<ForgeTournamentRow, 'status' | 'is_archived' | 'is_test'>) {
  return !tournament.is_test && !tournament.is_archived && !TERMINAL_TOURNAMENT_STATUSES.has(tournament.status || '');
}

function requireForgeAdmin(req: VercelRequest, res: VercelResponse) {
  if (!isForgeEnabled()) {
    res.status(404).json({ error: 'Not found.' });
    return false;
  }
  if (isForgeAdminRequest(req.headers.cookie) || hasSuperAdminBypassCookie(req.headers.cookie)) return true;
  res.status(401).json({ error: 'Forge authorization required.' });
  return false;
}

async function loadTournament(supabase: ReturnType<typeof getServiceSupabase>, tournamentId: string) {
  const { data, error } = await supabase
    .from('tournaments')
    .select('id, name, slug, season, status, is_archived, is_test, scoring_mode')
    .eq('id', tournamentId)
    .maybeSingle();
  if (error) throw error;
  const tournament = data as ForgeTournamentRow | null;
  if (!tournament || !isRelevantTournament(tournament)) return null;
  return tournament;
}

async function loadMaterializedRounds(
  supabase: ReturnType<typeof getServiceSupabase>,
  tournament: ForgeTournamentRow,
) {
  const { data, error } = await supabase
    .from('rounds')
    .select('id, tournament_id, created_at, season_number, round_number, phase, phase_status, matches(id, completed, status)')
    .eq('tournament_id', tournament.id)
    .eq('season_number', tournament.season || 1)
    .eq('phase', 'regular')
    .in('phase_status', ['materialized', 'completed'])
    .order('round_number', { ascending: true });
  if (error) throw error;
  return (data || []) as ForgeRoundRow[];
}

function selectForgeRound(rounds: ForgeRoundRow[], roundNumber?: number | null) {
  if (roundNumber !== null && roundNumber !== undefined) {
    return rounds.find((round) => round.round_number === roundNumber) || null;
  }
  return selectCurrentForgeRound(rounds);
}

async function loadCurrentRound(
  supabase: ReturnType<typeof getServiceSupabase>,
  tournament: ForgeTournamentRow,
  roundNumber?: number | null,
) {
  return selectForgeRound(await loadMaterializedRounds(supabase, tournament), roundNumber);
}

async function loadTournamentOptions(supabase: ReturnType<typeof getServiceSupabase>) {
  const { data: tournamentRows, error: tournamentError } = await supabase
    .from('tournaments')
    .select('id, name, slug, season, status, is_archived, is_test, scoring_mode, created_at, schedule_start_slot, registration_closed_at')
    .order('name', { ascending: true });
  if (tournamentError) throw tournamentError;

  const tournaments = ((tournamentRows || []) as ForgeTournamentRow[]).filter(isRelevantTournament);
  if (tournaments.length === 0) return [];

  const tournamentIds = tournaments.map((tournament) => tournament.id);
  const seasonByTournament = new Map(tournaments.map((tournament) => [tournament.id, tournament.season || 1]));
  const { data: rounds, error: roundsError } = await supabase
    .from('rounds')
    .select('id, tournament_id, created_at, season_number, round_number, phase, phase_status')
    .in('tournament_id', tournamentIds)
    .order('round_number', { ascending: true });
  if (roundsError) throw roundsError;

  const currentSeasonRounds = ((rounds || []) as ForgeRoundRow[])
    .filter((round) => seasonByTournament.get(round.tournament_id) === round.season_number);
  const roundIds = currentSeasonRounds.map((round) => round.id);
  const [matchesResult, teamsResult] = await Promise.all([
    roundIds.length > 0
      ? supabase.from('matches')
          .select('id, round_id, status, completed, ht_match_id, scheduled_for, chpp_match_date, schedule_slot_type, home_team_id, away_team_id, home_team:teams!matches_home_team_id_fkey(country_name)')
          .in('round_id', roundIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('teams')
      .select('id, tournament_id, name, ht_team_id, manager_name, hattrick_user_id, country_name, active, reserve_active, is_placeholder')
      .in('tournament_id', tournamentIds)
      .eq('active', true),
  ]);
  if (matchesResult.error) throw matchesResult.error;
  if (teamsResult.error) throw teamsResult.error;

  const matchRows = (matchesResult.data || []) as ForgeOverviewMatchRow[];
  const teamRows = ((teamsResult.data || []) as ForgeTournamentOverviewTeamRow[])
    .filter((team) => team.active === true && team.reserve_active !== true && !team.is_placeholder);
  const teamIds = teamRows.map((team) => team.id);
  const managerIds = [...new Set(teamRows
    .map((team) => team.hattrick_user_id)
    .filter((managerId): managerId is number => managerId !== null)
    .map(Number))];
  const seasonNumbers = [...new Set(tournaments.map((tournament) => tournament.season || 1))];
  const [profilesResult, preferencesResult] = await Promise.all([
    managerIds.length > 0
      ? supabase.from('profiles')
          .select('hattrick_user_id, manager_name, country_name, last_seen_at')
          .in('hattrick_user_id', managerIds)
      : Promise.resolve({ data: [], error: null }),
    teamIds.length > 0 && managerIds.length > 0
      ? supabase.from('tournament_team_auto_arrange_preferences')
          .select('tournament_id, season_number, team_id, hattrick_user_id, enabled')
          .in('tournament_id', tournamentIds)
          .in('season_number', seasonNumbers)
          .in('team_id', teamIds)
          .in('hattrick_user_id', managerIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (profilesResult.error) throw profilesResult.error;
  if (preferencesResult.error) throw preferencesResult.error;

  const profileByManager = new Map(
    ((profilesResult.data || []) as ForgeOverviewProfileRow[])
      .map((profile) => [Number(profile.hattrick_user_id), profile]),
  );
  const autoArrangeByTeamManager = new Map(
    ((preferencesResult.data || []) as ForgeAutoArrangePreferenceRow[]).map((preference) => [
      `${preference.tournament_id}:${preference.season_number}:${preference.team_id}:${Number(preference.hattrick_user_id)}`,
      preference.enabled,
    ]),
  );
  const teamsByTournament = new Map<string, ForgeTournamentOverviewTeam[]>();
  const tournamentById = new Map(tournaments.map((tournament) => [tournament.id, tournament]));
  const teamById = new Map(teamRows.map((team) => [team.id, team]));
  for (const team of teamRows) {
    const managerId = team.hattrick_user_id === null ? null : Number(team.hattrick_user_id);
    const profile = managerId === null ? null : profileByManager.get(managerId);
    const season = tournamentById.get(team.tournament_id)?.season || 1;
    const autoArrangeEnabled = managerId === null
      ? true
      : autoArrangeByTeamManager.get(`${team.tournament_id}:${season}:${team.id}:${managerId}`) ?? true;
    const tournamentTeams = teamsByTournament.get(team.tournament_id) || [];
    tournamentTeams.push({
      id: team.id,
      name: team.name,
      htTeamId: team.ht_team_id,
      managerName: profile?.manager_name || team.manager_name,
      managerCountryName: profile?.country_name || team.country_name,
      managerLastSeenAt: profile?.last_seen_at || null,
      autoArrangeEnabled,
    });
    teamsByTournament.set(team.tournament_id, tournamentTeams);
  }

  const matchesByRound = new Map<string, ForgeOverviewMatchRow[]>();
  for (const match of matchRows) {
    const roundMatches = matchesByRound.get(match.round_id) || [];
    roundMatches.push(match);
    matchesByRound.set(match.round_id, roundMatches);
  }

  const sortableOptions = tournaments.flatMap((tournament) => {
    const season = tournament.season || 1;
    const tournamentRounds = currentSeasonRounds
      .filter((candidate) => candidate.tournament_id === tournament.id && candidate.season_number === season)
      .map((candidate) => ({
        ...candidate,
        matches: (matchesByRound.get(candidate.id) || []).map((match) => ({
          completed: match.completed,
          status: match.status,
        })),
      }));
    const bookingRounds = tournamentRounds.filter(
      (candidate) => candidate.phase === 'regular' && candidate.phase_status === 'materialized',
    );
    const round = selectCurrentForgeRound(bookingRounds)
      || bookingRounds.find((candidate) => candidate.matches?.length);
    const roundMatches = round ? matchesByRound.get(round.id) || [] : [];
    if (!round || roundMatches.length === 0) return [];
    const fixtures = roundMatches.filter((match) => match.home_team_id && match.away_team_id);
    const isBooked = (match: ForgeOverviewMatchRow) => Boolean(match.ht_match_id)
      || match.completed === true
      || ['arranged', 'finished', 'ongoing'].includes(match.status || '');
    const isMisarranged = (match: ForgeOverviewMatchRow) => match.status === 'misarranged';
    const isAutoArrangeOff = (match: ForgeOverviewMatchRow) => [match.home_team_id, match.away_team_id]
      .some((teamId) => {
        if (!teamId) return false;
        const team = teamById.get(teamId);
        if (team?.hattrick_user_id == null) return false;
        return autoArrangeByTeamManager.get(`${tournament.id}:${season}:${teamId}:${Number(team.hattrick_user_id)}`) === false;
      });
    const bookedCount = fixtures.filter((match) => !isMisarranged(match) && isBooked(match)).length;
    const misarrangedCount = fixtures.filter(isMisarranged).length;
    const openFixtures = fixtures.filter((match) => !isBooked(match) && !isMisarranged(match));
    const pendingAutoArrangeOffCount = openFixtures.filter(isAutoArrangeOff).length;
    const readyToBookCount = openFixtures.length - pendingAutoArrangeOffCount;
    const roundDate = roundMatches
      .map((match) => match.scheduled_for)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => left.localeCompare(right))[0] || null;

    const tournamentMatches = tournamentRounds.flatMap((candidate) => matchesByRound.get(candidate.id) || []);
    const completedRounds = tournamentRounds.filter((candidate) => {
      const matches = matchesByRound.get(candidate.id) || [];
      return matches.length > 0 && matches.every((match) => match.completed || match.status === 'misarranged');
    }).length;
    const sortedStartDate = tournamentRounds
      .flatMap((candidate) => (matchesByRound.get(candidate.id) || []).map((match) => getMatchDateForRound(
        candidate,
        {
          scheduled_for: match.scheduled_for,
          chpp_match_date: match.chpp_match_date,
          ht_match_id: match.ht_match_id,
          schedule_slot_type: match.schedule_slot_type,
        },
        relationOne(match.home_team)?.country_name,
      )))
      .sort((left, right) => left.getTime() - right.getTime())[0];
    const listingSummary = {
      id: tournament.id,
      slug: tournament.slug || '',
      name: tournament.name,
      created_at: tournament.created_at || '',
      season,
      status: tournament.status,
      registration_closed_at: tournament.registration_closed_at,
      rounds: tournamentRounds.map((candidate) => ({
        round_number: candidate.round_number,
        matches: matchesByRound.get(candidate.id) || [],
      })),
      totalRounds: tournamentRounds.length,
      completedRounds,
      totalMatches: tournamentMatches.length,
      completedMatches: tournamentMatches.filter((match) => match.completed || match.status === 'misarranged').length,
      teamCount: teamRows.filter((team) => team.tournament_id === tournament.id).length,
      startedAt: sortedStartDate || tournament.schedule_start_slot || tournament.created_at || null,
      plannedStartDate: tournament.schedule_start_slot,
    };
    const option = {
      id: tournament.id,
      name: tournament.name,
      slug: tournament.slug,
      season,
      status: tournament.status,
      currentRoundNumber: round?.round_number ?? null,
      roundDate,
      matchCount: fixtures.length,
      bookedCount,
      misarrangedCount,
      pendingAutoArrangeOffCount,
      readyToBookCount,
      teams: teamsByTournament.get(tournament.id) || [],
    };
    return [{ option, listingSummary }];
  });

  return sortableOptions
    .sort((left, right) => compareTournamentListing(left.listingSummary, right.listingSummary))
    .map(({ option }) => option);
}

function toFixtureTeam(team: ForgeTeamRow | null): ForgeFixtureTeam | null {
  if (!team) return null;
  return {
    id: team.id,
    name: team.name,
    managerName: team.manager_name,
    managerHtId: team.hattrick_user_id,
    htTeamId: team.ht_team_id,
    active: team.active !== false,
    isPlaceholder: team.is_placeholder === true,
  };
}

function toFixture(match: ForgeMatchRow): ForgeFixtureRecord {
  return {
    id: match.id,
    roundId: match.round_id,
    status: match.status,
    completed: match.completed === true,
    home: toFixtureTeam(relationOne(match.home_team)),
    away: toFixtureTeam(relationOne(match.away_team)),
  };
}

function emptyFixtureTeam(fixtureId: string, side: ForgeMatchSide): ForgeFixtureTeam {
  return {
    id: `${fixtureId}-${side}`,
    name: 'BYE',
    managerName: null,
    managerHtId: null,
    htTeamId: null,
    active: false,
    isPlaceholder: true,
  };
}

function defaultInspection(reason: string, state: ForgeTeamChallengeInspection['state']): ForgeTeamChallengeInspection {
  return { state, reason, outgoing: [], incoming: [] };
}

async function inspectTeamChallenge(
  supabase: ReturnType<typeof getServiceSupabase>,
  team: ForgeTeamRow | null,
  oauthScope: string | null,
  consumerKey: string | undefined,
  consumerSecret: string | undefined,
  cache: ManagerCache,
): Promise<ChallengeSnapshot> {
  if (!team || !team.hattrick_user_id || !team.ht_team_id) {
    return {
      inspection: defaultInspection('This fixture side has no active Hattrick team or manager.', 'chpp_error'),
      challengeManagement: 'unknown',
      credentials: null,
      ownershipVerified: false,
    };
  }
  if (!consumerKey || !consumerSecret) {
    return {
      inspection: defaultInspection('CHPP server configuration is missing.', 'chpp_error'),
      challengeManagement: 'unknown',
      credentials: null,
      ownershipVerified: false,
    };
  }

  const managerId = Number(team.hattrick_user_id);
  const credentialsPromise = cache.credentials.get(managerId) || Promise.resolve(getManagerChppCredentials(supabase, managerId));
  cache.credentials.set(managerId, credentialsPromise);
  const credentials = await credentialsPromise;
  if (!credentials) {
    return {
      inspection: defaultInspection('No stored CHPP credentials for this manager.', 'credentials_missing'),
      challengeManagement: resolveChallengeManagementStatus(oauthScope, team.can_manage_challenges),
      credentials: null,
      ownershipVerified: false,
    };
  }

  const ownershipPromise = cache.ownership.get(managerId) || Promise.resolve(
    fetchManagerTeamsFromChpp(consumerKey, consumerSecret, credentials, managerId)
      .then((result) => new Set(result.teams.map((candidate) => candidate.teamId)))
      .catch(() => null),
  );
  cache.ownership.set(managerId, ownershipPromise);
  const ownedTeamIds = await ownershipPromise;
  if (!ownedTeamIds) {
    return {
      inspection: defaultInspection('CHPP ownership check failed.', 'chpp_error'),
      challengeManagement: resolveChallengeManagementStatus(oauthScope, team.can_manage_challenges),
      credentials,
      ownershipVerified: false,
    };
  }
  if (!ownedTeamIds.has(Number(team.ht_team_id))) {
    return {
      inspection: defaultInspection('The stored manager credentials no longer own this Hattrick team.', 'ownership_mismatch'),
      challengeManagement: resolveChallengeManagementStatus(oauthScope, team.can_manage_challenges),
      credentials,
      ownershipVerified: false,
    };
  }

  const challengeManagement = resolveChallengeManagementStatus(oauthScope, team.can_manage_challenges);
  if (challengeManagement === 'reauthorization_required') {
    return {
      inspection: defaultInspection('CHPP manage_challenges permission is missing; reauthorize this manager.', 'permission_missing'),
      challengeManagement,
      credentials,
      ownershipVerified: true,
    };
  }

  try {
    const view = await viewChppChallenges({
      consumerKey,
      consumerSecret,
      oauthToken: credentials.oauth_token,
      oauthTokenSecret: credentials.oauth_token_secret,
      teamId: Number(team.ht_team_id),
      isWeekendFriendly: 0,
    });
    if (view.httpStatus < 200 || view.httpStatus >= 300) {
      return {
        inspection: defaultInspection(`CHPP challenge state failed (${view.httpStatus}).`, challengeManagement === 'unknown' ? 'permission_missing' : 'chpp_error'),
        challengeManagement,
        credentials,
        ownershipVerified: true,
      };
    }
    if (view.parsed.errorCode !== undefined && view.parsed.errorCode !== 0) {
      return {
        inspection: defaultInspection(view.parsed.errorMessage || `CHPP challenge state failed (${view.parsed.errorCode}).`, challengeManagement === 'unknown' ? 'permission_missing' : 'chpp_error'),
        challengeManagement,
        credentials,
        ownershipVerified: true,
      };
    }
    return {
      inspection: {
        state: 'ready',
        reason: 'CHPP challenge state loaded.',
        outgoing: parseChppOutgoingChallenges(view.rawXml),
        incoming: parseChppChallengeOffers(view.rawXml),
      },
      challengeManagement,
      credentials,
      ownershipVerified: true,
    };
  } catch (error) {
    return {
      inspection: defaultInspection(error instanceof Error ? error.message : 'CHPP challenge state could not be loaded.', 'chpp_error'),
      challengeManagement,
      credentials,
      ownershipVerified: true,
    };
  }
}

async function loadFixtureRows(
  supabase: ReturnType<typeof getServiceSupabase>,
  roundId: string,
) {
  const { data, error } = await supabase
    .from('matches')
    .select(`
      id,
      round_id,
      status,
      completed,
      ht_match_id,
      scheduled_for,
      home_team:teams!matches_home_team_id_fkey(id, name, manager_name, hattrick_user_id, ht_team_id, active, is_placeholder, oauth_scope, can_manage_challenges),
      away_team:teams!matches_away_team_id_fkey(id, name, manager_name, hattrick_user_id, ht_team_id, active, is_placeholder, oauth_scope, can_manage_challenges)
    `)
    .eq('round_id', roundId)
    .order('id', { ascending: true });
  if (error) throw error;
  return (data || []) as ForgeMatchRow[];
}

async function buildMatchesResponse(
  supabase: ReturnType<typeof getServiceSupabase>,
  tournament: ForgeTournamentRow,
  options: {
    roundNumber?: number | null;
    action?: { type: 'challenge' | 'accept'; matchId: string; actingSide: ForgeMatchSide; message: string };
  } = {},
) {
  const materializedRounds = await loadMaterializedRounds(supabase, tournament);
  const round = selectForgeRound(materializedRounds, options.roundNumber);
  const roundOptions = materializedRounds
    .map((candidate) => ({
      roundNumber: candidate.round_number,
      fixtureCount: candidate.matches?.length || 0,
      hasUnfinishedFixtures: candidate.phase_status === 'materialized'
        && Boolean(candidate.matches?.some((match) => match.completed !== true && match.status !== 'misarranged')),
    }))
    .filter((candidate) => candidate.fixtureCount > 0);
  if (!round) {
    return {
      tournament: { id: tournament.id, name: tournament.name, season: tournament.season || 1 },
      currentRound: null,
      roundOptions,
      fixtures: [],
      action: options.action || null,
    };
  }

  const matchRows = await loadFixtureRows(supabase, round.id);
  const fixtureTeams = matchRows.flatMap((match) => [relationOne(match.home_team), relationOne(match.away_team)])
    .filter((team): team is ForgeTeamRow => Boolean(team?.hattrick_user_id && !team.is_placeholder));
  const teamIds = [...new Set(fixtureTeams.map((team) => team.id))];
  const managerIdsForPreferences = [...new Set(fixtureTeams.map((team) => Number(team.hattrick_user_id)))];
  const { data: preferenceRows, error: preferencesError } = teamIds.length > 0
    ? await supabase
        .from('tournament_team_auto_arrange_preferences')
        .select('team_id, hattrick_user_id, enabled')
        .eq('tournament_id', tournament.id)
        .eq('season_number', tournament.season || 1)
        .in('team_id', teamIds)
        .in('hattrick_user_id', managerIdsForPreferences)
    : { data: [], error: null };
  if (preferencesError) throw preferencesError;
  const autoArrangeByTeamManager = new Map(
    ((preferenceRows || []) as Array<{ team_id: string; hattrick_user_id: number; enabled: boolean }>)
      .map((preference) => [`${preference.team_id}:${Number(preference.hattrick_user_id)}`, preference.enabled]),
  );
  const managerIds = [...new Set(
    matchRows
      .flatMap((match) => [relationOne(match.home_team)?.hattrick_user_id, relationOne(match.away_team)?.hattrick_user_id])
      .filter((managerId): managerId is number => Number.isSafeInteger(managerId)),
  )];
  const { data: profiles, error: profilesError } = managerIds.length > 0
    ? await supabase.from('profiles').select('hattrick_user_id, oauth_scope').in('hattrick_user_id', managerIds)
    : { data: [], error: null };
  if (profilesError) throw profilesError;
  const scopeByManager = new Map((profiles as ForgeProfileRow[] || []).map((profile) => [Number(profile.hattrick_user_id), profile.oauth_scope]));
  const cache: ManagerCache = { credentials: new Map(), ownership: new Map() };
  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  const fixtures = [];

  for (const row of matchRows) {
    const fixture = toFixture(row);
    const homeTeamRow = relationOne(row.home_team);
    const awayTeamRow = relationOne(row.away_team);
    const homeAutoArrangeEnabled = fixture.home?.managerHtId
      ? autoArrangeByTeamManager.get(`${fixture.home.id}:${fixture.home.managerHtId}`) ?? true
      : null;
    const awayAutoArrangeEnabled = fixture.away?.managerHtId
      ? autoArrangeByTeamManager.get(`${fixture.away.id}:${fixture.away.managerHtId}`) ?? true
      : null;
    const [homeSnapshot, awaySnapshot] = await Promise.all([
      inspectTeamChallenge(
        supabase,
        homeTeamRow,
        scopeByManager.get(Number(homeTeamRow?.hattrick_user_id)) || homeTeamRow?.oauth_scope,
        consumerKey,
        consumerSecret,
        cache,
      ),
      inspectTeamChallenge(
        supabase,
        awayTeamRow,
        scopeByManager.get(Number(awayTeamRow?.hattrick_user_id)) || awayTeamRow?.oauth_scope,
        consumerKey,
        consumerSecret,
        cache,
      ),
    ]);
    const homeOpponentHtId = fixture.away?.htTeamId || 0;
    const awayOpponentHtId = fixture.home?.htTeamId || 0;
    const homeOutgoing = homeOpponentHtId ? findExactPendingOutgoingChallenge(homeSnapshot.inspection.outgoing, homeOpponentHtId) : null;
    const awayOutgoing = awayOpponentHtId ? findExactPendingOutgoingChallenge(awaySnapshot.inspection.outgoing, awayOpponentHtId) : null;
    const homeIncoming = homeOpponentHtId ? findExactPendingIncomingChallenge(homeSnapshot.inspection.incoming, homeOpponentHtId) : null;
    const awayIncoming = awayOpponentHtId ? findExactPendingIncomingChallenge(awaySnapshot.inspection.incoming, awayOpponentHtId) : null;
    const agreed = (homeOpponentHtId > 0 && awayOpponentHtId > 0
      && hasExactAgreedChallenge(homeSnapshot.inspection.outgoing, homeSnapshot.inspection.incoming, homeOpponentHtId))
      || (homeOpponentHtId > 0 && awayOpponentHtId > 0
        && hasExactAgreedChallenge(awaySnapshot.inspection.outgoing, awaySnapshot.inspection.incoming, awayOpponentHtId));
    if (agreed) fixture.status = 'arranged';

    const homeActions = resolveForgeTeamActions({
      fixture,
      side: 'home',
      inspection: homeSnapshot.inspection,
      outgoing: homeOutgoing,
      incoming: homeIncoming,
      opponentOutgoing: awayOutgoing,
    });
    const awayActions = resolveForgeTeamActions({
      fixture,
      side: 'away',
      inspection: awaySnapshot.inspection,
      outgoing: awayOutgoing,
      incoming: awayIncoming,
      opponentOutgoing: homeOutgoing,
    });
    const byeActions = {
      chppState: 'BYE',
      chppReason: 'No opposing team is scheduled for this fixture side.',
      canChallenge: false,
      canAccept: false,
      challengeDisabledReason: 'A BYE has no Hattrick challenge action.',
      acceptDisabledReason: 'A BYE has no incoming challenge.',
      trainingMatchId: null,
    };

    fixtures.push({
      id: fixture.id,
      status: fixture.status || 'not_arranged',
      completed: fixture.completed,
      htMatchId: row.ht_match_id,
      scheduledFor: row.scheduled_for,
      home: {
        side: 'home',
        ...(fixture.home || emptyFixtureTeam(fixture.id, 'home')),
        autoArrangeEnabled: homeAutoArrangeEnabled,
        ...(fixture.home ? homeActions : byeActions),
      },
      away: {
        side: 'away',
        ...(fixture.away || emptyFixtureTeam(fixture.id, 'away')),
        autoArrangeEnabled: awayAutoArrangeEnabled,
        ...(fixture.away ? awayActions : byeActions),
      },
    });
  }

  return {
    tournament: { id: tournament.id, name: tournament.name, season: tournament.season || 1, scoringMode: tournament.scoring_mode },
    currentRound: {
      id: round.id,
      roundNumber: round.round_number,
      phase: round.phase,
      phaseStatus: round.phase_status,
    },
    roundOptions,
    fixtures,
    action: options.action || null,
  };
}

async function resolveActionContext(
  supabase: ReturnType<typeof getServiceSupabase>,
  tournamentId: string,
  matchId: string,
  actingSide: ForgeMatchSide,
  roundNumber?: number | null,
) {
  const tournament = await loadTournament(supabase, tournamentId);
  if (!tournament) return { error: 'Tournament not found or not active.' } as const;
  const round = await loadCurrentRound(supabase, tournament, roundNumber);
  if (!round) return { error: 'There is no current materialized round.' } as const;
  if (round.phase_status !== 'materialized') return { error: 'This round is already complete and cannot be booked.' } as const;
  const rows = await loadFixtureRows(supabase, round.id);
  const row = rows.find((candidate) => candidate.id === matchId);
  if (!row) return { error: 'Fixture not found in the current materialized round.' } as const;
  const fixture = toFixture(row);
  const target = resolveForgeFixtureActionTarget(fixture, actingSide);
  if (!target || !target.team.htTeamId || !target.opponent.htTeamId || !target.team.managerHtId) {
    return { error: 'This fixture side does not have two valid Hattrick teams and managers.' } as const;
  }
  if (!target.team.active || target.team.isPlaceholder || !target.opponent.active || target.opponent.isPlaceholder) {
    return { error: 'This fixture contains an inactive or placeholder team.' } as const;
  }
  if (isForgeFixtureAlreadyBooked(fixture)) return { error: 'This fixture is already arranged.' } as const;
  if (isForgeFixtureMisarranged(fixture)) return { error: 'This fixture is misarranged; pairings were not changed.' } as const;
  return { tournament, round, row, fixture, target } as const;
}

async function executeAction(req: VercelRequest, res: VercelResponse) {
  const tournamentId = readString(req.body?.tournamentId);
  const matchId = readString(req.body?.matchId);
  const roundNumberValue = Number(readString(req.body?.roundNumber));
  const roundNumber = Number.isSafeInteger(roundNumberValue) && roundNumberValue > 0 ? roundNumberValue : null;
  const actingSide = readString(req.body?.actingSide) as ForgeMatchSide;
  const action = readString(req.body?.action) as 'challenge' | 'accept';
  if (!tournamentId || !matchId || !roundNumber || !['home', 'away'].includes(actingSide) || !['challenge', 'accept'].includes(action)) {
    return res.status(400).json({ error: 'tournamentId, matchId, roundNumber, actingSide, and action are required.' });
  }

  const supabase = getServiceSupabase();
  const context = await resolveActionContext(supabase, tournamentId, matchId, actingSide, roundNumber);
  if ('error' in context) return res.status(409).json({ error: context.error });

  const teamRow = relationOne(actingSide === 'home' ? context.row.home_team : context.row.away_team);
  const profile = await supabase.from('profiles').select('oauth_scope').eq('hattrick_user_id', context.target.team.managerHtId).maybeSingle();
  if (profile.error) throw profile.error;
  const challengeManagement = resolveChallengeManagementStatus(profile.data?.oauth_scope || teamRow?.oauth_scope, teamRow?.can_manage_challenges);
  if (challengeManagement === 'reauthorization_required') {
    return res.status(409).json({ error: 'CHPP manage_challenges permission is missing; reauthorize this manager.' });
  }

  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) return res.status(500).json({ error: 'CHPP configuration is missing.' });
  const credentials = await getManagerChppCredentials(supabase, context.target.team.managerHtId);
  if (!credentials) return res.status(409).json({ error: 'CHPP credentials are missing for this manager.' });

  const ownedTeams = await fetchManagerTeamsFromChpp(consumerKey, consumerSecret, credentials, context.target.team.managerHtId);
  if (!ownedTeams.teams.some((team) => team.teamId === context.target.team.htTeamId)) {
    return res.status(403).json({ error: 'The stored manager credentials do not own the acting fixture team.' });
  }

  const view = await viewChppChallenges({
    consumerKey,
    consumerSecret,
    oauthToken: credentials.oauth_token,
    oauthTokenSecret: credentials.oauth_token_secret,
    teamId: context.target.team.htTeamId,
    isWeekendFriendly: 0,
  });
  if (view.httpStatus < 200 || view.httpStatus >= 300) return res.status(502).json({ error: `CHPP challenge state failed (${view.httpStatus}).` });
  if (view.parsed.errorCode !== undefined && view.parsed.errorCode !== 0) {
    return res.status(502).json({ error: view.parsed.errorMessage || 'CHPP challenge state failed.' });
  }

  const outgoing = parseChppOutgoingChallenges(view.rawXml);
  const incoming = parseChppChallengeOffers(view.rawXml);
  const opponentHtTeamId = context.target.opponent.htTeamId;
  const existingOutgoing = findExactPendingOutgoingChallenge(outgoing, opponentHtTeamId);
  const existingAgreed = hasExactAgreedChallenge(outgoing, incoming, opponentHtTeamId);
  const existingIncoming = findExactPendingIncomingChallenge(incoming, opponentHtTeamId);

  if (action === 'challenge') {
    if (existingAgreed) return res.status(409).json({ error: 'This fixture already has an accepted Hattrick challenge.' });
    if (existingOutgoing) return res.status(409).json({ error: 'A challenge to this exact opponent is already outgoing.' });
    if (existingIncoming) return res.status(409).json({ error: 'A challenge from this exact opponent is waiting for acceptance.' });
    const sent = await sendChppChallengeDirect({
      consumerKey,
      consumerSecret,
      oauthToken: credentials.oauth_token,
      oauthTokenSecret: credentials.oauth_token_secret,
      teamId: context.target.team.htTeamId,
      opponentTeamId: opponentHtTeamId,
      matchType: 1,
      matchPlace: context.target.matchPlace,
      isWeekendFriendly: 0,
    });
    if (!sent.success) return res.status(502).json({ error: sent.errorMessage || 'Hattrick could not send this challenge.' });
    return res.status(200).json(await buildMatchesResponse(supabase, context.tournament, {
      roundNumber: context.round.round_number,
      action: {
        type: 'challenge',
        matchId,
        actingSide,
        message: 'Challenge sent. The fixture state was re-read from Hattrick.',
      },
    }));
  }

  if (existingAgreed) return res.status(409).json({ error: 'This fixture challenge is already accepted.' });
  if (!existingIncoming?.trainingMatchId) return res.status(409).json({ error: 'No pending incoming challenge from the exact fixture opponent was found.' });
  const accepted = await acceptChppChallengeDirect({
    consumerKey,
    consumerSecret,
    oauthToken: credentials.oauth_token,
    oauthTokenSecret: credentials.oauth_token_secret,
    teamId: context.target.team.htTeamId,
    trainingMatchId: existingIncoming.trainingMatchId,
    isWeekendFriendly: 0,
  });
  if (!accepted.success) return res.status(502).json({ error: accepted.errorMessage || 'Hattrick could not accept this challenge.' });
  return res.status(200).json(await buildMatchesResponse(supabase, context.tournament, {
    roundNumber: context.round.round_number,
    action: {
      type: 'accept',
      matchId,
      actingSide,
      message: 'Challenge accepted. Fixture refresh was requested by the Matches UI.',
    },
  }));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireForgeAdmin(req, res)) return;
  try {
    if (req.method === 'POST') return await executeAction(req, res);
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });

    const supabase = getServiceSupabase();
    const tournamentId = readString(req.query.tournamentId);
    if (!tournamentId) return res.status(200).json({ tournaments: await loadTournamentOptions(supabase) });
    const tournament = await loadTournament(supabase, tournamentId);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found or not active.' });
    const requestedRound = Number(readString(req.query.roundNumber));
    const roundNumber = Number.isSafeInteger(requestedRound) && requestedRound > 0 ? requestedRound : null;
    return res.status(200).json(await buildMatchesResponse(supabase, tournament, { roundNumber }));
  } catch (error) {
    console.error('Forge matches request failed:', error);
    return res.status(500).json({ error: 'Forge Matches data could not be loaded.' });
  }
}
