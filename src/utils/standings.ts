import { getAppgPoints, type AppgOutcome } from './appg.js';
import { usesAveragePoints, type PersistedScoringMode } from '../../shared/scoring-profile.js';

export interface Match {
  home_team_id: string | null;
  away_team_id: string | null;
  home_goals: number | null;
  away_goals: number | null;
  match_type?: number | null;
  went_120: boolean;
  completed: boolean;
  total_minutes?: number;
  appg_outcome?: AppgOutcome | null;
  penalty_shootout_home_goals?: number | null;
  penalty_shootout_away_goals?: number | null;
  home_slot_id?: string | null;
  away_slot_id?: string | null;
}

export interface SeasonSlot {
  id: string;
  current_team_id: string | null;
}

export function mapWarningTeamIdsToStandingsIds(
  warningTeamIds: Iterable<string>,
  slots: SeasonSlot[],
): Set<string> {
  const slotIdByTeamId = new Map(
    slots
      .filter((slot): slot is SeasonSlot & { current_team_id: string } => Boolean(slot.current_team_id))
      .map((slot) => [slot.current_team_id, slot.id]),
  );
  return new Set(Array.from(warningTeamIds, (teamId) => slotIdByTeamId.get(teamId) || teamId));
}

export interface SeasonSlotAssignment {
  id?: string;
  tournament_season_slot_id: string;
  team_id: string | null;
  assigned_at: string;
  released_at: string | null;
  team_name: string;
  ht_team_id: number | null;
  manager_name: string | null;
  hattrick_user_id: number | null;
  logo_url: string | null;
}

export const APPG_CLASSIFICATIONS = ['ET3', 'ET2', 'PS1', 'RT0', 'OPW'] as const;
export type AppgClassification = (typeof APPG_CLASSIFICATIONS)[number];

type AppgClassificationCounts = Record<AppgClassification, number>;

function createAppgClassificationCounts(): AppgClassificationCounts {
  return Object.fromEntries(APPG_CLASSIFICATIONS.map((classification) => [classification, 0])) as AppgClassificationCounts;
}

function recordAppgClassification(standing: TeamStanding, outcome: AppgOutcome | null | undefined) {
  if (outcome && outcome !== 'needs_review') {
    standing.appgClassifications[outcome]++;
  }
}

function hasDecisivePenaltyShootout(match: Match) {
  const homeShootoutGoals = match.penalty_shootout_home_goals;
  const awayShootoutGoals = match.penalty_shootout_away_goals;
  return (
    typeof homeShootoutGoals === 'number' &&
    typeof awayShootoutGoals === 'number' &&
    homeShootoutGoals !== awayShootoutGoals
  );
}

function get120MinMatchPoints(match: Match): { home: number; away: number } {
  // Normal Rules friendlies do not offer an extra-time path, so their result
  // never earns 120-minute-mode points.
  if (match.match_type === 4 || match.match_type === 8) return { home: 0, away: 0 };

  if (match.went_120) {
    let home = 2;
    let away = 2;
    if (match.home_goals! > match.away_goals!) home = 3;
    else if (match.away_goals! > match.home_goals!) away = 3;
    else if (hasDecisivePenaltyShootout(match)) {
      if (match.penalty_shootout_home_goals! > match.penalty_shootout_away_goals!) home = 3;
      else away = 3;
    }
    return { home, away };
  }

  // Hattrick match types 5 and 9 are domestic and international Cup Rules friendlies.
  if (match.match_type !== 5 && match.match_type !== 9) return { home: 0, away: 0 };
  if (match.home_goals! === match.away_goals!) return { home: 0, away: 0 };

  return match.home_goals! < match.away_goals!
    ? { home: match.home_goals! === 0 ? 2 : 1, away: 0 }
    : { home: 0, away: match.away_goals! === 0 ? 2 : 1 };
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
  reserve_active?: boolean;
  team_rank?: number | null;
}

export interface TeamStanding {
  teamId: string;
  teamName: string;
  isOpenSpot: boolean;
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
  appgClassifications: AppgClassificationCounts;
  achievements120min: number;
  totalMinutes: number;
  joinedViaOauth: boolean;
  countryName: string | null;
  countryId: number | null;
  leagueId: number | null;
  logoUrl: string | null;
  managerName: string | null;
  teamRank?: number | null;
}

export function getAppgStandingsQuota(standings: Array<Pick<TeamStanding, 'played'>>): number {
  const maxMatchesPlayed = Math.max(0, ...standings.map((standing) => standing.played));
  return maxMatchesPlayed > 0 ? Math.ceil(maxMatchesPlayed * 0.5) : 0;
}

export function meetsAppgStandingsQuota(standing: Pick<TeamStanding, 'played'>, quota: number): boolean {
  return quota === 0 || standing.played >= quota;
}

export function calculateStandings(
  teams: Team[],
  matches: Match[],
  scoringMode: PersistedScoringMode,
): TeamStanding[] {
  const standingsMap: Record<string, TeamStanding> = {};
  const participatingTeamIds = new Set(
    matches.flatMap((match) => [match.home_team_id, match.away_team_id]).filter((teamId): teamId is string => !!teamId),
  );

  // Initialize teams
  teams.filter((team) => !team.reserve_active).forEach((team) => {
    standingsMap[team.id] = {
      teamId: team.id,
      teamName: team.active ? team.name : 'Open spot',
      isOpenSpot: !team.active,
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
      appgClassifications: createAppgClassificationCounts(),
      achievements120min: 0,
      totalMinutes: 0,
      joinedViaOauth: !!team.joined_via_oauth,
      countryName: team.country_name || null,
      countryId: team.country_id || null,
      leagueId: team.league_id || null,
      logoUrl: team.logo_url || null,
      managerName: team.manager_name || null,
      teamRank: team.team_rank ?? null,
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
      if (!((scoringMode === '120m' || scoringMode === '120min') && !m.went_120)) {
        team.gf += teamGoals;
        team.ga += opponentGoals;
      }
      team.gd = team.gf - team.ga;

      if (teamGoals > opponentGoals) {
        team.won++;
        if (scoringMode !== '120m' && scoringMode !== '120min') team.pts += 3;
      } else if (teamGoals < opponentGoals) {
        team.lost++;
      } else {
        team.drawn++;
        if (scoringMode !== '120m' && scoringMode !== '120min') team.pts += 1;
      }

      const appgPoints = getAppgPoints(m);
      if (appgPoints !== null) {
        team.appgPoints += m.home_team_id ? appgPoints.home : appgPoints.away;
      }
      recordAppgClassification(team, m.appg_outcome);

      if (m.went_120) {
        team.achievements120min++;
      }

      team.totalMinutes += m.total_minutes || 90;
      team.appgPlayed++;
      return;
    }

    const home = standingsMap[m.home_team_id];
    const away = standingsMap[m.away_team_id];

    if (!home || !away) return;

    home.played++;
    away.played++;
    const is120MinMode = scoringMode === '120m' || scoringMode === '120min';
    if (!is120MinMode || m.went_120) {
      home.gf += m.home_goals;
      home.ga += m.away_goals;
      away.gf += m.away_goals;
      away.ga += m.home_goals;
    }
    home.gd = home.gf - home.ga;
    away.gd = away.gf - away.ga;

    if (m.home_goals > m.away_goals) {
      home.won++;
      away.lost++;
    } else if (m.home_goals < m.away_goals) {
      away.won++;
      home.lost++;
    } else {
      home.drawn++;
      away.drawn++;
      if (is120MinMode) {
        // 120-minute scoring awards no points for a 90-minute draw. Reaching ET
        // is handled below using the actual match result and shootout result.
      } else if (hasDecisivePenaltyShootout(m)) {
        if (m.penalty_shootout_home_goals! > m.penalty_shootout_away_goals!) {
          home.pts += 2;
          away.pts += 1;
        } else {
          home.pts += 1;
          away.pts += 2;
        }
      } else {
        home.pts += 1;
        away.pts += 1;
      }
    }

    if (is120MinMode) {
      const points = get120MinMatchPoints(m);
      home.pts += points.home;
      away.pts += points.away;
    } else if (m.home_goals > m.away_goals) {
      home.pts += 3;
    } else if (m.home_goals < m.away_goals) {
      away.pts += 3;
    }

    const appgPoints = getAppgPoints(m);
    if (appgPoints !== null) {
      home.appgPoints += appgPoints.home;
      away.appgPoints += appgPoints.away;
    }
    recordAppgClassification(home, m.appg_outcome);
    recordAppgClassification(away, m.appg_outcome);

    if (m.went_120) {
      home.achievements120min++;
      away.achievements120min++;
    }

    home.totalMinutes += m.total_minutes || 90;
    away.totalMinutes += m.total_minutes || 90;
    home.appgPlayed++;
    away.appgPlayed++;
  });

  // Keep inactive teams that participated this season so their stats remain visible.
  const standings = Object.values(standingsMap).filter(
    (standing) => {
      const team = teams.find((candidate) => candidate.id === standing.teamId);
      return Boolean(team && !team.reserve_active && (team.active || participatingTeamIds.has(standing.teamId)));
    },
  );

  // Sorting logic based on mode
  if (scoringMode === '120m' || scoringMode === '120min') {
    return standings.sort((a, b) => {
      // 1. Primary: 120-minute matches achieved (descending)
      if (b.achievements120min !== a.achievements120min) return b.achievements120min - a.achievements120min;

      // 2. Tie settler 1: Regular victory points (descending)
      if (b.pts !== a.pts) return b.pts - a.pts;

      // 3. Tie settler 2: Goal difference (descending – higher is better)
      if (b.gd !== a.gd) return b.gd - a.gd;

      // 4. Tie settler 3: Goals scored (descending)
      if (b.gf !== a.gf) return b.gf - a.gf;

      return a.played - b.played;
    });
  }

  if (usesAveragePoints(scoringMode)) {
    return standings.sort((a, b) => {
      const aAverage = a.appgPlayed ? a.appgPoints / a.appgPlayed : 0;
      const bAverage = b.appgPlayed ? b.appgPoints / b.appgPlayed : 0;
      if (bAverage !== aAverage) return bAverage - aAverage;
      if (b.appgPoints !== a.appgPoints) return b.appgPoints - a.appgPoints;
      if (b.appgPlayed !== a.appgPlayed) return b.appgPlayed - a.appgPlayed;
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

/**
 * Uses physical season slots as the statistics owner when a slot backfill is
 * present. The current slot occupant supplies display identity; completed
 * matches still retain their legacy team IDs for fixture-history rendering.
 */
export function calculateSeasonSlotStandings(
  teams: Team[],
  matches: Match[],
  slots: SeasonSlot[],
  scoringMode: PersistedScoringMode,
  slotAssignments: SeasonSlotAssignment[] = [],
): TeamStanding[] {
  if (slots.length === 0) return calculateStandings(teams, matches, scoringMode);

  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const assignmentsBySlot = new Map<string, SeasonSlotAssignment[]>();
  slotAssignments.forEach((assignment) => {
    const current = assignmentsBySlot.get(assignment.tournament_season_slot_id) || [];
    current.push(assignment);
    assignmentsBySlot.set(assignment.tournament_season_slot_id, current);
  });
  const slotTeams: Team[] = slots.flatMap((slot) => {
    if (slot.current_team_id) {
      const currentTeam = teamsById.get(slot.current_team_id);
      return currentTeam ? [{ ...currentTeam, id: slot.id, active: true, reserve_active: false }] : [];
    }

    // A vacant slot can have several historical occupants. Assignment
    // chronology, rather than arbitrary fixture order, identifies the last
    // team whose results belong to this physical standings position.
    const historicalAssignment = [...(assignmentsBySlot.get(slot.id) || [])].sort((a, b) => {
      const aChronology = new Date(a.released_at || a.assigned_at).getTime();
      const bChronology = new Date(b.released_at || b.assigned_at).getTime();
      if (bChronology !== aChronology) return bChronology - aChronology;
      return (b.assigned_at || '').localeCompare(a.assigned_at || '');
    })[0];
    if (!historicalAssignment) return [];

    const sourceTeam = historicalAssignment.team_id ? teamsById.get(historicalAssignment.team_id) : undefined;
    const historicalTeam: Team = sourceTeam
      ? {
          ...sourceTeam,
          name: historicalAssignment.team_name,
          ht_team_id: historicalAssignment.ht_team_id ?? sourceTeam.ht_team_id,
          manager_name: historicalAssignment.manager_name ?? sourceTeam.manager_name ?? null,
          hattrick_user_id: historicalAssignment.hattrick_user_id ?? sourceTeam.hattrick_user_id,
          logo_url: historicalAssignment.logo_url ?? sourceTeam.logo_url ?? null,
        }
      : {
          id: historicalAssignment.team_id || `historical-${slot.id}`,
          name: historicalAssignment.team_name,
          ht_team_id: historicalAssignment.ht_team_id,
          hattrick_user_id: historicalAssignment.hattrick_user_id,
          active: false,
          replacement_for_team_id: null,
          manager_name: historicalAssignment.manager_name,
          logo_url: historicalAssignment.logo_url,
        };

    return [{ ...historicalTeam, id: slot.id, active: true, reserve_active: false }];
  });
  return calculateStandings(
    slotTeams,
    matches.map((match) => ({
      ...match,
      home_team_id: match.home_slot_id || match.home_team_id,
      away_team_id: match.away_slot_id || match.away_team_id,
    })),
    scoringMode,
  );
}
