export const FORGE_LEAGUE_TEAM_LIMIT = 1200;

/** Private Forge list snapshots, never tournament registrations or authenticated profiles. */
export interface ForgeLeagueOption {
  leagueId: number;
  name: string;
  activeTeams: number;
  fetched?: boolean;
}

export interface ForgeLeagueTeam {
  teamId: number;
  teamName: string;
  managerId: number;
  managerName: string;
  countryId: number | null;
  booked: boolean | null;
  inCup: boolean | null;
  checkedAt: string | null;
  error: string | null;
}

export interface ForgeLeagueJob {
  mode: 'populate' | 'availability' | 'precise';
  cursor: number;
  total: number;
  // Temporary discovery work queue; removed when population completes.
  seriesIds: number[];
  seriesCursor: number;
  candidates: number[];
}

export interface ForgeLeagueSnapshot {
  teams: ForgeLeagueTeam[];
  populatedAt: string | null;
  availabilityAt: string | null;
  populationComplete: boolean;
  job: ForgeLeagueJob | null;
  availabilityMethod?: 'teamdetails' | 'matches';
  saveId?: string;
}

export function leagueTeamStatus(team: ForgeLeagueTeam): 'Available' | 'Booked' | 'In cup' | 'Unknown' {
  if (team.inCup === true) return 'In cup';
  if (team.booked === true) return 'Booked';
  return team.booked === false && team.inCup === false ? 'Available' : 'Unknown';
}
