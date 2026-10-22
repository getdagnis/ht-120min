import type { MatchSidePerformance } from './match-events.js';
import { getFormationIndicatorScore, getMatchMindsetIndicator, getTacticIndicatorScore } from '../src/utils/rating-indicators.js';

export const MATCH_120M_FORMULA_VERSION = 1;
export type Match120mGrade = `${'A' | 'B' | 'C' | 'D' | 'E' | 'F'}${'+' | '' | '-'}`;

export interface Match120mRating {
  score: number;
  grade: Match120mGrade;
  formula_version: typeof MATCH_120M_FORMULA_VERSION;
  has_set_pieces_skill: boolean;
  has_specialties: boolean;
}

const formationPoints: Record<string, number> = {
  '5-5-0': 100, '5-4-1': 90, '5-3-2': 90, '4-5-1': 90,
  '5-2-3': 80, '4-4-2': 55, '4-3-3': 25, '3-5-2': 25,
  '3-4-3': 0, '2-5-3': 0,
};

function interpolate(value: number, stops: readonly (readonly [number, number])[]): number {
  if (value <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i += 1) {
    if (value <= stops[i][0]) {
      const [x0, y0] = stops[i - 1];
      const [x1, y1] = stops[i];
      return y0 + (y1 - y0) * (value - x0) / (x1 - x0);
    }
  }
  return stops[stops.length - 1][1];
}

function gradeFor(score: number): Match120mGrade {
  const grades: Match120mGrade[] = [
    'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-',
    'D+', 'D', 'D-', 'E+', 'E', 'E-', 'F+', 'F', 'F-',
  ];
  if (score >= 95) return grades[0];
  if (score < 15) return grades[grades.length - 1];
  return grades[Math.min(grades.length - 2, Math.floor((95 - score + 4) / 5))];
}

function specialtyPenalty(count: number): number {
  if (count <= 1) return 0;
  if (count === 2) return 2;
  if (count === 3) return 6;
  return Math.min(30, 16 + (count - 4) * 8);
}

/** Scores a team's own finished-match setup; match result and opponent are deliberately excluded. */
export function calculateMatch120mRating(performance: MatchSidePerformance | null | undefined): Match120mRating | null {
  if (!performance) return null;
  const formation = performance.formation?.trim() || '';
  const tactic = performance.tacticType === 0 ? 'Normal'
    : performance.tacticType === 1 ? 'Pressing' : performance.tacticName;
  if (getFormationIndicatorScore(formation) === null || getTacticIndicatorScore(tactic) === null) return null;
  const raw = performance.ratings;
  const rawRatings = [raw?.leftDefence, raw?.centralDefence, raw?.rightDefence,
    raw?.leftAttack, raw?.centralAttack, raw?.rightAttack, raw?.midfield];
  if (rawRatings.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) return null;
  const display = (value: number) => (value + 3) / 4;
  const defence = (display(raw.leftDefence!) + display(raw.centralDefence!) + display(raw.rightDefence!)) / 3;
  const attacks = [display(raw.leftAttack!), display(raw.centralAttack!), display(raw.rightAttack!)];
  const attack = attacks.reduce((sum, value) => sum + value, 0) / 3;
  const maxAttack = Math.max(...attacks);
  const midfield = display(raw.midfield!);
  const defencePoints = interpolate(defence / attack, [[0.6, 0], [0.8, 40], [1, 70], [1.25, 90], [1.5, 100]]);
  const midfieldPoints = interpolate(midfield / defence, [[0.3, 100], [0.5, 80], [0.8, 50], [1, 25], [1.3, 0]]);
  const tacticScore = getTacticIndicatorScore(tactic);
  const tacticPoints = tacticScore === 1 ? 100 : tacticScore === 3 ? 50 : 0;
  const skill = performance.setPiecesTaker?.skill;
  const hasSetPiecesSkill = typeof skill === 'number' && Number.isFinite(skill) && skill >= 1;
  const setPiecesPoints = !hasSetPiecesSkill ? 50 : skill === 1 ? 100 : skill <= 3 ? 90
    : skill <= 5 ? 75 : skill <= 7 ? 55 : skill <= 11 ? 20 : 0;
  const specialties = performance.specialtyPositions;
  const quickCount = specialties?.find((entry) => entry.specialtyId === 2)?.roleIds.length ?? 0;
  const headCount = specialties?.find((entry) => entry.specialtyId === 5)?.roleIds.length ?? 0;
  const attackPenalty = maxAttack >= 8 ? 8 : maxAttack >= 7 ? 3 : maxAttack >= 6 ? 2 : maxAttack >= 5 ? 1 : 0;
  const attackingFormation = formation === '3-4-3' || formation === '2-5-3';
  let score = defencePoints * 0.25 + tacticPoints * 0.25 + formationPoints[formation] * 0.25
    + midfieldPoints * 0.15 + setPiecesPoints * 0.1
    + (getMatchMindsetIndicator(performance.styleOfPlay) ? 5 : 0)
    - specialtyPenalty(quickCount) - specialtyPenalty(headCount) - attackPenalty
    - (attackingFormation ? 5 : 0);
  if (attackingFormation && (tacticPoints === 0 || maxAttack >= 8)) score = Math.min(score, 10);
  score = Math.round(Math.max(0, Math.min(100, score)));
  return { score, grade: gradeFor(score), formula_version: MATCH_120M_FORMULA_VERSION,
    has_set_pieces_skill: hasSetPiecesSkill, has_specialties: Array.isArray(specialties) };
}

export function usesMatch120mRatings(scoringMode: string | null | undefined): boolean {
  return scoringMode === '120m' || scoringMode === '120min' || scoringMode === 'average120' || scoringMode === 'appg';
}
