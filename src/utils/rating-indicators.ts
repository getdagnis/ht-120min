import { getTacticKey, type TacticKey } from '../../shared/tactics.js';

export type RatingIndicatorScore = 0 | 1 | 2 | 3 | 4;

export function getMatchMindsetIndicator(styleOfPlay: number | null | undefined): {
  label: '100% Defensive';
  score: 1;
} | null {
  if (styleOfPlay === -10 || styleOfPlay === -1000) return { label: '100% Defensive', score: 1 };
  return null;
}

const canonicalFormationScores: Record<string, RatingIndicatorScore> = {
  '5-5-0': 1,
  '5-4-1': 1,
  '5-3-2': 1,
  '5-2-3': 1,
  '4-5-1': 2,
  '4-4-2': 2,
  '4-3-3': 3,
  '3-5-2': 3,
  '3-4-3': 4,
  '2-5-3': 4,
};

const tacticScores: Record<TacticKey, RatingIndicatorScore> = {
  pressing: 1,
  normal: 3,
  attack_on_wings: 4,
  attack_in_the_middle: 4,
  long_shots: 4,
  play_creatively: 4,
  counter_attacks: 4,
};

export function getFormationIndicatorScore(formation: string | null | undefined): RatingIndicatorScore | null {
  if (!formation) return null;
  const normalized = formation.trim();
  if (Object.hasOwn(canonicalFormationScores, normalized)) return canonicalFormationScores[normalized];

  if (!/^\d+-\d+-\d+$/.test(normalized)) return null;
  const parts = normalized.split('-').map(Number);
  if (parts.length !== 3 || parts.some((value) => !Number.isInteger(value) || value < 0)) return null;
  const [defenders, midfielders, forwards] = parts;
  if (defenders + midfielders + forwards <= 0 || defenders + midfielders + forwards >= 10) return null;

  const defensiveDifference = defenders - (midfielders + forwards);
  if (defensiveDifference > 0) return 1;
  if (defensiveDifference === 0) return 2;
  if (defensiveDifference === -1) return 0;
  return 4;
}

export function getTacticIndicatorScore(tactic: string | null | undefined): RatingIndicatorScore | null {
  if (!tactic) return null;
  const key = getTacticKey(tactic);
  return key ? tacticScores[key] : null;
}

export function getSetPieceIndicatorScore(skill: number | null | undefined): RatingIndicatorScore | null {
  if (skill === null) return 4;
  if (!Number.isFinite(skill) || skill === undefined || skill < 1) return null;
  if (skill <= 3) return 1;
  if (skill <= 5) return 2;
  if (skill <= 7) return 3;
  return 4;
}
