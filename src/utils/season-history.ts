import { calculateStandings, type Team, type Match, type TeamStanding } from './standings';

export interface SeasonHistoryMatch extends Match {
  home_yellow_cards?: number | null;
  home_red_cards?: number | null;
  home_injuries?: number | null;
  away_yellow_cards?: number | null;
  away_red_cards?: number | null;
  away_injuries?: number | null;
}

export interface SeasonTeamStat {
  teamId: string;
  teamName: string;
  htTeamId: number | null;
  yellowCards: number;
  redCards: number;
  injuries: number;
}

export interface SeasonHistorySnapshot {
  standings: TeamStanding[];
  winner: TeamStanding | null;
  teamStats: SeasonTeamStat[];
  summary: {
    teams: number;
    matches: number;
    completedMatches: number;
    goals: number;
    achievements120min: number;
    yellowCards: number;
    redCards: number;
    injuries: number;
  };
  generatedAt: string;
}

export function buildSeasonHistorySnapshot(
  teams: Team[],
  matches: SeasonHistoryMatch[],
  scoringMode: '120m' | '120min' | 'points',
): SeasonHistorySnapshot {
  const standings = calculateStandings(teams, matches, scoringMode);
  const activeTeams = teams.filter((team) => team.active);
  const activeTeamMap = new Map(activeTeams.map((team) => [team.id, team]));
  const teamStatsMap = new Map<string, SeasonTeamStat>();

  activeTeams.forEach((team) => {
    teamStatsMap.set(team.id, {
      teamId: team.id,
      teamName: team.name,
      htTeamId: team.ht_team_id,
      yellowCards: 0,
      redCards: 0,
      injuries: 0,
    });
  });

  matches.forEach((match) => {
    if (match.home_team_id && teamStatsMap.has(match.home_team_id)) {
      const stat = teamStatsMap.get(match.home_team_id)!;
      stat.yellowCards += match.home_yellow_cards || 0;
      stat.redCards += match.home_red_cards || 0;
      stat.injuries += match.home_injuries || 0;
    }
    if (match.away_team_id && teamStatsMap.has(match.away_team_id)) {
      const stat = teamStatsMap.get(match.away_team_id)!;
      stat.yellowCards += match.away_yellow_cards || 0;
      stat.redCards += match.away_red_cards || 0;
      stat.injuries += match.away_injuries || 0;
    }
  });

  const completedMatches = matches.filter(
    (match) => match.completed && match.home_goals !== null && match.away_goals !== null,
  );
  const teamStats = Array.from(teamStatsMap.values()).sort((a, b) => {
    const aIndex = standings.findIndex((standing) => standing.teamId === a.teamId);
    const bIndex = standings.findIndex((standing) => standing.teamId === b.teamId);
    return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
  });

  return {
    standings,
    winner: standings[0] || null,
    teamStats,
    summary: {
      teams: activeTeamMap.size,
      matches: matches.length,
      completedMatches: completedMatches.length,
      goals: completedMatches.reduce((total, match) => total + (match.home_goals || 0) + (match.away_goals || 0), 0),
      achievements120min: completedMatches.filter((match) => match.went_120).length,
      yellowCards: teamStats.reduce((total, stat) => total + stat.yellowCards, 0),
      redCards: teamStats.reduce((total, stat) => total + stat.redCards, 0),
      injuries: teamStats.reduce((total, stat) => total + stat.injuries, 0),
    },
    generatedAt: new Date().toISOString(),
  };
}
