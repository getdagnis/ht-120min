import { supabase } from '../lib/supabase';

export interface OpenTournamentSummary {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  teamCount: number;
  team_limit?: number | null;
  validatedTeamCount: number;
}

type OpenTournamentRow = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  team_limit?: number | null;
  rounds: { id: string }[] | null;
  teams: { id: string; joined_via_oauth: boolean }[] | null;
};

export const sortOpenTournaments = <T extends { teamCount: number; team_limit?: number | null }>(
  tournaments: T[],
): T[] =>
  [...tournaments].sort((a, b) => {
    const scoreA = a.team_limit && a.team_limit > 0 ? a.teamCount / a.team_limit : a.teamCount;
    const scoreB = b.team_limit && b.team_limit > 0 ? b.teamCount / b.team_limit : b.teamCount;
    return scoreB - scoreA;
  });

export const formatOpenTournamentMeta = (tournament: OpenTournamentSummary) => {
  const teamsLabel =
    tournament.team_limit && tournament.team_limit > 0
      ? `${tournament.teamCount}/${tournament.team_limit} teams`
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
      rounds ( id ),
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
      team_limit: tournament.team_limit ?? null,
      teamCount: tournament.teams?.length ?? 0,
      validatedTeamCount: tournament.teams?.filter((team) => team.joined_via_oauth).length ?? 0,
    }));

  return sortOpenTournaments(open);
};
