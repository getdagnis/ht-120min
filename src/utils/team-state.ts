export interface CurrentParticipantTeamState {
  active?: boolean | null;
  reserve_active?: boolean | null;
  actively_waiting?: boolean | null;
  is_placeholder?: boolean | null;
}

export function isCurrentParticipantTeam(team: CurrentParticipantTeamState) {
  return team.active === true && team.reserve_active !== true && team.is_placeholder !== true;
}

export function isWaitingTeam(team: CurrentParticipantTeamState) {
  return team.active !== true && team.reserve_active === true && team.is_placeholder !== true;
}

export function isPastTeam(team: CurrentParticipantTeamState) {
  return team.active !== true && team.reserve_active !== true && team.is_placeholder !== true;
}
