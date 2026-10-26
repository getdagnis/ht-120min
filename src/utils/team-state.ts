export const LOBBY_STATUSES = ['hanging_around', 'ready_to_join', 'open_to_invitations'] as const;
export type LobbyStatus = typeof LOBBY_STATUSES[number];

export interface CurrentParticipantTeamState {
  lobby_status?: LobbyStatus | null;
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

export function getLobbyStatus(team: CurrentParticipantTeamState): LobbyStatus {
  return team.lobby_status ?? (team.actively_waiting ? 'ready_to_join' : 'hanging_around');
}
