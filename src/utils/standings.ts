export interface Match {
  home_team_id: string;
  away_team_id: string;
  home_goals: number | null;
  away_goals: number | null;
  went_120: boolean;
  completed: boolean;
}

export interface Team {
  id: string;
  name: string;
  ht_team_id: number | null;
  active: boolean;
  replacement_for_team_id: string | null;
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
}

export function calculateStandings(teams: Team[], matches: Match[], scoringMode: '120m' | '120min' | 'points'): TeamStanding[] {
  const standingsMap: Record<string, TeamStanding> = {};

  // Initialize all teams
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
    };
  });

  // Process completed matches
  matches.forEach((match) => {
    if (!match.completed) return;

    const home = standingsMap[match.home_team_id];
    const away = standingsMap[match.away_team_id];

    // If one of the teams is no longer in the map (shouldn't happen with valid data)
    if (!home || !away) return;

    const hg = match.home_goals || 0;
    const ag = match.away_goals || 0;

    home.played++;
    away.played++;
    home.gf += hg;
    home.ga += ag;
    away.gf += ag;
    away.ga += hg;
    home.gd = home.gf - home.ga;
    away.gd = away.gf - away.ga;

    if (hg > ag) {
      home.won++;
      home.pts += 3;
      away.lost++;
    } else if (hg < ag) {
      away.won++;
      away.pts += 3;
      home.lost++;
    } else {
      home.drawn++;
      home.pts += 1;
      away.drawn++;
      away.pts += 1;
    }

    if (match.went_120) {
      home.achievements120min++;
      away.achievements120min++;
    }
  });

  const standings = Object.values(standingsMap);

  // Sorting logic based on mode
  if (scoringMode === '120m' || scoringMode === '120min') {
    return standings.sort((a, b) => {
      // Primary: 120min achievements
      if (b.achievements120min !== a.achievements120min) return b.achievements120min - a.achievements120min;
      // Secondary: Points
      if (b.pts !== a.pts) return b.pts - a.pts;
      // Tertiary: GD
      if (b.gd !== a.gd) return b.gd - a.gd;
      // Quaternary: GF
      if (b.gf !== a.gf) return b.gf - a.gf;
      return a.played - b.played;
    });
  }

  return standings.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.gd !== a.gd) return b.gd - a.gd;
    return b.gf - a.gf;
  });
}
