import type { MatchEventDetails, MatchGoalEvent, MatchSideEventDetails } from '../../shared/match-events.js';

export type ChppAppgOutcome = 'ET3' | 'ET2' | 'PS1' | 'RT0' | 'OPW' | 'needs_review';
export type ChppAppgOutcomeSource = 'unclassified' | 'chpp' | 'organizer' | 'csv';

export interface ChppAppgClassificationInput {
  completed: boolean;
  homeGoals: number | null;
  awayGoals: number | null;
  went120?: boolean | null;
  totalMinutes?: number | null;
  penaltyShootoutHomeGoals?: number | null;
  penaltyShootoutAwayGoals?: number | null;
  eventDetails?: MatchEventDetails | null;
}

interface ChppAppgUpdateInput extends ChppAppgClassificationInput {
  scoringMode?: string | null;
  currentSource?: ChppAppgOutcomeSource | string | null;
}

export interface ChppAppgUpdate {
  appg_outcome?: ChppAppgOutcome;
  appg_outcome_source?: 'unclassified' | 'chpp';
}

function winnerSide(homeGoals: number, awayGoals: number): 'home' | 'away' | null {
  if (homeGoals > awayGoals) return 'home';
  if (awayGoals > homeGoals) return 'away';
  return null;
}

function parsedGoals(side: MatchSideEventDetails): MatchGoalEvent[] | null {
  return Array.isArray(side.goals) ? side.goals : null;
}

function matchesOfficialScore(
  homeGoals: MatchGoalEvent[],
  awayGoals: MatchGoalEvent[],
  officialHomeGoals: number,
  officialAwayGoals: number,
) {
  return homeGoals.length === officialHomeGoals && awayGoals.length === officialAwayGoals;
}

function isExtraTimeGoal(goal: MatchGoalEvent) {
  return goal.matchPart !== null && goal.matchPart >= 3;
}

/**
 * English APPG tournament rules only. Keep this separate from generic CHPP parsing
 * so the whole policy can be removed without affecting other tournament formats.
 */
export function classifyChppAppgOutcome(input: ChppAppgClassificationInput): ChppAppgOutcome {
  if (!input.completed || input.homeGoals === null || input.awayGoals === null || !input.eventDetails) {
    return 'needs_review';
  }

  const shootoutHome =
    input.penaltyShootoutHomeGoals ??
    (input.eventDetails.hasPenaltyShootout ? input.eventDetails.home.penaltyShootoutGoals ?? null : null);
  const shootoutAway =
    input.penaltyShootoutAwayGoals ??
    (input.eventDetails.hasPenaltyShootout ? input.eventDetails.away.penaltyShootoutGoals ?? null : null);

  if (input.eventDetails.hasPenaltyShootout || (shootoutHome !== null && shootoutAway !== null)) {
    return shootoutHome !== null && shootoutAway !== null && shootoutHome !== shootoutAway
      ? 'PS1'
      : 'needs_review';
  }

  const reachedExtraTime = input.went120 === true || (input.totalMinutes ?? 0) >= 120;
  const winner = winnerSide(input.homeGoals, input.awayGoals);

  if (!reachedExtraTime && !winner) return 'RT0';
  if (!winner) return 'needs_review';

  const homeGoals = parsedGoals(input.eventDetails.home);
  const awayGoals = parsedGoals(input.eventDetails.away);
  if (!homeGoals || !awayGoals) return 'needs_review';
  if (!matchesOfficialScore(homeGoals, awayGoals, input.homeGoals, input.awayGoals)) return 'needs_review';

  const winnerGoals = winner === 'home' ? homeGoals : awayGoals;

  if (reachedExtraTime) {
    const extraTimeGoals = winnerGoals.filter(isExtraTimeGoal);
    if (extraTimeGoals.some((goal) => goal.category === 'regular')) return 'ET3';
    if (extraTimeGoals.length > 0) return 'ET2';
    return 'needs_review';
  }

  return winnerGoals.some((goal) => goal.category === 'regular') ? 'OPW' : 'RT0';
}

export function buildChppAppgUpdate(input: ChppAppgUpdateInput): ChppAppgUpdate {
  if (input.scoringMode !== 'appg') return {};
  if (input.currentSource === 'organizer' || input.currentSource === 'csv') return {};

  const outcome = classifyChppAppgOutcome(input);
  return {
    appg_outcome: outcome,
    appg_outcome_source: outcome === 'needs_review' ? 'unclassified' : 'chpp',
  };
}
