import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { cache } from 'react';
import { getMatchDateForRound } from '../../utils/match-schedule';
import { getTournamentNextMatchDate } from '../../utils/tournament-next-match';
import { sortFeaturedFirst } from '../../utils/tournament-sorting';
import { sortOpenTournaments } from '../../utils/open-tournaments';
import { calculateSeasonSlotStandings } from '../../utils/standings';

interface HomeMatch {
  id: string;
  completed: boolean;
  went_120?: boolean;
  status: 'not_arranged' | 'arranged' | 'ongoing' | 'misarranged' | 'finished';
  home_team_id: string | null;
  away_team_id: string | null;
  scheduled_for?: string | null;
  home_team: { country_name: string } | null;
}

interface HomeRound {
  id: string;
  created_at: string;
  round_number: number;
  season_number?: number | null;
  matches: HomeMatch[] | null;
}

interface HomeTeam {
  id: string;
  name: string;
  ht_team_id: number;
  joined_via_oauth: boolean;
}

interface HomeTournamentRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  schedule_start_slot?: string | null;
  is_featured?: boolean | null;
  is_private: boolean;
  is_test?: boolean | null;
  status?: string | null;
  is_archived?: boolean | null;
  season: number;
  thumbnail_index?: number;
  image_url?: string;
  country_limit: string | null;
  scoring_mode: string | null;
  league_category: string | null;
  max_teams: number | null;
  rounds: HomeRound[] | null;
  teams: HomeTeam[];
}

interface HomeWarning {
  round_id: string;
  team_id: string;
}

interface HomeTournament extends HomeTournamentRow {
  rounds: HomeRound[];
  validatedTeamCount: number;
  totalRounds: number;
  completedRounds: number;
  totalMatches: number;
  completedMatches: number;
  activityScore: number;
  teamCount: number;
  nextMatchDate: string | null;
  plannedStartDate: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  is_featured: boolean;
}

export interface HomeInitialData {
  featuredTournaments: HomeTournament[];
  activeTournaments: HomeTournament[];
  openTournaments: HomeTournament[];
  topTeams: { name: string; ht_team_id: number; achievements120min: number }[];
  topActiveTournaments: { name: string; slug: string; completedMatches: number }[];
}

export interface TournamentInitialData {
  tournament: Record<string, unknown>;
  teams: Record<string, unknown>[];
  rounds: Record<string, unknown>[];
  standings: Record<string, unknown>[];
  warnings: Record<string, unknown>[];
  seasons: Record<string, unknown>[];
  announcements: Record<string, unknown>[];
  organizerProfileName: string | null;
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

function serializeDate(value: Date | null) {
  return value ? value.toISOString() : null;
}

export const loadHomeInitialData = cache(async (): Promise<HomeInitialData> => {
  const supabase = getPublicSupabase();
  if (!supabase) {
    return { featuredTournaments: [], activeTournaments: [], openTournaments: [], topTeams: [], topActiveTournaments: [] };
  }

  let tournamentsRaw: unknown[] | null;
  let warningsRaw: unknown[] | null;
  try {
    const [tournamentsResult, warningsResult] = await Promise.all([
      supabase
        .from('tournaments')
        .select(
          `
          id, name, slug, created_at, schedule_start_slot, is_featured, is_private, is_test, status, is_archived,
          season, thumbnail_index, image_url, country_limit, scoring_mode, league_category, max_teams,
          rounds (
            id, created_at, round_number, season_number,
            matches (
              id, completed, status, home_team_id, away_team_id, scheduled_for, went_120,
              home_team:teams!matches_home_team_id_fkey(country_name)
            )
          ),
          teams (id, name, ht_team_id, joined_via_oauth)
        `,
        )
        .eq('is_private', false),
      supabase.from('fixture_warnings').select('round_id, team_id').eq('active', true),
    ]);
    if (tournamentsResult.error) {
      console.error('Could not load Home tournaments on the server:', tournamentsResult.error.message);
      return { featuredTournaments: [], activeTournaments: [], openTournaments: [], topTeams: [], topActiveTournaments: [] };
    }
    tournamentsRaw = tournamentsResult.data;
    warningsRaw = warningsResult.data;
  } catch (error) {
    console.error('Could not load Home tournaments on the server:', error instanceof Error ? error.message : 'Unknown error');
    return { featuredTournaments: [], activeTournaments: [], openTournaments: [], topTeams: [], topActiveTournaments: [] };
  }

  const warnings = (warningsRaw || []) as HomeWarning[];
  const featured: HomeTournament[] = [];
  const active: HomeTournament[] = [];
  const open: HomeTournament[] = [];
  const team120Stats: Record<number, { name: string; count: number }> = {};

  for (const tournament of (tournamentsRaw || []) as unknown as HomeTournamentRow[]) {
    if (tournament.is_test || tournament.status === 'stopped' || tournament.status === 'archived' || tournament.is_archived) {
      continue;
    }

    const currentRounds = (tournament.rounds || []).filter(
      (round) => (round.season_number ?? tournament.season) === tournament.season,
    );
    const matches = currentRounds.flatMap((round) => round.matches || []);
    const completedMatches = matches.filter((match) => match.completed || match.status === 'misarranged').length;
    const isGenerated = currentRounds.length > 0;
    const isClosed = matches.length > 0 && matches.length === completedMatches;
    const allMatchDates = currentRounds.flatMap((round) =>
      (round.matches || []).map((match) => getMatchDateForRound(round, match, match.home_team?.country_name)),
    );
    const completedMatchDates = currentRounds.flatMap((round) =>
      (round.matches || [])
        .filter((match) => match.completed || match.status === 'misarranged')
        .map((match) => getMatchDateForRound(round, match, match.home_team?.country_name)),
    );
    const plannedStartDate = tournament.schedule_start_slot ? new Date(tournament.schedule_start_slot) : null;
    const startedAt =
      allMatchDates.toSorted((a, b) => a.getTime() - b.getTime())[0] ?? plannedStartDate ?? new Date(tournament.created_at);
    const finishedAt = completedMatchDates.toSorted((a, b) => a.getTime() - b.getTime()).at(-1) ?? null;

    for (const match of matches) {
      if (!match.completed || !match.went_120) continue;
      for (const teamId of [match.home_team_id, match.away_team_id]) {
        const team = tournament.teams.find((candidate) => candidate.id === teamId);
        if (!team?.ht_team_id) continue;
        team120Stats[team.ht_team_id] ||= { name: team.name, count: 0 };
        team120Stats[team.ht_team_id].count += 1;
      }
    }

    const item: HomeTournament = {
      ...tournament,
      rounds: currentRounds,
      validatedTeamCount: tournament.teams.filter((team) => team.joined_via_oauth).length,
      totalRounds: currentRounds.length,
      completedRounds: currentRounds.filter((round) => {
        const roundMatches = round.matches || [];
        return roundMatches.length > 0 && roundMatches.every((match) => match.completed || match.status === 'misarranged');
      }).length,
      totalMatches: matches.length,
      completedMatches,
      activityScore: completedMatches,
      teamCount: tournament.teams.length,
      nextMatchDate: serializeDate(isGenerated && !isClosed ? getTournamentNextMatchDate(currentRounds, warnings) : null),
      plannedStartDate: serializeDate(plannedStartDate),
      startedAt: serializeDate(startedAt),
      finishedAt: serializeDate(finishedAt),
      is_featured: Boolean(tournament.is_featured),
    };

    if (item.is_featured) featured.push(item);
    else if (isGenerated && !isClosed && item.status !== 'finished') active.push(item);
    else if (!isGenerated && item.status !== 'finished') open.push(item);
  }

  const featuredTournaments = sortFeaturedFirst(featured, (a, b) => {
    const statusWeight = (tournament: HomeTournament) => {
      if (tournament.status === 'finished' || tournament.totalMatches === tournament.completedMatches) return 3;
      if (tournament.rounds.length > 0) return 1;
      return 2;
    };
    const weightDelta = statusWeight(a) - statusWeight(b);
    return weightDelta || new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
  const activeTournaments = sortFeaturedFirst(active, (a, b) => {
    if (b.validatedTeamCount !== a.validatedTeamCount) return b.validatedTeamCount - a.validatedTeamCount;
    if (!a.nextMatchDate && !b.nextMatchDate) return 0;
    if (!a.nextMatchDate) return 1;
    if (!b.nextMatchDate) return -1;
    return new Date(a.nextMatchDate).getTime() - new Date(b.nextMatchDate).getTime();
  });

  return {
    featuredTournaments,
    activeTournaments,
    openTournaments: sortOpenTournaments(open),
    topTeams: Object.entries(team120Stats)
      .map(([id, data]) => ({ ht_team_id: Number(id), name: data.name, achievements120min: data.count }))
      .toSorted((a, b) => b.achievements120min - a.achievements120min)
      .slice(0, 10),
    topActiveTournaments: active
      .map((tournament) => ({
        name: tournament.name,
        slug: tournament.slug,
        completedMatches: tournament.completedMatches,
      }))
      .toSorted((a, b) => b.completedMatches - a.completedMatches)
      .slice(0, 10),
  };
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

  const [{ data: teamsRaw }, { data: roundsRaw }, { data: seasonsRaw }, { data: warningsRaw }, { data: announcementsRaw }, organizerResult] =
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
              away_team:teams!matches_away_team_id_fkey(name, ht_team_id, logo_url, country_name, country_id, league_id, league_level, active, manager_name, hattrick_user_id)
            `,
          )
          .in('round_id', roundIds)
      : Promise.resolve({ data: [] }),
    userIds.length
      ? supabase.from('profiles').select('hattrick_user_id, manager_name, last_seen_at').in('hattrick_user_id', userIds)
      : Promise.resolve({ data: [] }),
  ]);

  const profiles = (profilesResult.data || []) as { hattrick_user_id: number; manager_name: string; last_seen_at: string | null }[];
  const profileMap = Object.fromEntries(profiles.map((profile) => [profile.hattrick_user_id, profile.manager_name]));
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
    return { ...match, home_team: historicalTeam(match.home_team, match.home_slot_assignment_id), away_team: historicalTeam(match.away_team, match.away_slot_assignment_id) };
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
      .sort((a, b) => {
        const aDate = new Date(String(a.match_date)).getTime();
        const bDate = new Date(String(b.match_date)).getTime();
        if (aDate !== bDate) return aDate - bDate;
        const aHtMatchId = Number(a.ht_match_id) || Number.MAX_SAFE_INTEGER;
        const bHtMatchId = Number(b.ht_match_id) || Number.MAX_SAFE_INTEGER;
        if (aHtMatchId !== bHtMatchId) return aHtMatchId - bHtMatchId;
        return String(a.id).localeCompare(String(b.id));
      }),
  }));

  // The slot table is optional until the peak-season migration is applied. Its
  // query intentionally degrades to the legacy team-based view on old projects.
  const slots = (slotsRaw || []) as { id: string; current_team_id: string | null }[];
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
    })),
    matches.map((match) => ({
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
  ) as Record<string, unknown>[];

  return {
    tournament,
    teams,
    rounds: roundWithMatches,
    standings,
    warnings: (warningsRaw || []) as Record<string, unknown>[],
    seasons: (seasonsRaw || []) as Record<string, unknown>[],
    announcements: (announcementsRaw || []) as Record<string, unknown>[],
    organizerProfileName: (organizerResult.data as { manager_name?: string } | null)?.manager_name || null,
  };
});
