import type { MatchEventDetails, MatchSideEventDetails, MatchSidePerformance } from '../../../../shared/match-events.js';
import type { PersistedScoringMode } from '../../../../shared/scoring-profile.js';
import { calculateStandings, type Match, type Team } from '../../../utils/standings.js';

export interface RoundPressTeamSource {
  id: string;
  name: string;
  ht_team_id: number | null;
  manager_name?: string | null;
  country_name?: string | null;
  country_id?: number | null;
  league_id?: number | null;
}

export interface RoundPressMatchSource {
  id: string;
  round_id: string;
  home_team_id: string | null;
  away_team_id: string | null;
  home_goals: number | null;
  away_goals: number | null;
  completed: boolean;
  status: string;
  went_120: boolean;
  total_minutes: number | null;
  penalty_shootout_home_goals?: number | null;
  penalty_shootout_away_goals?: number | null;
  home_yellow_cards?: number | null;
  home_red_cards?: number | null;
  home_injuries?: number | null;
  away_yellow_cards?: number | null;
  away_red_cards?: number | null;
  away_injuries?: number | null;
  match_event_details?: MatchEventDetails | null;
  scheduled_for?: string | null;
  home_team: RoundPressTeamSource | null;
  away_team: RoundPressTeamSource | null;
}

export interface RoundPressRoundSource {
  id: string;
  round_number: number;
  matches: RoundPressMatchSource[];
}

export interface RoundPressInput {
  tournament: {
    id: string;
    name: string;
    seasonNumber: number;
    roundNumber: number;
    scoringMode: PersistedScoringMode;
  };
  previousContext?: {
    standingsBeforeRound?: Array<{
      teamId: string;
      teamName: string;
      played: number;
      won: number;
      drawn: number;
      lost: number;
      goalsFor: number;
      goalsAgainst: number;
      points: number;
      achievements120min: number;
      totalMinutes: number;
    }>;
  };
  matches: Array<{
    matchId: string;
    home: RoundPressTeamSource | null;
    away: RoundPressTeamSource | null;
    result: {
      homeGoals: number | null;
      awayGoals: number | null;
      completed: boolean;
      status: string;
      went120: boolean;
      totalMinutes: number | null;
      penaltyShootoutHomeGoals: number | null;
      penaltyShootoutAwayGoals: number | null;
      scoreAfterRegulation: { home: number; away: number } | null;
      scoreAfterExtraTime: { home: number; away: number } | null;
      decisionType: 'regulation' | 'extra_time' | 'penalty_shootout' | null;
      winnerTeamId: number | null;
    };
    homeFacts: RoundPressSideFacts;
    awayFacts: RoundPressSideFacts;
    scheduledFor: string | null;
  }>;
  nextRound?: {
    roundNumber: number;
    fixtures: Array<{ homeTeamName: string; awayTeamName: string }>;
  };
}

export interface RoundPressSideFacts {
  yellowCards: number;
  redCards: number;
  injuries: Array<{
    playerId: number | null;
    minute: number | null;
    weeks: number | null;
    severity: string | null;
  }>;
  goals: Array<{
    playerId: number | null;
    minute: number | null;
    matchPart: number | null;
    category: string;
  }>;
  penaltyShootoutGoals: number;
  performance: MatchSidePerformance | null;
}

function sideFacts(side: MatchSideEventDetails | undefined, yellowFallback: number, redFallback: number, injuryFallback: number): RoundPressSideFacts {
  return {
    yellowCards: side ? side.cards.filter((card) => card.type === 'yellow').length : yellowFallback,
    redCards: side ? side.cards.filter((card) => card.type !== 'yellow').length : redFallback,
    injuries: side
      ? side.injuries.map((injury) => ({
          playerId: injury.playerId,
          minute: injury.minute,
          weeks: injury.weeks,
          severity: injury.severity,
        }))
      : Array.from({ length: Math.max(0, injuryFallback) }, () => ({
          playerId: null,
          minute: null,
          weeks: null,
          severity: null,
        })),
    goals: (side?.goals || []).map((goal) => ({
      playerId: goal.playerId,
      minute: goal.minute,
      matchPart: goal.matchPart,
      category: goal.category,
    })),
    penaltyShootoutGoals: side?.penaltyShootoutGoals || 0,
    performance: side?.performance || null,
  };
}

function standingsBeforeRound(
  teams: RoundPressTeamSource[],
  rounds: RoundPressRoundSource[],
  roundNumber: number,
  scoringMode: PersistedScoringMode,
) {
  if (roundNumber <= 1 || teams.length === 0) return undefined;
  const priorMatches = rounds
    .filter((round) => round.round_number < roundNumber)
    .flatMap((round) => round.matches)
    .map((match): Match => ({
      home_team_id: match.home_team_id,
      away_team_id: match.away_team_id,
      home_goals: match.home_goals,
      away_goals: match.away_goals,
      went_120: match.went_120,
      completed: match.completed || match.status === 'misarranged',
      total_minutes: match.total_minutes ?? 90,
      penalty_shootout_home_goals: match.penalty_shootout_home_goals ?? null,
      penalty_shootout_away_goals: match.penalty_shootout_away_goals ?? null,
    }));
  if (priorMatches.length === 0) return undefined;

  const standings = calculateStandings(
    teams.map((team): Team => ({
      id: team.id,
      name: team.name,
      ht_team_id: team.ht_team_id,
      hattrick_user_id: null,
      active: true,
      replacement_for_team_id: null,
      joined_via_oauth: true,
      country_name: team.country_name ?? null,
      country_id: team.country_id ?? null,
      league_id: team.league_id ?? null,
      logo_url: null,
      manager_name: team.manager_name ?? null,
    })),
    priorMatches,
    scoringMode,
  );

  return standings.map((standing) => ({
    teamId: standing.teamId,
    teamName: standing.teamName,
    played: standing.played,
    won: standing.won,
    drawn: standing.drawn,
    lost: standing.lost,
    goalsFor: standing.gf,
    goalsAgainst: standing.ga,
    points: standing.pts,
    achievements120min: standing.achievements120min,
    totalMinutes: standing.totalMinutes,
  }));
}

export function buildRoundPressInput(params: {
  tournament: { id: string; name: string; scoringMode: PersistedScoringMode };
  seasonNumber: number;
  roundNumber: number;
  rounds: RoundPressRoundSource[];
  teams: RoundPressTeamSource[];
}): RoundPressInput {
  const selectedRound = params.rounds.find((round) => round.round_number === params.roundNumber);
  if (!selectedRound) throw new Error(`Round ${params.roundNumber} was not found.`);

  const matches = selectedRound.matches.map((match) => ({
    matchId: match.id,
    home: match.home_team,
    away: match.away_team,
    result: {
      homeGoals: match.home_goals,
      awayGoals: match.away_goals,
      completed: match.completed,
      status: match.status,
      went120: match.went_120,
      totalMinutes: match.total_minutes,
      penaltyShootoutHomeGoals: match.penalty_shootout_home_goals ?? null,
      penaltyShootoutAwayGoals: match.penalty_shootout_away_goals ?? null,
      scoreAfterRegulation: match.match_event_details?.result?.scoreAfterRegulation || null,
      scoreAfterExtraTime: match.match_event_details?.result?.scoreAfterExtraTime || null,
      decisionType: match.match_event_details?.result?.decisionType || null,
      winnerTeamId: match.match_event_details?.result?.winnerTeamId || null,
    },
    homeFacts: sideFacts(
      match.match_event_details?.home,
      match.home_yellow_cards ?? 0,
      match.home_red_cards ?? 0,
      match.home_injuries ?? 0,
    ),
    awayFacts: sideFacts(
      match.match_event_details?.away,
      match.away_yellow_cards ?? 0,
      match.away_red_cards ?? 0,
      match.away_injuries ?? 0,
    ),
    scheduledFor: match.scheduled_for ?? null,
  }));

  const next = params.rounds.find((round) => round.round_number === params.roundNumber + 1);
  const nextRound = next
    ? {
        roundNumber: next.round_number,
        fixtures: next.matches
          .filter((match) => match.home_team || match.away_team)
          .map((match) => ({
            homeTeamName: match.home_team?.name || 'BYE',
            awayTeamName: match.away_team?.name || 'BYE',
          })),
      }
    : undefined;

  const input: RoundPressInput = {
    tournament: {
      ...params.tournament,
      seasonNumber: params.seasonNumber,
      roundNumber: params.roundNumber,
    },
    matches,
    nextRound,
  };
  const before = standingsBeforeRound(params.teams, params.rounds, params.roundNumber, params.tournament.scoringMode);
  if (before) input.previousContext = { standingsBeforeRound: before };
  return input;
}
