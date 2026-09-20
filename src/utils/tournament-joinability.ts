interface TournamentJoinabilityTeam {
  active: boolean;
  is_placeholder?: boolean | null;
}

interface TournamentJoinabilityInput {
  hasJoined: boolean;
  isGenerated: boolean;
  maxTeams: number | null | undefined;
  teams: TournamentJoinabilityTeam[];
  status?: string | null;
  registrationClosedAt?: string | null;
}

interface TournamentRegistrationStateInput {
  isGenerated: boolean;
  status?: string | null;
  registrationClosedAt?: string | null;
}

interface AdditionalTeamJoinInput {
  isLoggedIn: boolean;
  isRegistrationOpen: boolean;
  maxTeams: number | null | undefined;
  activeTeamsCount: number;
}

export function isTournamentRegistrationOpen({
  isGenerated,
  status,
  registrationClosedAt,
}: TournamentRegistrationStateInput) {
  return (
    !isGenerated &&
    !registrationClosedAt &&
    (status === 'open' || status === 'waiting')
  );
}

export function canViewerJoinTournament({
  hasJoined,
  isGenerated,
  maxTeams,
  teams,
  status,
  registrationClosedAt,
}: TournamentJoinabilityInput) {
  if (hasJoined) return false;
  if (status === 'stopped' || status === 'finished' || status === 'archived') return false;
  // Registration closure is authoritative for every tournament shape. A
  // generated season may still have a replacement/odd-team vacancy, but that
  // vacancy is organizer-managed once registration has been closed.
  if (registrationClosedAt) return false;
  // An active tournament without current-season fixtures is an auto-started, roster-locked season.
  if (status === 'active' && !isGenerated) return false;

  const activeRealTeams = teams.filter((team) => team.active && !team.is_placeholder);
  const hasInactiveRealSpot = teams.some((team) => !team.active && !team.is_placeholder);
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
}: AdditionalTeamJoinInput) {
  return isLoggedIn && isRegistrationOpen && (!maxTeams || activeTeamsCount < maxTeams);
}
