export type MatchCardReason = 'nasty_play' | 'cheating' | null;
export type MatchCardType = 'yellow' | 'second_yellow_red' | 'straight_red';
export type MatchInjurySeverity = 'plaster' | 'injury';
export type MatchGoalCategory = 'regular' | 'other';

export interface MatchGoalEvent {
  eventTypeId: number;
  playerId: number | null;
  minute: number | null;
  matchPart: number | null;
  category: MatchGoalCategory;
}

export interface MatchCardEvent {
  eventTypeId: 510 | 511 | 512 | 513 | 514;
  playerId: number | null;
  minute: number | null;
  matchPart: number | null;
  type: MatchCardType;
  reason: MatchCardReason;
}

export interface MatchInjuryEvent {
  playerId: number | null;
  minute: number | null;
  matchPart: number | null;
  injuryType: number;
  severity: MatchInjurySeverity;
  locationEventTypeId: number | null;
  weeks: number | null;
  causedByFoul: boolean;
  causedByTeamId: number | null;
}

export interface MatchSideEventDetails {
  teamId: number | null;
  cards: MatchCardEvent[];
  injuries: MatchInjuryEvent[];
  goals?: MatchGoalEvent[];
  penaltyShootoutGoals?: number;
}

export interface MatchEventDetails {
  version: 1;
  source: 'matchdetails-3.1';
  actualHomeTeamId: number | null;
  actualAwayTeamId: number | null;
  hasPenaltyShootout?: boolean;
  home: MatchSideEventDetails;
  away: MatchSideEventDetails;
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
