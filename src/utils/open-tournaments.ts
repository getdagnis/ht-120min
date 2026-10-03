import { supabase } from '../lib/supabase';
import { sortOpenTournaments } from './tournament-sorting.js';
export { sortOpenTournaments } from './tournament-sorting.js';
import { isCurrentParticipantTeam } from './team-state.js';

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
  is_test?: boolean | null;
  status?: string | null;
  is_archived?: boolean | null;
  max_teams?: number | null;
  season: number | null;
  rounds: { id: string; season_number: number | null }[] | null;
  teams: { id: string; joined_via_oauth: boolean; active?: boolean | null; reserve_active?: boolean | null; is_placeholder?: boolean | null }[] | null;
};

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
      is_test,
      status,
      is_archived,
      season,
      rounds ( id, season_number ),
      max_teams,
      teams ( id, joined_via_oauth, active, reserve_active, is_placeholder )
    `,
    )
    .eq('is_private', false);

  if (error) throw error;
  if (!data) return [];

  const open = (data as OpenTournamentRow[])
    .filter(
      (tournament) =>
        !tournament.is_test &&
        tournament.status !== 'stopped' &&
        tournament.status !== 'finished' &&
        tournament.status !== 'archived' &&
        !tournament.is_archived &&
        !(tournament.rounds || []).some(
          (round) => Number(round.season_number ?? 1) === Number(tournament.season ?? 1),
        ),
    )
    .map((tournament) => ({
      id: tournament.id,
      name: tournament.name,
      slug: tournament.slug,
      created_at: tournament.created_at,
      is_featured: tournament.is_featured ?? false,
      max_teams: tournament.max_teams ?? null,
      teamCount: tournament.teams?.filter(isCurrentParticipantTeam).length ?? 0,
      validatedTeamCount: tournament.teams?.filter((team) => isCurrentParticipantTeam(team) && team.joined_via_oauth).length ?? 0,
    }));

  return sortOpenTournaments(open);
};
