import type { AppgOutcome } from './appg';
import { isAppg120ScoringMode } from '../../shared/scoring-profile';

export interface BulkMatchUpdate {
  home_goals?: number | null;
  away_goals?: number | null;
  went_120?: boolean;
  total_minutes?: number;
  completed?: boolean;
  penalty_shootout_home_goals?: number | null;
  penalty_shootout_away_goals?: number | null;
  appg_outcome?: AppgOutcome | null;
  appg_outcome_source?: 'organizer' | 'csv';
}

interface SandboxFixture {
  id: string;
  home_team_id: string | null;
  away_team_id: string | null;
}

function randomInteger(random: () => number, min: number, max: number) {
  return Math.floor(random() * (max - min + 1)) + min;
}

function winnerScore(random: () => number) {
  const winnerGoals = randomInteger(random, 1, 4);
  const loserGoals = randomInteger(random, 0, winnerGoals - 1);
  return random() < 0.5
    ? { home_goals: winnerGoals, away_goals: loserGoals }
    : { home_goals: loserGoals, away_goals: winnerGoals };
}

function randomAppgResult(random: () => number): BulkMatchUpdate {
  const outcomes: AppgOutcome[] = ['ET3', 'ET2', 'PS1', 'RT0', 'OPW'];
  const outcome = outcomes[randomInteger(random, 0, outcomes.length - 1)];

  if (outcome === 'PS1') {
    const tiedGoals = randomInteger(random, 0, 3);
    const homeWinsShootout = random() < 0.5;
    const winnerShootoutGoals = randomInteger(random, 4, 6);
    const loserShootoutGoals = randomInteger(random, 2, winnerShootoutGoals - 1);
    return {
      home_goals: tiedGoals,
      away_goals: tiedGoals,
      went_120: true,
      total_minutes: 120,
      completed: true,
      penalty_shootout_home_goals: homeWinsShootout ? winnerShootoutGoals : loserShootoutGoals,
      penalty_shootout_away_goals: homeWinsShootout ? loserShootoutGoals : winnerShootoutGoals,
      appg_outcome: outcome,
      appg_outcome_source: 'organizer',
    };
  }

  const score = winnerScore(random);
  const isExtraTime = outcome === 'ET3' || outcome === 'ET2';
  return {
    ...score,
    went_120: isExtraTime,
    total_minutes: isExtraTime ? randomInteger(random, 120, 123) : 90,
    completed: true,
    penalty_shootout_home_goals: null,
    penalty_shootout_away_goals: null,
    appg_outcome: outcome,
    appg_outcome_source: 'organizer',
  };
}

function randomStandardResult(random: () => number, scoringMode: string): BulkMatchUpdate {
  const reachesExtraTime = (scoringMode === '120m' || scoringMode === '120min') && random() < 0.35;
  return {
    ...winnerScore(random),
    went_120: reachesExtraTime,
    total_minutes: reachesExtraTime ? randomInteger(random, 120, 123) : 90,
    completed: true,
    penalty_shootout_home_goals: null,
    penalty_shootout_away_goals: null,
  };
}

/**
 * Creates immediately savable sandbox results. BYEs are intentionally omitted:
 * a random score must never imply a real outside-friendly result for one team.
 */
export function createSandboxResultUpdates(
  matches: SandboxFixture[],
  scoringMode: string,
  random: () => number = Math.random,
): Record<string, BulkMatchUpdate> {
  return Object.fromEntries(
    matches
      .filter((match) => match.home_team_id && match.away_team_id)
      .map((match) => [
        match.id,
        isAppg120ScoringMode(scoringMode) ? randomAppgResult(random) : randomStandardResult(random, scoringMode),
      ]),
  );
}
