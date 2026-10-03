import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { cache } from 'react';
import { getMatchDateForRound } from '../../utils/match-schedule.js';
import { compareFixtures } from '../../utils/fixture-sorting';
import { calculateSeasonSlotStandings, type SeasonSlotAssignment } from '../../utils/standings';
import { isCurrentParticipantTeam } from '../../utils/team-state.js';
import {
  buildManagerSpotlight,
  getUtcDateKey,
  type ManagerSpotlight,
  type ManagerSpotlightProfile,
} from '../../utils/manager-spotlight';

import { buildHomeSnapshot, type HomeInitialData } from '../../server/api/_lib/home-snapshot-builder.js';
import { readCachedHomeSnapshot } from './home-snapshot.js';
export type { HomeInitialData, HomeActivityEntry } from '../../server/api/_lib/home-snapshot-builder.js';

export interface TournamentInitialData {
  tournament: Record<string, unknown>;
  teams: Record<string, unknown>[];
  rounds: Record<string, unknown>[];
  standings: Record<string, unknown>[];
  warnings: Record<string, unknown>[];
  activityWarnings: Record<string, unknown>[];
  seasons: Record<string, unknown>[];
  announcements: Record<string, unknown>[];
  organizerProfileName: string | null;
  managerSpotlight: ManagerSpotlight | null;
}

function getPublicSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: init?.signal || AbortSignal.timeout(3_500) }),
    },
  });
}

export const loadHomeInitialData = cache(async (): Promise<HomeInitialData> => {
  if (process.env.PUBLIC_HOME_SNAPSHOT_ENABLED === 'true') return readCachedHomeSnapshot();
  const supabase = getPublicSupabase();
  if (!supabase) return { featuredTournaments: [], activeTournaments: [], openTournaments: [], exoticHfiTournaments: [], topTeams: [], topActiveTournaments: [], activity: [] };
  return buildHomeSnapshot(supabase);
});

export const loadTournamentInitialData = cache(async (slug: string): Promise<TournamentInitialData | null> => {
  const supabase = getPublicSupabase();
  if (!supabase) return null;

  const { data: tournamentRaw, error: tournamentError } = await supabase.from('tournaments').select('*').eq('slug', slug).single();
  if (tournamentError || !tournamentRaw) return null;

  const tournament = tournamentRaw as Record<string, unknown>;
  const tournamentId = String(tournament.id);
  const seasonNumber = Number(tournament.season || 1);
  const organizerId = Number(tournament.organizer_id || 0);

  const [{ data: teamsRaw }, { data: roundsRaw }, { data: seasonsRaw }, { data: warningsRaw }, { data: activityWarningsRaw }, { data: announcementsRaw }, organizerResult] =
    await Promise.all([
      supabase.from('teams').select('*').eq('tournament_id', tournamentId).order('created_at', { ascending: true }),
      supabase
        .from('rounds')
        .select('*')
        .eq('tournament_id', tournamentId)
        .eq('season_number', seasonNumber)
        .order('round_number', { ascending: true }),
      supabase.from('tournament_seasons').select('*').eq('tournament_id', tournamentId).order('season_number', { ascending: true }),
      supabase.from('fixture_warnings').select('*').eq('tournament_id', tournamentId).eq('active', true),
      supabase.from('fixture_warnings').select('id, round_id, team_id, created_at').eq('tournament_id', tournamentId),
      supabase.from('tournament_announcements').select('*').eq('tournament_id', tournamentId).order('created_at', { ascending: false }),
      organizerId
        ? supabase.from('profiles').select('manager_name').eq('hattrick_user_id', organizerId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const teams = (teamsRaw || []) as Record<string, unknown>[];
  const rounds = (roundsRaw || []) as Record<string, unknown>[];
  const currentSeasonId = String((seasonsRaw || []).find((season) => Number((season as Record<string, unknown>).season_number) === seasonNumber)?.id || '');
  const { data: slotsRaw } = currentSeasonId
    ? await supabase.from('tournament_season_slots').select('id, current_team_id').eq('tournament_season_id', currentSeasonId)
    : { data: [] as unknown[] };
  const slotIds = (slotsRaw || []).map((slot) => String((slot as Record<string, unknown>).id));
  const { data: slotAssignmentsRaw } = slotIds.length
    ? await supabase
        .from('tournament_season_slot_assignments')
        .select('id, tournament_season_slot_id, team_id, assigned_at, released_at, team_name, ht_team_id, manager_name, hattrick_user_id, logo_url')
        .in('tournament_season_slot_id', slotIds)
    : { data: [] as unknown[] };
  const roundIds = rounds.map((round) => String(round.id));
  const userIds = teams.map((team) => Number(team.hattrick_user_id || 0)).filter(Boolean);
  const [matchesResult, profilesResult] = await Promise.all([
    roundIds.length
      ? supabase
          .from('matches')
          .select(
            `
              *, status, ht_match_id, match_type,
              home_team:teams!matches_home_team_id_fkey(name, ht_team_id, logo_url, country_name, country_id, league_id, league_level, active, manager_name, hattrick_user_id),
              away_team:teams!matches_away_team_id_fkey(name, ht_team_id, logo_url, country_name, country_id, league_id, league_level, active, manager_name, hattrick_user_id),
              reserve_team:teams!matches_reserve_team_id_fkey(name, ht_team_id, logo_url, country_name, country_id, league_id, league_level, active, reserve_active, manager_name, hattrick_user_id)
            `,
          )
          .in('round_id', roundIds)
      : Promise.resolve({ data: [] }),
    userIds.length
      ? supabase
          .from('profiles')
          .select('hattrick_user_id, manager_name, last_seen_at, avatar_json, country_id, country_name, language_name, teams_json')
          .in('hattrick_user_id', userIds)
      : Promise.resolve({ data: [] }),
  ]);

  let profileRows = profilesResult.data;
  if (profilesResult.error && userIds.length) {
    // Keep public tournament rendering usable while the small profile-language migration is rolling out.
    const fallbackProfiles = await supabase
      .from('profiles')
      .select('hattrick_user_id, manager_name, last_seen_at, avatar_json, country_id, country_name, teams_json')
      .in('hattrick_user_id', userIds);
    profileRows = fallbackProfiles.data;
  }
  const profiles = (profileRows || []) as Array<ManagerSpotlightProfile & { last_seen_at: string | null }>;
  const profileMap = Object.fromEntries(profiles.map((profile) => [profile.hattrick_user_id, profile.manager_name]));
  const managerSpotlight = buildManagerSpotlight({
    tournamentId,
    participants: teams.filter(isCurrentParticipantTeam) as Array<{
      id: string;
      ht_team_id?: number | null;
      name?: string | null;
      logo_url?: string | null;
      country_id?: number | null;
      country_name?: string | null;
      manager_name?: string | null;
      hattrick_user_id?: number | null;
    }>,
    profiles,
    dateKey: getUtcDateKey(),
  });
  const rawMatches = (matchesResult.data || []) as Record<string, unknown>[];
  const assignmentIds = Array.from(new Set(rawMatches.flatMap((match) => [match.home_slot_assignment_id, match.away_slot_assignment_id]).filter((id): id is string => typeof id === 'string')));
  const { data: assignmentRows } = assignmentIds.length
    ? await supabase.from('tournament_season_slot_assignments').select('id, team_name, ht_team_id, manager_name, hattrick_user_id, logo_url').in('id', assignmentIds)
    : { data: [] as unknown[] };
  const assignments = new Map((assignmentRows || []).map((row) => [String((row as Record<string, unknown>).id), row as Record<string, unknown>]));
  const matches = rawMatches.map((match) => {
    const enrichTeam = (value: unknown) => {
      if (!value || typeof value !== 'object') return null;
      const team = value as Record<string, unknown>;
      const userId = Number(team.hattrick_user_id || 0);
      return { ...team, manager_name: profileMap[userId] || team.manager_name || null };
    };
    const historicalTeam = (team: unknown, assignmentId: unknown) => {
      const assignment = typeof assignmentId === 'string' ? assignments.get(assignmentId) : null;
      if (!assignment || !match.completed) return enrichTeam(team);
      return { ...(enrichTeam(team) || {}), name: assignment.team_name, ht_team_id: assignment.ht_team_id, manager_name: assignment.manager_name, hattrick_user_id: assignment.hattrick_user_id, logo_url: assignment.logo_url };
    };
    const homeTeam = historicalTeam(match.home_team, match.home_slot_assignment_id);
    const awayTeam = historicalTeam(match.away_team, match.away_slot_assignment_id);
    const reserveTeam = enrichTeam(match.reserve_team);
    if (!reserveTeam || !match.reserve_team_id || !match.reserve_replaces_team_id) {
      return { ...match, home_team: homeTeam, away_team: awayTeam };
    }
    const replacingTeam = match.reserve_replaces_team_id === match.home_team_id ? homeTeam : awayTeam;
    const displayReserve = { ...reserveTeam, reserve_active: true, reserve_replacing_name: replacingTeam?.name };
    return {
      ...match,
      home_team: match.reserve_replaces_team_id === match.home_team_id ? displayReserve : homeTeam,
      away_team: match.reserve_replaces_team_id === match.away_team_id ? displayReserve : awayTeam,
    };
  });

  const roundWithMatches = rounds.map((round) => ({
    ...round,
      matches: matches
      .filter((match) => match.round_id === round.id)
      .map((match) => {
        const homeTeam = match.home_team as { country_name?: string } | null;
        const matchDate = getMatchDateForRound(round as never, match as never, homeTeam?.country_name);
        return { ...match, match_date: matchDate.toISOString() };
      })
      .sort(compareFixtures),
  }));

  // The slot table is optional until the peak-season migration is applied. Its
  // query intentionally degrades to the legacy team-based view on old projects.
  const slots = (slotsRaw || []) as { id: string; current_team_id: string | null }[];
  const slotAssignments = (slotAssignmentsRaw || []) as SeasonSlotAssignment[];
  const regularRoundIds = new Set(
    rounds
      .filter((round) => round.phase !== 'postseason')
      .map((round) => String(round.id)),
  );
  const regularStandingMatches = matches.filter((match) => regularRoundIds.has(String(match.round_id)));
  const standings = calculateSeasonSlotStandings(
    teams.map((team) => ({
      id: String(team.id),
      name: String(team.name),
      ht_team_id: Number(team.ht_team_id),
      hattrick_user_id: Number(team.hattrick_user_id || 0) || null,
      active: Boolean(team.active),
      replacement_for_team_id: (team.replacement_for_team_id as string | null) || null,
      joined_via_oauth: Boolean(team.joined_via_oauth),
      country_name: (team.country_name as string | null) || null,
      country_id: Number(team.country_id || 0) || null,
      league_id: Number(team.league_id || 0) || null,
      logo_url: (team.logo_url as string | null) || undefined,
      manager_name: profileMap[Number(team.hattrick_user_id || 0)] || (team.manager_name as string | null) || undefined,
      is_placeholder: Boolean(team.is_placeholder),
      reserve_active: Boolean(team.reserve_active),
      team_rank: Number(team.team_rank || 0) || null,
    })),
    regularStandingMatches.map((match) => ({
      home_team_id: (match.home_team_id as string | null) || null,
      away_team_id: (match.away_team_id as string | null) || null,
      home_slot_id: (match.home_slot_id as string | null) || null,
      away_slot_id: (match.away_slot_id as string | null) || null,
      home_goals: Number(match.home_goals || 0),
      away_goals: Number(match.away_goals || 0),
      completed: Boolean(match.completed),
      went_120: Boolean(match.went_120),
      total_minutes: Number(match.total_minutes || 90),
      appg_outcome: match.appg_outcome as 'ET3' | 'ET2' | 'PS1' | 'RT0' | 'OPW' | 'needs_review' | null,
      penalty_shootout_home_goals: Number(match.penalty_shootout_home_goals || 0) || null,
      penalty_shootout_away_goals: Number(match.penalty_shootout_away_goals || 0) || null,
    })),
    slots,
    String(tournament.scoring_mode || '120min'),
    slotAssignments,
  ) as Record<string, unknown>[];

  return {
    tournament,
    teams,
    rounds: roundWithMatches,
    standings,
    warnings: (warningsRaw || []) as Record<string, unknown>[],
    activityWarnings: (activityWarningsRaw || []) as Record<string, unknown>[],
    seasons: (seasonsRaw || []) as Record<string, unknown>[],
    announcements: (announcementsRaw || []) as Record<string, unknown>[],
    organizerProfileName: (organizerResult.data as { manager_name?: string } | null)?.manager_name || null,
    managerSpotlight,
  };
});
