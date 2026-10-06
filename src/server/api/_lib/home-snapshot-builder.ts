import type { SupabaseClient } from '@supabase/supabase-js';
import { getMatchDateForRound } from '../../../utils/match-schedule.js';
import { getTournamentNextMatchDate } from '../../../utils/tournament-next-match.js';
import { compareTournamentActivity } from '../../../utils/tournament-card-details.js';
import { formatTournamentName } from '../../../utils/tournament-names.js';
import { getCountryWorldDetails } from '../../../../shared/worlddetails.js';
import { getJoinStoryManagerSummary } from '../../../utils/tournament-activity.js';
import { isCurrentParticipantTeam } from '../../../utils/team-state.js';
import type { PublicCollection } from '../../../utils/tournament-collections.js';

interface HomeMatch {
  id: string;
  completed: boolean;
  went_120?: boolean;
  status: 'not_arranged' | 'arranged' | 'ongoing' | 'misarranged' | 'finished';
  home_team_id: string | null;
  away_team_id: string | null;
  scheduled_for?: string | null;
  finished_at?: string | null;
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
  ht_team_id: number | null;
  joined_via_oauth: boolean | null;
  created_at?: string | null;
  active?: boolean | null;
  reserve_active?: boolean | null;
  is_placeholder?: boolean | null;
  manager_name?: string | null;
  hattrick_user_id?: number | null;
  country_id?: number | null;
  country_name?: string | null;
  join_story?: unknown;
}

interface HomeTournamentRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  schedule_start_slot?: string | null;
  schedule_generated_at?: string | null;
  registration_closed_at?: string | null;
  description?: string | null;
  show_description?: boolean | null;
  is_featured?: boolean | null;
  is_private: boolean;
  is_test?: boolean | null;
  status?: string | null;
  is_archived?: boolean | null;
  season: number;
  thumbnail_index?: number;
  image_url?: string;
  country_limit: string | null;
  country_limit_format?: 'country_id' | 'league_id' | null;
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

export interface HomeTournament extends HomeTournamentRow {
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
  weeklyPosts?: HomeWeeklyPost[];
  nextRefreshAt?: string | null;
  featuredTournaments: HomeTournament[];
  activeTournaments: HomeTournament[];
  openTournaments: HomeTournament[];
  collections: PublicCollection<HomeTournament>[];
  topTeams: { name: string; ht_team_id: number; achievements120min: number }[];
  topActiveTournaments: { name: string; slug: string; completedMatches: number }[];
  activity: HomeActivityEntry[];
}

export interface HomeWeeklyPost {
  id: string; tournament_id: string; tournament_slug: string; tournament_name: string;
  tournament_display_name: string; title: string | null; content: string; image_url: string | null;
  author_name: string; author_team_id: null; author_ht_user_id: number | null; author_team_name: null;
  tournament_image_url: string | null; tournament_league_category: string | null;
  tournament_country_limit: string | null; tournament_country_limit_format: 'country_id' | 'league_id' | null;
  is_admin: boolean; created_at: string;
}

export interface HomeActivityEntry {
  id: string;
  type: 'join' | 'season-start' | 'round-start' | 'round-finish' | 'round-report';
  occurred_at: string;
  tournament_id: string;
  tournament_slug: string;
  tournament_display_name: string;
  tournament_name: string;
  manager_name?: string | null;
  manager_href?: string | null;
  manager_flag?: string | null;
  manager_ht_id?: number | null;
  team_name?: string | null;
  team_ht_id?: number | null;
  team_flag?: string | null;
  season_number?: number;
  round_number?: number;
  report_id?: string;
}

interface HomeReportRow {
  id: string;
  tournament_id: string;
  season_number: number | null;
  round_number: number | null;
  created_at: string;
}


function serializeDate(value: Date | null) { return value ? value.toISOString() : null; }

export async function buildHomeSnapshot(supabase: SupabaseClient, now = Date.now()): Promise<HomeInitialData> {
  if (!Number.isFinite(now)) throw new Error('Invalid Home build time.');

  let tournamentsRaw: unknown[] | null;
  let warningsRaw: unknown[] | null;
  let reportRows: HomeReportRow[] = [];
  let collectionsRaw: Array<{ id: string; slug: string; title: string; description: string; banner_url: string | null; homepage_group: string | null; display_order: number }>;
  let membershipsRaw: Array<{ collection_id: string; tournament_id: string; is_featured: boolean; display_order: number }>;
  try {
    const [tournamentsResult, warningsResult, collectionsResult, membershipsResult] = await Promise.all([
      supabase
        .from('tournaments')
        .select(
          `
          id, name, slug, created_at, schedule_start_slot, schedule_generated_at, registration_closed_at, description, show_description, is_featured, is_private, is_test, status, is_archived,
          season, thumbnail_index, image_url, country_limit, country_limit_format, scoring_mode, league_category, max_teams,
          rounds (
            id, created_at, round_number, season_number,
            matches (
              id, completed, status, home_team_id, away_team_id, scheduled_for, finished_at, went_120,
              home_team:teams!matches_home_team_id_fkey(country_name)
            )
          ),
          teams (id, name, ht_team_id, joined_via_oauth, created_at, active, reserve_active, is_placeholder, manager_name, hattrick_user_id, country_id, country_name, join_story)
        `,
        )
        .eq('is_private', false),
      supabase.from('fixture_warnings').select('round_id, team_id').eq('active', true),
      supabase.from('tournament_collections').select('id,slug,title,description,banner_url,homepage_group,display_order').eq('is_published', true),
      supabase.from('tournament_collection_memberships').select('collection_id,tournament_id,is_featured,display_order'),
    ]);
    if (tournamentsResult.error) {
      throw new Error('Home source read failed.');
    }
    if (warningsResult.error) throw new Error('Home warning read failed.');
    if (collectionsResult.error || membershipsResult.error) throw new Error('Home collection read failed.');
    tournamentsRaw = tournamentsResult.data;
    warningsRaw = warningsResult.data;
    collectionsRaw = collectionsResult.data || [];
    membershipsRaw = membershipsResult.data || [];
  } catch (error) {
    throw new Error('Home source read failed.', { cause: error });
  }

  if ((tournamentsRaw || []).length >= 1000 || (warningsRaw || []).length >= 1000 ||
      collectionsRaw.length >= 1000 || membershipsRaw.length >= 1000) throw new Error('Home source bound exceeded.');
  const activityCutoff = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const twoMonthsAgo = getHomeWeeklyCutoff(now);
  const { data: weeklyRows, error: weeklyError } = await supabase.from('news_posts')
    .select('id, tournament_id, title, content, image_url, author_name, author_ht_user_id, created_at, tournament:tournaments!news_posts_tournament_id_fkey!inner(name, slug, image_url, league_category, country_limit, country_limit_format, is_private, is_test, is_archived, status)')
    .eq('is_admin', true).eq('tournament.is_private', false)
    .or('is_test.is.null,is_test.eq.false', { referencedTable: 'tournament' })
    .or('is_archived.is.null,is_archived.eq.false', { referencedTable: 'tournament' })
    .or('status.is.null,status.not.in.(stopped,archived)', { referencedTable: 'tournament' })
    .gte('created_at', twoMonthsAgo.toISOString()).order('created_at', { ascending: false }).limit(3);
  if (weeklyError) throw new Error('Home Weekly read failed.');
  const weeklyPosts: HomeWeeklyPost[] = (weeklyRows || []).map((post) => {
    const tournament = (Array.isArray(post.tournament) ? post.tournament[0] : post.tournament) as unknown as HomeTournamentRow;
    if (!tournament || tournament.is_private || tournament.is_test || tournament.is_archived || ['stopped', 'archived'].includes(tournament.status || '')) {
      throw new Error('Home Weekly visibility failed.');
    }
    return {
      id: post.id, tournament_id: post.tournament_id, tournament_slug: tournament.slug,
      tournament_name: tournament.name,
      tournament_display_name: formatTournamentName(tournament.name, { countryLimit: tournament.country_limit, includeCountryFlag: true }),
      title: post.title, content: post.content, image_url: post.image_url || null, author_name: post.author_name,
      author_team_id: null, author_team_name: null, author_ht_user_id: post.author_ht_user_id,
      tournament_image_url: tournament.image_url || null, tournament_league_category: tournament.league_category,
      tournament_country_limit: tournament.country_limit, tournament_country_limit_format: tournament.country_limit_format || null,
      is_admin: true, created_at: post.created_at,
    };
  });
  const publicTournamentIds = ((tournamentsRaw || []) as HomeTournamentRow[])
    .filter((tournament) => !tournament.is_test && !tournament.is_archived && tournament.status !== 'stopped' && tournament.status !== 'archived')
    .map((tournament) => tournament.id);
  if (publicTournamentIds.length > 0) {
    const { data, error } = await supabase
      .from('news_posts')
      .select('id, tournament_id, season_number, round_number, created_at')
      .eq('is_round_report', true)
      .gte('created_at', activityCutoff)
      .in('tournament_id', publicTournamentIds)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error('Home activity read failed.');
    reportRows = (data || []) as HomeReportRow[];
  }

  const warnings = (warningsRaw || []) as HomeWarning[];
  const featured: HomeTournament[] = [];
  const active: HomeTournament[] = [];
  const open: HomeTournament[] = [];
  const publicCards = new Map<string, HomeTournament>();
  const publishedCollectionIds = new Set(collectionsRaw.map((collection) => collection.id));
  const memberIds = new Set(membershipsRaw
    .filter((membership) => publishedCollectionIds.has(membership.collection_id))
    .map((membership) => membership.tournament_id));
  const team120Stats: Record<number, { name: string; count: number }> = {};
  const activity: HomeActivityEntry[] = [];

  for (const tournament of (tournamentsRaw || []) as unknown as HomeTournamentRow[]) {
    if (tournament.is_private || tournament.is_test || tournament.status === 'stopped' || tournament.status === 'archived' || tournament.is_archived) {
      continue;
    }

    const currentRounds = (tournament.rounds || []).filter(
      (round) => (round.season_number ?? tournament.season) === tournament.season,
    );
    if (tournament.teams.length >= 1000 || (tournament.rounds || []).length >= 1000 || currentRounds.some((round) => (round.matches || []).length >= 1000)) {
      throw new Error('Home relation bound exceeded.');
    }
    const matches = currentRounds.flatMap((round) => round.matches || []);
    const tournamentDisplayName = formatTournamentName(tournament.name, {
      countryLimit: tournament.country_limit,
      includeCountryFlag: true,
    });
    const inActivityWindow = (value: string | null | undefined) => {
      const timestamp = value ? Date.parse(value) : NaN;
      return Number.isFinite(timestamp) && timestamp >= Date.parse(activityCutoff) && timestamp <= now;
    };
    const addActivity = (entry: Omit<HomeActivityEntry, 'tournament_id' | 'tournament_slug' | 'tournament_name' | 'tournament_display_name'>) => {
      activity.push({
        ...entry,
        tournament_id: tournament.id,
        tournament_slug: tournament.slug,
        tournament_name: tournament.name,
        tournament_display_name: tournamentDisplayName,
      });
    };

    for (const team of tournament.teams) {
      if (team.active === false || team.is_placeholder || !team.created_at || !inActivityWindow(team.created_at)) continue;
      const manager = getJoinStoryManagerSummary(team.join_story);
      addActivity({
        id: `join:${team.id}`,
        type: 'join',
        occurred_at: team.created_at,
        manager_name: manager.name || team.manager_name || null,
        manager_href: manager.href,
        manager_flag: manager.flag,
        manager_ht_id: team.hattrick_user_id || null,
        team_name: team.name,
        team_ht_id: team.ht_team_id,
        team_flag: getCountryWorldDetails(team.country_id ?? undefined)?.emoji || null,
      });
    }

    const seasonStartAt = tournament.schedule_generated_at;
    if (inActivityWindow(seasonStartAt)) {
      addActivity({
        id: `season-start:${tournament.id}:${tournament.season}`,
        type: 'season-start',
        occurred_at: seasonStartAt!,
        season_number: tournament.season,
      });
    }

    for (const round of currentRounds) {
      const playableMatches = (round.matches || []).filter((match) => match.home_team_id && match.away_team_id);
      if (playableMatches.length === 0) continue;
      const scheduledTimes = playableMatches
        .map((match) => (match.scheduled_for ? Date.parse(match.scheduled_for) : NaN))
        .filter((value) => Number.isFinite(value));
      const startedAt = scheduledTimes.length > 0 ? new Date(Math.min(...scheduledTimes)).toISOString() : null;
      if (startedAt && inActivityWindow(startedAt)) {
        addActivity({
          id: `round-start:${round.id}`,
          type: 'round-start',
          occurred_at: startedAt,
          round_number: round.round_number,
        });
      }

      const playedMatches = playableMatches.filter(
        (match) => (match.completed || match.status === 'finished') && match.status !== 'misarranged',
      );
      const isFinished = playableMatches.every((match) => match.completed || match.status === 'finished' || match.status === 'misarranged') && playedMatches.length > 0;
      if (isFinished) {
        const finishTimes = playedMatches
          .map((match) => match.finished_at || match.scheduled_for)
          .filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(value)));
        const finishedAt = finishTimes.length > 0 ? finishTimes.map(Date.parse).sort((a, b) => b - a)[0] : NaN;
        if (Number.isFinite(finishedAt)) {
          addActivity({
            id: `round-finish:${round.id}`,
            type: 'round-finish',
            occurred_at: new Date(finishedAt).toISOString(),
            round_number: round.round_number,
          });
        }
      }
    }

    reportRows
      .filter((report) => report.tournament_id === tournament.id && report.season_number === tournament.season && report.round_number)
      .filter((report) => inActivityWindow(report.created_at))
      .forEach((report) => {
        addActivity({
          id: `round-report:${report.id}`,
          type: 'round-report',
          occurred_at: report.created_at,
          round_number: report.round_number || undefined,
          report_id: report.id,
        });
      });
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
      description: tournament.show_description ? (tournament.description || '').trim().slice(0, 600) || null : null,
      rounds: currentRounds,
      validatedTeamCount: tournament.teams.filter((team) => isCurrentParticipantTeam(team) && team.joined_via_oauth).length,
      totalRounds: currentRounds.length,
      completedRounds: currentRounds.filter((round) => {
        const roundMatches = round.matches || [];
        return roundMatches.length > 0 && roundMatches.every((match) => match.completed || match.status === 'misarranged');
      }).length,
      totalMatches: matches.length,
      completedMatches,
      activityScore: completedMatches,
      teamCount: tournament.teams.filter(isCurrentParticipantTeam).length,
      nextMatchDate: serializeDate(isGenerated && !isClosed ? getTournamentNextMatchDate(currentRounds, warnings) : null),
      plannedStartDate: serializeDate(plannedStartDate),
      startedAt: serializeDate(startedAt),
      finishedAt: serializeDate(finishedAt),
      is_featured: Boolean(tournament.is_featured),
    };
    publicCards.set(item.id, item);

    // Global homepage promotion remains independent of collection membership.
    if (item.is_featured) featured.push(item);
    if (memberIds.has(item.id)) continue;

    if (isGenerated && !isClosed && item.status !== 'finished') active.push(item);
    else if (!isGenerated && item.status !== 'finished') open.push(item);
  }

  const featuredTournaments = featured.sort(compareTournamentActivity);
  const activeTournaments = active.sort(compareTournamentActivity);

  const collections: PublicCollection<HomeTournament>[] = collectionsRaw
    .map((collection) => ({
      id: collection.id, slug: collection.slug, title: collection.title,
      description: collection.description, bannerUrl: collection.banner_url,
      homepageGroup: collection.homepage_group ?? null,
      displayOrder: collection.display_order,
      members: membershipsRaw.filter((membership) => membership.collection_id === collection.id)
        .flatMap((membership) => {
          const tournament = publicCards.get(membership.tournament_id);
          return tournament ? [{ tournament, isFeatured: membership.is_featured, displayOrder: membership.display_order }] : [];
        }),
    }))
    .sort((a, b) => a.displayOrder - b.displayOrder || a.slug.localeCompare(b.slug));
  return {
    weeklyPosts,
    nextRefreshAt: getHomeNextRefreshAt(activity, (tournamentsRaw || []) as HomeTournamentRow[], weeklyPosts, now),
    featuredTournaments,
    activeTournaments,
    openTournaments: open.sort(compareTournamentActivity),
    collections,
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
    activity: activity
      .filter((entry) => Number.isFinite(Date.parse(entry.occurred_at)) && Date.parse(entry.occurred_at) >= Date.parse(activityCutoff) && Date.parse(entry.occurred_at) <= now)
      .toSorted((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
      .slice(0, 7),
  };
}

/** Time-driven expiry/kickoff, not a blanket snapshot TTL. */
function getHomeNextRefreshAt(activity: HomeActivityEntry[], tournaments: HomeTournamentRow[], weekly: HomeWeeklyPost[], now: number): string | null {
  const boundaries = activity.flatMap((entry) => [Date.parse(entry.occurred_at), Date.parse(entry.occurred_at) + 7 * 86_400_000 + 1]);
  for (const tournament of tournaments) {
    if (tournament.is_private || tournament.is_test || tournament.is_archived || ['stopped', 'archived'].includes(tournament.status || '')) continue;
    for (const round of tournament.rounds || []) {
      for (const match of round.matches || []) if (match.scheduled_for) boundaries.push(Date.parse(match.scheduled_for));
    }
  }
  for (const post of weekly) {
    boundaries.push(getHomeWeeklyExpiry(post.created_at));
  }
  const next = boundaries.filter((value) => Number.isFinite(value) && value > now).sort((a, b) => a - b)[0];
  return next === undefined ? null : new Date(next).toISOString();
}

/** Calendar-month cutoff with end-of-month clamping, independent of host timezone. */
export function getHomeWeeklyCutoff(now: number): Date {
  const cutoff = new Date(now);
  const day = cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 2);
  const lastDay = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate();
  cutoff.setUTCDate(Math.min(day, lastDay));
  return cutoff;
}

export function getHomeWeeklyExpiry(createdAt: string): number {
  const created = new Date(createdAt);
  const expiry = new Date(created);
  expiry.setUTCDate(1);
  expiry.setUTCMonth(expiry.getUTCMonth() + 2);
  const lastDay = new Date(Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth() + 1, 0)).getUTCDate();
  if (created.getUTCDate() > lastDay) {
    // The cutoff jumps past this post at the following month boundary.
    return Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth() + 1, 1);
  }
  expiry.setUTCDate(created.getUTCDate());
  return expiry.getTime() + 1;
}
