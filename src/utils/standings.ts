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
}

export interface TeamStanding {
  teamId: string;
  teamName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
  achievements120m: number;
}

export function calculateStandings(teams: Team[], matches: Match[], scoringMode: '120m' | 'points'): TeamStanding[] {
  const standingsMap: Record<string, TeamStanding> = {};

  teams.forEach((team) => {
    standingsMap[team.id] = {
      teamId: team.id,
      teamName: team.name,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      gf: 0,
      ga: 0,
      gd: 0,
      pts: 0,
      achievements120m: 0,
    };
  });

  matches.forEach((match) => {
    if (!match.completed || match.home_goals === null || match.away_goals === null) return;

    const home = standingsMap[match.home_team_id];
    const away = standingsMap[match.away_team_id];

    if (!home || !away) return;

    home.played++;
    away.played++;

    home.gf += match.home_goals;
    home.ga += match.away_goals;
    away.gf += match.away_goals;
    away.ga += match.home_goals;

    if (match.home_goals > match.away_goals) {
      home.won++;
      home.pts += 3;
      away.lost++;
    } else if (match.home_goals < match.away_goals) {
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
      home.achievements120m++;
      away.achievements120m++;
    }

    home.gd = home.gf - home.ga;
    away.gd = away.gf - away.ga;
  });

  const standings = Object.values(standingsMap);

  if (scoringMode === '120m') {
    return standings.sort((a, b) => {
      // Primary: 120m achievements
      if (b.achievements120m !== a.achievements120m) {
        return b.achievements120m - a.achievements120m;
      }
      // Secondary: Points (3/1/0)
      if (b.pts !== a.pts) {
        return b.pts - a.pts;
      }
      // Tertiary: Goal Difference
      if (b.gd !== a.gd) {
        return b.gd - a.gd;
      }
      // Quaternary: Goals For
      if (b.gf !== a.gf) {
        return b.gf - a.gf;
      }
      // Final: Matches played (fewer is better if tied on everything else)
      return a.played - b.played;
    });
  }

  return standings.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.gd !== a.gd) return b.gd - a.gd;
    return b.gf - a.gf;
  });
}
