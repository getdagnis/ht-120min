import type { SurveyImportance, SurveyPriority } from './survey.js';

export interface PairingPreference {
  priority: SurveyPriority | null;
  importance120m: SurveyImportance | null;
  comment?: string | null;
  commentedAt?: string | null;
}

export const importanceLevel: Record<SurveyImportance, number> = { high: 4, nice: 3, depends: 2, regular: 1 };

/** A team answer is authoritative. Manager importance fills a missing team answer only. */
export function interest120m(preference?: PairingPreference): number {
  if (!preference) return 0;
  if (preference.priority && preference.priority !== '120m' && preference.priority !== 'both') return 0;
  if (!preference.priority && !preference.importance120m) return 0;
  return importanceLevel[preference.importance120m || 'nice'];
}

export function preferencePairScore(home?: PairingPreference, away?: PairingPreference, homeGain = false, awayGain = false): number {
  const flagScore = Number(homeGain && (home?.priority === 'flags' || home?.priority === 'both'))
    + Number(awayGain && (away?.priority === 'flags' || away?.priority === 'both'));
  const homeInterest = Math.max(0, interest120m(home) - 1), awayInterest = Math.max(0, interest120m(away) - 1);
  // A mutually interested match is useful; one interested team alone is a weaker signal.
  return flagScore * 10 + (homeInterest && awayInterest ? 10 + Math.min(homeInterest, awayInterest) : Math.max(homeInterest, awayInterest));
}
