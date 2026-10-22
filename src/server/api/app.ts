import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAppSessionSecret, verifyAppSessionCookie } from './_lib/app-session.js';
import {
  clearForgeSessionCookie,
  getForgeSuperadminId,
  isForgeAdminRequest,
  verifyForgeSessionCookie,
} from './_lib/forge-session.js';
import { getAnalyticsExcludedHtUserId, isExcludedAnalyticsReferrer } from './_lib/analytics.js';
import { cleanupActivityEvents, recordActivity } from './_lib/activity.js';
import { validateNewsComment } from './_lib/news-comments.js';
import { findSeasonParticipant, validateSeasonComment } from './_lib/season-comments.js';
import { validateTournamentLeave } from './_lib/tournament-participation.js';
import { getServiceSupabase, getSupabase } from './_lib/supabase.js';
import { tryRecalculateMatch120mRatings } from './_lib/match-120m-ratings.js';
import { handleForgeLocales } from './_lib/forge-locales.js';
import { hasSuperAdminBypassCookie } from './_lib/superadmin-bypass.js';
import {
  loadTournamentAccess,
  loadTournamentRoleRecords,
} from './_lib/tournament-access.js';
import { isTournamentRole, type TournamentRole } from '../../../shared/tournament-roles.js';
import { normalizeLeagueLimit } from '../../../shared/worlddetails.js';
import { isForgeEnabled } from '../forge-availability.js';
import { isTournamentRegistrationOpen } from '../../utils/tournament-joinability.js';
import { normalizeGlobalChatContent } from '../../utils/global-chat.js';
import { summarizeUniqueTournamentViews } from '../../utils/forge-activity-routes.js';
import {
  sendChppChallengeDirect,
} from './_lib/chpp-challenges.js';
import {
  getFixtureChallengeMatchPlace,
  getFixtureChallengeMatchType,
  resolveFixtureChallengeOptions,
  getFixtureChallengeSide,
  resolveChallengeManagementStatus,
  type ChallengeManagementStatus,
  type FixtureChallengeSide,
} from './_lib/fixture-challenge.js';
import {
  fetchManagerTeamsFromChpp,
  fetchTeamBookingStatus,
  fetchTeamDetailsFromChpp,
  getManagerChppCredentials,
} from './_lib/matchmaker.js';
import {
  fetchManagerTeamDetailsFromChpp,
  getEligibleSpotlightManagerIds,
  getSpotlightRefreshLimitError,
  mergeManagerTeamSnapshot,
} from './_lib/manager-compendium.js';
import { teamMatchesCountryLimit, validateTeamEligibility } from './_lib/eligibility.js';
import { validateTournamentCountrySizeEligibility } from './_lib/country-size-eligibility.js';
import { managerCountrySizeAllowance, validateCountrySizeEligibility } from '../../../shared/country-size-eligibility.js';
import { getActiveTournamentConflicts, registerReserveTeam } from './_lib/chpp-register.js';
import { buildSandboxCopyIdentity, loadSandboxSnapshotInput } from './_lib/sandbox-duplicate.js';
import {
  refreshCurrentHfiTeamRanks,
  validateHfiRankRefreshAccess,
  type HfiRankParticipant,
} from './_lib/hfi-rank-refresh.js';
import { type ChppTeamOption } from './_lib/chpp-xml.js';
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
import { buildLengthScheduleDraft, serializeLengthScheduleDraft } from '../../utils/length-schedule.js';
import { buildFlagHuntersLengthScheduleDraft } from './_lib/flag-hunters-schedule.js';
import { progressLengthSchedule, recoverLengthRoundOne, repairLengthRound } from './_lib/length-schedule-service.js';
import {
  FixtureRatingsError, isLocalRatingsAdmin, loadVisibleFixtureRatings, saveFixtureRatings,
  loadRatingSharingPreferences, setRatingSharingPreference,
} from './_lib/fixture-ratings.js';

import { findVerifiedReserveOwner, checkReserveAdmission } from './_lib/reserve-admission.js';

const COMMENT_SELECT = 'id, season_id, team_id, team_name, manager_name, comment, created_at';
const NEWS_COMMENT_SELECT = 'id, post_id, hattrick_user_id, author_name, content, created_at';
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

async function handleDuplicateTournamentAsSandbox(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.body?.tournamentId);
  if (!tournamentId) return res.status(400).json({ error: 'Missing tournamentId.' });

  const actor = await requireTournamentRoleSession(req, res, tournamentId);
  if (!actor) return;
  if (!actor.access.isImplicitSuperadmin) {
    return res.status(403).json({ error: 'This action is not available.' });
  }

  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) {
    return res.status(500).json({ error: 'CHPP configuration is missing.' });
  }

  const supabase = getServiceSupabase();
  const credentials = await getManagerChppCredentials(supabase, actor.userId);
  if (!credentials) {
    return res.status(409).json({ error: 'Refresh your Hattrick login before creating a sandbox copy.' });
  }

  try {
    const snapshot = await loadSandboxSnapshotInput(supabase, {
      sourceTournamentId: tournamentId,
      consumerKey,
      consumerSecret,
      credentials,
    });
    const identity = buildSandboxCopyIdentity(snapshot.source.name);
    const { data, error } = await supabase.rpc('duplicate_tournament_as_sandbox', {
      p_source_tournament_id: tournamentId,
      p_name: identity.name,
      p_slug: identity.slug,
      p_admin_password: identity.adminPassword,
      p_organizer_id: actor.userId,
      p_organizer_name: actor.access.viewerManagerName || credentials.manager_name,
      p_teams: snapshot.teams,
    });
    if (error) throw error;
    const created = Array.isArray(data) ? data[0] : data;
    if (!created?.tournament_id || !created?.slug) throw new Error('Sandbox copy was not created.');
    return res.status(201).json({ tournamentId: created.tournament_id, slug: created.slug });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'object' && error && 'message' in error && typeof error.message === 'string'
          ? error.message
          : 'Sandbox copy could not be created.';
    return res.status(422).json({ error: message });
  }
}

async function handleUpdateHfiRanks(req: VercelRequest, res: VercelResponse, powerRankings = false) {
  const rankLabel = powerRankings ? 'Power Rankings' : 'HFI ranks';
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.body?.tournamentId);
  if (!tournamentId) return res.status(400).json({ error: 'Missing tournamentId.' });

  const actor = await requireTournamentRoleSession(req, res, tournamentId);
  if (!actor) return;

  const supabase = getServiceSupabase();
  const { data: tournament, error: tournamentError } = await supabase
    .from('tournaments')
    .select('id, league_category')
    .eq('id', tournamentId)
    .maybeSingle();
  if (tournamentError) throw tournamentError;
  if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });

  const accessError = powerRankings
    ? actor.access.canManageOperations ? null : 'You do not have permission to update rankings.'
    : validateHfiRankRefreshAccess({
    canManageOperations: actor.access.canManageOperations,
    leagueCategory: tournament.league_category,
  });
  if (accessError) return res.status(403).json({ error: accessError });

  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) {
    return res.status(500).json({ error: 'CHPP configuration is missing.' });
  }

  const credentials = await getManagerChppCredentials(supabase, actor.userId);
  if (!credentials) {
    return res.status(409).json({ error: `Refresh your Hattrick login before updating ${rankLabel}.` });
  }

  const { data: teamRows, error: teamsError } = await supabase
    .from('teams')
    .select('id, name, ht_team_id, active, reserve_active, is_placeholder')
    .eq('tournament_id', tournamentId)
    .eq('active', true)
    .eq('reserve_active', false);
  if (teamsError) throw teamsError;

  try {
    const result = await refreshCurrentHfiTeamRanks({
      rankingSource: powerRankings ? 'power_rating' : 'team_rank',
      participants: (teamRows || []) as HfiRankParticipant[],
      fetchTeamDetails: (teamId) =>
        fetchTeamDetailsFromChpp(consumerKey, consumerSecret, credentials, teamId),
      updateTeamMetadata: async (teamId, update) => {
        const { data, error } = await supabase
          .from('teams')
          .update({
            ...(!powerRankings ? { team_rank: update.teamRank } : {}),
            power_rating: update.powerRating,
            power_global_rank: update.powerGlobalRank,
            power_league_rank: update.powerLeagueRank,
            power_region_rank: update.powerRegionRank,
          })
          .eq('id', teamId)
          .eq('tournament_id', tournamentId)
          .select('id')
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('The participant roster changed while ranks were being updated.');
      },
    });

    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : `Could not update ${rankLabel}.`;
    return res.status(422).json({ error: message });
  }
}

async function handleRefreshSpotlightProfiles(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.body?.tournamentId);
  if (!tournamentId) return res.status(400).json({ error: 'Missing tournamentId.' });
  const actor = await requireTournamentRoleSession(req, res, tournamentId);
  if (!actor) return;
  if (!actor.access.canManageOperations) return res.status(403).json({ error: 'This role cannot refresh manager snapshots.' });

  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) return res.status(500).json({ error: 'CHPP configuration is missing.' });
  const supabase = getServiceSupabase();
  const { data: participants, error: participantsError } = await supabase
    .from('teams')
    .select('hattrick_user_id, active, reserve_active, is_placeholder')
    .eq('tournament_id', tournamentId)
    .eq('active', true)
    .not('hattrick_user_id', 'is', null);
  if (participantsError) throw participantsError;
  const managerIds = getEligibleSpotlightManagerIds(participants ?? []);
  const limitError = getSpotlightRefreshLimitError(managerIds.length);
  if (limitError) return res.status(422).json({ error: limitError, managerCount: managerIds.length });

  const results: Array<{ managerId: number; refreshed: boolean; teamCount?: number; error?: string }> = [];
  const refreshedTeamIds = new Set<number>();
  for (const managerId of managerIds) {
    try {
      const credentials = await getManagerChppCredentials(supabase, managerId);
      if (!credentials) {
        results.push({ managerId, refreshed: false, error: 'No stored CHPP authorization.' });
        continue;
      }
      const [manager, details] = await Promise.all([
        fetchManagerTeamsFromChpp(consumerKey, consumerSecret, credentials, managerId),
        fetchManagerTeamDetailsFromChpp(consumerKey, consumerSecret, credentials),
      ]);
      const teams = mergeManagerTeamSnapshot(manager.teams, details.teams, credentials.teams_json ?? []);
      const { error } = await supabase.from('profiles').update({
        manager_name: manager.managerName,
        country_id: manager.countryId ?? null,
        country_name: manager.countryName ?? null,
        league_id: manager.leagueId ?? null,
        language_id: manager.languageId ?? null,
        language_name: manager.languageName ?? null,
        avatar_json: manager.avatar ?? null,
        teams_json: teams,
        national_team_roles_json: details.nationalTeamRoles,
        chpp_synced_at: new Date().toISOString(),
      }).eq('hattrick_user_id', managerId);
      if (error) throw error;
      for (const team of teams) refreshedTeamIds.add(team.teamId);
      results.push({ managerId, refreshed: true, teamCount: teams.length });
    } catch (error) {
      results.push({ managerId, refreshed: false, error: error instanceof Error ? error.message : 'CHPP refresh failed.' });
    }
  }
  const tournamentIds = new Set([tournamentId]);
  if (refreshedTeamIds.size) {
    const { data: linkedTeams, error: linkedTeamsError } = await supabase
      .from('teams')
      .select('tournament_id')
      .in('ht_team_id', Array.from(refreshedTeamIds))
      .eq('active', true);
    if (linkedTeamsError) {
      console.warn('Could not resolve all public tournaments for refreshed Spotlight profiles:', linkedTeamsError.message);
    } else {
      for (const row of linkedTeams ?? []) tournamentIds.add(String(row.tournament_id));
    }
  }
  return res.status(200).json({
    tournamentId,
    tournamentIds: Array.from(tournamentIds),
    managerCount: managerIds.length,
    maxChppCalls: managerIds.length * 2,
    refreshedCount: results.filter((result) => result.refreshed).length,
    failedCount: results.filter((result) => !result.refreshed).length,
    results,
  });
}

async function handleGenerateLengthSchedule(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.body?.tournamentId);
  const seasonNumber = Number(req.body?.seasonNumber);
  const schedulePayload = req.body?.schedulePayload;
  if (!tournamentId || !Number.isInteger(seasonNumber) || seasonNumber < 1 || !schedulePayload) {
    return res.status(400).json({ error: 'Invalid length schedule request.' });
  }

  const actor = await requireTournamentRoleSession(req, res, tournamentId);
  if (!actor) return;
  if (!actor.access.canManageOperations) {
    return res.status(403).json({ error: 'You do not have permission to generate this schedule.' });
  }

  const supabase = getServiceSupabase();
  const { data: tournament, error: tournamentError } = await supabase
    .from('tournaments')
    .select('id, slug, league_category')
    .eq('id', tournamentId)
    .maybeSingle();
  if (tournamentError) throw tournamentError;
  if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });
  const { data: roster, error: rosterError } = await supabase.from('teams')
    .select('id, name, active, is_placeholder, team_rank, power_rating, country_name, league_level, ht_team_id, hattrick_user_id, country_id, league_id, gender_id')
    .eq('tournament_id', tournamentId).eq('active', true).eq('reserve_active', false);
  if (rosterError) throw rosterError;
  // Rebuild from persisted metadata. Browser previews never choose seeds, pairings,
  // safe dates or ranking source for the privileged generation RPC.
  const scheduleInput: Parameters<typeof buildLengthScheduleDraft>[0] = {
    teams: (roster || []).map(team => ({
      id: team.id, name: team.name, active: team.active, isPlaceholder: team.is_placeholder,
      teamRank: team.team_rank, powerRating: team.power_rating,
      countryName: team.country_name, leagueLevel: team.league_level,
    })),
    rankingSource: tournament.league_category === 'hfi' ? 'team_rank' : 'power_rating',
    startSlotId: readString(schedulePayload.start_slot_id),
    selectedFormatId: readString(schedulePayload.format_id),
  };
  let draft;
  try {
    if (tournament.slug === 'around-the-world') {
      draft = buildFlagHuntersLengthScheduleDraft(scheduleInput, roster || []);
    } else draft = buildLengthScheduleDraft(scheduleInput);
  } catch (error) {
    return res.status(422).json({ error: error instanceof Error ? error.message : 'Could not pair the admitted teams.' });
  }
  if (!draft.valid) return res.status(422).json({ error: draft.reason });
  if (!draft.formats.some(format => format.id === schedulePayload.format_id)) {
    return res.status(422).json({ error: 'Choose a supported schedule format.' });
  }

  const { data, error } = await supabase.rpc('generate_length_tournament_schedule', {
    p_tournament_id: tournamentId,
    p_season_number: seasonNumber,
    p_schedule_payload: serializeLengthScheduleDraft(draft),
  });
  if (error) return res.status(422).json({ error: error.message });
  return res.status(201).json(data);
}

async function handleRepairLengthRound(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.body?.tournamentId);
  const seasonNumber = Number(req.body?.seasonNumber);
  if (!tournamentId || !Number.isInteger(seasonNumber) || seasonNumber < 1) {
    return res.status(400).json({ error: 'Invalid round repair request.' });
  }
  const actor = await requireTournamentRoleSession(req, res, tournamentId);
  if (!actor) return;
  if (!actor.access.canManageOperations) {
    return res.status(403).json({ error: 'You do not have permission to repair this round.' });
  }
  try {
    const result = await repairLengthRound(getServiceSupabase(), tournamentId, seasonNumber);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Round repair failed:', error);
    const message = error instanceof Error ? error.message
      : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message : 'The round could not be repaired.';
    return res.status(422).json({ error: message });
  }
}

async function handleRecoverLengthRoundOne(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.body?.tournamentId);
  const seasonNumber = Number(req.body?.seasonNumber);
  if (!tournamentId || !Number.isInteger(seasonNumber) || seasonNumber < 1) {
    return res.status(400).json({ error: 'Invalid Round 1 recovery request.' });
  }
  const actor = await requireTournamentRoleSession(req, res, tournamentId);
  if (!actor) return;
  if (!actor.access.canManageOperations) {
    return res.status(403).json({ error: 'You do not have permission to recover Round 1.' });
  }
  try {
    const result = await recoverLengthRoundOne(getServiceSupabase(), tournamentId, seasonNumber);
    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Round 1 could not be recovered.';
    return res.status(422).json({ error: message });
  }
}

interface LengthResultUpdate {
  matchId: string;
  homeGoals: number;
  awayGoals: number;
  went120: boolean;
  totalMinutes: number;
  penaltyShootoutHomeGoals: number | null;
  penaltyShootoutAwayGoals: number | null;
  appgOutcome?: string | null;
  appgOutcomeSource?: string | null;
}

function parseLengthResultUpdates(value: unknown): LengthResultUpdate[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const updates: LengthResultUpdate[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const source = item as Record<string, unknown>;
    const matchId = typeof source.matchId === 'string' ? source.matchId : '';
    const homeGoals = Number(source.homeGoals);
    const awayGoals = Number(source.awayGoals);
    const totalMinutes = Number(source.totalMinutes);
    const homeShootout = source.penaltyShootoutHomeGoals == null ? null : Number(source.penaltyShootoutHomeGoals);
    const awayShootout = source.penaltyShootoutAwayGoals == null ? null : Number(source.penaltyShootoutAwayGoals);
    if (!matchId || !Number.isInteger(homeGoals) || homeGoals < 0 || !Number.isInteger(awayGoals) || awayGoals < 0) {
      return null;
    }
    if (
      (homeShootout !== null && (!Number.isInteger(homeShootout) || homeShootout < 0)) ||
      (awayShootout !== null && (!Number.isInteger(awayShootout) || awayShootout < 0))
    ) return null;
    updates.push({
      matchId,
      homeGoals,
      awayGoals,
      went120: source.went120 === true,
      totalMinutes: Number.isFinite(totalMinutes) && totalMinutes > 0 ? totalMinutes : 90,
      penaltyShootoutHomeGoals: homeShootout,
      penaltyShootoutAwayGoals: awayShootout,
      appgOutcome: typeof source.appgOutcome === 'string' ? source.appgOutcome : null,
      appgOutcomeSource: typeof source.appgOutcomeSource === 'string' ? source.appgOutcomeSource : null,
    });
  }
  return updates;
}

async function handleSaveLengthResults(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.body?.tournamentId);
  const seasonNumber = Number(req.body?.seasonNumber);
  const updates = parseLengthResultUpdates(req.body?.updates);
  if (!tournamentId || !Number.isInteger(seasonNumber) || seasonNumber < 1 || !updates) {
    return res.status(400).json({ error: 'Invalid result update request.' });
  }
  const actor = await requireTournamentRoleSession(req, res, tournamentId);
  if (!actor) return;
  if (!actor.access.canManageOperations) {
    return res.status(403).json({ error: 'You do not have permission to update these results.' });
  }

  const supabase = getServiceSupabase();
  const payload = updates.map((update) => ({
    match_id: update.matchId,
    home_goals: update.homeGoals,
    away_goals: update.awayGoals,
    went_120: update.went120,
    total_minutes: update.totalMinutes,
    penalty_shootout_home_goals: update.penaltyShootoutHomeGoals,
    penalty_shootout_away_goals: update.penaltyShootoutAwayGoals,
    appg_outcome: update.appgOutcome ?? 'needs_review',
    appg_outcome_source: update.appgOutcomeSource ?? 'unclassified',
  }));
  const { data, error } = await supabase.rpc('save_length_schedule_results', {
    p_tournament_id: tournamentId,
    p_season_number: seasonNumber,
    p_updates: payload,
  });
  if (error) return res.status(422).json({ error: error.message });
  const ratingFailures = [];
  for (const update of updates) {
    const failure = await tryRecalculateMatch120mRatings(supabase, update.matchId);
    if (failure) ratingFailures.push(failure);
  }
  try {
    const progression = await progressLengthSchedule(supabase, tournamentId, seasonNumber);
    return res.status(200).json({ saved: data, progression, ratingFailures });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Round progression could not be completed.';
    return res.status(409).json({ error: `Results were saved, but ${message}`, resultsSaved: true, ratingFailures });
  }
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
    .select(`
      id,
      organizer_id,
      name,
      slug,
      is_featured,
      status,
      is_archived,
      is_test,
      registration_type,
      created_at,
      rounds ( round_number, matches ( completed, status ) )
    `)
    .in('id', tournamentIds)
    .neq('status', 'archived');
  if (tournamentsError) throw tournamentsError;
  return res.status(200).json({ tournaments: tournaments || [] });
}

async function handleDeleteOwnedTestTournaments(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const secret = getAppSessionSecret();
  const session = secret ? verifyAppSessionCookie(req.headers.cookie, secret) : null;
  if (!session?.userId) return res.status(401).json({ error: 'Please sign in with Hattrick first.' });

  const { data, error } = await getServiceSupabase().rpc('delete_owned_test_tournaments', {
    p_organizer_id: session.userId,
  });
  if (error?.code === '23514') return res.status(409).json({ error: error.message });
  if (error) throw error;
  return res.status(200).json({ deletedCount: Number(data) || 0 });
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

  const { data, error } = await supabase.rpc('change_tournament_team_membership', {
    p_tournament_id: tournamentId, p_team_id: teamId, p_action: 'remove',
  });
  if (error) return res.status(409).json({ error: error.message });
  return res.status(200).json(data);
}

async function handleTournamentTeamDeparture(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.method === 'GET' ? req.query.tournamentId : req.body?.tournamentId);
  if (!tournamentId) return res.status(400).json({ error: 'Missing tournament.' });
  res.setHeader('Cache-Control', 'no-store');
  const supabase = getServiceSupabase();

  if (req.method === 'POST' && readString(req.body?.action) === 'admin-list') {
    if (!(await requireLifecycleAccess(req, res, tournamentId))) return;
    const { data: tournament, error: tournamentError } = await supabase.from('tournaments')
      .select('season').eq('id', tournamentId).maybeSingle();
    if (tournamentError) throw tournamentError;
    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });
    const { data: requests, error: requestsError } = await supabase.from('tournament_team_departures')
      .select('team_id, after_round_id').eq('tournament_id', tournamentId).eq('season_number', tournament.season || 1);
    if (requestsError) throw requestsError;
    if (!requests?.length) return res.status(200).json({ departures: [] });
    const [{ data: teams, error: teamsError }, { data: rounds, error: roundsError }] = await Promise.all([
      supabase.from('teams').select('id, name, active, reserve_active').in('id', requests.map((request) => request.team_id)),
      supabase.from('rounds').select('id, phase_status').in('id', requests.map((request) => request.after_round_id)),
    ]);
    if (teamsError) throw teamsError;
    if (roundsError) throw roundsError;
    const teamById = new Map((teams || []).map((team) => [team.id, team]));
    const roundById = new Map((rounds || []).map((round) => [round.id, round]));
    return res.status(200).json({ departures: requests.flatMap((request) => {
      const team = teamById.get(request.team_id);
      if (!team?.active || team.reserve_active) return [];
      return [{ teamId: team.id, teamName: team.name,
        needsReview: roundById.get(request.after_round_id)?.phase_status === 'completed' }];
    }) });
  }

  const secret = getAppSessionSecret();
  const session = secret ? verifyAppSessionCookie(req.headers.cookie, secret) : null;
  if (!session?.userId) return res.status(401).json({ error: 'Please sign in with Hattrick first.' });

  if (req.method === 'GET') {
    const { data: teams, error: teamsError } = await supabase.from('teams')
      .select('id, name').eq('tournament_id', tournamentId)
      .eq('hattrick_user_id', session.userId).eq('active', true)
      .eq('reserve_active', false).eq('is_placeholder', false);
    if (teamsError) throw teamsError;
    if (!teams?.length) return res.status(200).json({ teams: [] });
    const { data: requests, error: requestsError } = await supabase.from('tournament_team_departures')
      .select('team_id').in('team_id', teams.map((team) => team.id));
    if (requestsError) throw requestsError;
    const requestedIds = new Set((requests || []).map((request) => request.team_id));
    return res.status(200).json({ teams: teams.map((team) => ({
      id: team.id, name: team.name, checked: requestedIds.has(team.id),
    })) });
  }

  const teamId = readString(req.body?.teamId);
  const checked = req.body?.checked;
  if (!teamId || typeof checked !== 'boolean') return res.status(400).json({ error: 'Invalid departure request.' });
  const { data, error } = await supabase.rpc('set_tournament_team_departure', {
    p_tournament_id: tournamentId,
    p_team_id: teamId,
    p_manager_id: session.userId,
    p_leave: checked,
  });
  if (error) {
    const status = ['22023', '42501', 'P0002'].includes(error.code || '') ? 409 : 500;
    return res.status(status).json({ error: error.message });
  }
  return res.status(200).json(data);
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

  const { count: generatedRoundCount, error: generatedRoundError } = await getServiceSupabase()
    .from('rounds')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('season_number', seasonNumber);
  if (generatedRoundError) throw generatedRoundError;
  if ((generatedRoundCount ?? 0) > 0) {
    return res.status(409).json({ error: 'Scheduled seasons must use Replace with reserve.' });
  }

  const affectedPlanningIds = await planningMembershipIds(tournamentId);
  const { data, error } = await getServiceSupabase().rpc('replace_or_fill_known_team_in_current_season', {
    p_tournament_id: tournamentId,
    p_season_number: seasonNumber,
    p_former_team_id: formerTeamId,
    p_incoming_ht_team_id: incomingHtTeamId,
  });
  if (error) {
    const status = ['22023', '23505', 'P0002'].includes(error.code || '') ? 409 : 500;
    return res.status(status).json({ error: error.message });
  }
  return res.status(200).json({ replacement: Array.isArray(data) ? data[0] : data, tournamentIds: [tournamentId, ...affectedPlanningIds] });
}

async function handleReserveTeamSwap(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.body?.tournamentId);
  const formerTeamId = readString(req.body?.formerTeamId);
  const incomingReserveTeamId = readString(req.body?.incomingReserveTeamId);
  const seasonNumber = Number(req.body?.seasonNumber);
  if (
    !tournamentId ||
    !formerTeamId ||
    !incomingReserveTeamId ||
    !Number.isSafeInteger(seasonNumber) ||
    seasonNumber < 1
  ) {
    return res.status(400).json({ error: 'Invalid reserve replacement request.' });
  }

  const actor = await requireTournamentRoleSession(req, res, tournamentId);
  if (!actor) return;
  if (!actor.access.canManageOperations) {
    return res.status(403).json({ error: 'This role cannot replace a scheduled team.' });
  }

  const affectedPlanningIds = await planningMembershipIds(tournamentId);
  const { data, error } = await getServiceSupabase().rpc(
    actor.access.isImplicitSuperadmin
      ? 'swap_current_season_team_with_reserve_as_site_admin'
      : 'swap_current_season_team_with_reserve', {
    p_tournament_id: tournamentId,
    p_season_number: seasonNumber,
    p_former_team_id: formerTeamId,
    p_incoming_reserve_team_id: incomingReserveTeamId,
  });
  if (error) {
    const status = ['22023', '23505', '55000', 'P0002'].includes(error.code || '') ? 409 : 500;
    return res.status(status).json({ error: error.message });
  }
  return res.status(200).json({ replacement: Array.isArray(data) ? data[0] : data, tournamentIds: [tournamentId, ...affectedPlanningIds] });
}

async function handleReserveTeamFill(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.body?.tournamentId);
  const incomingReserveTeamId = readString(req.body?.incomingReserveTeamId);
  const formerTeamId = readString(req.body?.formerTeamId);
  const seasonNumber = Number(req.body?.seasonNumber);
  if (!tournamentId || !incomingReserveTeamId || !Number.isSafeInteger(seasonNumber) || seasonNumber < 1) {
    return res.status(400).json({ error: 'Invalid reserve fill request.' });
  }

  const actor = await requireTournamentRoleSession(req, res, tournamentId);
  if (!actor) return;
  if (!actor.access.canManageOperations) {
    return res.status(403).json({ error: 'This role cannot promote a reserve team.' });
  }

  const affectedPlanningIds = await planningMembershipIds(tournamentId);
  const fillRpc = formerTeamId
    ? 'fill_past_team_slot_with_reserve'
    : actor.access.isImplicitSuperadmin
      ? 'fill_vacant_current_season_slot_with_reserve_as_site_admin'
      : 'fill_vacant_current_season_slot_with_reserve';
  const { data, error } = await getServiceSupabase().rpc(fillRpc, {
    p_tournament_id: tournamentId,
    p_season_number: seasonNumber,
    p_incoming_reserve_team_id: incomingReserveTeamId,
    ...(formerTeamId ? { p_former_team_id: formerTeamId } : {}),
  });
  if (error) {
    const status = ['22023', '23505', '55000', 'P0002'].includes(error.code || '') ? 409 : 500;
    return res.status(status).json({ error: error.message });
  }
  return res.status(200).json({ promotion: Array.isArray(data) ? data[0] : data, tournamentIds: [tournamentId, ...affectedPlanningIds] });
}

async function handleRemoveUnusedPastTeam(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.body?.tournamentId);
  const teamId = readString(req.body?.teamId);
  if (!tournamentId || !teamId) return res.status(400).json({ error: 'Missing tournament or team.' });

  const actor = await requireTournamentRoleSession(req, res, tournamentId);
  if (!actor) return;
  if (!actor.access.canManageOperations) {
    return res.status(403).json({ error: 'This role cannot manage tournament teams.' });
  }
  const { data, error } = await getServiceSupabase().rpc('remove_unused_past_tournament_team', {
    p_tournament_id: tournamentId,
    p_team_id: teamId,
  });
  if (error) return res.status(409).json({ error: error.message });
  return res.status(200).json(data);
}

async function handleMoveInactiveTeamToReserve(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  req.body = { ...req.body, action: 'return' };
  return handleTeamMembership(req, res);
}

async function requireLifecycleAccess(req: VercelRequest, res: VercelResponse, tournamentId: string) {
  const secret = getAppSessionSecret();
  const session = secret ? verifyAppSessionCookie(req.headers.cookie, secret) : null;
  const bypass = hasSuperAdminBypassCookie(req.headers.cookie);
  const userId = session?.userId || (bypass ? getForgeSuperadminId() : null);
  if (userId) {
    const access = await loadTournamentAccess(getServiceSupabase(), tournamentId, userId, bypass);
    if (access?.canManageOperations) return true;
  }
  const password = readString(req.body?.adminPassword);
  if (password) {
    const { data, error } = await getServiceSupabase().from('tournaments').select('admin_password').eq('id', tournamentId).maybeSingle();
    if (error) throw error;
    if (data?.admin_password && password === data.admin_password) return true;
  }
  res.status(userId ? 403 : 401).json({ error: 'Tournament management access required.' });
  return false;
}

async function planningMembershipIds(tournamentId: string) {
  const { data, error } = await getServiceSupabase().rpc('planning_membership_tournament_ids', { p_tournament_id: tournamentId });
  if (error) throw error;
  return (data ?? []) as string[];
}

async function handleTournamentPublication(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.body?.tournamentId);
  const seasonNumber = Number(req.body?.seasonNumber);
  const target = req.body?.target;
  if (!tournamentId || !UUID_PATTERN.test(tournamentId) || !Number.isSafeInteger(seasonNumber) || seasonNumber < 1 || !['planning', 'recruiting'].includes(target)) {
    return res.status(400).json({ error: 'Invalid publication request.' });
  }
  if (!(await requireLifecycleAccess(req, res, tournamentId))) return;
  const { data, error } = await getServiceSupabase().rpc('transition_tournament_publication', {
    p_tournament_id: tournamentId, p_season_number: seasonNumber, p_target: target,
  });
  if (error) return res.status(['22023', '55000', '23505', '40P01'].includes(error.code ?? '') ? 409 : 500).json({ error: error.message,
    errorCode: error.message.includes('cannot be reset after a match') ? 'season_started' : undefined });
  return res.status(200).json({ transition: data, tournamentIds: data?.tournament_ids ?? [tournamentId] });
}

async function handleCreationRoster(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.body?.tournamentId);
  const rows = req.body?.teams;
  if (!tournamentId || !UUID_PATTERN.test(tournamentId) || !Array.isArray(rows) || rows.length > 1000 || rows.some((row) =>
    !row || typeof row !== 'object' || row.tournament_id !== tournamentId || !Number.isSafeInteger(row.ht_team_id) || row.ht_team_id < 1 || typeof row.name !== 'string' || !row.name.trim())) {
    return res.status(400).json({ error: 'Invalid creation roster.' });
  }
  const actor = await requireTournamentRoleSession(req, res, tournamentId);
  if (!actor) return;
  if (!actor.access.isOriginalOrganizer && !actor.access.isImplicitSuperadmin) return res.status(403).json({ error: 'Tournament management access required.' });
  if (rows.some((row) => row.active !== true || row.reserve_active === true ||
    (row.joined_via_oauth === true && Number(row.hattrick_user_id) !== actor.userId) ||
    (row.joined_via_oauth !== true && (row.oauth_token || row.oauth_token_secret)))) {
    return res.status(400).json({ error: 'Invalid creation registration.' });
  }
  const database = getServiceSupabase();
  const { data: tournament, error } = await database.from('tournaments').select('status,is_test,created_at').eq('id', tournamentId).single();
  if (error) throw error;
  if (tournament.status !== 'planning' || tournament.is_test || Date.now() - Date.parse(tournament.created_at) > 30 * 60_000) {
    return res.status(409).json({ error: 'The creation roster can only be added to a newly created planning tournament.' });
  }
  const { error: insertError } = await database.rpc('register_creation_roster', {
    p_tournament_id: tournamentId, p_rows: rows, p_skip_membership: actor.access.isImplicitSuperadmin,
  });
  if (insertError) return res.status(409).json({ error: insertError.message });
  return res.status(200).json({ tournamentId });
}

async function handleStartTournamentSeason(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.body?.tournamentId);
  const nextSeasonNumber = Number(req.body?.nextSeasonNumber);
  if (!tournamentId || !UUID_PATTERN.test(tournamentId) || !Number.isSafeInteger(nextSeasonNumber) || nextSeasonNumber < 2 ||
    (req.body?.plannedStartSlot != null && (typeof req.body.plannedStartSlot !== 'string' || !Number.isFinite(Date.parse(req.body.plannedStartSlot)))) ||
    !['auto', 'open'].includes(req.body?.mode) || !req.body?.fixturesSnapshot || typeof req.body.fixturesSnapshot !== 'object' || Array.isArray(req.body.fixturesSnapshot)) {
    return res.status(400).json({ error: 'Invalid season transition.' });
  }
  if (!(await requireLifecycleAccess(req, res, tournamentId))) return;
  const { data, error } = await getServiceSupabase().rpc('start_tournament_season_with_commitment', {
    p_tournament_id: tournamentId, p_next_season_number: nextSeasonNumber, p_mode: req.body.mode,
    p_fixtures_snapshot: req.body.fixturesSnapshot, p_planned_start_slot: req.body.plannedStartSlot ?? null,
  });
  if (error) return res.status(409).json({ error: error.message });
  return res.status(200).json({ season: data?.season, droppedTeams: data?.dropped_teams ?? [], tournamentIds: data?.tournament_ids ?? [tournamentId] });
}

async function handleResetSeasonToPlanning(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.body?.tournamentId);
  const seasonNumber = Number(req.body?.seasonNumber);
  if (!tournamentId || !Number.isSafeInteger(seasonNumber) || seasonNumber < 1) {
    return res.status(400).json({ error: 'Invalid season reset request.' });
  }

  const actor = await requireTournamentRoleSession(req, res, tournamentId);
  if (!actor) return;
  if (!actor.access.canManageOperations) {
    return res.status(403).json({ error: 'This role cannot manage the tournament season.' });
  }

  const { data, error } = await getServiceSupabase().rpc('reset_current_season_to_planning', {
    p_tournament_id: tournamentId,
    p_season_number: seasonNumber,
  });
  if (error) {
    const status = ['22023', '55000', 'P0002'].includes(error.code || '') ? 409 : 500;
    return res.status(status).json({ error: error.message });
  }
  return res.status(200).json({ reset: data });
}

async function handleArchiveTournament(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.body?.tournamentId);
  if (!tournamentId) return res.status(400).json({ error: 'Missing tournamentId.' });
  if (typeof req.body?.archived !== 'boolean') {
    return res.status(400).json({ error: 'Missing archived state.' });
  }
  const shouldArchive = req.body.archived;

  const actor = await requireTournamentRoleSession(req, res, tournamentId);
  if (!actor) return;
  if (!actor.access.canManageOperations) {
    return res.status(403).json({ error: 'This role cannot archive the tournament.' });
  }

  const supabase = getServiceSupabase();
  const { data: tournament, error: tournamentError } = await supabase
    .from('tournaments')
    .select('id, status, is_archived')
    .eq('id', tournamentId)
    .maybeSingle();
  if (tournamentError) throw tournamentError;
  if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });
  if (!['finished', 'stopped'].includes(tournament.status || '')) {
    return res.status(409).json({ error: 'Only finished or stopped tournaments can be archived or unarchived.' });
  }
  if (Boolean(tournament.is_archived) === shouldArchive) return res.status(200).json({ archived: shouldArchive });

  const { data, error } = await supabase
    .from('tournaments')
    .update({ is_archived: shouldArchive })
    .eq('id', tournamentId)
    .eq('is_archived', !shouldArchive)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) return res.status(409).json({ error: 'The tournament changed while its archived state was being updated.' });

  return res.status(200).json({ archived: shouldArchive });
}

async function handleScheduledTeamRemoval(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  req.body = { ...req.body, action: 'remove' };
  return handleTeamMembership(req, res);
}

async function handleAdminTeamReserveTransition(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (req.body?.action !== 'to_participant' && req.body?.action !== 'to_reserve') return res.status(400).json({ error: 'Invalid team transition.' });
  req.body = { ...req.body, action: req.body.action === 'to_participant' ? 'promote' : 'to_waiting' };
  return handleTeamMembership(req, res);
}

async function handleAdminAddReserveTeam(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const tournamentId = readString(req.body?.tournamentId);
  const teamId = positiveInteger(req.body?.teamId);
  if (!tournamentId || teamId === null) {
    return res.status(400).json({ error: 'A tournament and valid Hattrick team ID are required.' });
  }

  const actor = await requireTournamentRoleSession(req, res, tournamentId);
  if (!actor) return;
  if (!actor.access.canManageOperations) {
    return res.status(403).json({ error: 'This role cannot manage tournament teams.' });
  }

  const addPlaceholder = req.body?.action === 'add-placeholder';
  if (addPlaceholder && !actor.access.isImplicitSuperadmin) {
    return res.status(403).json({ error: 'This action is unavailable.' });
  }
  const supabase = getServiceSupabase();
  const { data: tournament, error: tournamentError } = await supabase
    .from('tournaments')
    .select('id, league_category, country_limit, country_limit_format, max_country_active_teams, allow_manager_country_size_exception, status, is_archived')
    .eq('id', tournamentId)
    .maybeSingle();
  if (tournamentError) throw tournamentError;
  if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });
  if (tournament.is_archived || ['finished', 'stopped', 'archived'].includes(tournament.status || '')) {
    return res.status(409).json({ error: 'Reserve teams cannot be added to a finished tournament.' });
  }

  const { data: existingTeam, error: existingTeamError } = await supabase
    .from('teams')
    .select('id, active, reserve_active')
    .eq('tournament_id', tournamentId)
    .eq('ht_team_id', teamId)
    .maybeSingle();
  if (existingTeamError) throw existingTeamError;
  if (req.body?.action === 'validate-participant') {
    if (!existingTeam?.active || existingTeam.reserve_active) {
      return res.status(409).json({ error: 'This team is no longer an active participant. Refresh and try again.' });
    }
    const owner = await findVerifiedReserveOwner(supabase, teamId);
    if (!owner.credentials || !owner.team) {
      return res.status(409).json({ error: 'Current ownership could not be verified. The manager may need to reauthorize.' });
    }
    // Ownership repair only: keep registration, season slots and fixture identities.
    const { data: updated, error: updateError } = await supabase.from('teams').update({
      manager_name: owner.managerName || owner.credentials.manager_name,
      hattrick_user_id: owner.credentials.hattrick_user_id,
      oauth_token: owner.credentials.oauth_token,
      oauth_token_secret: owner.credentials.oauth_token_secret,
      joined_via_oauth: true,
      ht_team_name: owner.team.teamName,
    }).eq('id', existingTeam.id).eq('tournament_id', tournamentId)
      .eq('ht_team_id', teamId).eq('active', true).eq('reserve_active', false)
      .select('id').maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return res.status(409).json({ error: 'The participant changed. Refresh and try again.' });
    return res.status(200).json({ team: updated, validated: true });
  }
  if (addPlaceholder) {
    if (existingTeam) return res.status(409).json({ error: 'This team is already in the tournament roster.' });
    const { data: round, error: roundError } = await supabase.from('rounds')
      .select('id').eq('tournament_id', tournamentId).limit(1).maybeSingle();
    if (roundError) throw roundError;
    if (round) return res.status(409).json({ error: 'Use the reserve or replacement flow after a schedule has been generated.' });
  }
  if (existingTeam?.active) return res.status(409).json({ error: 'This team is already a tournament participant.' });
  if (existingTeam && !existingTeam.reserve_active) return res.status(409).json({ error: 'An inactive row already exists. Resolve it before adding a reserve.' });

  if (!addPlaceholder && !actor.access.isImplicitSuperadmin) {
    const conflict = (await getActiveTournamentConflicts(supabase, [teamId], tournamentId)).get(teamId);
    if (conflict) {
      return res.status(409).json({
        error: `This team is already active in another tournament: "${conflict.name}". It must leave that tournament first.`,
      });
    }
  }

  const owner = addPlaceholder
    ? { credentials: null, team: null, managerName: null }
    : await findVerifiedReserveOwner(supabase, teamId);
  const { data: gateway, error: gatewayError } = await supabase
    .from('teams')
    .select('oauth_token, oauth_token_secret')
    .not('oauth_token', 'is', null)
    .not('oauth_token_secret', 'is', null)
    .limit(1)
    .maybeSingle();
  if (gatewayError) throw gatewayError;
  if (!owner.credentials && (!gateway?.oauth_token || !gateway.oauth_token_secret)) {
    return res.status(503).json({ error: 'No CHPP gateway is available. Link a team first.' });
  }

  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) return res.status(500).json({ error: 'CHPP configuration is missing.' });

  const details = await fetchTeamDetailsFromChpp(
    consumerKey,
    consumerSecret,
    owner.credentials || { oauth_token: gateway!.oauth_token, oauth_token_secret: gateway!.oauth_token_secret },
    teamId,
  );
  const teamName = details.teamName?.trim();
  if (!teamName) return res.status(404).json({ error: `Team ID ${teamId} was not found.` });

  const teamDetails = {
    leagueName: details.leagueName,
    leagueId: details.leagueId,
    leagueSystemId: details.leagueSystemId,
    leagueLevel: details.leagueLevel,
    countryId: details.countryId,
    countryName: details.countryName,
    genderId: details.genderId,
  };
  const category = tournament.league_category === 'hfi' ? 'hfi' : 'male';
  const countryLimit = normalizeLeagueLimit(tournament.country_limit, tournament.country_limit_format ?? 'league_id');
  const categoryEligibility = validateTeamEligibility(teamDetails, { category, countryLimit: null });
  const countryEligible = teamMatchesCountryLimit(teamDetails, countryLimit);
  if (!actor.access.isImplicitSuperadmin) {
    if (!categoryEligibility.eligible) {
      return res.status(400).json({ error: categoryEligibility.reason || 'This team is not eligible for this tournament category.' });
    }
    if (!countryEligible && req.body?.countryMismatchConfirmed !== true) {
      const countryEligibility = validateTeamEligibility(teamDetails, { category, countryLimit });
      return res.status(400).json({ error: countryEligibility.reason || 'This team is outside the tournament country restriction.' });
    }
    const countrySizeEligibility = await validateTournamentCountrySizeEligibility(supabase, {
      tournamentId,
      managerId: owner.credentials?.hattrick_user_id,
      countryId: details.countryId,
      maximumActiveTeams: tournament.max_country_active_teams,
      allowManagerException: tournament.allow_manager_country_size_exception,
    });
    if (!countrySizeEligibility.eligible) return res.status(400).json({ error: countrySizeEligibility.reason });
  }

  if (addPlaceholder) {
    const { data: id, error: registrationError } = await supabase.rpc('add_tournament_team_as_site_admin', {
      p_values: {
        tournament_id: tournamentId, ht_team_id: teamId, name: teamName,
        active: true, reserve_active: false, joined_via_oauth: false,
        manager_name: 'Bot team', logo_url: details.logoUrl ?? null,
        country_id: details.countryId ?? null, country_name: details.countryName ?? null,
        league_id: details.leagueId ?? null, gender_id: details.genderId ?? null,
        league_level: details.leagueLevel ?? null, team_rank: details.teamRank ?? null,
        power_rating: details.powerRating ?? null, power_global_rank: details.powerGlobalRank ?? null,
        power_league_rank: details.powerLeagueRank ?? null, power_region_rank: details.powerRegionRank ?? null,
      },
    });
    if (registrationError) throw registrationError;
    if (!id) throw new Error('The placeholder could not be added.');
    return res.status(200).json({ team: { id }, validated: false });
  }

  if (owner.credentials && owner.team && req.body?.validated !== false) {
    const id = await registerReserveTeam(supabase, {
      tournamentId, team: { ...owner.team, ...details, teamId, teamName },
      managerName: owner.managerName!, hattrickUserId: owner.credentials.hattrick_user_id,
      accessToken: owner.credentials.oauth_token, accessTokenSecret: owner.credentials.oauth_token_secret,
      logoUrl: details.logoUrl, countryId: details.countryId, countryName: details.countryName,
      teamRank: details.teamRank, powerRating: details.powerRating, powerGlobalRank: details.powerGlobalRank,
      powerLeagueRank: details.powerLeagueRank, powerRegionRank: details.powerRegionRank,
      reserveOrigin: 'organizer_added',
      skipMembershipCheck: actor.access.isImplicitSuperadmin,
    });
    return res.status(200).json({ team: { id }, validated: true });
  }
  if (req.body?.validated === true) return res.status(409).json({ error: 'Current ownership could not be verified. Reauthorize or explicitly add an unvalidated reserve.' });
  if (existingTeam) return res.status(409).json({ error: 'This reserve is already listed; it could not be validated.' });

  const reserveValues = {
    tournament_id: tournamentId,
    ht_team_id: teamId,
    ht_team_name: teamName,
    name: teamName,
    manager_name: null,
    hattrick_user_id: null,
    country_id: details.countryId ?? null,
    country_name: details.countryName ?? null,
    league_id: details.leagueId ?? null,
    gender_id: details.genderId ?? null,
    league_level: details.leagueLevel ?? null,
    team_rank: details.teamRank ?? null,
    power_rating: details.powerRating ?? null,
    power_global_rank: details.powerGlobalRank ?? null,
    power_league_rank: details.powerLeagueRank ?? null,
    power_region_rank: details.powerRegionRank ?? null,
    logo_url: details.logoUrl ?? null,
    joined_via_oauth: false,
    active: false,
    reserve_active: true,
    reserve_joined_at: new Date().toISOString(),
    actively_waiting: false,
  };
  const { data: id, error } = await supabase.rpc('save_verified_tournament_registration', {
    p_values: reserveValues, p_existing_id: null, p_skip_membership: actor.access.isImplicitSuperadmin,
  });
  if (error) throw error;
  if (!id) throw new Error('The team could not be added to Waiting.');
  return res.status(200).json({ team: { id, name: teamName, ht_team_id: teamId, active: false, reserve_active: true } });
}

async function handleReserveAdmission(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.body?.tournamentId);
  if (!tournamentId) return res.status(400).json({ error: 'Missing tournament.' });
  const actor = await requireTournamentRoleSession(req, res, tournamentId);
  if (!actor) return;
  if (!actor.access.canManageOperations) return res.status(403).json({ error: 'This role cannot manage tournament teams.' });
  const supabase = getServiceSupabase();
  try {
    if (req.body?.action === 'queue-next-round' || req.body?.action === 'move-to-past') {
      const teamId = readString(req.body?.teamId);
      const roundId = readString(req.body?.roundId);
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuid.test(teamId) || (req.body.action === 'queue-next-round' && !uuid.test(roundId))) {
        return res.status(400).json({ error: 'Invalid reserve team or target round.' });
      }
      const { data, error } = req.body.action === 'queue-next-round'
        ? await supabase.rpc('queue_tournament_reserve_for_next_round', {
            p_tournament_id: tournamentId, p_team_id: teamId, p_round_id: roundId,
          })
        : await supabase.rpc('move_tournament_reserve_to_past', {
            p_tournament_id: tournamentId, p_team_id: teamId,
          });
      if (error) return res.status(409).json({ error: error.message });
      return res.status(200).json({ ok: true, teamId: data });
    }
    if (req.body?.action === 'lookup') {
      const teamId = positiveInteger(req.body?.teamId);
      if (teamId === null) return res.status(400).json({ error: 'Invalid Hattrick team ID.' });
      const owner = await findVerifiedReserveOwner(supabase, teamId);
      return res.status(200).json({ known: owner.known, validated: Boolean(owner.team), managerName: owner.managerName });
    }
    if (req.body?.action === 'remove') {
      const teamId = req.body?.teamId;
      if (typeof teamId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(teamId)) return res.status(400).json({ error: 'Invalid reserve team.' });
      const { data, error } = await supabase.rpc('change_tournament_team_membership', { p_tournament_id: tournamentId, p_team_id: teamId, p_action: 'remove', p_override: actor.access.isImplicitSuperadmin });
      if (error) return res.status(409).json({ error: 'Only unused reserve registrations can be removed. Refresh the list; teams tied to fixtures or season history must stay.' });
      return res.status(200).json(data);
    }
    const teamIds = req.body?.teamIds;
    if (!Array.isArray(teamIds) || teamIds.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) return res.status(400).json({ error: 'Invalid reserve selection.' });
    if (!['check', 'admit'].includes(req.body?.action)) return res.status(400).json({ error: 'Invalid reserve action.' });
    if (req.body.action === 'admit') {
      if (![req.body.requestId, req.body.roundId].every(value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))) return res.status(400).json({ error: 'Invalid admission request.' });
      const receipt = await supabase.rpc('get_length_reserve_admission_receipt', { p_tournament_id: tournamentId, p_round_id: req.body.roundId, p_request_id: req.body.requestId, p_team_ids: teamIds });
      if (receipt.error) throw receipt.error;
      if (receipt.data) return res.status(200).json(receipt.data);
    }
    const checked = await checkReserveAdmission(supabase, tournamentId, teamIds, {
      isSiteAdmin: actor.access.isImplicitSuperadmin,
    });
    const preview = { roundId: checked.round.id, roundNumber: checked.round.round_number, pairs: checked.pairs, matches: checked.matches, statuses: checked.statuses,
      canAdmit: checked.canAdmit, newFieldSize: checked.newFieldSize, maxTeams: checked.tournament.max_teams };
    if (req.body.action === 'check') return res.status(200).json(preview);
    if (!checked.canAdmit) return res.status(409).json({ ...preview, error: 'Selected reserves are booked, in cup, or could not be verified.' });
    if (JSON.stringify(req.body.expectedMatches) !== JSON.stringify(checked.matches)) return res.status(409).json({ error: 'The proposed reserve pairings changed. Check reserves again.' });
    if (req.body.roundId !== checked.round.id) return res.status(409).json({ error: 'The current round changed. Check reserves again.' });
    if (typeof req.body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.body.requestId)) return res.status(400).json({ error: 'Invalid admission request.' });
    const affectedPlanningIds = await planningMembershipIds(tournamentId);
    const { data, error } = await supabase.rpc(
      actor.access.isImplicitSuperadmin ? 'admit_length_schedule_reserves_as_site_admin' : 'admit_length_schedule_reserves',
      {
        p_tournament_id: tournamentId, p_season_number: checked.tournament.season, p_round_id: checked.round.id,
        p_request_id: req.body.requestId, p_team_ids: checked.teamIds, p_matches: checked.matches,
        ...(!actor.access.isImplicitSuperadmin ? { p_raise_limit: req.body.raiseLimit === true } : {}),
      },
    );
    if (error) throw error;
    return res.status(200).json({ ...data, tournamentIds: [tournamentId, ...affectedPlanningIds] });
  } catch (error) {
    return res.status(422).json({ error: error instanceof Error ? error.message : 'Reserve admission could not be completed.' });
  }
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

function readOptionalNewsImageUrl(value: unknown) {
  const imageUrl = readString(value);
  if (!imageUrl) return { imageUrl: null, error: null };
  if (imageUrl.length > 2048) return { imageUrl: null, error: 'Image URL must be 2048 characters or fewer.' };
  if (imageUrl.startsWith('/') && !imageUrl.startsWith('//')) return { imageUrl, error: null };

  try {
    const parsed = new URL(imageUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { imageUrl: null, error: 'Image URL must use http or https.' };
    }
  } catch {
    return { imageUrl: null, error: 'Enter a valid image URL.' };
  }

  return { imageUrl, error: null };
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

type FixtureChallengeTeamRow = {
  id: string;
  ht_team_id: number | null;
  hattrick_user_id: number | null;
  active: boolean | null;
  is_placeholder: boolean | null;
  name: string | null;
  oauth_scope: string | null;
  can_manage_challenges: boolean | null;
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
  challengeManagementStatus: ChallengeManagementStatus;
};

type FixtureChallengeConsentRow = {
  auto_send_challenge: boolean;
  auto_accept_challenge: boolean;
  consented_at: string | null;
  updated_at: string;
};

function formatFixtureChallengeConsent(row?: FixtureChallengeConsentRow | null) {
  return {
    autoSendChallenge: row?.auto_send_challenge === true,
    autoAcceptChallenge: row?.auto_accept_challenge === true,
    consentedAt: row?.consented_at ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

type AutoArrangePreferenceRow = {
  team_id: string;
  hattrick_user_id: number;
  enabled: boolean;
};

async function resolveAutoArrangePreferenceContext(req: VercelRequest, res: VercelResponse) {
  const values = req.method === 'GET' ? req.query : req.body;
  const tournamentId = readString(Array.isArray(values?.tournamentId) ? values.tournamentId[0] : values?.tournamentId);
  const rawSeasonNumber = Array.isArray(values?.seasonNumber) ? values.seasonNumber[0] : values?.seasonNumber;
  const seasonNumber = typeof rawSeasonNumber === 'number' ? rawSeasonNumber : Number(readString(rawSeasonNumber));
  if (!tournamentId || !Number.isSafeInteger(seasonNumber) || seasonNumber < 1) {
    res.status(400).json({ error: 'Tournament and season are required.' });
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
    .select('id, season, status, is_archived')
    .eq('id', tournamentId)
    .maybeSingle();
  if (tournamentError) throw tournamentError;
  if (!tournament || tournament.is_archived || ['finished', 'archived', 'cancelled'].includes(tournament.status || '')) {
    res.status(404).json({ error: 'Tournament not found or no longer active.' });
    return null;
  }
  if (seasonNumber !== Number(tournament.season || 1)) {
    res.status(409).json({ error: 'Auto-arrange preferences can only be changed for the current season.' });
    return null;
  }

  const { data: rounds, error: roundsError } = await supabase
    .from('rounds')
    .select('matches(home_team_id, away_team_id)')
    .eq('tournament_id', tournamentId)
    .eq('season_number', seasonNumber);
  if (roundsError) throw roundsError;
  const scheduledTeamIds = [...new Set((rounds || []).flatMap((round) =>
    (round.matches || []).flatMap((match) => [match.home_team_id, match.away_team_id]),
  ).filter((teamId): teamId is string => typeof teamId === 'string'))];
  if (rounds?.length && scheduledTeamIds.length === 0) {
    return { supabase, tournamentId, seasonNumber, userId: session.userId, teams: [] as Array<{ id: string; name: string }> };
  }

  let teamsQuery = supabase
    .from('teams')
    .select('id, name')
    .eq('tournament_id', tournamentId)
    .eq('hattrick_user_id', session.userId);
  teamsQuery = rounds?.length
    ? teamsQuery.in('id', scheduledTeamIds)
    : teamsQuery.eq('active', true).eq('reserve_active', false).not('is_placeholder', 'is', true);
  const { data: teams, error: teamsError } = await teamsQuery;
  if (teamsError) throw teamsError;
  return {
    supabase,
    tournamentId,
    seasonNumber,
    userId: session.userId,
    teams: (teams || []) as Array<{ id: string; name: string }>,
  };
}

async function handleAutoArrangePreferences(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const context = await resolveAutoArrangePreferenceContext(req, res);
  if (!context) return;

  if (req.method === 'GET') {
    if (context.teams.length === 0) return res.status(200).json({ preferences: [] });
    const teamIds = context.teams.map((team) => team.id);
    const { data, error } = await context.supabase
      .from('tournament_team_auto_arrange_preferences')
      .select('team_id, hattrick_user_id, enabled')
      .eq('tournament_id', context.tournamentId)
      .eq('season_number', context.seasonNumber)
      .eq('hattrick_user_id', context.userId)
      .in('team_id', teamIds);
    if (error) throw error;
    const enabledByTeam = new Map(
      ((data || []) as AutoArrangePreferenceRow[]).map((row) => [row.team_id, row.enabled]),
    );
    return res.status(200).json({
      preferences: context.teams.map((team) => ({
        teamId: team.id,
        teamName: team.name,
        enabled: enabledByTeam.get(team.id) ?? true,
      })),
    });
  }

  const teamId = readString(req.body?.teamId);
  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be a boolean.' });
  if (!context.teams.some((team) => team.id === teamId)) {
    return res.status(403).json({ error: 'This team is not managed by the signed-in Hattrick account in this season.' });
  }
  const now = new Date().toISOString();
  const { error } = await context.supabase
    .from('tournament_team_auto_arrange_preferences')
    .upsert({
      tournament_id: context.tournamentId,
      season_number: context.seasonNumber,
      team_id: teamId,
      hattrick_user_id: context.userId,
      enabled,
      updated_at: now,
    }, { onConflict: 'tournament_id,season_number,team_id,hattrick_user_id' });
  if (error) throw error;
  return res.status(200).json({ teamId, enabled });
}

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
      home_team:teams!matches_home_team_id_fkey(id, ht_team_id, hattrick_user_id, active, is_placeholder, name, oauth_scope, can_manage_challenges),
      away_team:teams!matches_away_team_id_fkey(id, ht_team_id, hattrick_user_id, active, is_placeholder, name, oauth_scope, can_manage_challenges)
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

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('oauth_scope')
    .eq('hattrick_user_id', session.userId)
    .maybeSingle();
  if (profileError) throw profileError;

  const oauthScope = profile?.oauth_scope?.trim() || actorTeam.oauth_scope;
  const challengeManagementStatus = resolveChallengeManagementStatus(oauthScope, actorTeam.can_manage_challenges);

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
      challengeManagementStatus,
    },
  };
}

async function handleFixtureChallenge(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  if (req.method === 'POST' && readString(req.body?.action) === 'save-consent') {
    return handleFixtureChallengeConsent(req, res);
  }

  const resolvedRequest = await resolveFixtureChallenge(req, res);
  if (!resolvedRequest?.resolved) return;

  const { sessionUserId, resolved } = resolvedRequest;
  const supabase = getServiceSupabase();
  const { data: consent, error: consentError } = await supabase
    .from('tournament_challenge_consents')
    .select('auto_send_challenge, auto_accept_challenge, consented_at, updated_at')
    .eq('tournament_id', resolvedRequest.tournamentId)
    .eq('team_id', resolved.actorTeam.id)
    .maybeSingle();
  if (consentError) throw consentError;

  const challengeManagement = {
    status: resolved.challengeManagementStatus,
    supported: resolved.challengeManagementStatus === 'enabled',
  };
  const formattedConsent = formatFixtureChallengeConsent(consent as FixtureChallengeConsentRow | null);
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

  const availability = {
    available: true as const,
    side: resolved.side,
    opponent: { name: resolved.opponentTeam.name || 'opposing team', htTeamId: opponentTeamId },
    matchType: options.matchType === 1 ? 'cup_rules' : 'normal',
    venue: options.matchPlace === 0 ? 'home' : 'away',
    consent: formattedConsent,
    challengeManagement,
  };
  if (req.method === 'GET') return res.status(200).json(availability);

  const sent = await sendChppChallengeDirect({
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

async function handleRatingSharingPreferences(req: VercelRequest, res: VercelResponse) {
  if (!['GET', 'POST'].includes(req.method || '')) return res.status(405).json({ error: 'Method not allowed.' });
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  const secret = getAppSessionSecret();
  const session = secret ? verifyAppSessionCookie(req.headers.cookie, secret) : null;
  if (!session) return res.status(401).json({ error: 'Please sign in with Hattrick first.' });
  const values = req.method === 'GET' ? req.query : req.body;
  const tournamentId = readString(values?.tournamentId);
  const teamId = readString(values?.teamId);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(tournamentId) || (req.method === 'POST' && (!uuid.test(teamId) || typeof values?.enabled !== 'boolean'))) {
    return res.status(400).json({ error: 'Invalid rating sharing preference.' });
  }
  try {
    const db = getServiceSupabase();
    if (req.method === 'GET') {
      return res.status(200).json({ preferences: await loadRatingSharingPreferences(db, tournamentId, session.userId) });
    }
    await setRatingSharingPreference(db, tournamentId, teamId, session.userId, values.enabled);
    return res.status(200).json({ teamId, enabled: values.enabled });
  } catch (error) {
    if (error instanceof FixtureRatingsError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
}

async function handleFixtureRatings(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  const secret = getAppSessionSecret();
  const session = secret ? verifyAppSessionCookie(req.headers.cookie, secret) : null;
  if (!session) return res.status(401).json({ error: 'Please sign in with Hattrick first.' });
  try {
    if (req.method === 'GET') {
      const tournamentId = readString(req.query.tournamentId);
      if (!tournamentId) return res.status(400).json({ error: 'Missing tournamentId.' });
      const localAdmin = isLocalRatingsAdmin(
        String(req.headers.host || ''), process.env.NODE_ENV,
        process.env.FORGE_SUPERADMIN_HT_ID, session.userId,
      );
      const fixtures = await loadVisibleFixtureRatings(getServiceSupabase(), tournamentId, session.userId, localAdmin);
      return res.status(200).json({ fixtures });
    }
    const fixtureId = readString(req.body?.fixtureId);
    const side = readString(req.body?.side);
    const action = readString(req.body?.action);
    if (!fixtureId || !['home', 'away'].includes(side) || !['share', 'update', 'remove'].includes(action)) {
      return res.status(400).json({ error: 'Invalid fixture ratings request.' });
    }
    const rating = await saveFixtureRatings(
      getServiceSupabase(), fixtureId, side as 'home' | 'away', session.userId,
      action as 'share' | 'update' | 'remove',
    );
    return res.status(200).json({ rating });
  } catch (error) {
    if (error instanceof FixtureRatingsError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
}

async function handleFixtureChallengeConsent(req: VercelRequest, res: VercelResponse) {
  const autoArrangeEnabled = req.body?.autoArrangeEnabled;
  if (typeof autoArrangeEnabled !== 'boolean') {
    return res.status(400).json({ error: 'autoArrangeEnabled must be a boolean.' });
  }

  const resolvedRequest = await resolveFixtureChallenge(req, res);
  if (!resolvedRequest?.resolved) return;

  const { resolved } = resolvedRequest;
  const supabase = getServiceSupabase();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('tournament_challenge_consents')
    .upsert(
      {
        tournament_id: resolvedRequest.tournamentId,
        team_id: resolved.actorTeam.id,
        auto_send_challenge: autoArrangeEnabled,
        auto_accept_challenge: autoArrangeEnabled,
        consented_at: autoArrangeEnabled ? now : null,
        updated_at: now,
      },
      { onConflict: 'tournament_id,team_id' },
    )
    .select('auto_send_challenge, auto_accept_challenge, consented_at, updated_at')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Could not save challenge automation preference.');
  }

  return res.status(200).json({
    consent: formatFixtureChallengeConsent(data as FixtureChallengeConsentRow),
    challengeManagement: {
      status: resolved.challengeManagementStatus,
      supported: resolved.challengeManagementStatus === 'enabled',
    },
    message: autoArrangeEnabled
      ? 'Preference saved. Automatic challenge actions are not active yet.'
      : 'Automatic challenge preference disabled for this tournament team.',
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
    .select('id, ht_match_id, home_team_id, away_team_id, reserve_replaces_team_id, reserve_team:teams!matches_reserve_team_id_fkey(ht_team_id), home_team:teams!matches_home_team_id_fkey(ht_team_id), away_team:teams!matches_away_team_id_fkey(ht_team_id)')
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

    const homeTeam = firstRelation(match.home_team as { ht_team_id?: number | null } | { ht_team_id?: number | null }[] | null);
    const awayTeam = firstRelation(match.away_team as { ht_team_id?: number | null } | { ht_team_id?: number | null }[] | null);
    const reserveTeam = firstRelation(match.reserve_team as { ht_team_id?: number | null } | { ht_team_id?: number | null }[] | null);
    const details = mapMatchEventDetailsToFixture(
      parseMatchEventDetails(xml),
      typeof homeTeam?.ht_team_id === 'number' ? homeTeam.ht_team_id : null,
      typeof awayTeam?.ht_team_id === 'number' ? awayTeam.ht_team_id : null,
      match.reserve_replaces_team_id === match.home_team_id && typeof reserveTeam?.ht_team_id === 'number'
        ? [reserveTeam.ht_team_id]
        : [],
      match.reserve_replaces_team_id === match.away_team_id && typeof reserveTeam?.ht_team_id === 'number'
        ? [reserveTeam.ht_team_id]
        : [],
    );
    const footballScore = getFootballScore(details);
    const shootout = getPenaltyShootoutScore(details);
    let ratingFailure: { matchId: string; error: string } | null = null;
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
      ratingFailure = await tryRecalculateMatch120mRatings(supabase, match.id);
    }
    refreshed.push({
      matchId: match.id,
      htMatchId,
      refreshed: true,
      persisted: apply,
      ...(ratingFailure ? { ratingFailure: ratingFailure.error } : {}),
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
  const scoringMode: PersistedScoringMode = tournament.scoring_mode === 'points' || tournament.scoring_mode === 'appg' || tournament.scoring_mode === 'average120' || tournament.scoring_mode === '120m'
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
  const imageUrlResult = readOptionalNewsImageUrl(req.body?.imageUrl);
  if (!tournamentId || !seasonNumber || !roundNumber || !content) {
    return res.status(400).json({ error: 'tournamentId, seasonNumber, roundNumber, and content are required.' });
  }
  if (imageUrlResult.error) return res.status(400).json({ error: imageUrlResult.error });

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
      image_url: imageUrlResult.imageUrl,
      author_name: actor.access.viewerManagerName || 'Tournament organizer',
      author_team_id: null,
      author_ht_user_id: actor.userId,
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

async function loadNewsPostMutationAccess(
  req: VercelRequest,
  res: VercelResponse,
  postId: string,
  action: 'edit' | 'delete',
) {
  const supabase = getServiceSupabase();
  const { data: post, error } = await supabase
    .from('news_posts')
    .select('id, tournament_id, author_team_id, author_ht_user_id, is_admin')
    .eq('id', postId)
    .maybeSingle();
  if (error) throw error;
  if (!post?.tournament_id) {
    res.status(404).json({ error: 'News post not found.' });
    return null;
  }

  const actor = await requireTournamentRoleSession(req, res, post.tournament_id);
  if (!actor) return null;
  const isOrganizer = actor.access.isOriginalOrganizer;
  const isAuthor = Number(post.author_ht_user_id) === actor.userId;
  const isOrganizerAuthored =
    Number(post.author_ht_user_id) === Number(actor.access.organizerUserId) && Number(actor.access.organizerUserId) > 0;
  const role = actor.access.effectiveRole;
  const isOrganizerRole = role === 'co_organizer';
  const isAdminRole = role === 'admin';
  const isPressOfficer = role === 'press_officer';
  const legacyUnknownOfficialPost = Boolean(post.is_admin) && !post.author_ht_user_id;

  const allowed =
    isOrganizer ||
    isOrganizerRole ||
    isAuthor ||
    (!isOrganizerAuthored && !legacyUnknownOfficialPost && isAdminRole) ||
    (!isOrganizerAuthored && !legacyUnknownOfficialPost && isPressOfficer && Boolean(post.is_admin));
  if (!allowed) {
    res.status(403).json({ error: `You cannot ${action} this news post.` });
    return null;
  }
  return { supabase, actor, post };
}

async function handleCreateNewsPost(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.body?.tournamentId);
  const seasonNumber = positiveInteger(req.body?.seasonNumber);
  const title = readString(req.body?.title);
  const content = readString(req.body?.content);
  const imageUrlResult = readOptionalNewsImageUrl(req.body?.imageUrl);
  const isAdmin = req.body?.isAdmin === true;
  if (!tournamentId || !seasonNumber || !content) {
    return res.status(400).json({ error: 'tournamentId, seasonNumber, and content are required.' });
  }
  if (imageUrlResult.error) return res.status(400).json({ error: imageUrlResult.error });

  const actor = await requireTournamentRoleSession(req, res, tournamentId);
  if (!actor) return;
  const supabase = getServiceSupabase();
  let authorTeamId: string | null = null;
  let authorName: string;
  if (isAdmin) {
    if (!actor.access.canPublishAnnouncements) return res.status(403).json({ error: 'Not available.' });
    authorName = actor.access.viewerManagerName || 'Tournament organizer';
  } else {
    const { data: team, error } = await supabase
      .from('teams')
      .select('id, name')
      .eq('tournament_id', tournamentId)
      .eq('hattrick_user_id', actor.userId)
      .maybeSingle();
    if (error) throw error;
    if (!team) return res.status(403).json({ error: 'Join a tournament team before posting team news.' });
    authorTeamId = team.id;
    authorName = actor.access.viewerManagerName || team.name;
  }

  const { data: post, error } = await supabase
    .from('news_posts')
    .insert({
      tournament_id: tournamentId,
      season_number: seasonNumber,
      title: title || null,
      content,
      image_url: imageUrlResult.imageUrl,
      author_name: authorName,
      author_team_id: authorTeamId,
      author_ht_user_id: actor.userId,
      is_admin: isAdmin,
    })
    .select('*')
    .single();
  if (error) throw error;
  return res.status(201).json(post);
}

async function handleEditNewsPost(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed.' });
  const postId = readString(req.body?.postId);
  const title = readString(req.body?.title);
  const content = readString(req.body?.content);
  const imageUrlResult = readOptionalNewsImageUrl(req.body?.imageUrl);
  if (!postId || !content) return res.status(400).json({ error: 'postId and content are required.' });
  if (imageUrlResult.error) return res.status(400).json({ error: imageUrlResult.error });
  const mutation = await loadNewsPostMutationAccess(req, res, postId, 'edit');
  if (!mutation) return;
  const { data: post, error } = await mutation.supabase
    .from('news_posts')
    .update({ title: title || null, content, image_url: imageUrlResult.imageUrl })
    .eq('id', postId)
    .select('*')
    .single();
  if (error) throw error;
  return res.status(200).json(post);
}

async function handleDeleteNewsPost(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed.' });
  const postId = readString(req.body?.postId) || readString(req.query.postId);
  if (!postId) return res.status(400).json({ error: 'postId is required.' });
  const mutation = await loadNewsPostMutationAccess(req, res, postId, 'delete');
  if (!mutation) return;
  const { error } = await mutation.supabase.from('news_posts').delete().eq('id', postId);
  if (error) throw error;
  return res.status(204).end();
}

function routeFor(request: VercelRequest) {
  const raw = request.query.route;
  return readString(Array.isArray(raw) ? raw[0] : raw) || 'activity';
}

async function handleGlobalChat(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const secret = getAppSessionSecret();
  const session = secret ? verifyAppSessionCookie(req.headers.cookie, secret) : null;
  if (!session) return res.status(401).json({ error: 'Please sign in with Hattrick first.' });

  const content = normalizeGlobalChatContent(req.body?.content);
  if (!content) return res.status(400).json({ error: 'Message must contain 1–500 characters.' });
  const isGlobalMessage = req.body?.globalMessage === true;
  if (isGlobalMessage) {
    const expectedAdminId = Number(process.env.FORGE_SUPERADMIN_HT_ID || '');
    const host = String(req.headers.host || '').toLowerCase();
    const isLocalhost = /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(:\d+)?$/.test(host);
    if (!isLocalhost || expectedAdminId !== 8777402 || session.userId !== expectedAdminId) {
      return res.status(403).json({ error: 'Global messages are unavailable.' });
    }
  }

  const supabase = getServiceSupabase();
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('manager_name')
    .eq('hattrick_user_id', session.userId)
    .maybeSingle();
  if (profileError) throw profileError;

  const { data: message, error: insertError } = await supabase
    .from('global_chat')
    .insert({
      author_name: profile?.manager_name || 'Hattrick manager',
      author_ht_id: session.userId,
      content,
      global_message: isGlobalMessage,
    })
    .select('id, author_name, author_ht_id, content, created_at, global_message, is_published')
    .single();
  if (insertError) throw insertError;

  return res.status(201).json(message);
}

interface PublicReservePlanningStatus {
  inCup: boolean | null;
  bookedOutsideTournament: boolean;
}

function publicReserveTeam(row: Record<string, unknown>, planningStatus: PublicReservePlanningStatus | null) {
  return {
    id: row.id,
    name: row.name,
    ht_team_id: row.ht_team_id,
    logo_url: row.logo_url,
    country_name: row.country_name,
    country_id: row.country_id,
    manager_name: row.manager_name,
    hattrick_user_id: row.hattrick_user_id,
    reserve_joined_at: row.reserve_joined_at,
    reserve_origin: row.reserve_origin,
    planning_status: planningStatus,
  };
}

async function loadPublicReservePlanningStatuses(
  supabase: ReturnType<typeof getServiceSupabase>,
  tournamentId: string,
  rows: Array<Record<string, unknown>>,
  reserveRows: Array<Record<string, unknown>>,
) {
  const statuses = new Map<string, PublicReservePlanningStatus>();
  if (reserveRows.length === 0) return statuses;

  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) return statuses;

  const authRow = rows.find(
    (row) =>
      row.is_placeholder !== true &&
      (row.active === true || row.reserve_active === true) &&
      typeof row.oauth_token === 'string' &&
      typeof row.oauth_token_secret === 'string',
  );
  if (!authRow) return statuses;

  const authCredentials = {
    oauth_token: String(authRow.oauth_token),
    oauth_token_secret: String(authRow.oauth_token_secret),
  };
  const { data: roundRows, error: roundsError } = await supabase
    .from('rounds')
    .select('matches(ht_match_id)')
    .eq('tournament_id', tournamentId);
  if (roundsError) return statuses;

  const tournamentMatchIds = new Set<number>();
  for (const round of roundRows || []) {
    const matches = Array.isArray(round.matches) ? round.matches : round.matches ? [round.matches] : [];
    for (const match of matches) {
      const htMatchId = Number((match as { ht_match_id?: unknown }).ht_match_id);
      if (Number.isSafeInteger(htMatchId) && htMatchId > 0) tournamentMatchIds.add(htMatchId);
    }
  }

  for (const row of reserveRows) {
    const teamId = Number(row.ht_team_id);
    if (!Number.isSafeInteger(teamId) || teamId <= 0) continue;

    const credentials =
      typeof row.oauth_token === 'string' && typeof row.oauth_token_secret === 'string'
        ? { oauth_token: row.oauth_token, oauth_token_secret: row.oauth_token_secret }
        : authCredentials;
    let inCup: boolean | null = null;
    let bookedOutsideTournament = false;

    try {
      const details = await fetchTeamDetailsFromChpp(consumerKey, consumerSecret, credentials, teamId);
      inCup = typeof details.stillInCup === 'boolean' ? details.stillInCup : null;
    } catch {
      // Keep the booking status usable if the teamdetails request fails.
    }

    try {
      const booking = await fetchTeamBookingStatus(consumerKey, consumerSecret, credentials, teamId);
      const bookedMatchId = booking.match?.matchId ? Number(booking.match.matchId) : null;
      bookedOutsideTournament = bookedMatchId !== null && !tournamentMatchIds.has(bookedMatchId);
    } catch {
      // Keep the reserve widget available if the matches request fails.
    }

    statuses.set(String(row.id), { inCup, bookedOutsideTournament });
  }

  return statuses;
}

async function handleTeamMembership(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.body?.tournamentId || req.query.tournamentId);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(tournamentId)) return res.status(400).json({ error: 'Invalid tournament.' });
  const actor = await requireTournamentRoleSession(req, res, tournamentId);
  if (!actor) return;
  if (!actor.access.canManageOperations) return res.status(403).json({ error: 'You cannot manage these teams.' });
  const supabase = getServiceSupabase();
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    const { data: tournament, error: tournamentError } = await supabase.from('tournaments').select('season').eq('id', tournamentId).maybeSingle();
    if (tournamentError) throw tournamentError;
    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });
    const { data, error } = await supabase.rpc('get_waiting_admission_plan', {
      p_tournament_id: tournamentId, p_season_number: tournament.season || 1,
    });
    if (error) return res.status(409).json({ error: error.message });
    return res.status(200).json(data);
  }
  const action = readString(req.body?.action), teamId = readString(req.body?.teamId);
  if (!uuid.test(teamId) || !['promote', 'to_waiting', 'remove', 'return', 'ready'].includes(action) ||
      (action === 'ready' && typeof req.body?.ready !== 'boolean')) return res.status(400).json({ error: 'Invalid membership action.' });
  if (!actor.access.isImplicitSuperadmin && ['promote', 'to_waiting'].includes(action)) {
    const { data: tournament, error } = await supabase.from('tournaments').select('schedule_generated_at').eq('id', tournamentId).maybeSingle();
    if (error) throw error;
    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });
    if (tournament.schedule_generated_at) return res.status(409).json({ error: action === 'promote'
      ? 'Check Actively waiting for admission at a regular-round transition, or use the existing paired scheduling operation.'
      : 'Use Leave after this round for a scheduled participant.' });
  }
  const { data, error } = await supabase.rpc('change_tournament_team_membership', {
    p_tournament_id: tournamentId, p_team_id: teamId, p_action: action,
    p_ready: action === 'ready' ? req.body.ready : null,
    p_override: actor.access.isImplicitSuperadmin,
  });
  if (error) return res.status(409).json({ error: error.message });
  return res.status(200).json(data);
}

async function handleNextRoundJoin(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.body?.tournamentId);
  const teamId = readString(req.body?.teamId);
  if (!tournamentId || !teamId || !/^[0-9a-f-]{36}$/i.test(tournamentId) || !/^[0-9a-f-]{36}$/i.test(teamId)) {
    return res.status(400).json({ error: 'Invalid pending registration.' });
  }
  if (req.body?.action === 'cancel') {
    const actor = await requireTournamentRoleSession(req, res, tournamentId);
    if (!actor) return;
    if (!actor.access.canManageOperations) {
      return res.status(403).json({ error: 'You do not have permission to manage this registration.' });
    }
    const { error } = await getServiceSupabase().rpc('cancel_next_round_tournament_join', {
      p_tournament_id: tournamentId, p_team_id: teamId,
    });
    if (error) return res.status(409).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }
  if (req.body?.action !== undefined && req.body.action !== 'withdraw') {
    return res.status(400).json({ error: 'Invalid pending registration action.' });
  }
  const secret = getAppSessionSecret();
  const session = secret ? verifyAppSessionCookie(req.headers.cookie, secret) : null;
  if (!session) return res.status(401).json({ error: 'Please sign in with Hattrick first.' });
  const { error } = await getServiceSupabase().rpc('withdraw_next_round_tournament_join', {
    p_tournament_id: tournamentId, p_team_id: teamId, p_manager_id: session.userId,
  });
  if (error) return res.status(409).json({ error: error.message });
  return res.status(200).json({ ok: true });
}

async function handleReserveTeams(req: VercelRequest, res: VercelResponse) {
  if (!['GET', 'POST'].includes(req.method || '')) return res.status(405).json({ error: 'Method not allowed.' });

  const tournamentId = readString(req.query.tournamentId || req.body?.tournamentId);
  if (!tournamentId) return res.status(400).json({ error: 'Missing tournamentId.' });

  const supabase = getServiceSupabase();
  const [{ data: tournament, error: tournamentError }, { data: teamRows, error: teamsError }] = await Promise.all([
    supabase
      .from('tournaments')
      .select('id, league_category, country_limit, country_limit_format, max_country_active_teams, allow_manager_country_size_exception, registration_closed_at, status, schedule_mode, schedule_generated_at')
      .eq('id', tournamentId)
      .maybeSingle(),
    supabase
      .from('teams')
      .select(
        'id, name, ht_team_id, active, is_placeholder, reserve_active, reserve_joined_at, reserve_origin, pending_entry_round_id, logo_url, country_name, country_id, manager_name, hattrick_user_id, oauth_token, oauth_token_secret',
      )
      .eq('tournament_id', tournamentId)
      .order('reserve_joined_at', { ascending: false, nullsFirst: false }),
  ]);
  if (tournamentError) throw tournamentError;
  if (teamsError) throw teamsError;
  if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });

  const rows = (teamRows || []) as unknown as Array<Record<string, unknown>>;
  const reserveRows = rows.filter((row) => row.reserve_active === true && row.is_placeholder !== true);
  const allowReserveRegistration = !tournament.registration_closed_at && !['finished', 'stopped', 'archived'].includes(tournament.status);
  if (req.method === 'GET') {
    const planningStatuses = await loadPublicReservePlanningStatuses(supabase, tournamentId, rows, reserveRows);
    const reserveTeams = reserveRows.map((row) => publicReserveTeam(row, planningStatuses.get(String(row.id)) || null));
    const secret = getAppSessionSecret();
    const session = secret ? verifyAppSessionCookie(req.headers.cookie, secret) : null;
    if (!session) {
      return res.status(200).json({ authenticated: false, allowReserveRegistration, reserveTeams, myTeams: [] });
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('manager_name, teams_json')
      .eq('hattrick_user_id', session.userId)
      .maybeSingle();
    if (profileError) throw profileError;
    const profileTeams = Array.isArray(profile?.teams_json) ? (profile.teams_json as ChppTeamOption[]) : [];
    const category = tournament.league_category === 'hfi' ? 'hfi' : 'male';
    const countryLimit = normalizeLeagueLimit(
      tournament.country_limit,
      tournament.country_limit_format ?? 'league_id',
    );
    const hasQualifyingParticipant = Boolean(tournament.allow_manager_country_size_exception &&
      tournament.max_country_active_teams != null &&
      managerCountrySizeAllowance(rows.map((row) => ({
        ht_team_id: row.ht_team_id == null ? null : Number(row.ht_team_id),
        active: row.active === true, reserve_active: row.reserve_active === true,
        is_placeholder: row.is_placeholder === true, hattrick_user_id: Number(row.hattrick_user_id),
        country_id: Number(row.country_id),
      })), session.userId, tournament.max_country_active_teams).waiting > 0);
    const myTeams = profileTeams
      .map((team) => {
        const baseEligibility = validateTeamEligibility(team, { category, countryLimit });
        const sizeEligibility = validateCountrySizeEligibility({
          countryId: team.countryId,
          maximumActiveTeams: tournament.max_country_active_teams,
          allowManagerException: tournament.allow_manager_country_size_exception,
          hasQualifyingParticipant,
        });
        const eligibility = baseEligibility.eligible ? sizeEligibility : baseEligibility;
        const existing = rows.find((row) => Number(row.ht_team_id) === team.teamId);
        return {
          team_id: team.teamId,
          name: team.teamName,
          logo_url: team.logoUrl,
          country_name: team.countryName,
          country_id: team.countryId,
          eligible: eligibility.eligible,
          reason: eligibility.reason,
          base_eligible: baseEligibility.eligible,
          allowance_message: tournament.allow_manager_country_size_exception && tournament.max_country_active_teams != null && eligibility.eligible
            ? validateCountrySizeEligibility({ countryId: team.countryId, maximumActiveTeams: tournament.max_country_active_teams,
                allowManagerException: false, hasQualifyingParticipant: false }).eligible
              ? 'Add this small-league team to reserves to unlock one additional larger-league reserve entry.'
              : 'Your qualifying small-league entry allows this additional larger-league team onto the reserve list.'
            : undefined,
          state: existing?.active ? 'participant' : existing?.reserve_active ? 'reserve' : existing?.pending_entry_round_id ? 'pending' : 'available',
          existing_team_id: existing?.id || null,
        };
      })
      .filter((team) => team.state === 'reserve' || (team.base_eligible &&
        (team.state !== 'available' || tournament.max_country_active_teams == null || team.eligible)));
    return res.status(200).json({ authenticated: true, allowReserveRegistration, reserveTeams, myTeams });
  }

  const secret = getAppSessionSecret();
  if (!secret) return res.status(500).json({ error: 'Session configuration is missing.' });
  const session = verifyAppSessionCookie(req.headers.cookie, secret);
  if (!session) return res.status(401).json({ error: 'Please sign in with Hattrick first.' });

  const action = readString(req.body?.action);
  const requestedTeamId = readString(req.body?.teamId);
  if (!['join', 'leave'].includes(action) || !requestedTeamId) {
    return res.status(400).json({ error: 'Choose a team and an action.' });
  }
  if (action === 'join' && !allowReserveRegistration) {
    return res.status(409).json({ error: 'Tournament registration is currently closed.' });
  }

  if (action === 'leave') {
    const { data, error } = await supabase.rpc('withdraw_next_round_tournament_join', {
      p_tournament_id: tournamentId, p_team_id: requestedTeamId, p_manager_id: session.userId,
    });
    if (error) return res.status(409).json({ error: error.message });
    return res.status(200).json({ ok: true, teamId: data });
  }

  const selectedTeamId = Number(requestedTeamId);
  if (!Number.isSafeInteger(selectedTeamId) || selectedTeamId <= 0) {
    return res.status(400).json({ error: 'Invalid team.' });
  }
  const credentials = await getManagerChppCredentials(supabase, session.userId);
  if (!credentials) return res.status(401).json({ error: 'Please sign in with Hattrick first.' });

  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) return res.status(500).json({ error: 'CHPP configuration is missing.' });

  let ownedTeams;
  try {
    ownedTeams = await fetchManagerTeamsFromChpp(consumerKey, consumerSecret, credentials, session.userId);
  } catch {
    return res.status(502).json({ error: 'Could not verify your Hattrick teams right now.' });
  }
  const cachedTeam = ownedTeams.teams.find((team) => team.teamId === selectedTeamId);
  if (!cachedTeam) return res.status(400).json({ error: 'That team is not available from your Hattrick profile.' });

  let details: Awaited<ReturnType<typeof fetchTeamDetailsFromChpp>> | null = null;
  try {
    details = await fetchTeamDetailsFromChpp(consumerKey, consumerSecret, credentials, selectedTeamId);
  } catch (error) {
    console.warn('Reserve registration teamdetails refresh failed; using managercompendium metadata.', error);
  }
  const team: ChppTeamOption = {
    ...cachedTeam,
    teamName: details?.teamName || cachedTeam.teamName,
    leagueId: details?.leagueId ?? cachedTeam.leagueId,
    leagueSystemId: details?.leagueSystemId ?? cachedTeam.leagueSystemId,
    leagueName: details?.leagueName ?? cachedTeam.leagueName,
    leagueLevel: details?.leagueLevel ?? cachedTeam.leagueLevel,
    genderId: details?.genderId ?? cachedTeam.genderId,
    countryId: details?.countryId ?? cachedTeam.countryId,
    countryName: details?.countryName ?? cachedTeam.countryName,
    logoUrl: details?.logoUrl ?? cachedTeam.logoUrl,
  };
  const eligibility = validateTeamEligibility(team, {
    category: tournament.league_category === 'hfi' ? 'hfi' : 'male',
    countryLimit: normalizeLeagueLimit(tournament.country_limit, tournament.country_limit_format ?? 'league_id'),
  });
  if (!eligibility.eligible) return res.status(400).json({ error: eligibility.reason || 'This team is not eligible.' });
  // The legacy reserve URL delegates ongoing user joins to the same verified
  // Waiting request; it cannot reopen a second registration path.
  if (tournament.schedule_mode === 'length' && tournament.schedule_generated_at) {
    const { data: teamRowId, error } = await supabase.rpc('request_next_round_tournament_join', {
      p_tournament_id: tournamentId,
      p_values: {
        ht_team_id: team.teamId, name: team.teamName, ht_team_name: team.teamName,
        hattrick_user_id: session.userId, manager_name: credentials.manager_name,
        country_id: team.countryId ?? null, country_name: team.countryName ?? null,
        league_id: team.leagueId ?? null, gender_id: team.genderId ?? null, league_level: team.leagueLevel ?? null,
        team_rank: details?.teamRank ?? null, power_rating: details?.powerRating ?? null,
        power_global_rank: details?.powerGlobalRank ?? null, power_league_rank: details?.powerLeagueRank ?? null,
        power_region_rank: details?.powerRegionRank ?? null, logo_url: team.logoUrl ?? null,
        oauth_token: credentials.oauth_token, oauth_token_secret: credentials.oauth_token_secret,
      },
    });
    if (error) return res.status(409).json({ error: error.message });
    return res.status(200).json({ ok: true, teamId: teamRowId });
  }

  const countrySizeEligibility = await validateTournamentCountrySizeEligibility(supabase, {
    tournamentId,
    managerId: session.userId,
    countryId: team.countryId,
    waitingList: true,
    excludeTeamId: team.teamId,
    maximumActiveTeams: tournament.max_country_active_teams,
    allowManagerException: tournament.allow_manager_country_size_exception,
  });
  if (!countrySizeEligibility.eligible) return res.status(400).json({ error: countrySizeEligibility.reason });

  const teamRowId = await registerReserveTeam(supabase, {
    tournamentId,
    team,
    managerName: credentials.manager_name,
    hattrickUserId: session.userId,
    accessToken: credentials.oauth_token,
    accessTokenSecret: credentials.oauth_token_secret,
    logoUrl: details?.logoUrl ?? cachedTeam.logoUrl,
    countryId: team.countryId,
    countryName: team.countryName,
    teamRank: details?.teamRank ?? null,
    powerRating: details?.powerRating ?? null,
    powerGlobalRank: details?.powerGlobalRank ?? null,
    powerLeagueRank: details?.powerLeagueRank ?? null,
    powerRegionRank: details?.powerRegionRank ?? null,
    reserveOrigin: 'manager_joined',
  });
  return res.status(200).json({ ok: true, teamId: teamRowId });
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
    if (!session) {
      const secret = getAppSessionSecret();
      const appSession = secret ? verifyAppSessionCookie(req.headers.cookie, secret) : null;
      if (!appSession) return res.status(200).json({ authorized: false });
      const { data: assignments, error: assignmentError } = await getServiceSupabase(6000)
        .from('locale_catalog_settings').select('locale, editor_ht_ids');
      if (assignmentError) return res.status(200).json({ authorized: false });
      const editorLocales = (assignments || []).filter((row) => row.editor_ht_ids?.includes(appSession.userId))
        .map((row) => row.locale);
      if (!editorLocales.length) return res.status(200).json({ authorized: false });
      const { data: editorProfile } = await getServiceSupabase(6000).from('profiles')
        .select('manager_name').eq('hattrick_user_id', appSession.userId).maybeSingle();
      return res.status(200).json({
        authorized: true, role: 'locale-editor', editorLocales,
        userId: appSession.userId, managerName: editorProfile?.manager_name || null,
      });
    }
    const { data: profile } = await getServiceSupabase()
      .from('profiles')
      .select('manager_name')
      .eq('hattrick_user_id', session.userId)
      .maybeSingle();
    return res.status(200).json({ authorized: true, role: 'admin', userId: session.userId, managerName: profile?.manager_name || null });
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

type NewsCommentRow = {
  id: string;
  post_id: string;
  hattrick_user_id: number;
  author_name: string;
  content: string;
  created_at: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readNewsCommentPostIds(value: unknown) {
  const raw = Array.isArray(value) ? value.join(',') : readString(value);
  return Array.from(new Set(raw.split(',').map((item) => item.trim()).filter((item) => UUID_PATTERN.test(item)))).slice(0, 100);
}

async function hydrateNewsComments(
  supabase: ReturnType<typeof getSupabase>,
  comments: NewsCommentRow[],
) {
  const authorIds = Array.from(new Set(comments.map((comment) => comment.hattrick_user_id).filter((id) => id > 0)));
  if (authorIds.length === 0) return comments.map((comment) => ({ ...comment, avatar_json: null }));

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('hattrick_user_id, avatar_json')
    .in('hattrick_user_id', authorIds);
  if (error) throw error;

  const avatars = new Map<number, unknown>(
    (profiles || []).map((profile) => [Number(profile.hattrick_user_id), profile.avatar_json || null]),
  );
  return comments.map((comment) => ({ ...comment, avatar_json: avatars.get(comment.hattrick_user_id) || null }));
}

async function handleNewsComments(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    const postIds = readNewsCommentPostIds(req.query.postIds || req.query.postId);
    if (postIds.length === 0) return res.status(400).json({ error: 'Missing news post.' });

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('news_comments')
      .select(NEWS_COMMENT_SELECT)
      .in('post_id', postIds)
      .order('created_at', { ascending: true });
    if (error) throw error;

    const comments = await hydrateNewsComments(supabase, (data || []) as NewsCommentRow[]);
    const viewerId = positiveInteger(req.query.viewerId);
    let viewer: { manager_name: string | null; avatar_json: unknown } | null = null;
    if (viewerId) {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('manager_name, avatar_json')
        .eq('hattrick_user_id', viewerId)
        .maybeSingle();
      if (profileError) throw profileError;
      viewer = profile
        ? { manager_name: profile.manager_name || null, avatar_json: profile.avatar_json || null }
        : null;
    }

    return res.status(200).json({ comments, viewer });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const postId = readString(req.body?.postId);
  if (!UUID_PATTERN.test(postId)) return res.status(400).json({ error: 'Invalid news post.' });
  const validatedComment = validateNewsComment(req.body?.content);
  if (validatedComment.error) return res.status(400).json({ error: validatedComment.error });

  const secret = getAppSessionSecret();
  if (!secret) return res.status(500).json({ error: 'Session configuration is missing.' });
  const session = verifyAppSessionCookie(req.headers.cookie, secret);
  if (!session) return res.status(401).json({ error: 'Please sign in with Hattrick first.' });

  const supabase = getServiceSupabase();
  const { data: post, error: postError } = await supabase
    .from('news_posts')
    .select('id')
    .eq('id', postId)
    .maybeSingle();
  if (postError) throw postError;
  if (!post) return res.status(404).json({ error: 'News post not found.' });

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('manager_name, avatar_json')
    .eq('hattrick_user_id', session.userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.manager_name) return res.status(403).json({ error: 'Your manager profile is not available.' });

  const { data, error } = await supabase
    .from('news_comments')
    .insert({
      post_id: postId,
      hattrick_user_id: session.userId,
      author_name: profile.manager_name,
      content: validatedComment.comment,
    })
    .select(NEWS_COMMENT_SELECT)
    .single();
  if (error) throw error;
  return res.status(201).json({ comment: { ...data, avatar_json: profile.avatar_json || null } });
}

function toDate(value: unknown, fallback: Date) {
  const parsed = typeof value === 'string' ? new Date(value) : fallback;
  return Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

type ForgeActivityRow = {
  id: string;
  occurred_at: string;
  visitor_id: string;
  visit_id: string | null;
  hattrick_user_id: number | null;
  manager_name: string | null;
  event_type: string;
  route: string | null;
  tournament_id: string | null;
  team_id: string | null;
  referrer: string | null;
  country_code: string | null;
  language: string | null;
  platform: string | null;
  browser: string | null;
  metadata: Record<string, unknown> | null;
  resolved_user_id?: number | null;
  resolved_manager_name?: string | null;
};

function cookieValue(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) return null;
  const entry = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? entry.slice(name.length + 1) : null;
}

function encodeVisitCursor(visit: { lastSeen: string; visitId: string }) {
  return Buffer.from(JSON.stringify(visit)).toString('base64url');
}

function decodeVisitCursor(value: string) {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { lastSeen?: unknown; visitId?: unknown };
    if (typeof parsed.lastSeen === 'string' && typeof parsed.visitId === 'string') return parsed as { lastSeen: string; visitId: string };
  } catch {
    // Invalid cursors restart from the newest visit.
  }
  return null;
}

function encodeActivityCursor(event: { occurred_at: string; id: string }) {
  return Buffer.from(JSON.stringify(event)).toString('base64url');
}

function decodeActivityCursor(value: string) {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { occurred_at?: unknown; id?: unknown };
    if (typeof parsed.occurred_at === 'string' && typeof parsed.id === 'string') {
      return parsed as { occurred_at: string; id: string };
    }
  } catch {
    // Invalid cursors restart from the newest activity.
  }
  return null;
}

async function loadForgeActivityRows(
  supabase: ReturnType<typeof getServiceSupabase>,
  since: Date | null,
) {
  const rows: ForgeActivityRow[] = [];
  const batchSize = 1000;
  let offset = 0;
  while (true) {
    let query = supabase
      .from('activity_events')
      .select('id, occurred_at, visitor_id, visit_id, hattrick_user_id, manager_name, event_type, route, tournament_id, team_id, referrer, country_code, language, platform, browser, metadata');
    if (since) query = query.gte('occurred_at', since.toISOString());
    const { data, error } = await query
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + batchSize - 1);
    if (error) throw error;
    const batch = (data || []) as ForgeActivityRow[];
    rows.push(...batch);
    if (batch.length < batchSize) break;
    offset += batchSize;
  }
  return rows;
}

function filterForgeActivityRows(rawEvents: ForgeActivityRow[], req: VercelRequest) {
  const adminId = getForgeSuperadminId();
  const analyticsExcludedUserId = getAnalyticsExcludedHtUserId();
  const currentVisitorId = cookieValue(req.headers.cookie, 'ht_visitor');
  const adminVisitorIds = new Set(
    rawEvents.filter((event) => adminId && event.hattrick_user_id === adminId).map((event) => event.visitor_id),
  );
  const analyticsExcludedVisitorIds = new Set(
    rawEvents.filter((event) => analyticsExcludedUserId && event.hattrick_user_id === analyticsExcludedUserId)
      .map((event) => event.visitor_id),
  );
  return rawEvents.filter((event) => {
    if (isExcludedAnalyticsReferrer(event.referrer)) return false;
    if (currentVisitorId && event.visitor_id === currentVisitorId) return false;
    if (analyticsExcludedUserId && (
      event.hattrick_user_id === analyticsExcludedUserId || analyticsExcludedVisitorIds.has(event.visitor_id)
    )) return false;
    return event.hattrick_user_id !== adminId && !adminVisitorIds.has(event.visitor_id);
  });
}

function isMissingCleanActivityTable(error: { code?: string; message?: string }) {
  return error.code === '42P01'
    || error.code === 'PGRST205'
    || /activity_daily_clean.*(not found|does not exist)/i.test(error.message || '');
}

function addDailyEventCount(
  counts: Map<string, number>,
  activityDate: string,
  eventType: string,
  amount: number,
  route = '',
) {
  const key = `${activityDate}\u0000${eventType}\u0000${route}`;
  counts.set(key, (counts.get(key) || 0) + amount);
}

function serializeDailyEventCounts(counts: Map<string, number>) {
  return Array.from(counts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, event_count]) => {
      const [activity_date, event_type, route] = key.split('\u0000');
      return { activity_date, event_type, route, event_count };
    });
}

function activityBucketKey(activityDate: string, unit: 'day' | 'week' | 'month') {
  const date = new Date(`${activityDate}T00:00:00.000Z`);
  if (unit === 'month') return activityDate.slice(0, 7);
  if (unit === 'week') {
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return date.toISOString().slice(0, 10);
  }
  return activityDate;
}

function summarizeForgeUniqueVisitors(events: ForgeActivityRow[], unit: 'day' | 'week' | 'month') {
  const visitorsByBucket = new Map<string, Set<string>>();
  for (const event of events) {
    const bucket = activityBucketKey(event.occurred_at.slice(0, 10), unit);
    const key = `${bucket}\u0000${event.event_type}`;
    const visitors = visitorsByBucket.get(key) || new Set<string>();
    visitors.add(event.visitor_id);
    visitorsByBucket.set(key, visitors);
  }
  return Array.from(visitorsByBucket.entries()).map(([key, visitors]) => {
    const [activity_date, event_type] = key.split('\u0000');
    return { activity_date, event_type, visitor_count: visitors.size };
  });
}

function summarizeForgeActivityTrend(events: ForgeActivityRow[]) {
  const dailyCounts = new Map<string, number>();
  for (const event of events) {
    const activityDate = event.occurred_at.slice(0, 10);
    addDailyEventCount(dailyCounts, activityDate, event.event_type, 1, event.route || '');
  }
  return serializeDailyEventCounts(dailyCounts);
}

async function loadRawForgeActivityTrend(
  supabase: ReturnType<typeof getServiceSupabase>,
  req: VercelRequest,
  requestedDay: string,
  rawStartDay: string,
  unit: 'day' | 'week' | 'month',
) {
  const coverageStart = requestedDay > rawStartDay ? requestedDay : rawStartDay;
  const rawEvents = await loadForgeActivityRows(supabase, new Date(`${coverageStart}T00:00:00.000Z`));
  const events = filterForgeActivityRows(rawEvents, req);
  return {
    daily: summarizeForgeActivityTrend(events),
    uniqueVisitors: summarizeForgeUniqueVisitors(events, unit),
    uniqueTournamentViews: summarizeUniqueTournamentViews(events, (day) => activityBucketKey(day, unit)),
    coverageStart,
    rawUniqueStart: coverageStart,
  };
}

async function handleForgeActivityTrend(req: VercelRequest, res: VercelResponse) {
  const supabase = getServiceSupabase();
  const requestedSince = toDate(req.query.since, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const requestedUnit = readString(req.query.unit);
  const unit = requestedUnit === 'week' || requestedUnit === 'month' ? requestedUnit : 'day';
  const requestedDay = requestedSince.toISOString().slice(0, 10);
  const rawCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const rawStartDay = new Date(Date.UTC(
    rawCutoff.getUTCFullYear(), rawCutoff.getUTCMonth(), rawCutoff.getUTCDate() + 1,
  )).toISOString().slice(0, 10);

  await cleanupActivityEvents().catch((error) => console.warn('Activity cleanup failed:', error));

  const { data: coverageRow, error: coverageError } = await supabase.from('activity_daily_clean')
    .select('activity_date')
    .eq('event_type', '__clean_tracking_start__')
    .maybeSingle();
  if (coverageError) {
    if (!isMissingCleanActivityTable(coverageError)) throw coverageError;
    return res.status(200).json(await loadRawForgeActivityTrend(supabase, req, requestedDay, rawStartDay, unit));
  }

  const cleanRows: Array<{ activity_date: string; event_type: string; route: string; event_count: number | string }> = [];
  const cleanBatchSize = 1000;
  let cleanOffset = 0;
  while (true) {
    const { data, error } = await supabase.from('activity_daily_clean')
      .select('activity_date, event_type, route, event_count')
      .gte('activity_date', requestedDay)
      .lt('activity_date', rawStartDay)
      .neq('event_type', '__clean_tracking_start__')
      .order('activity_date', { ascending: true })
      .order('event_type', { ascending: true })
      .order('route', { ascending: true })
      .range(cleanOffset, cleanOffset + cleanBatchSize - 1);
    if (error) {
      if (!isMissingCleanActivityTable(error)) throw error;
      return res.status(200).json(await loadRawForgeActivityTrend(supabase, req, requestedDay, rawStartDay, unit));
    }
    const batch = (data || []) as typeof cleanRows;
    cleanRows.push(...batch);
    if (batch.length < cleanBatchSize) break;
    cleanOffset += cleanBatchSize;
  }

  const dailyCounts = new Map<string, number>();
  for (const row of cleanRows || []) {
    addDailyEventCount(dailyCounts, row.activity_date, row.event_type, Number(row.event_count || 0), row.route || '');
  }

  const rawSinceDay = requestedDay > rawStartDay ? requestedDay : rawStartDay;
  const rawEvents = await loadForgeActivityRows(supabase, new Date(`${rawSinceDay}T00:00:00.000Z`));
  const visibleRawEvents = filterForgeActivityRows(rawEvents, req);
  for (const event of visibleRawEvents) {
    const activityDate = event.occurred_at.slice(0, 10);
    addDailyEventCount(dailyCounts, activityDate, event.event_type, 1, event.route || '');
  }

  const cleanStartDay = typeof coverageRow?.activity_date === 'string' ? coverageRow.activity_date : rawStartDay;
  const firstAvailableDay = cleanStartDay < rawStartDay ? cleanStartDay : rawStartDay;
  const coverageStart = requestedDay > firstAvailableDay ? requestedDay : firstAvailableDay;
  const daily = serializeDailyEventCounts(dailyCounts);

  return res.status(200).json({
    daily,
    uniqueVisitors: summarizeForgeUniqueVisitors(visibleRawEvents, unit),
    uniqueTournamentViews: summarizeUniqueTournamentViews(visibleRawEvents, (day) => activityBucketKey(day, unit)),
    coverageStart,
    rawUniqueStart: rawSinceDay,
  });
}

async function handleForgeStats(req: VercelRequest, res: VercelResponse) {
  if (!isForgeEnabled()) return res.status(404).json({ error: 'Not found.' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!isForgeAdminRequest(req.headers.cookie) && !hasSuperAdminBypassCookie(req.headers.cookie)) {
    return res.status(401).json({ error: 'Forge authorization required.' });
  }
  if (String(req.query.trend || '') === '1') return handleForgeActivityTrend(req, res);

  const now = new Date();
  const allData = String(req.query.all || '') === '1';
  const since = allData ? null : toDate(req.query.since, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
  const rawRetentionCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const rawUniqueStart = new Date(Date.UTC(
    rawRetentionCutoff.getUTCFullYear(),
    rawRetentionCutoff.getUTCMonth(),
    rawRetentionCutoff.getUTCDate() + 1,
  )).toISOString().slice(0, 10);
  const selectedUserId = Number(req.query.userId || 0) || null;
  const selectedVisitorId = readString(req.query.visitorId) || null;
  const requestedTrendUnit = readString(req.query.trendUnit);
  const trendUnit = requestedTrendUnit === 'week' || requestedTrendUnit === 'month' ? requestedTrendUnit : 'day';
  const supabase = getServiceSupabase();

  await cleanupActivityEvents().catch((error) => console.warn('Activity cleanup failed:', error));

  const rawEvents = await loadForgeActivityRows(supabase, since);
  const visibleEvents = filterForgeActivityRows(rawEvents, req);
  const identityByVisitor = new Map<string, { userId: number; managerName: string | null }>();
  for (const event of visibleEvents) {
    if (event.hattrick_user_id) {
      identityByVisitor.set(event.visitor_id, {
        userId: event.hattrick_user_id,
        managerName: event.manager_name,
      });
    }
  }
  const events: ForgeActivityRow[] = visibleEvents.map((event) => {
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
    else if (event.event_type !== 'page_exit') actionEvents += 1;
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
    events.filter((event) => event.event_type === 'page_view')
      .map((event) => (typeof event.metadata?.[key] === 'string' ? String(event.metadata[key]) : null));

  const visitGroups = new Map<string, {
    visitId: string;
    visitorId: string;
    userId: number | null;
    managerName: string | null;
    firstSeen: string;
    lastSeen: string;
    countryCode: string | null;
    language: string | null;
    platform: string | null;
    browser: string | null;
    referrer: string | null;
    pages: Array<{ route: string; visitedAt: string; theme: string | null; durationSeconds: number | null; maxScrollPercent: number | null }>;
    actions: string[];
  }>();
  const chronologicalEvents = [...events].sort((left, right) => left.occurred_at.localeCompare(right.occurred_at));
  for (const event of chronologicalEvents) {
    const visitId = event.visit_id || `legacy:${event.visitor_id}:${Math.floor(Date.parse(event.occurred_at) / (30 * 60 * 1000))}`;
    const existing = visitGroups.get(visitId);
    const visit = existing || {
      visitId,
      visitorId: event.visitor_id,
      userId: event.resolved_user_id || null,
      managerName: event.resolved_manager_name || null,
      firstSeen: event.occurred_at,
      lastSeen: event.occurred_at,
      countryCode: event.country_code,
      language: event.language,
      platform: event.platform,
      browser: event.browser,
      referrer: event.referrer,
      pages: [],
      actions: [],
    };
    visit.userId = event.resolved_user_id || visit.userId;
    visit.managerName = event.resolved_manager_name || visit.managerName;
    visit.firstSeen = event.occurred_at < visit.firstSeen ? event.occurred_at : visit.firstSeen;
    visit.lastSeen = event.occurred_at > visit.lastSeen ? event.occurred_at : visit.lastSeen;
    visit.countryCode ||= event.country_code;
    visit.language ||= event.language;
    visit.platform ||= event.platform;
    visit.browser ||= event.browser;
    visit.referrer ||= event.referrer;
    if (event.event_type === 'page_view' && event.route) {
      visit.pages.push({
        route: event.route,
        visitedAt: event.occurred_at,
        theme: typeof event.metadata?.theme === 'string' ? event.metadata.theme : null,
        durationSeconds: null,
        maxScrollPercent: null,
      });
    } else if (event.event_type === 'page_exit') {
      const page = [...visit.pages].reverse().find((item) => item.route === event.route && item.durationSeconds === null);
      if (page) {
        page.durationSeconds = typeof event.metadata?.durationSeconds === 'number' ? event.metadata.durationSeconds : null;
        page.maxScrollPercent = typeof event.metadata?.maxScrollPercent === 'number' ? event.metadata.maxScrollPercent : null;
        if (!page.theme && typeof event.metadata?.theme === 'string') page.theme = event.metadata.theme;
      }
    } else if (event.event_type !== 'page_view' && event.event_type !== 'page_exit') {
      visit.actions.push(event.event_type);
    }
    visitGroups.set(visitId, visit);
  }

  const sortedVisits = Array.from(visitGroups.values()).sort(
    (left, right) => right.lastSeen.localeCompare(left.lastSeen) || right.visitId.localeCompare(left.visitId),
  );
  const themeVisitors = new Map<string, Set<string>>();
  for (const visit of sortedVisits) {
    for (const page of visit.pages) {
      if (!page.theme) continue;
      const visitors = themeVisitors.get(page.theme) || new Set<string>();
      visitors.add(visit.visitorId);
      themeVisitors.set(page.theme, visitors);
    }
  }
  const selectedVisits = selectedUserId
    ? sortedVisits.filter((visit) => visit.userId === selectedUserId)
    : selectedVisitorId
      ? sortedVisits.filter((visit) => visit.visitorId === selectedVisitorId)
      : sortedVisits;
  const cursor = decodeVisitCursor(readString(req.query.cursor));
  const pageSize = 30;
  const pageStart = cursor
    ? selectedVisits.findIndex((visit) => visit.lastSeen < cursor.lastSeen
      || (visit.lastSeen === cursor.lastSeen && visit.visitId < cursor.visitId))
    : 0;
  const safePageStart = cursor && pageStart < 0 ? selectedVisits.length : pageStart;
  const visitsPage = selectedVisits.slice(safePageStart, safePageStart + pageSize);
  const hasMore = safePageStart + visitsPage.length < selectedVisits.length;
  const lastVisit = visitsPage[visitsPage.length - 1];
  const dailyByDate = new Map<string, number>();
  for (const event of events) {
    const activityDate = event.occurred_at.slice(0, 10);
    addDailyEventCount(dailyByDate, activityDate, event.event_type, 1, event.route || '');
  }
  const daily = serializeDailyEventCounts(dailyByDate);
  const sortedActivity = events
    .filter((event) => event.event_type !== 'page_view')
    .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at) || right.id.localeCompare(left.id));
  const activityCursor = decodeActivityCursor(readString(req.query.activityCursor));
  const activityStart = activityCursor
    ? sortedActivity.findIndex((event) => event.occurred_at < activityCursor.occurred_at
      || (event.occurred_at === activityCursor.occurred_at && event.id < activityCursor.id))
    : 0;
  const safeActivityStart = activityCursor && activityStart < 0 ? sortedActivity.length : activityStart;
  const recentActivity = sortedActivity.slice(safeActivityStart, safeActivityStart + 30);
  const hasMoreActivity = safeActivityStart + recentActivity.length < sortedActivity.length;
  const lastActivity = recentActivity[recentActivity.length - 1];

  return res.status(200).json({
    since: since?.toISOString() || null,
    summary: {
      events: events.length,
      visits: sortedVisits.length,
      pageViews: visitEvents,
      actions: actionEvents,
      uniqueVisitors: visitors.size,
      identifiedUsers: userRows.length,
    },
    users: userRows,
    visitors: visitorRows,
    visits: visitsPage,
    recentActivity,
    hasMoreActivity,
    nextActivityCursor: hasMoreActivity && lastActivity
      ? encodeActivityCursor({ occurred_at: lastActivity.occurred_at, id: lastActivity.id })
      : null,
    hasMore,
    nextCursor: hasMore && lastVisit ? encodeVisitCursor({ lastSeen: lastVisit.lastSeen, visitId: lastVisit.visitId }) : null,
    breakdowns: {
      countries: breakdown(sortedVisits.map((visit) => visit.countryCode)),
      platforms: breakdown(sortedVisits.map((visit) => visit.platform)),
      browsers: breakdown(sortedVisits.map((visit) => visit.browser)),
      languages: breakdown(sortedVisits.map((visit) => visit.language)),
      routes: breakdown(events.map((event) => event.route)),
      referrers: breakdown(sortedVisits.map((visit) => visit.referrer)),
      themes: breakdown(sortedVisits.flatMap((visit) => visit.pages.map((page) => page.theme)))
        .map((row) => ({ ...row, uniqueCount: themeVisitors.get(row.value)?.size || 0 })),
      screens: breakdown(metadataValues('screen')),
      times: breakdown(
        events.filter((event) => event.event_type === 'page_view').map((event) => {
          const hour = new Date(event.occurred_at).getHours();
          return `${String(hour).padStart(2, '0')}:00`;
        }),
      ),
    },
    selectedVisitorId,
    daily: daily || [],
    uniqueVisitors: summarizeForgeUniqueVisitors(events, trendUnit),
    uniqueTournamentViews: summarizeUniqueTournamentViews(events, (day) => activityBucketKey(day, trendUnit)),
    rawUniqueStart,
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    switch (routeFor(req)) {
      case 'presence':
        return await handlePresence(req, res);
      case 'history':
        return await handleHistory(req, res);
      case 'news-comments':
        return await handleNewsComments(req, res);
      case 'forge-session':
        return await handleForgeSession(req, res);
      case 'forge-stats':
        return await handleForgeStats(req, res);
      case 'forge-locales':
        return await handleForgeLocales(req, res);
      case 'tournament-roles':
        return await handleTournamentRoles(req, res);
      case 'tournament-access':
        return await handleTournamentAccess(req, res);
      case 'duplicate-tournament-sandbox':
        return await handleDuplicateTournamentAsSandbox(req, res);
      case 'update-power-rankings':
        return await handleUpdateHfiRanks(req, res, true);
      case 'update-hfi-ranks':
        return await handleUpdateHfiRanks(req, res);
      case 'refresh-spotlight-profiles':
        return await handleRefreshSpotlightProfiles(req, res);
      case 'generate-length-schedule':
        return await handleGenerateLengthSchedule(req, res);
      case 'repair-length-round':
        return await handleRepairLengthRound(req, res);
      case 'recover-length-round-one':
        return await handleRecoverLengthRoundOne(req, res);
      case 'save-length-results':
        return await handleSaveLengthResults(req, res);
      case 'managed-tournaments':
        return await handleManagedTournaments(req, res);
      case 'delete-owned-test-tournaments':
        return await handleDeleteOwnedTestTournaments(req, res);
      case 'tournament-participation':
        return await handleTournamentParticipation(req, res);
      case 'season-slot-replacement':
        return await handleSeasonSlotReplacement(req, res);
      case 'reserve-team-swap':
        return await handleReserveTeamSwap(req, res);
      case 'reserve-team-fill':
        return await handleReserveTeamFill(req, res);
      case 'move-inactive-team-to-reserve':
        return await handleMoveInactiveTeamToReserve(req, res);
      case 'remove-unused-past-team':
        return await handleRemoveUnusedPastTeam(req, res);
      case 'tournament-publication':
        return await handleTournamentPublication(req, res);
      case 'creation-roster':
        return await handleCreationRoster(req, res);
      case 'start-tournament-season':
        return await handleStartTournamentSeason(req, res);
      case 'reset-season-to-planning':
        return await handleResetSeasonToPlanning(req, res);
      case 'archive-tournament':
        return await handleArchiveTournament(req, res);
      case 'scheduled-team-removal':
        return await handleScheduledTeamRemoval(req, res);
      case 'tournament-team-departure':
        return await handleTournamentTeamDeparture(req, res);
      case 'admin-team-reserve-transition':
        return await handleAdminTeamReserveTransition(req, res);
      case 'reserve-admission':
        return await handleReserveAdmission(req, res);
      case 'admin-add-reserve-team':
        return await handleAdminAddReserveTeam(req, res);
      case 'fixture-challenge':
        return await handleFixtureChallenge(req, res);
      case 'fixture-ratings':
        return await handleFixtureRatings(req, res);
      case 'auto-arrange-preferences':
        return await handleAutoArrangePreferences(req, res);
      case 'rating-sharing-preferences':
        return await handleRatingSharingPreferences(req, res);
      case 'backfill-round-matchdetails':
        return await handleRoundPressMatchDetailsBackfill(req, res);
      case 'generate-round-summary':
        return req.method === 'GET'
          ? await handleRoundSummaryEligibility(req, res)
          : await handleGenerateRoundSummary(req, res);
      case 'post-round-summary':
        return await handlePostRoundSummary(req, res);
      case 'create-news-post':
        return await handleCreateNewsPost(req, res);
      case 'edit-news-post':
        return await handleEditNewsPost(req, res);
      case 'delete-news-post':
        return await handleDeleteNewsPost(req, res);
      case 'global-chat':
        return await handleGlobalChat(req, res);
      case 'reserve-teams':
        return await handleReserveTeams(req, res);
      case 'team-membership':
        return await handleTeamMembership(req, res);
      case 'next-round-join':
        return await handleNextRoundJoin(req, res);
      case 'activity':
      default:
        return await handleActivity(req, res);
    }
  } catch (error) {
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? String(error.message) : '';
    if (routeFor(req) === 'admin-add-reserve-team' && errorMessage.includes('Tournament registration is closed')) {
      return res.status(409).json({ error: 'Tournament registration is closed.' });
    }
    console.error('Application API error:', error);
    return res.status(500).json({ error: 'Application request failed.' });
  }
}
