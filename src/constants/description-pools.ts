import {
  DESCRIPTIONS as EN_DESCRIPTIONS,
  TOURNAMENT_DEFAULT as EN_TOURNAMENT_DEFAULT,
  TOURNAMENT_DEFAULT_120MIN_DEFAULTS as EN_TOURNAMENT_DEFAULT_120MIN_DEFAULTS,
} from './descriptions';
import {
  DESCRIPTIONS as LV_DESCRIPTIONS,
  TOURNAMENT_DEFAULT as LV_TOURNAMENT_DEFAULT,
  TOURNAMENT_DEFAULT_120MIN_DEFAULTS as LV_TOURNAMENT_DEFAULT_120MIN_DEFAULTS,
} from './descriptions.lv';

export interface DescriptionPools {
  general: string[];
  tournament: string[];
  tournament120MinuteDefaults: string[];
}

export function getDescriptionPools(locale: string): DescriptionPools {
  if (locale === 'lv') {
    return {
      general: LV_DESCRIPTIONS,
      tournament: LV_TOURNAMENT_DEFAULT,
      tournament120MinuteDefaults: LV_TOURNAMENT_DEFAULT_120MIN_DEFAULTS,
    };
  }

  return {
    general: EN_DESCRIPTIONS,
    tournament: EN_TOURNAMENT_DEFAULT,
    tournament120MinuteDefaults: EN_TOURNAMENT_DEFAULT_120MIN_DEFAULTS,
  };
}
