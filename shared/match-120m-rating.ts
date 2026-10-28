import type { MatchSidePerformance } from './match-events.js';
import { getFormationIndicatorScore, getMatchMindsetIndicator, getSetPieceIndicatorScore, getTacticIndicatorScore } from '../src/utils/rating-indicators.js';
import type { RatingIndicatorScore } from '../src/utils/rating-indicators.js';
import type { SpecialtyPositionGroup } from './player-specialties.js';

export const MATCH_120M_FORMULA_VERSION = 15;
export const MATCH_120M_MAX_SE_THREAT_PENALTY = 25;
const MATCH_120M_SET_PIECES_MAX_POINTS = 25;
const MATCH_120M_SET_PIECES_POINTS_PER_SKILL = 2;
const MATCH_120M_SET_PIECES_NEUTRAL_POINTS = MATCH_120M_SET_PIECES_MAX_POINTS / 2;
const MATCH_120M_FORMATION_WEIGHT = 18;
const MATCH_120M_DEFENCE_WEIGHT = 30;
const MATCH_120M_MIDFIELD_WEIGHT = 20;
const MATCH_120M_FORMATION_PROTECTION_SCALE = MATCH_120M_DEFENCE_WEIGHT + MATCH_120M_MIDFIELD_WEIGHT;
export const MATCH_120M_MIDFIELD_RED_THRESHOLD = 35;
export const MATCH_120M_MIDFIELD_WARNING_THRESHOLD = 50;
export const MATCH_120M_WARNING_STAGE_F_THRESHOLD = 25;
export const MATCH_120M_WARNING_STAGE_E_THRESHOLD = 40;
export const MATCH_120M_WARNING_STAGE_D_THRESHOLD = 55;
export type Match120mGrade = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D' | 'E-' | 'F-';
export type Match120mWarningGrade = 'D' | 'E' | 'F';

export interface Match120mSpecialtyThreatBreakdown {
  quick: { count: number; points: number };
  head: { count: number; points: number };
  unpredictable: { count: number; points: number };
  technical: { count: number; points: number };
  powerful: { count: number; points: number };
  total: number;
}

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
  sectorWarningGrades: Partial<Record<Match120mRatedSector, Match120mWarningGrade>>;
  formationScore: RatingIndicatorScore | null;
  tacticScore: RatingIndicatorScore | null;
  setPiecesScore: RatingIndicatorScore | null;
  mindsetScore: RatingIndicatorScore | null;
  formation: string | null;
  midfieldBalancePoints: number | null;
  powerfulPressingRoles: number[];
  quickCount: number | null;
  headCount: number | null;
  unpredictableCount: number | null;
  quickDefensiveRoles: number[];
  recommendations: string[];
  recommendationImpacts: Record<string, number>;
}

const formationPoints: Record<string, number> = {
  '5-5-0': 100, '5-4-1': 95, '5-3-2': 95, '4-5-1': 95,
  '5-2-3': 95, '4-4-2': 75, '4-3-3': 65, '3-5-2': 25,
  '3-4-3': 0, '2-5-3': 0,
};

// Translate incomplete-lineup indicator tiers onto the rating's existing 0–100 formation scale.
const incompleteFormationPoints: Partial<Record<RatingIndicatorScore, number>> = {
  0: 55, 1: 90, 2: 75, 4: 0,
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

function warningGradeForScore(score: number | null): Match120mWarningGrade | null {
  if (score === null || score >= MATCH_120M_WARNING_STAGE_D_THRESHOLD) return null;
  if (score < MATCH_120M_WARNING_STAGE_F_THRESHOLD) return 'F';
  if (score < MATCH_120M_WARNING_STAGE_E_THRESHOLD) return 'E';
  return 'D';
}

function hiddenRatingPenalty(
  indicatorScores: Array<RatingIndicatorScore | null>,
  seThreatPoints: number,
  hasRedPosition: boolean,
): number {
  const indicatorPenalty = indicatorScores.filter((score) => score !== null && score >= 3).length;
  return indicatorPenalty + seThreatRatingSurcharge(seThreatPoints) + Number(hasRedPosition);
}

function seThreatRatingSurcharge(seThreatPoints: number): number {
  return seThreatPoints >= 15 ? 3 : seThreatPoints >= 10 ? 2 : seThreatPoints >= 7 ? 1 : 0;
}

export const MATCH_120M_COUNTER_ATTACK_PENALTY = 10;

export function isCounterAttacks(tactic: string | null | undefined): boolean {
  return tactic?.trim().toLowerCase().replace(/[ -]+/g, '_') === 'counter_attacks';
}

function tacticRatingPoints(tactic: string, tacticSkill: number | null | undefined): number {
  const indicator = getTacticIndicatorScore(tactic);
  if (indicator === 1) {
    const level = typeof tacticSkill === 'number' && Number.isFinite(tacticSkill) ? tacticSkill : 0;
    return Math.max(0, 25 - Math.max(0, 15 - level) * 1.5);
  }
  return indicator === 3 ? 12.5 : 0;
}

function setPiecesRatingPoints(skill: number | null | undefined): number {
  if (typeof skill !== 'number' || !Number.isFinite(skill) || skill < 1) {
    return MATCH_120M_SET_PIECES_NEUTRAL_POINTS;
  }
  return Math.max(0, MATCH_120M_SET_PIECES_MAX_POINTS - skill * MATCH_120M_SET_PIECES_POINTS_PER_SKILL);
}

const allGrades = [
  'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-',
  'D+', 'D', 'D-', 'E+', 'E', 'E-', 'F+', 'F', 'F-',
] as const;

export function normalizeMatch120mGrade(grade: string): Match120mGrade {
  if (grade === 'A+' || grade === 'A-' || grade === 'B+' || grade === 'B-' ||
    grade === 'C+' || grade === 'C-' || grade === 'D' || grade === 'E-' || grade === 'F-') return grade;
  if (grade.startsWith('D')) return 'D';
  if (grade.startsWith('E')) return 'E-';
  if (grade.startsWith('F')) return 'F-';
  return (grade[0] ?? 'F') as Match120mGrade;
}

function gradeFor(score: number): Match120mGrade {
  if (score >= 95) return 'A+';
  if (score < 15) return 'F-';
  const original = allGrades[Math.min(allGrades.length - 2, Math.floor((95 - score + 4) / 5))];
  return normalizeMatch120mGrade(original);
}

/**
 * Applies a deliberately rough, opponent-independent penalty for offensive SE potential.
 * Specialty counts and eligible roles approximate event-opportunity generation; player
 * skills that affect conversion are deliberately not estimated here. The family steps add
 * diminishing returns, and the weights are calibration choices rather than Hattrick event
 * probabilities. With the current caps and uncertainty weights (100%, 100%, 75%, 25%, 50%),
 * the theoretical maximum is 22.5 points, below the 25-point scale ceiling.
 * This uses only specialties and lineup roles in the performance snapshot; it does not fetch
 * player skills or infer an opponent.
 * The role filters count Quick attackers, all Head players, outfield
 * Unpredictable players, Technical wingers/forwards, and Powerful forwards. Unknown specialty
 * data stays neutral. The returned breakdown drives the score tooltip.
 */
export function countMatch120mSpecialtyPlayers(
  specialties: SpecialtyPositionGroup[] | undefined,
  specialtyId: number,
): number | null {
  if (!Array.isArray(specialties)) return null;
  const roleIds = specialties.find((entry) => entry.specialtyId === specialtyId)?.roleIds ?? [];
  return roleIds
    .filter((roleId) => roleId >= 101 && roleId <= 113)
    .reduce((count, roleId) => count + (
      (specialtyId === 2 || specialtyId === 5) && roleId <= 105 ? 0.5 : 1
    ), 0);
}

export function calculateMatch120mSpecialtyThreatBreakdown(
  specialties: SpecialtyPositionGroup[] | undefined,
): Match120mSpecialtyThreatBreakdown {
  if (!Array.isArray(specialties)) {
    return {
      quick: { count: 0, points: 0 },
      head: { count: 0, points: 0 },
      unpredictable: { count: 0, points: 0 },
      technical: { count: 0, points: 0 },
      powerful: { count: 0, points: 0 },
      total: 0,
    };
  }

  const countRoles = (specialtyId: number, eligible: (roleId: number) => boolean) =>
    specialties.find((entry) => entry.specialtyId === specialtyId)?.roleIds.filter(eligible).length ?? 0;

  const quickAttackers = countRoles(2, (roleId) => roleId >= 106 && roleId <= 113);
  const headPlayers = countRoles(5, (roleId) => roleId >= 100 && roleId <= 113);
  const unpredictablePlayers = countRoles(4, (roleId) => roleId >= 101 && roleId <= 113);
  const technicalAttackers = countRoles(1, (roleId) => roleId === 106 || (roleId >= 110 && roleId <= 113));
  const powerfulForwards = countRoles(3, (roleId) => roleId >= 111 && roleId <= 113);

  // UNCERTAINTY REDUCTIONS
  const quickPoints = Math.min(5, quickAttackers * 2) * 1.00; // no uncertainty reduction for quick and head
  const headBasePoints = interpolate(headPlayers, [[0, 0], [1, 2], [2, 4], [3, 5]]);
  const headPoints = headBasePoints * 1.00; // no uncertainty reduction for quick and head anymore
  const unpredictableBasePoints = unpredictablePlayers === 0
    ? 0
    : unpredictablePlayers === 1
      ? 2
      : 5;
  const unpredictablePoints = unpredictableBasePoints * 0.75;
  const technicalBasePoints = technicalAttackers === 0 ? 0 : technicalAttackers === 1 ? 3 : 5;
  const technicalPoints = technicalBasePoints * 0.25;
  const powerfulPoints = (powerfulForwards > 0 ? 5 : 0) * 0.5;

  const total = Math.round(Math.min(
    MATCH_120M_MAX_SE_THREAT_PENALTY,
    quickPoints + headPoints + unpredictablePoints + technicalPoints + powerfulPoints,
  ));
  return {
    quick: { count: quickAttackers, points: quickPoints },
    head: { count: headPlayers, points: headPoints },
    unpredictable: { count: unpredictablePlayers, points: unpredictablePoints },
    technical: { count: technicalAttackers, points: technicalPoints },
    powerful: { count: powerfulForwards, points: powerfulPoints },
    total,
  };
}

export function calculateMatch120mSpecialtyThreatPenalty(
  specialties: SpecialtyPositionGroup[] | undefined,
): number {
  return calculateMatch120mSpecialtyThreatBreakdown(specialties).total;
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
  const midfieldAttackLoad = midfield + attack;
  const defenceCoverRatio = defence / midfieldAttackLoad;
  const midfieldPoints = interpolate(defenceCoverRatio, [[0.5, 0], [1, 100]]);
  const tacticPoints = tacticRatingPoints(tactic, performance.tacticSkill) * 4;
  const formationScore = getFormationIndicatorScore(formation);
  const tacticScore = getTacticIndicatorScore(tactic);
  const formationValue = formationPoints[formation] ?? incompleteFormationPoints[formationScore!];
  const skill = performance.setPiecesTaker?.skill;
  const hasSetPiecesSkill = typeof skill === 'number' && Number.isFinite(skill) && skill >= 1;
  const setPiecesPoints = setPiecesRatingPoints(skill);
  const setPiecesScore = getSetPieceIndicatorScore(skill);
  const specialties = performance.specialtyPositions;
  const seThreatPenalty = calculateMatch120mSpecialtyThreatPenalty(specialties);
  const hasRedPosition = [raw.leftDefence!, raw.centralDefence!, raw.rightDefence!]
    .some((value) => display(value) < 5)
    || midfieldPoints < MATCH_120M_WARNING_STAGE_F_THRESHOLD
    || attacks.some((value) => value >= 11.25);
  const additionalRatingPenalty = hiddenRatingPenalty(
    [formationScore, tacticScore, setPiecesScore],
    seThreatPenalty,
    hasRedPosition,
  );
  const attackPenalty = maxAttack >= 8 ? 8 : maxAttack >= 7 ? 3 : maxAttack >= 6 ? 2 : maxAttack >= 5 ? 1 : 0;
  const formationPenalty = Math.max(0, (100 - formationValue!) * 0.18);
  const formationProtection = Math.min(1, Math.max(0,
    (defencePoints * MATCH_120M_DEFENCE_WEIGHT + midfieldPoints * MATCH_120M_MIDFIELD_WEIGHT)
      / (MATCH_120M_FORMATION_PROTECTION_SCALE * 100),
  ));
  const unprotectedFormationPenalty = formationPenalty * (1 - formationProtection);
  const positiveScore = defencePoints * 0.30 + tacticPoints * 0.25
    + (MATCH_120M_FORMATION_WEIGHT - unprotectedFormationPenalty)
    + midfieldPoints * 0.20 + setPiecesPoints;
  const score = Math.round(Math.max(0, Math.min(100,
    Math.min(100, positiveScore) - seThreatPenalty - attackPenalty - additionalRatingPenalty
      - (isCounterAttacks(tactic) ? MATCH_120M_COUNTER_ATTACK_PENALTY : 0),
  )));
  return { score, grade: gradeFor(score), formula_version: MATCH_120M_FORMULA_VERSION,
    has_set_pieces_skill: hasSetPiecesSkill, has_specialties: Array.isArray(specialties) };
}

export function usesMatch120mRatings(scoringMode: string | null | undefined): boolean {
  return scoringMode === '120m' || scoringMode === '120min' || scoringMode === 'average120' || scoringMode === 'appg';
}

const ratedSectors: Match120mRatedSector[] = [
  'leftAttack', 'centreAttack', 'rightAttack', 'midfield', 'leftDefence', 'centreDefence', 'rightDefence',
];

/** Derives all 120m colors and coaching points from a team's lineup; only Quick defensive cover reads opponent specialties. */
export function analyzeMatch120mCoaching(
  performance: MatchSidePerformance | null | undefined,
  opposingSpecialties?: SpecialtyPositionGroup[],
): Match120mCoachingAnalysis {
  const rating = calculateMatch120mRating(performance);
  const sectorScores: Match120mCoachingAnalysis['sectorScores'] = {};
  const sectorWarningGrades: Match120mCoachingAnalysis['sectorWarningGrades'] = {};
  const recommendations: string[] = [];
  const recommendationImpacts: Record<string, number> = {};
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
  let defenceRatingPoints: number | null = null;
  let midfieldRatingPoints: number | null = null;
  let attackPenaltyPoints = 0;
  if (averageDefence !== null && averageAttack !== null && midfield !== null) {
    const highestAttack = Math.max(...attacks.map((value) => value ?? 0));
    const allDefenceRatingsAtLeastFive = defences.every((value) => value !== null && value >= 5);
    const allDefenceRatingsVeryStrong = (defences.every((value) => value !== null && value >= 11)
      && averageDefence >= 12)
      || (allDefenceRatingsAtLeastFive
        && averageDefence >= highestAttack * 2
        && averageDefence >= midfield * 1.5);
    const allDefenceRatingsStrong = allDefenceRatingsAtLeastFive
      && averageDefence >= highestAttack * 1.5
      && averageDefence >= midfield * 1.5;
    const ownValues: Record<Match120mRatedSector, number> = {
      leftAttack: attacks[0]!, centreAttack: attacks[1]!, rightAttack: attacks[2]!, midfield,
      leftDefence: defences[0]!, centreDefence: defences[1]!, rightDefence: defences[2]!,
    };
    defenceRatingPoints = interpolate(averageDefence / averageAttack, [[0.6, 0], [0.8, 40], [1, 70], [1.25, 90], [1.5, 100]]);
    midfieldRatingPoints = interpolate(
      averageDefence / (midfield + averageAttack),
      [[0.5, 0], [1, 100]],
    );
    const midfieldIsStrongerThanAttack = midfield > averageAttack;
    const balanceWarningGrade = midfieldIsStrongerThanAttack
      ? warningGradeForScore(midfieldRatingPoints)
      : null;
    attackPenaltyPoints = Math.max(...attacks.map((value) => value ?? 0)) >= 8 ? 8
      : Math.max(...attacks.map((value) => value ?? 0)) >= 7 ? 3
        : Math.max(...attacks.map((value) => value ?? 0)) >= 6 ? 2
          : Math.max(...attacks.map((value) => value ?? 0)) >= 5 ? 1 : 0;
    for (const sector of ratedSectors) {
      if (sector === 'midfield') {
        if (balanceWarningGrade) sectorWarningGrades[sector] = balanceWarningGrade;
        if (midfieldIsStrongerThanAttack && midfieldRatingPoints !== null
          && midfieldRatingPoints < MATCH_120M_MIDFIELD_RED_THRESHOLD) {
          sectorScores[sector] = 4;
        } else if (midfieldIsStrongerThanAttack && midfieldRatingPoints !== null
          && midfieldRatingPoints < MATCH_120M_MIDFIELD_WARNING_THRESHOLD) {
          sectorScores[sector] = 3;
        }
      } else if (sector.endsWith('Attack')) {
        const attackWarningGrade: Match120mWarningGrade | null = ownValues[sector] >= 11.25 ? 'F'
          : ownValues[sector] >= 8 ? 'E'
            : ownValues[sector] > averageDefence ? 'D' : null;
        if (attackWarningGrade) sectorWarningGrades[sector] = attackWarningGrade;
        if (ownValues[sector] >= 8 || ownValues[sector] > averageDefence) sectorScores[sector] = 4;
      } else if (ownValues[sector] < 5) {
        sectorWarningGrades[sector] = 'F';
        sectorScores[sector] = 4;
      } else if (allDefenceRatingsVeryStrong) {
        sectorScores[sector] = 1;
      } else if (allDefenceRatingsStrong) {
        sectorScores[sector] = 2;
      }
    }
    if (midfield > averageAttack && midfield + averageAttack > averageDefence) {
      recommendations.push('balanceMidfield');
    }
    if (defences.some((value) => value !== null && value < 5)) recommendations.push('adviceWeakDefence');
    if (highestAttack >= 11.25) recommendations.push('adviceVeryHighAttack');
    else if (highestAttack >= 8) recommendations.push('adviceDangerousAttack');
    else if (attacks.some((value) => value !== null && value > averageDefence)) recommendations.push('lowerAttack');
  }

  const specialties = performance?.specialtyPositions;
  const quickCount = countMatch120mSpecialtyPlayers(specialties, 2);
  const headCount = countMatch120mSpecialtyPlayers(specialties, 5);
  const unpredictableCount = countMatch120mSpecialtyPlayers(specialties, 4);
  const seThreatPenalty = calculateMatch120mSpecialtyThreatPenalty(specialties);
  if ((quickCount ?? 0) >= 3) recommendations.push('reduceQuick');
  if ((headCount ?? 0) >= 3) recommendations.push('reduceHead');
  if ((unpredictableCount ?? 0) >= 3) recommendations.push('reduceUnpredictable');
  if (seThreatPenalty > 0) recommendations.push('reduceSEThreat');

  const quickOpponents = opposingSpecialties?.find((entry) => entry.specialtyId === 2)?.roleIds ?? [];
  const defensiveRoleToAttackRole: Record<number, number> = {
    101: 110, 102: 113, 103: 112, 104: 111, 105: 106, 107: 109, 108: 108, 109: 107,
  };
  const quickDefensiveRoles: number[] = [];
  if (Array.isArray(specialties) && opposingSpecialties) {
    for (const role of specialties.find((entry) => entry.specialtyId === 2)?.roleIds ?? []) {
      const opposingAttackRole = defensiveRoleToAttackRole[role];
      if (opposingAttackRole !== undefined && quickOpponents.includes(opposingAttackRole)) {
        quickDefensiveRoles.push(role);
      }
    }
  }

  const formationScore = getFormationIndicatorScore(performance?.formation);
  const tacticName = performance?.tacticType === 0 ? 'Normal'
    : performance?.tacticType === 1 ? 'Pressing' : performance?.tacticName;
  const powerfulPressingRoles = tacticName?.trim().toLowerCase() === 'pressing'
    ? specialties?.find((entry) => entry.specialtyId === 3)?.roleIds
      .filter((role) => role >= 101 && role <= 105) ?? []
    : [];
  const tacticScore = getTacticIndicatorScore(tacticName);
  const skill = performance?.setPiecesTaker?.skill;
  const setPiecesScore = getSetPieceIndicatorScore(skill);
  const mindsetScore = getMatchMindsetIndicator(performance?.styleOfPlay)?.score ?? null;
  const tacticPoints = tacticRatingPoints(tacticName ?? '', performance?.tacticSkill) * 4;
  const setPiecesPoints = setPiecesRatingPoints(skill);
  const formationValue = performance?.formation
    ? formationPoints[performance.formation.trim()] ?? incompleteFormationPoints[formationScore ?? -1]
    : undefined;
  const formationPenalty = formationValue === undefined ? 0 : Math.max(0, (100 - formationValue) * 0.18);
  const formationProtection = Math.min(1, Math.max(0,
    ((defenceRatingPoints ?? 0) * MATCH_120M_DEFENCE_WEIGHT
      + (midfieldRatingPoints ?? 0) * MATCH_120M_MIDFIELD_WEIGHT)
      / (MATCH_120M_FORMATION_PROTECTION_SCALE * 100),
  ));

  if (formationScore !== null && formationScore !== 0 && formationScore !== 1 && formationValue !== undefined && formationValue < 100) {
    recommendations.push('chooseDefensiveFormation');
  }
  if (tacticScore !== null && tacticScore !== 1) recommendations.push('choosePressing');
  else if (tacticScore === 1 && (performance?.tacticSkill ?? 0) < 12) recommendations.push('improvePressingSkill');
  if (setPiecesScore !== 1 && !(typeof skill === 'number' && skill >= 4 && skill <= 7)) {
    recommendations.push('improveSetPieces');
  }

  if (defenceRatingPoints !== null && midfieldRatingPoints !== null) {
    if (recommendations.includes('balanceMidfield')) {
      recommendationImpacts.balanceMidfield = Math.max(0, (100 - midfieldRatingPoints) * 0.20);
    }
    if (recommendations.includes('adviceWeakDefence')) {
      recommendationImpacts.adviceWeakDefence = Math.max(0, (100 - defenceRatingPoints) * 0.30)
        + Math.max(0, (100 - midfieldRatingPoints) * 0.20);
    }
    for (const key of ['lowerAttack', 'adviceDangerousAttack', 'adviceVeryHighAttack']) {
      if (recommendations.includes(key)) {
        recommendationImpacts[key] = attackPenaltyPoints + Math.max(0, (100 - defenceRatingPoints) * 0.30);
      }
    }
  }
  if (recommendations.includes('reduceSEThreat')) {
    recommendationImpacts.reduceSEThreat = seThreatPenalty + seThreatRatingSurcharge(seThreatPenalty);
  }
  if (recommendations.includes('choosePressing')) recommendationImpacts.choosePressing = (100 - tacticPoints) * 0.25
    + (isCounterAttacks(tacticName) ? MATCH_120M_COUNTER_ATTACK_PENALTY : 0);
  if (recommendations.includes('improvePressingSkill')) {
    recommendationImpacts.improvePressingSkill = Math.max(
      0,
      25 - tacticRatingPoints(tacticName ?? '', performance?.tacticSkill),
    );
  }
  if (recommendations.includes('improveSetPieces')) {
    recommendationImpacts.improveSetPieces = setPiecesRatingPoints(1) - setPiecesPoints;
  }
  if (recommendations.includes('chooseDefensiveFormation') && formationValue !== undefined) {
    recommendationImpacts.chooseDefensiveFormation = formationPenalty * (1 - formationProtection);
  }
  if (rating && rating.grade !== 'A' && rating.grade !== 'A+' && recommendations.length === 0) recommendations.push('fineTuneLineup');

  return { rating, sectorScores, sectorWarningGrades, formationScore, tacticScore, setPiecesScore, mindsetScore,
    formation: performance?.formation ?? null,
    midfieldBalancePoints: midfieldRatingPoints,
    powerfulPressingRoles,
    quickCount, headCount, unpredictableCount, quickDefensiveRoles,
    recommendations: [...new Set(recommendations)], recommendationImpacts };
}
