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
}

export function canViewerJoinTournament({ hasJoined, isGenerated, maxTeams, teams, status }: TournamentJoinabilityInput) {
  if (hasJoined) return false;
  if (status === 'stopped' || status === 'finished' || status === 'archived') return false;
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
