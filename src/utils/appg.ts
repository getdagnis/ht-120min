/**
 * APPG-120 result rules.
 *
 * The filename, database fields and exported `Appg*` symbols remain for
 * compatibility. ET3, ET2, PS1, RT0 and OPW belong to APPG-120 and must not
 * be inherited automatically by future APPG-90 or Bone Crushers profiles.
 */

export const APPG_OUTCOMES = ['ET3', 'ET2', 'PS1', 'RT0', 'OPW', 'needs_review'] as const;

export type AppgOutcome = (typeof APPG_OUTCOMES)[number];

export interface AppgMatchInput {
  home_goals: number | null;
  away_goals: number | null;
  went_120?: boolean | null;
  total_minutes?: number | null;
  penalty_shootout_home_goals?: number | null;
  penalty_shootout_away_goals?: number | null;
  appg_outcome?: AppgOutcome | null;
}

export interface AppgPoints {
  home: number;
  away: number;
}

export function appgOutcomeLabel(outcome: AppgOutcome) {
  switch (outcome) {
    case 'ET3':
      return 'Extra time, open-play winner (3pt)';
    case 'ET2':
      return 'Extra time, SE/other winner (2pt)';
    case 'PS1':
      return 'Penalty shootout (1pt)';
    case 'RT0':
      return 'Regulation time ending (0p)';
    case 'OPW':
      return 'Regulation open-play winner (-1p)';
    default:
      return 'Needs review';
  }
}

function winnerSide(match: AppgMatchInput): 'home' | 'away' | null {
  if (match.home_goals === null || match.away_goals === null) return null;
  if (match.home_goals > match.away_goals) return 'home';
  if (match.away_goals > match.home_goals) return 'away';

  const homeShootout = match.penalty_shootout_home_goals ?? null;
  const awayShootout = match.penalty_shootout_away_goals ?? null;
  if (homeShootout !== null && awayShootout !== null) {
    if (homeShootout > awayShootout) return 'home';
    if (awayShootout > homeShootout) return 'away';
  }
  return null;
}

export function getAppgPoints(match: AppgMatchInput): AppgPoints | null {
  if (!match.appg_outcome || match.appg_outcome === 'needs_review') return null;
  switch (match.appg_outcome) {
    case 'ET3':
      return { home: 3, away: 3 };
    case 'ET2':
      return { home: 2, away: 2 };
    case 'PS1':
      return { home: 1, away: 1 };
    case 'RT0':
      return { home: 0, away: 0 };
    case 'OPW':
      return { home: -1, away: -1 };
    default:
      return null;
  }
}

export function validateAppgOutcome(match: AppgMatchInput): string | null {
  if (!match.appg_outcome || match.appg_outcome === 'needs_review') return null;
  if (match.home_goals === null || match.away_goals === null)
    return 'Enter both scores before choosing an APPG-120 outcome.';
  if (match.appg_outcome !== 'RT0' && !winnerSide(match))
    return 'APPG-120 needs a winning team or a completed penalty shootout.';

  const extraTime = Boolean(match.went_120 || (match.total_minutes ?? 0) >= 120);
  if ((match.appg_outcome === 'ET3' || match.appg_outcome === 'ET2') && !extraTime) {
    return 'ET3 and ET2 require a match that reached extra time.';
  }
  if (
    match.appg_outcome === 'PS1' &&
    (match.penalty_shootout_home_goals === null || match.penalty_shootout_away_goals === null)
  ) {
    return 'PS1 requires penalty shootout scores.';
  }
  if ((match.appg_outcome === 'RT0' || match.appg_outcome === 'OPW') && extraTime) {
    return 'RT0 and OPW apply only to regulation-time results.';
  }
  return null;
}
