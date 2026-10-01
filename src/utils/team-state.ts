export interface CurrentParticipantTeamState {
  active?: boolean | null;
  reserve_active?: boolean | null;
  is_placeholder?: boolean | null;
}

export function isCurrentParticipantTeam(team: CurrentParticipantTeamState) {
  return team.active === true && team.reserve_active !== true && team.is_placeholder !== true;
}
