export type MatchCardReason = 'nasty_play' | 'cheating' | null;

// Pure event labels shared by the parser and browser tooltip fallback.
export const CARD_EVENT_TYPES = new Set([510, 511, 512, 513, 514]);
export const MISSED_CHANCE_EVENT_TYPES = new Set([
  ...Array.from({ length: 26 }, (_, index) => 200 + index),
  ...Array.from({ length: 8 }, (_, index) => 230 + index),
  ...Array.from({ length: 5 }, (_, index) => 239 + index),
  ...Array.from({ length: 5 }, (_, index) => 250 + index),
  ...Array.from({ length: 5 }, (_, index) => 260 + index),
  ...Array.from({ length: 5 }, (_, index) => 270 + index),
  ...Array.from({ length: 11 }, (_, index) => 280 + index),
]);

const EVENT_DESCRIPTIONS: Record<number, string> = {
  55: 'penalty shootout goal by technical player without nerves',
  56: 'penalty shootout goal without nerves',
  57: 'penalty shootout goal despite nerves',
  58: 'penalty shootout miss because of nerves',
  59: 'penalty shootout miss despite no nerves',
  61: 'organisation break', 64: 'team reorganised', 65: 'nerves in an important match',
  68: 'successful pressing', 69: 'underestimation removed', 70: 'extra time started',
  71: 'penalty shootout after extra time', 72: 'extra time decided', 73: 'penalty shootout decided by coin toss',
  75: 'added time announced', 76: 'no added time announced',
  90: 'injured but continued playing', 91: 'injured and left the field', 92: 'badly injured and left the field',
  93: 'injured with no replacement', 94: 'injured after foul but continued', 95: 'injured after foul and left the field',
  96: 'injured after foul with no replacement', 97: 'keeper injured; field player took goal',
  107: 'long-shot goal', 115: 'quick player scored after a rush', 116: 'quick rush created a goal',
  117: 'tired defender mistake led to a goal', 118: 'corner created a goal', 119: 'corner goal by a head specialist',
  125: 'unpredictable own goal', 135: 'experienced forward scored', 136: 'inexperienced defender caused a goal',
  137: 'winger supplied a head specialist who scored', 138: 'winger supplied a goal', 139: 'technical player beat a head specialist',
  185: 'indirect free-kick goal', 186: 'counter-attack goal from an indirect free kick', 187: 'long-shot goal',
  190: 'powerful forward created an extra-chance goal',
  207: 'long shot missed', 215: 'quick player missed after a rush', 216: 'quick rush failed to produce a goal',
  217: 'tired defender mistake did not produce a goal', 218: 'corner chance missed', 219: 'head-specialist corner chance missed',
  225: 'unpredictable own-goal chance missed', 235: 'experienced forward missed', 236: 'inexperienced defender almost caused a goal',
  237: 'winger-created chance missed', 239: 'technical player failed against a head specialist',
  240: 'counter-attack chance missed from a free kick', 241: 'counter-attack chance missed through the centre',
  242: 'counter-attack chance missed on the left', 243: 'counter-attack chance missed on the right',
  285: 'indirect free-kick chance missed', 286: 'counter-attack chance missed from an indirect free kick',
  287: 'long-shot chance missed', 288: 'long-shot chance saved', 289: 'quick rush stopped by a quick defender',
  290: 'powerful forward extra-chance missed',
  301: 'technical player affected by rain', 302: 'powerful player benefited from rain', 303: 'technical player benefited from sun',
  304: 'powerful player affected by sun', 305: 'quick player affected by rain', 306: 'quick player affected by sun',
  307: 'support-player boost succeeded', 308: 'support-player boost failed and organisation dropped', 309: 'support-player boost failed',
  310: 'powerful defensive player pressed a chance', 311: 'counter-attack triggered by a technical defender',
  331: 'pressing tactic used', 332: 'counter-attacking tactic used', 333: 'attack through the middle used',
  334: 'attack on the wings used', 335: 'play creatively tactic used', 336: 'long-shot tactic used',
  343: 'attack through the middle used', 344: 'attack on the wings used',
  350: 'substitution while team was behind', 351: 'substitution while team was ahead', 352: 'substitution',
  360: 'tactical change while team was behind', 361: 'tactical change while team was ahead', 362: 'tactical change',
  370: 'position swap while team was behind', 371: 'position swap while team was ahead', 372: 'position swap',
  380: 'successful short-distance man marking', 381: 'successful long-distance man marking',
  382: 'man marking changed from short to long distance', 383: 'man marking changed from long to short distance',
  384: 'man-marking penalty: no opponent was marked', 385: 'man marker changed from short to long distance',
  386: 'man marker changed from long to short distance', 387: 'man-marking penalty: opponent was out of position',
  388: 'man-marking penalty: marker was out of position', 389: 'man-marking penalty: no opponent was available',
  390: 'rain affected many players', 391: 'sun affected many players',
  450: 'third yellow card caused a suspension', 455: 'new star player', 473: 'career-ending injury', 489: 'comeback after a long injury',
  456: 'player reached a career-goal milestone', 457: 'player reached a league-goal milestone', 458: 'player reached a cup-goal milestone',
  650: 'Hattrick anniversary', 651: 'team anniversary', 700: 'manager taunted the opponent', 701: 'manager praised the opponent',
  702: 'manager asked fans for support', 703: 'manager expected a great show', 704: 'manager honoured club legacy',
  812: 'player birthday', 813: 'new match kit', 818: 'brothers played together', 819: 'parent and child played together',
  820: 'family members faced each other', 821: 'family members combined for a goal', 822: 'family members faced each other in a penalty',
};

export function getCanonicalEventDescription(typeId: number): string {
  if (EVENT_DESCRIPTIONS[typeId]) return EVENT_DESCRIPTIONS[typeId];
  if (typeId >= 100 && typeId <= 190) {
    const location = typeId % 10;
    if (location === 0) return 'free-kick goal';
    if (location === 1) return 'goal through the centre';
    if (location === 2) return 'goal on the left';
    if (location === 3) return 'goal on the right';
    if (location === 4) return 'penalty goal';
    return 'goal';
  }
  if (MISSED_CHANCE_EVENT_TYPES.has(typeId)) {
    const location = typeId % 10;
    if (location === 0) return 'free-kick chance missed';
    if (location === 1) return 'chance missed through the centre';
    if (location === 2) return 'chance missed on the left';
    if (location === 3) return 'chance missed on the right';
    if (location === 4) return 'penalty chance missed';
    return 'chance missed';
  }
  if (typeId >= 401 && typeId <= 422) return `${INJURY_LOCATION_LABELS[typeId] || 'body part'} injury`;
  if (typeId === 423) return 'injured after a foul';
  if (typeId === 424) return 'injured player replaced';
  if (typeId === 425) return 'injured player had no replacement';
  if (typeId === 426) return 'field player replaced an injured keeper';
  if (typeId === 427) return 'injured regainer was bruised';
  if (CARD_EVENT_TYPES.has(typeId)) return getCardDescription(typeId);
  return `structured event ${typeId}`;
}

function getCardDescription(typeId: number): string {
  if (typeId === 510) return 'yellow card for nasty play';
  if (typeId === 511) return 'yellow card for cheating';
  if (typeId === 512) return 'second-yellow red card for nasty play';
  if (typeId === 513) return 'second-yellow red card for cheating';
  return 'straight red card';
}

export type MatchCardType = 'yellow' | 'second_yellow_red' | 'straight_red';
export type MatchInjurySeverity = 'plaster' | 'injury';
export type MatchGoalCategory = 'regular' | 'other' | 'penalty_shootout';
export type MatchDecisionType = 'regulation' | 'extra_time' | 'penalty_shootout';

export interface MatchGoalEvent {
  eventTypeId: number;
  playerId: number | null;
  playerName?: string | null;
  minute: number | null;
  matchPart: number | null;
  category: MatchGoalCategory;
  /** Stable, human-readable subtype derived from EventTypeID (never EventText). */
  description?: string;
}

export interface MatchNotableEvent {
  eventTypeId: number;
  minute: number | null;
  matchPart: number | null;
  teamId: number | null;
  playerId?: number | null;
  playerName?: string | null;
  category: string;
  description: string;
}

export interface MatchCardEvent {
  eventTypeId: 510 | 511 | 512 | 513 | 514;
  playerId: number | null;
  playerName?: string | null;
  minute: number | null;
  matchPart: number | null;
  type: MatchCardType;
  reason: MatchCardReason;
}

export interface MatchInjuryEvent {
  playerId: number | null;
  playerName?: string | null;
  minute: number | null;
  matchPart: number | null;
  injuryType: number;
  severity: MatchInjurySeverity;
  locationEventTypeId: number | null;
  weeks: number | null;
  causedByFoul: boolean;
  causedByTeamId: number | null;
}

export interface MatchScore {
  home: number;
  away: number;
}

export interface MatchResultDetails {
  scoreAfterRegulation: MatchScore;
  scoreAfterExtraTime: MatchScore;
  penaltyShootout: MatchScore | null;
  decisionType: MatchDecisionType;
  winnerTeamId: number | null;
  reached120: boolean;
}

export interface MatchRatings {
  midfield: number | null;
  rightDefence: number | null;
  centralDefence: number | null;
  leftDefence: number | null;
  rightAttack: number | null;
  centralAttack: number | null;
  leftAttack: number | null;
}

export interface MatchChanceCounts {
  left: number | null;
  centre: number | null;
  right: number | null;
  specialEvents: number | null;
  other: number | null;
}

export interface MatchSidePerformance {
  formation: string | null;
  tacticType: number | null;
  tacticName: string | null;
  tacticSkill: number | null;
  possessionFirstHalf: number | null;
  possessionSecondHalf: number | null;
  ratings: MatchRatings;
  chances: MatchChanceCounts;
}

export interface MatchSideEventDetails {
  teamId: number | null;
  cards: MatchCardEvent[];
  injuries: MatchInjuryEvent[];
  goals?: MatchGoalEvent[];
  penaltyShootoutGoals?: number;
  performance?: MatchSidePerformance;
}

export interface MatchEventDetails {
  version: 1 | 2;
  source: 'matchdetails-3.1' | 'live-2.3';
  actualHomeTeamId: number | null;
  actualAwayTeamId: number | null;
  hasPenaltyShootout?: boolean;
  result?: MatchResultDetails;
  home: MatchSideEventDetails;
  away: MatchSideEventDetails;
  /** Optional curated event facts. Missing on older v1/v2 archives. */
  notableEvents?: MatchNotableEvent[];
}

export interface MatchEventSummary {
  home_yellow_cards: number;
  home_red_cards: number;
  home_injuries: number;
  away_yellow_cards: number;
  away_red_cards: number;
  away_injuries: number;
}

export const MATCH_CARD_EVENT_TYPES = {
  yellowNasty: 510,
  yellowCheating: 511,
  secondYellowNasty: 512,
  secondYellowCheating: 513,
  straightRed: 514,
} as const;

export const INJURY_LOCATION_LABELS: Record<number, string> = {
  401: 'left knee',
  402: 'right knee',
  403: 'left thigh',
  404: 'right thigh',
  405: 'left foot',
  406: 'right foot',
  407: 'left ankle',
  408: 'right ankle',
  409: 'left calf',
  410: 'right calf',
  411: 'left groin',
  412: 'right groin',
  413: 'collarbone',
  414: 'back',
  415: 'left hand',
  416: 'right hand',
  417: 'left arm',
  418: 'right arm',
  419: 'left shoulder',
  420: 'right shoulder',
  421: 'rib',
  422: 'head',
};

export const getCardEventLabel = (card: MatchCardEvent) => {
  const reason = card.reason === 'nasty_play' ? 'nasty play' : card.reason === 'cheating' ? 'cheating' : null;
  const base = card.type === 'yellow' ? 'Yellow card' : card.type === 'second_yellow_red' ? 'Second yellow / red card' : 'Red card';
  return reason ? `${base} for ${reason}` : base;
};

export const getInjuryEventLabel = (injury: MatchInjuryEvent) => {
  const type = injury.severity === 'plaster' ? 'Plaster' : 'Injury';
  const details = [
    injury.weeks ? `${injury.weeks} ${injury.weeks === 1 ? 'week' : 'weeks'}` : null,
    injury.locationEventTypeId ? INJURY_LOCATION_LABELS[injury.locationEventTypeId] || null : null,
  ].filter(Boolean);
  return details.length > 0 ? `${type}: ${details.join(', ')}` : type;
};
