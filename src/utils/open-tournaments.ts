import { supabase } from '../lib/supabase';
import { sortFeaturedFirst } from './tournament-sorting';

export interface OpenTournamentSummary {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  is_featured?: boolean | null;
  teamCount: number;
  max_teams?: number | null;
  validatedTeamCount: number;
}

type OpenTournamentRow = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  is_featured?: boolean | null;
  max_teams?: number | null;
  rounds: { id: string }[] | null;
  teams: { id: string; joined_via_oauth: boolean }[] | null;
};

export const sortOpenTournaments = <T extends { teamCount: number; max_teams?: number | null; is_featured?: boolean | null }>(
  tournaments: T[],
): T[] =>
  sortFeaturedFirst(tournaments, (a, b) => {
    const scoreA = a.max_teams && a.max_teams > 0 ? a.teamCount / a.max_teams : a.teamCount;
    const scoreB = b.max_teams && b.max_teams > 0 ? b.teamCount / b.max_teams : b.teamCount;
    return scoreB - scoreA;
  });

export const formatOpenTournamentMeta = (tournament: OpenTournamentSummary) => {
  const teamsLabel =
    tournament.max_teams && tournament.max_teams > 0
      ? `${tournament.teamCount}/${tournament.max_teams} teams`
      : `${tournament.teamCount} teams`;

  return `${teamsLabel} · ${new Date(tournament.created_at).toLocaleDateString()}`;
};

export const fetchOpenTournaments = async (): Promise<OpenTournamentSummary[]> => {
  const { data, error } = await supabase
    .from('tournaments')
    .select(
      `
      id,
      name,
      slug,
      created_at,
      is_featured,
      rounds ( id ),
      max_teams,
      teams ( id, joined_via_oauth )
    `,
    )
    .eq('is_private', false);

  if (error) throw error;
  if (!data) return [];

  const open = (data as OpenTournamentRow[])
    .filter((tournament) => (tournament.rounds?.length ?? 0) === 0)
    .map((tournament) => ({
      id: tournament.id,
      name: tournament.name,
      slug: tournament.slug,
      created_at: tournament.created_at,
      is_featured: tournament.is_featured ?? false,
      max_teams: tournament.max_teams ?? null,
      teamCount: tournament.teams?.length ?? 0,
      validatedTeamCount: tournament.teams?.filter((team) => team.joined_via_oauth).length ?? 0,
    }));

  return sortOpenTournaments(open);
};
