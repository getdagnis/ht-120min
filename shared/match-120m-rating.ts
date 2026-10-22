import type { MatchSidePerformance } from './match-events.js';
import { getFormationIndicatorScore, getMatchMindsetIndicator, getTacticIndicatorScore } from '../src/utils/rating-indicators.js';
import type { RatingIndicatorScore } from '../src/utils/rating-indicators.js';
import type { SpecialtyPositionGroup } from './player-specialties.js';

export const MATCH_120M_FORMULA_VERSION = 1;
export type Match120mGrade = `${'A' | 'B' | 'C' | 'D' | 'E' | 'F'}${'+' | '' | '-'}`;

export interface Match120mRating {
  score: number;
  grade: Match120mGrade;
  formula_version: typeof MATCH_120M_FORMULA_VERSION;
  has_set_pieces_skill: boolean;
  has_specialties: boolean;
}

export type Match120mRatedSector =
  | 'leftAttack' | 'centreAttack' | 'rightAttack' | 'midfield'
  | 'leftDefence' | 'centreDefence' | 'rightDefence';

export interface Match120mCoachingAnalysis {
  rating: Match120mRating | null;
  sectorScores: Partial<Record<Match120mRatedSector, RatingIndicatorScore>>;
  formationScore: RatingIndicatorScore | null;
  tacticScore: RatingIndicatorScore | null;
  setPiecesScore: RatingIndicatorScore | null;
  mindsetScore: RatingIndicatorScore | null;
  quickCount: number | null;
  headCount: number | null;
  recommendations: string[];
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

const ratedSectors: Match120mRatedSector[] = [
  'leftAttack', 'centreAttack', 'rightAttack', 'midfield', 'leftDefence', 'centreDefence', 'rightDefence',
];

function countSpecialty(specialties: SpecialtyPositionGroup[] | undefined, specialtyId: number): number | null {
  return Array.isArray(specialties)
    ? specialties.find((entry) => entry.specialtyId === specialtyId)?.roleIds.length ?? 0
    : null;
}

/** Derives all 120m colors and coaching points from a team's lineup; only Quick defensive cover reads opponent specialties. */
export function analyzeMatch120mCoaching(
  performance: MatchSidePerformance | null | undefined,
  opposingSpecialties?: SpecialtyPositionGroup[],
): Match120mCoachingAnalysis {
  const rating = calculateMatch120mRating(performance);
  const sectorScores: Match120mCoachingAnalysis['sectorScores'] = {};
  const recommendations: string[] = [];
  const raw = performance?.ratings;
  const display = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value) ? (value + 3) / 4 : null;
  const defences = [display(raw?.leftDefence), display(raw?.centralDefence), display(raw?.rightDefence)];
  const attacks = [display(raw?.leftAttack), display(raw?.centralAttack), display(raw?.rightAttack)];
  const midfield = display(raw?.midfield);
  const averageDefence = defences.every((value): value is number => value !== null)
    ? defences.reduce((sum, value) => sum + value, 0) / 3
    : null;
  const averageAttack = attacks.every((value): value is number => value !== null)
    ? attacks.reduce((sum, value) => sum + value, 0) / 3
    : null;
  if (averageDefence !== null && averageAttack !== null && midfield !== null) {
    const ownValues: Record<Match120mRatedSector, number> = {
      leftAttack: attacks[0]!, centreAttack: attacks[1]!, rightAttack: attacks[2]!, midfield,
      leftDefence: defences[0]!, centreDefence: defences[1]!, rightDefence: defences[2]!,
    };
    for (const sector of ratedSectors) {
      if (sector === 'midfield') {
        if (midfield + averageAttack > 2 * averageDefence) sectorScores[sector] = 4;
      } else if (sector.endsWith('Attack')) {
        if (ownValues[sector] > averageDefence) sectorScores[sector] = 4;
      } else if (sector === 'leftDefence' && opposingSpecialties) {
        // Quick coverage is evaluated below for all defensive roles.
      }
    }
    if (midfield + averageAttack > 2 * averageDefence) recommendations.push('balanceMidfield');
    if (attacks.some((value) => value !== null && value > averageDefence)) recommendations.push('lowerAttack');
  }

  const specialties = performance?.specialtyPositions;
  const quickCount = countSpecialty(specialties, 2);
  const headCount = countSpecialty(specialties, 5);
  if ((quickCount ?? 0) >= 3) recommendations.push('reduceQuick');
  if ((headCount ?? 0) >= 3) recommendations.push('reduceHead');

  const quickOpponents = opposingSpecialties?.find((entry) => entry.specialtyId === 2)?.roleIds ?? [];
  const defensiveRoleToAttackRole: Record<number, number> = {
    101: 110, 102: 113, 103: 112, 104: 111, 105: 106,
  };
  if (Array.isArray(specialties) && opposingSpecialties) {
    for (const role of specialties.find((entry) => entry.specialtyId === 2)?.roleIds ?? []) {
      const opposingAttackRole = defensiveRoleToAttackRole[role];
      if (opposingAttackRole !== undefined && quickOpponents.includes(opposingAttackRole)) {
        const sector = role === 105 ? 'leftDefence' : role === 101 ? 'rightDefence' : 'centreDefence';
        sectorScores[sector] = 1;
      }
    }
  }

  const formationScore = getFormationIndicatorScore(performance?.formation);
  const tacticName = performance?.tacticType === 0 ? 'Normal'
    : performance?.tacticType === 1 ? 'Pressing' : performance?.tacticName;
  const tacticScore = getTacticIndicatorScore(tacticName);
  const skill = performance?.setPiecesTaker?.skill;
  const setPiecesScore = skill === null ? 4
    : typeof skill === 'number' && skill >= 1
      ? skill <= 3 ? 1 : skill <= 5 ? 2 : skill <= 7 ? 3 : 4
      : null;
  const mindsetScore = getMatchMindsetIndicator(performance?.styleOfPlay)?.score ?? null;

  if (formationScore !== null && formationScore >= 3) recommendations.push('chooseDefensiveFormation');
  if (tacticScore !== null && tacticScore !== 1) recommendations.push('choosePressing');
  if (setPiecesScore === null || setPiecesScore >= 3) recommendations.push('improveSetPieces');
  if (rating && rating.grade[0] !== 'A' && recommendations.length === 0) recommendations.push('fineTuneLineup');

  return { rating, sectorScores, formationScore, tacticScore, setPiecesScore, mindsetScore,
    quickCount, headCount, recommendations: [...new Set(recommendations)] };
}
