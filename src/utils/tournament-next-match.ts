import { getMatchDateForRound } from './match-schedule';

interface TournamentWarning {
  round_id: string;
  team_id: string;
}

interface TournamentNextMatchRound {
  id: string;
  created_at: string;
  round_number: number;
  matches:
    | {
        id: string;
        completed: boolean;
        status?: 'not_arranged' | 'arranged' | 'ongoing' | 'misarranged' | 'finished';
        home_team_id: string | null;
        away_team_id: string | null;
        scheduled_for?: string | null;
        home_team?: {
          country_name?: string | null;
        } | null;
      }[]
    | null;
}

export function getTournamentNextMatchDate(
  rounds: TournamentNextMatchRound[] | null | undefined,
  warnings: TournamentWarning[] | null | undefined,
): Date | null {
  if (!rounds || rounds.length === 0) return null;

  const candidateDates = rounds.flatMap((round) =>
    (round.matches ?? [])
      .filter((match) => !match.completed && match.status !== 'misarranged')
      .filter(
        (match) =>
          !warnings?.some(
            (warning) =>
              warning.round_id === round.id &&
              (warning.team_id === match.home_team_id || warning.team_id === match.away_team_id),
          ),
      )
      .map((match) => getMatchDateForRound(round, match, match.home_team?.country_name ?? undefined)),
  );

  if (candidateDates.length === 0) return null;

  return candidateDates.sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
}
