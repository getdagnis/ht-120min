export interface Match {
  home_team_id: string;
  away_team_id: string;
  home_goals: number | null;
  away_goals: number | null;
  went_120: boolean;
  completed: boolean;
  total_minutes?: number;
}

export interface Team {
  id: string;
  name: string;
  ht_team_id: number | null;
  active: boolean;
  replacement_for_team_id: string | null;
  joined_via_oauth?: boolean;
  country_name?: string | null;
}

export interface TeamStanding {
  teamId: string;
  teamName: string;
  htTeamId: number | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
  achievements120min: number;
  totalMinutes: number;
  joinedViaOauth: boolean;
  countryName: string | null;
}

export function calculateStandings(
  teams: Team[],
  scoringMode: '120m' | '120min' | 'points',
): TeamStanding[] {
  const standingsMap: Record<string, TeamStanding> = {};

  // Initialize teams (all of them so we can process matches)
  teams.forEach((team) => {
    standingsMap[team.id] = {
      teamId: team.id,
      teamName: team.name,
      htTeamId: team.ht_team_id,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      gf: 0,
      ga: 0,
      gd: 0,
      pts: 0,
      achievements120min: 0,
      totalMinutes: 0,
      joinedViaOauth: !!team.joined_via_oauth,
      countryName: team.country_name || null,
    };
  });

  // Process completed matches ... (no change to this block)

  // Filter out inactive teams from the final list
  const activeTeamIds = new Set(teams.filter(t => t.active).map(t => t.id));
  const standings = Object.values(standingsMap).filter(s => activeTeamIds.has(s.teamId));

  // Sorting logic based on mode
  if (scoringMode === '120m' || scoringMode === '120min') {
    return standings.sort((a, b) => {
      // 1. Primary: 120min achievements
      if (b.achievements120min !== a.achievements120min) return b.achievements120min - a.achievements120min;

      // 2. Tie settler 1: Total minutes achieved
      if (b.totalMinutes !== a.totalMinutes) return b.totalMinutes - a.totalMinutes;

      // 3. Tie settler 2: Smaller goal difference (closer to 0 is better)
      // We use absolute value for smaller GD comparison
      const absGDa = Math.abs(a.gd);
      const absGDb = Math.abs(b.gd);
      if (absGDa !== absGDb) return absGDa - absGDb;

      // 4. Tie settler 3: Number of goals scored
      if (b.gf !== a.gf) return b.gf - a.gf;

      return a.played - b.played;
    });
  }

  // Classic mode
  return standings.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.gd !== a.gd) return b.gd - a.gd;
    return b.gf - a.gf;
  });
}
