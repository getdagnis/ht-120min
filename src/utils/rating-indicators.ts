export type RatingIndicatorScore = 1 | 2 | 3 | 4;

const canonicalFormationScores: Record<string, RatingIndicatorScore> = {
  '5-5-0': 1,
  '5-4-1': 1,
  '5-3-2': 1,
  '5-2-3': 2,
  '4-5-1': 2,
  '4-4-2': 2,
  '4-3-3': 3,
  '3-5-2': 3,
  '3-4-3': 4,
  '2-5-3': 4,
};

const tacticScores: Record<string, RatingIndicatorScore> = {
  pressing: 1,
  normal: 3,
  attack_on_wings: 4,
  attack_in_middle: 4,
  long_shots: 4,
  play_creatively: 4,
  counter_attacks: 4,
};

export function getFormationIndicatorScore(formation: string | null | undefined): RatingIndicatorScore | null {
  if (!formation) return null;
  const normalized = formation.trim();
  return Object.hasOwn(canonicalFormationScores, normalized) ? canonicalFormationScores[normalized] : null;
}

export function getTacticIndicatorScore(tactic: string | null | undefined): RatingIndicatorScore | null {
  if (!tactic) return null;
  const normalized = tactic
    .trim()
    .toLowerCase()
    .replace(/[ -]+/g, '_')
    .replace(/^attack_in_the_middle$/, 'attack_in_middle')
    .replace(/^attack_in_wings$/, 'attack_on_wings');
  return Object.hasOwn(tacticScores, normalized) ? tacticScores[normalized] : null;
}

export function getSetPieceIndicatorScore(skill: number | null | undefined): RatingIndicatorScore | null {
  if (!Number.isFinite(skill) || skill === null || skill === undefined || skill < 1) return null;
  if (skill <= 3) return 1;
  if (skill <= 5) return 2;
  if (skill <= 7) return 3;
  return 4;
}
