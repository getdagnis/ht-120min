import { getAppgPoints, type AppgOutcome } from './appg';

export interface Match {
  home_team_id: string | null;
  away_team_id: string | null;
  home_goals: number | null;
  away_goals: number | null;
  went_120: boolean;
  completed: boolean;
  total_minutes?: number;
  appg_outcome?: AppgOutcome | null;
  penalty_shootout_home_goals?: number | null;
  penalty_shootout_away_goals?: number | null;
}

export interface Team {
  id: string;
  name: string;
  ht_team_id: number | null;
  hattrick_user_id: number | null;
  active: boolean;
  replacement_for_team_id: string | null;
  joined_via_oauth?: boolean;
  country_name?: string | null;
  country_id?: number | null;
  league_id?: number | null;
  logo_url?: string | null;
  manager_name?: string | null;
  is_placeholder?: boolean;
}

export interface TeamStanding {
  teamId: string;
  teamName: string;
  htTeamId: number | null;
  hattrickUserId: number | null;
  lastSeenAt: string | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
  appgPoints: number;
  appgPlayed: number;
  achievements120min: number;
  totalMinutes: number;
  joinedViaOauth: boolean;
  countryName: string | null;
  countryId: number | null;
  leagueId: number | null;
  logoUrl: string | null;
  managerName: string | null;
}

export function calculateStandings(
  teams: Team[],
  matches: Match[],
  scoringMode: '120m' | '120min' | 'points' | 'appg',
): TeamStanding[] {
  const standingsMap: Record<string, TeamStanding> = {};

  // Initialize teams
  teams.forEach((team) => {
    standingsMap[team.id] = {
      teamId: team.id,
      teamName: team.name,
      htTeamId: team.ht_team_id,
      hattrickUserId: team.hattrick_user_id,
      lastSeenAt: null,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      gf: 0,
      ga: 0,
      gd: 0,
      pts: 0,
      appgPoints: 0,
      appgPlayed: 0,
      achievements120min: 0,
      totalMinutes: 0,
      joinedViaOauth: !!team.joined_via_oauth,
      countryName: team.country_name || null,
      countryId: team.country_id || null,
      leagueId: team.league_id || null,
      logoUrl: team.logo_url || null,
      managerName: team.manager_name || null,
    };
  });

  // Process completed matches
  matches.forEach((m) => {
    if (!m.completed || m.home_goals === null || m.away_goals === null) return;

    if (!m.home_team_id || !m.away_team_id) {
      const teamId = m.home_team_id || m.away_team_id;
      if (!teamId) return;

      const team = standingsMap[teamId];
      if (!team) return;

      const teamGoals = m.home_team_id ? m.home_goals : m.away_goals;
      const opponentGoals = m.home_team_id ? m.away_goals : m.home_goals;

      team.played++;
      team.gf += teamGoals;
      team.ga += opponentGoals;
      team.gd = team.gf - team.ga;

      if (teamGoals > opponentGoals) {
        team.won++;
        team.pts += 3;
      } else if (teamGoals < opponentGoals) {
        team.lost++;
      } else {
        team.drawn++;
        team.pts += 1;
      }

      const appgPoints = getAppgPoints(m);
      if (appgPoints !== null) {
        team.appgPoints += m.home_team_id ? appgPoints.home : appgPoints.away;
        team.appgPlayed++;
      }

      if (m.went_120) {
        team.achievements120min++;
      }

      team.totalMinutes += m.total_minutes || 90;
      return;
    }

    const home = standingsMap[m.home_team_id];
    const away = standingsMap[m.away_team_id];

    if (!home || !away) return;

    home.played++;
    away.played++;
    home.gf += m.home_goals;
    home.ga += m.away_goals;
    away.gf += m.away_goals;
    away.ga += m.home_goals;
    home.gd = home.gf - home.ga;
    away.gd = away.gf - away.ga;

    if (m.home_goals > m.away_goals) {
      home.won++;
      home.pts += 3;
      away.lost++;
    } else if (m.home_goals < m.away_goals) {
      away.won++;
      away.pts += 3;
      home.lost++;
    } else {
      home.drawn++;
      away.drawn++;
      home.pts += 1;
      away.pts += 1;
    }

    const appgPoints = getAppgPoints(m);
    if (appgPoints !== null) {
      home.appgPoints += appgPoints.home;
      away.appgPoints += appgPoints.away;
      home.appgPlayed++;
      away.appgPlayed++;
    }

    if (m.went_120) {
      home.achievements120min++;
      away.achievements120min++;
    }

    home.totalMinutes += m.total_minutes || 90;
    away.totalMinutes += m.total_minutes || 90;
  });

  // Filter out inactive teams from the final list
  const activeTeamIds = new Set(teams.filter((t) => t.active).map((t) => t.id));
  const standings = Object.values(standingsMap).filter((s) => activeTeamIds.has(s.teamId));

  // Sorting logic based on mode
  if (scoringMode === '120m' || scoringMode === '120min') {
    return standings.sort((a, b) => {
      // 1. Primary: 120-minute matches achieved (descending)
      if (b.achievements120min !== a.achievements120min) return b.achievements120min - a.achievements120min;

      // 2. Tie settler 1: Goal difference (descending – higher is better)
      if (b.gd !== a.gd) return b.gd - a.gd;

      // 3. Tie settler 2: Goals scored (descending)
      if (b.gf !== a.gf) return b.gf - a.gf;

      return a.played - b.played;
    });
  }

  if (scoringMode === 'appg') {
    return standings.sort((a, b) => {
      const aAverage = a.appgPlayed ? a.appgPoints / a.appgPlayed : 0;
      const bAverage = b.appgPlayed ? b.appgPoints / b.appgPlayed : 0;
      if (bAverage !== aAverage) return bAverage - aAverage;
      if (b.gd !== a.gd) return b.gd - a.gd;
      if (b.gf !== a.gf) return b.gf - a.gf;
      return a.teamName.localeCompare(b.teamName);
    });
  }

  // Classic mode
  return standings.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.gd !== a.gd) return b.gd - a.gd;
    return b.gf - a.gf;
  });
}
