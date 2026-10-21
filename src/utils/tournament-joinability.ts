import { isCurrentParticipantTeam } from './team-state.js';

interface TournamentJoinabilityTeam {
  active: boolean;
  reserve_active?: boolean | null;
  is_placeholder?: boolean | null;
}

interface TournamentJoinabilityInput {
  hasJoined: boolean;
  isGenerated: boolean;
  maxTeams: number | null | undefined;
  teams: TournamentJoinabilityTeam[];
  status?: string | null;
  registrationClosedAt?: string | null;
  nextRegularRoundAvailable?: boolean;
  pendingTeamsCount?: number;
  scheduleMode?: string | null;
}

interface TournamentRegistrationStateInput {
  isGenerated: boolean;
  status?: string | null;
  registrationClosedAt?: string | null;
  nextRegularRoundAvailable?: boolean;
}

interface AdditionalTeamJoinInput {
  isLoggedIn: boolean;
  isRegistrationOpen: boolean;
  maxTeams: number | null | undefined;
  activeTeamsCount: number;
  pendingTeamsCount?: number;
}

export function isTournamentRegistrationOpen({
  isGenerated,
  status,
  registrationClosedAt,
  nextRegularRoundAvailable = false,
}: TournamentRegistrationStateInput) {
  return (
    !registrationClosedAt &&
    (isGenerated
      ? status === 'active' && nextRegularRoundAvailable
      : ['planning', 'recruiting', 'open', 'waiting'].includes(status ?? ''))
  );
}

export function canViewerJoinTournament({
  hasJoined,
  isGenerated,
  maxTeams,
  teams,
  status,
  registrationClosedAt,
  nextRegularRoundAvailable = false,
  pendingTeamsCount = 0,
  scheduleMode,
}: TournamentJoinabilityInput) {
  if (hasJoined) return false;
  if (status === 'stopped' || status === 'finished' || status === 'archived') return false;
  // Registration closure is authoritative for every tournament shape. A
  // generated season may still have a replacement/odd-team vacancy, but that
  // vacancy is organizer-managed once registration has been closed.
  if (registrationClosedAt) return false;
  // An active tournament without current-season fixtures is an auto-started, roster-locked season.
  if (status === 'active' && !isGenerated) return false;

  const activeRealTeams = teams.filter(isCurrentParticipantTeam);
  if (isGenerated && scheduleMode === 'length') {
    return nextRegularRoundAvailable && status === 'active' &&
      (!maxTeams || activeRealTeams.length + pendingTeamsCount < maxTeams);
  }
  const hasInactiveRealSpot = teams.some(
    (team) => !team.active && !team.reserve_active && !team.is_placeholder,
  );
  const hasOddGeneratedByeSpot = isGenerated && activeRealTeams.length % 2 !== 0;

  if (isGenerated) {
    return hasInactiveRealSpot || hasOddGeneratedByeSpot;
  }

  return !maxTeams || activeRealTeams.length < maxTeams;
}

export function canViewerJoinAnotherTeam({
  isLoggedIn,
  isRegistrationOpen,
  maxTeams,
  activeTeamsCount,
  pendingTeamsCount = 0,
}: AdditionalTeamJoinInput) {
  return isLoggedIn && isRegistrationOpen && (!maxTeams || activeTeamsCount + pendingTeamsCount < maxTeams);
}

export function canViewerJoinReserve({
  allowReserveRegistration,
  canJoinDirectly,
  status,
  isTest,
  isSandbox,
}: {
  allowReserveRegistration: boolean;
  canJoinDirectly: boolean;
  status?: string | null;
  isTest: boolean;
  isSandbox: boolean;
}) {
  return allowReserveRegistration && !canJoinDirectly && !isTest && !isSandbox &&
    !['stopped', 'finished', 'archived'].includes(status ?? '');
}
