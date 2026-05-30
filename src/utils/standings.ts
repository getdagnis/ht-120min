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

    const hg = match.home_goals || 0;
    const ag = match.away_goals || 0;

    if (home) {
      home.played++;
      home.gf += hg;
      home.ga += ag;
      home.gd = home.gf - home.ga;

      if (away) {
        // Normal match with two teams in tournament
        if (hg > ag) {
          home.won++;
          home.pts += 3;
        } else if (hg < ag) {
          home.lost++;
        } else {
          home.drawn++;
          home.pts += 1;
        }
      } else {
        // "Free to choose" match - against external team
        // We still award points/results based on the score
        if (hg > ag) {
          home.won++;
          home.pts += 3;
        } else if (hg < ag) {
          home.lost++;
        } else {
          home.drawn++;
          home.pts += 1;
        }
      }
      
      if (match.went_120) {
        home.achievements120min++;
      }
    }

    if (away) {
      away.played++;
      away.gf += ag;
      away.ga += hg;
      away.gd = away.gf - away.ga;

      if (home) {
        // Normal match (already handled home part)
        if (ag > hg) {
          away.won++;
          away.pts += 3;
        } else if (ag < hg) {
          away.lost++;
        } else {
          away.drawn++;
          away.pts += 1;
        }
      } else {
        // "Free to choose" match (away team is in tournament, home is external)
        if (ag > hg) {
          away.won++;
          away.pts += 3;
        } else if (ag < hg) {
          away.lost++;
        } else {
          away.drawn++;
          away.pts += 1;
        }
      }

      if (match.went_120) {
        away.achievements120min++;
      }
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
