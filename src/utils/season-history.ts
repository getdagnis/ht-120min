import {
  calculateStandings,
  getAppgStandingsQuota,
  meetsAppgStandingsQuota,
  type Match,
  type Team,
  type TeamStanding,
} from './standings';
import type { MatchEventDetails, MatchSideEventDetails } from '../../shared/match-events';
import { isAppg120ScoringMode, usesAveragePoints } from '../../shared/scoring-profile';

export type SeasonAwardKey =
  | 'champions'
  | 'most-120-matches'
  | 'top-scorers'
  | 'best-goal-difference'
  | 'least-goals-allowed'
  | 'fair-play'
  | 'most-cards'
  | 'most-injuries'
  | 'most-matches-played'
  | 'every-fixture-completed'
  | 'total-minute-specialists';

export interface SeasonHistoryMatch extends Match {
  id?: string;
  roundNumber?: number;
  scheduledFor?: string | null;
  homeTeamName?: string | null;
  awayTeamName?: string | null;
  home_yellow_cards?: number | null;
  home_red_cards?: number | null;
  home_injuries?: number | null;
  away_yellow_cards?: number | null;
  away_red_cards?: number | null;
  away_injuries?: number | null;
  match_event_details?: MatchEventDetails | null;
}

export interface SeasonTeamStat {
  teamId: string;
  teamName: string;
  htTeamId: number | null;
  yellowCards: number;
  redCards: number;
  injuries: number;
  injuryWeeks?: number;
}

export interface SeasonParticipant {
  teamId: string;
  teamName: string;
  htTeamId: number | null;
  hattrickUserId: number | null;
  managerName: string | null;
  logoUrl: string | null;
  countryName: string | null;
  countryId: number | null;
  leagueId: number | null;
  finalPosition: number | null;
}

export interface SeasonAward {
  key: SeasonAwardKey;
  recipientTeamIds: string[];
  value: number | null;
  recipientValues?: Record<string, number>;
  recipientSecondaryValues?: Record<string, number>;
}

export interface SeasonMatchSnapshot {
  id: string;
  roundNumber: number | null;
  scheduledFor: string | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeTeamName: string;
  awayTeamName: string;
  homeGoals: number;
  awayGoals: number;
  totalMinutes: number;
  went120: boolean;
  yellowCards: number;
  redCards: number;
  injuries: number;
}

export interface SeasonHistoryRecords {
  most120TeamIds: string[];
  most120Value: number;
  highestScoringMatchId: string | null;
  closestFinish: {
    leaderTeamId: string;
    runnerUpTeamId: string;
    margin: number;
    metric: '120m' | 'points';
  } | null;
  longestMatchId: string | null;
  memorableMatchId: string | null;
}

interface SeasonHistorySummary {
  teams: number;
  matches: number;
  completedMatches: number;
  goals: number;
  achievements120min: number;
  yellowCards: number;
  redCards: number;
  injuries: number;
}

export interface SeasonHistorySnapshotV1 {
  standings: TeamStanding[];
  winner: TeamStanding | null;
  teamStats: SeasonTeamStat[];
  summary: SeasonHistorySummary;
  generatedAt: string;
}

export interface SeasonHistorySnapshotV2 extends SeasonHistorySnapshotV1 {
  version: 2;
  participants: SeasonParticipant[];
  awards: SeasonAward[];
  matches: SeasonMatchSnapshot[];
  records: SeasonHistoryRecords;
  story: string;
}

export type SeasonHistorySnapshot = SeasonHistorySnapshotV1 | SeasonHistorySnapshotV2;

export function resolveSeasonFinishedAt(matches: SeasonHistoryMatch[], fallback: string) {
  const latestCompletedFixture = matches.reduce<Date | null>((latest, match) => {
    if (!match.completed || !match.scheduledFor) return latest;
    const date = new Date(match.scheduledFor);
    if (Number.isNaN(date.getTime())) return latest;
    return !latest || date.getTime() > latest.getTime() ? date : latest;
  }, null);

  return latestCompletedFixture?.toISOString() || fallback;
}

export function resolveSeasonStartedAt(matches: SeasonHistoryMatch[], fallback: string | null) {
  const earliestFixture = matches.reduce<Date | null>((earliest, match) => {
    if (!match.scheduledFor) return earliest;
    const date = new Date(match.scheduledFor);
    if (Number.isNaN(date.getTime())) return earliest;
    return !earliest || date.getTime() < earliest.getTime() ? date : earliest;
  }, null);

  return earliestFixture?.toISOString() || fallback;
}

const getWinningTeamIds = (items: Array<{ teamId: string; value: number }>, mode: 'max' | 'min') => {
  if (items.length === 0) return { teamIds: [] as string[], value: null as number | null };
  const values = items.map((item) => item.value);
  const winningValue = mode === 'max' ? Math.max(...values) : Math.min(...values);
  return {
    teamIds: items.filter((item) => item.value === winningValue).map((item) => item.teamId),
    value: winningValue,
  };
};

const getInjuryWeeks = (side?: MatchSideEventDetails | null) =>
  (side?.injuries || []).reduce((total, injury) => total + (injury.weeks || 0), 0);

function getHistoryEligibleStandings(standings: TeamStanding[], scoringMode: '120m' | '120min' | 'points' | 'appg') {
  if (!isAppg120ScoringMode(scoringMode)) return standings;
  const quota = getAppgStandingsQuota(standings);
  return standings.filter((standing) => meetsAppgStandingsQuota(standing, quota));
}

function buildAwards(
  standings: TeamStanding[],
  teamStats: SeasonTeamStat[],
  sourceMatches: SeasonHistoryMatch[] | null,
  scoringMode: '120m' | '120min' | 'points' | 'appg',
) {
  if (standings.length === 0) return [];

  const completedMatchCounts = new Map(standings.map((standing) => [standing.teamId, 0]));
  (sourceMatches || [])
    .filter((match) => match.completed && match.home_goals !== null && match.away_goals !== null)
    .forEach((match) => {
      if (match.home_team_id && completedMatchCounts.has(match.home_team_id)) {
        completedMatchCounts.set(match.home_team_id, (completedMatchCounts.get(match.home_team_id) || 0) + 1);
      }
      if (match.away_team_id && completedMatchCounts.has(match.away_team_id)) {
        completedMatchCounts.set(match.away_team_id, (completedMatchCounts.get(match.away_team_id) || 0) + 1);
      }
    });
  const maxMatchesPlayed = sourceMatches ? Math.max(...completedMatchCounts.values(), 0) : null;
  const minimumEligibleMatches =
    maxMatchesPlayed === null || maxMatchesPlayed === 0
      ? 1
      : isAppg120ScoringMode(scoringMode)
        ? Math.ceil(maxMatchesPlayed * 0.5)
        : 1;
  const eligibleTeamIds = new Set(
    [...completedMatchCounts.entries()]
      .filter(([, matchesPlayed]) => matchesPlayed >= minimumEligibleMatches)
      .map(([teamId]) => teamId),
  );
  const eligibleStandings = standings.filter((standing) => eligibleTeamIds.has(standing.teamId));
  const eligibleTeamStats = teamStats.filter((stat) => eligibleTeamIds.has(stat.teamId));

  const topScorers = getWinningTeamIds(
    standings.map((standing) => ({ teamId: standing.teamId, value: standing.gf })),
    'max',
  );
  const bestGoalDifference = getWinningTeamIds(
    standings.map((standing) => ({ teamId: standing.teamId, value: standing.gd })),
    'max',
  );
  const leastGoalsAllowed = getWinningTeamIds(
    eligibleStandings.map((standing) => ({ teamId: standing.teamId, value: standing.ga })),
    'min',
  );
  const fairPlay = getWinningTeamIds(
    eligibleTeamStats.map((stat) => ({ teamId: stat.teamId, value: stat.yellowCards + stat.redCards })),
    'min',
  );
  const mostCards = getWinningTeamIds(
    teamStats.map((stat) => ({ teamId: stat.teamId, value: stat.yellowCards + stat.redCards })),
    'max',
  );
  const hasInjuryWeeks = teamStats.some((stat) => (stat.injuryWeeks || 0) > 0);
  const mostInjuries = getWinningTeamIds(
    teamStats.map((stat) => ({ teamId: stat.teamId, value: hasInjuryWeeks ? stat.injuryWeeks || 0 : stat.injuries })),
    'max',
  );
  const most120 = getWinningTeamIds(
    standings.map((standing) => ({ teamId: standing.teamId, value: standing.achievements120min })),
    'max',
  );
  const totalMinutes = getWinningTeamIds(
    standings.map((standing) => ({ teamId: standing.teamId, value: standing.totalMinutes })),
    'max',
  );
  const completedEveryFixture = standings
    .filter((standing) => {
      if (!sourceMatches) return false;
      const fixtures = sourceMatches.filter(
        (match) =>
          match.home_team_id &&
          match.away_team_id &&
          (match.home_team_id === standing.teamId || match.away_team_id === standing.teamId),
      );
      return (
        fixtures.length > 0 &&
        fixtures.every((match) => match.completed && match.home_goals !== null && match.away_goals !== null)
      );
    })
    .map((standing) => standing.teamId);
  const mostMatchesPlayed =
    isAppg120ScoringMode(scoringMode) && maxMatchesPlayed !== null && maxMatchesPlayed > 0
      ? getWinningTeamIds(
          [...completedMatchCounts].map(([teamId, value]) => ({ teamId, value })),
          'max',
        )
      : { teamIds: [] as string[], value: null as number | null };
  const injuryCountByTeam = Object.fromEntries(teamStats.map((stat) => [stat.teamId, stat.injuries]));
  const injuryWeeksByTeam = Object.fromEntries(teamStats.map((stat) => [stat.teamId, stat.injuryWeeks || 0]));
  const championStandings = getHistoryEligibleStandings(standings, scoringMode);

  const awards: SeasonAward[] = [
    { key: 'champions', recipientTeamIds: championStandings[0] ? [championStandings[0].teamId] : [], value: null },
    { key: 'most-120-matches', recipientTeamIds: most120.teamIds, value: most120.value },
    { key: 'top-scorers', recipientTeamIds: topScorers.teamIds, value: topScorers.value },
    {
      key: 'best-goal-difference',
      recipientTeamIds: bestGoalDifference.teamIds,
      value: bestGoalDifference.value,
    },
    {
      key: 'least-goals-allowed',
      recipientTeamIds: leastGoalsAllowed.teamIds,
      value: leastGoalsAllowed.value,
    },
    { key: 'fair-play', recipientTeamIds: fairPlay.teamIds, value: fairPlay.value },
    {
      key: 'most-matches-played',
      recipientTeamIds: mostMatchesPlayed.teamIds,
      value: mostMatchesPlayed.value,
    },
    {
      key: 'most-cards',
      recipientTeamIds: mostCards.value && mostCards.value > 0 ? mostCards.teamIds : [],
      value: mostCards.value,
    },
    {
      key: 'most-injuries',
      recipientTeamIds: mostInjuries.value && mostInjuries.value > 0 ? mostInjuries.teamIds : [],
      value:
        mostInjuries.teamIds.length > 0
          ? Math.max(...mostInjuries.teamIds.map((teamId) => injuryCountByTeam[teamId] || 0))
          : null,
      recipientValues:
        mostInjuries.teamIds.length > 0
          ? Object.fromEntries(mostInjuries.teamIds.map((teamId) => [teamId, injuryCountByTeam[teamId] || 0]))
          : undefined,
      recipientSecondaryValues:
        mostInjuries.teamIds.length > 0
          ? Object.fromEntries(mostInjuries.teamIds.map((teamId) => [teamId, injuryWeeksByTeam[teamId] || 0]))
          : undefined,
    },
    ...(isAppg120ScoringMode(scoringMode)
      ? []
      : [
          {
            key: 'every-fixture-completed' as const,
            recipientTeamIds: completedEveryFixture,
            value: completedEveryFixture.length > 0 ? 1 : null,
          },
        ]),
    {
      key: 'total-minute-specialists',
      recipientTeamIds: totalMinutes.teamIds,
      value: totalMinutes.value,
    },
  ];

  return awards.filter((award) => award.recipientTeamIds.length > 0);
}

function buildStory(standings: TeamStanding[], summary: SeasonHistorySummary) {
  const winner = standings[0];
  if (!winner) return 'This season finished without enough results for a full summary.';
  const runnerUp = standings[1];
  const resultText = summary.achievements120min
    ? `where ${summary.achievements120min} match${summary.achievements120min === 1 ? '' : 'es'} reached 120 minutes out of ${summary.completedMatches} completed total.`
    : `of ${summary.completedMatches} total completed match${summary.completedMatches === 1 ? '' : 'es'}`;

  return runnerUp
    ? `${winner.teamName} finished ahead of ${runnerUp.teamName} in a season ${resultText}.`
    : `${winner.teamName} completed a season ${resultText}.`;
}

function buildRecords(
  standings: TeamStanding[],
  matches: SeasonMatchSnapshot[],
  scoringMode: '120m' | '120min' | 'points' | 'appg',
): SeasonHistoryRecords {
  const most120 = getWinningTeamIds(
    standings.map((standing) => ({ teamId: standing.teamId, value: standing.achievements120min })),
    'max',
  );
  const byGoals = [...matches].sort((a, b) => {
    const goalDifference = b.homeGoals + b.awayGoals - (a.homeGoals + a.awayGoals);
    if (goalDifference !== 0) return goalDifference;
    if (a.went120 !== b.went120) return Number(b.went120) - Number(a.went120);
    return b.totalMinutes - a.totalMinutes;
  });
  const byLength = [...matches].sort((a, b) => b.totalMinutes - a.totalMinutes);
  const memorable = [...matches].sort((a, b) => {
    if (a.went120 !== b.went120) return Number(b.went120) - Number(a.went120);
    const goalDifference = b.homeGoals + b.awayGoals - (a.homeGoals + a.awayGoals);
    if (goalDifference !== 0) return goalDifference;
    return b.totalMinutes - a.totalMinutes;
  });
  const leader = standings[0];
  const runnerUp = standings[1];
  const metric = scoringMode === 'points' || usesAveragePoints(scoringMode) ? 'points' : '120m';
  const leaderValue = metric === 'points' ? leader?.pts : leader?.achievements120min;
  const runnerUpValue = metric === 'points' ? runnerUp?.pts : runnerUp?.achievements120min;

  return {
    most120TeamIds: most120.teamIds,
    most120Value: most120.value || 0,
    highestScoringMatchId: byGoals[0]?.id || null,
    closestFinish:
      leader && runnerUp && leaderValue !== undefined && runnerUpValue !== undefined
        ? {
            leaderTeamId: leader.teamId,
            runnerUpTeamId: runnerUp.teamId,
            margin: Math.abs(leaderValue - runnerUpValue),
            metric,
          }
        : null,
    longestMatchId: byLength[0]?.id || null,
    memorableMatchId: memorable[0]?.id || null,
  };
}

export function buildSeasonHistorySnapshot(
  teams: Team[],
  matches: SeasonHistoryMatch[],
  scoringMode: '120m' | '120min' | 'points' | 'appg',
): SeasonHistorySnapshotV2 {
  const participatingTeamIds = new Set(
    matches.flatMap((match) => [match.home_team_id, match.away_team_id]).filter((teamId): teamId is string => !!teamId),
  );
  const seasonTeams = teams
    .filter((team) => !team.is_placeholder && (team.active || participatingTeamIds.has(team.id)))
    .map((team) => ({ ...team, active: true }));
  const standings = calculateStandings(seasonTeams, matches, scoringMode);
  const historyEligibleStandings = getHistoryEligibleStandings(standings, scoringMode);
  const teamStatsMap = new Map<string, SeasonTeamStat>();

  seasonTeams.forEach((team) => {
    teamStatsMap.set(team.id, {
      teamId: team.id,
      teamName: team.name,
      htTeamId: team.ht_team_id,
      yellowCards: 0,
      redCards: 0,
      injuries: 0,
      injuryWeeks: 0,
    });
  });

  matches.forEach((match) => {
    if (match.home_team_id && teamStatsMap.has(match.home_team_id)) {
      const stat = teamStatsMap.get(match.home_team_id)!;
      stat.yellowCards += match.home_yellow_cards || 0;
      stat.redCards += match.home_red_cards || 0;
      stat.injuries += match.home_injuries || 0;
      stat.injuryWeeks = (stat.injuryWeeks || 0) + getInjuryWeeks(match.match_event_details?.home);
    }
    if (match.away_team_id && teamStatsMap.has(match.away_team_id)) {
      const stat = teamStatsMap.get(match.away_team_id)!;
      stat.yellowCards += match.away_yellow_cards || 0;
      stat.redCards += match.away_red_cards || 0;
      stat.injuries += match.away_injuries || 0;
      stat.injuryWeeks = (stat.injuryWeeks || 0) + getInjuryWeeks(match.match_event_details?.away);
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
  const frozenMatches: SeasonMatchSnapshot[] = completedMatches.map((match, index) => ({
    id: match.id || `season-match-${index + 1}`,
    roundNumber: match.roundNumber ?? null,
    scheduledFor: match.scheduledFor ?? null,
    homeTeamId: match.home_team_id,
    awayTeamId: match.away_team_id,
    homeTeamName:
      match.homeTeamName || seasonTeams.find((team) => team.id === match.home_team_id)?.name || 'Outside friendly',
    awayTeamName:
      match.awayTeamName || seasonTeams.find((team) => team.id === match.away_team_id)?.name || 'Outside friendly',
    homeGoals: match.home_goals || 0,
    awayGoals: match.away_goals || 0,
    totalMinutes: match.total_minutes || 90,
    went120: match.went_120,
    yellowCards: (match.home_yellow_cards || 0) + (match.away_yellow_cards || 0),
    redCards: (match.home_red_cards || 0) + (match.away_red_cards || 0),
    injuries: (match.home_injuries || 0) + (match.away_injuries || 0),
  }));
  const summary: SeasonHistorySummary = {
    teams: seasonTeams.length,
    matches: matches.length,
    completedMatches: completedMatches.length,
    goals: completedMatches.reduce((total, match) => total + (match.home_goals || 0) + (match.away_goals || 0), 0),
    achievements120min: completedMatches.filter((match) => match.went_120).length,
    yellowCards: teamStats.reduce((total, stat) => total + stat.yellowCards, 0),
    redCards: teamStats.reduce((total, stat) => total + stat.redCards, 0),
    injuries: teamStats.reduce((total, stat) => total + stat.injuries, 0),
  };
  const participants = seasonTeams.map((team) => {
    const position = standings.findIndex((standing) => standing.teamId === team.id);
    return {
      teamId: team.id,
      teamName: team.name,
      htTeamId: team.ht_team_id,
      hattrickUserId: team.hattrick_user_id,
      managerName: team.manager_name || null,
      logoUrl: team.logo_url || null,
      countryName: team.country_name || null,
      countryId: team.country_id || null,
      leagueId: team.league_id || null,
      finalPosition: position === -1 ? null : position + 1,
    };
  });

  return {
    version: 2,
    standings,
    winner: historyEligibleStandings[0] || null,
    participants,
    teamStats,
    awards: buildAwards(standings, teamStats, matches, scoringMode),
    matches: frozenMatches,
    records: buildRecords(standings, frozenMatches, scoringMode),
    summary,
    story: buildStory(historyEligibleStandings, summary),
    generatedAt: new Date().toISOString(),
  };
}

export function normalizeSeasonHistorySnapshot(snapshot: SeasonHistorySnapshot): SeasonHistorySnapshotV2 {
  if ('version' in snapshot && snapshot.version === 2) return snapshot;

  const participants = snapshot.standings.map((standing, index) => ({
    teamId: standing.teamId,
    teamName: standing.teamName,
    htTeamId: standing.htTeamId,
    hattrickUserId: standing.hattrickUserId,
    managerName: standing.managerName,
    logoUrl: standing.logoUrl,
    countryName: standing.countryName,
    countryId: standing.countryId,
    leagueId: standing.leagueId,
    finalPosition: index + 1,
  }));

  return {
    ...snapshot,
    version: 2,
    participants,
    awards: buildAwards(snapshot.standings, snapshot.teamStats, null, '120min'),
    matches: [],
    records: buildRecords(snapshot.standings, [], '120min'),
    story: buildStory(snapshot.standings, snapshot.summary),
  };
}
