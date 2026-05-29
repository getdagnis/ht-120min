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
  ht_team_id?: number | string | null;
  active: boolean;
  replacement_for_team_id?: string | null;
}

export interface TeamStanding {
  teamId: string;
  teamName: string;
  htTeamId: string | null;
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
  const teamToRootMap: Record<string, string> = {};

  // 1. Build a map from every team in a chain to its "root" team ID
  // And find the "active" team for each chain to use its name/ID for display
  const rootToActiveTeam: Record<string, Team> = {};

  teams.forEach(team => {
    let rootId = team.id;
    const chain = [team.id];
    let current = team;
    
    // Trace back to the absolute root of the chain
    while (current.replacement_for_team_id) {
      const parent = teams.find(t => t.id === current.replacement_for_team_id);
      if (!parent || chain.includes(parent.id)) break; // Prevent cycles
      rootId = parent.id;
      chain.push(parent.id);
      current = parent;
    }
    
    teamToRootMap[team.id] = rootId;

    // Keep track of which team is currently active for this root
    if (team.active || !rootToActiveTeam[rootId]) {
      rootToActiveTeam[rootId] = team;
    }
  });

  // 2. Initialize standings for each root team
  Object.keys(rootToActiveTeam).forEach((rootId) => {
    const activeTeam = rootToActiveTeam[rootId];
    standingsMap[rootId] = {
      teamId: activeTeam.id,
      teamName: activeTeam.name,
      htTeamId: activeTeam.ht_team_id ? String(activeTeam.ht_team_id) : null,
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

  // 3. Process matches, attributing them to the root of the team's chain
  matches.forEach((match) => {
    if (!match.completed || match.home_goals === null || match.away_goals === null) return;

    const homeRootId = teamToRootMap[match.home_team_id];
    const awayRootId = teamToRootMap[match.away_team_id];

    const home = standingsMap[homeRootId];
    const away = standingsMap[awayRootId];

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
      if (b.achievements120m !== a.achievements120m) return b.achievements120m - a.achievements120m;
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (b.gd !== a.gd) return b.gd - a.gd;
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
