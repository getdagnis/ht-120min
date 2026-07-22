/** Values currently persisted in tournaments.scoring_mode. */
export type PersistedScoringMode = '120m' | '120min' | 'points' | 'appg';

/** Explicit internal identities. These are not database values yet. */
export type ScoringProfileId = '120min' | 'victory-points' | 'appg-120';
export type ScoringReference = PersistedScoringMode | ScoringProfileId;
export type StandingsAggregation = 'total-120m' | 'total-points' | 'average-points';
export type MatchRulesetId = 'standard' | 'appg-120';

export interface ScoringProfile {
  id: ScoringProfileId;
  label: string;
  persistedMode: PersistedScoringMode;
  aggregation: StandingsAggregation;
  matchRuleset: MatchRulesetId;
  targetMinutes: number | null;
  supportsChppAutoClassification: boolean;
}

const SCORING_PROFILES: Record<ScoringProfileId, ScoringProfile> = {
  '120min': {
    id: '120min',
    label: '120-minute achievements',
    persistedMode: '120min',
    aggregation: 'total-120m',
    matchRuleset: 'standard',
    targetMinutes: 120,
    supportsChppAutoClassification: false,
  },
  'victory-points': {
    id: 'victory-points',
    label: 'Victory points',
    persistedMode: 'points',
    aggregation: 'total-points',
    matchRuleset: 'standard',
    targetMinutes: 90,
    supportsChppAutoClassification: false,
  },
  'appg-120': {
    id: 'appg-120',
    label: 'APPG-120',
    persistedMode: 'appg',
    aggregation: 'average-points',
    matchRuleset: 'appg-120',
    targetMinutes: 120,
    supportsChppAutoClassification: true,
  },
};

export function resolveScoringProfile(reference?: ScoringReference | string | null): ScoringProfile {
  if (reference === 'appg' || reference === 'appg-120') return SCORING_PROFILES['appg-120'];
  if (reference === 'points' || reference === 'victory-points') return SCORING_PROFILES['victory-points'];
  return SCORING_PROFILES['120min'];
}

export function isAppg120ScoringMode(reference?: ScoringReference | string | null) {
  return resolveScoringProfile(reference).id === 'appg-120';
}

export function usesAveragePoints(reference?: ScoringReference | string | null) {
  return resolveScoringProfile(reference).aggregation === 'average-points';
}

export function supportsAppg120ChppClassification(reference?: ScoringReference | string | null) {
  const profile = resolveScoringProfile(reference);
  return profile.matchRuleset === 'appg-120' && profile.supportsChppAutoClassification;
}

export function persistedScoringMode(profileId: ScoringProfileId): PersistedScoringMode {
  return SCORING_PROFILES[profileId].persistedMode;
}
