interface TournamentJoinabilityTeam {
  active: boolean;
  is_placeholder?: boolean | null;
}

interface TournamentJoinabilityInput {
  hasJoined: boolean;
  isGenerated: boolean;
  maxTeams: number | null | undefined;
  teams: TournamentJoinabilityTeam[];
}

export function canViewerJoinTournament({ hasJoined, isGenerated, maxTeams, teams }: TournamentJoinabilityInput) {
  if (hasJoined) return false;

  const activeRealTeams = teams.filter((team) => team.active && !team.is_placeholder);
  const hasInactiveRealSpot = teams.some((team) => !team.active && !team.is_placeholder);
  const hasOddGeneratedByeSpot = isGenerated && activeRealTeams.length % 2 !== 0;

  if (isGenerated) {
    return hasInactiveRealSpot || hasOddGeneratedByeSpot;
  }

  return !maxTeams || activeRealTeams.length < maxTeams;
}

