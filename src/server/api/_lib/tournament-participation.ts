export interface TournamentParticipationTeam {
  active: boolean | null;
  hattrickUserId: number | null;
  reapplySeasonNumber: number | null;
}

export interface TournamentParticipationValidationError {
  status: 403 | 409;
  error: string;
}

export function validateTournamentLeave(input: {
  viewerUserId: number;
  tournamentSeason: number;
  registrationOpen: boolean;
  team: TournamentParticipationTeam;
}): TournamentParticipationValidationError | null {
  if (input.team.hattrickUserId !== input.viewerUserId) {
    return { status: 403, error: 'Only this team owner can leave the tournament.' };
  }
  if (!input.registrationOpen) {
    return { status: 409, error: 'Teams can leave only while tournament registration is open.' };
  }
  if (!input.team.active && input.team.reapplySeasonNumber !== input.tournamentSeason) {
    return { status: 409, error: 'This team is not participating or awaiting re-application.' };
  }
  return null;
}
