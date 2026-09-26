import {
  getLeagueWorldDetails,
  resolveCountryRestriction,
  type CountryRestrictionFormat,
} from '../../shared/worlddetails';

const HFI_LEAGUE_ID = 3000;
const SPECIAL_EMOJI_LIMIT = 2;
const DEFAULT_EMOJI_COUNT = 10;
const INITIAL_EMOJI_COUNT = DEFAULT_EMOJI_COUNT - SPECIAL_EMOJI_LIMIT;

export interface TournamentEmojiContext {
  leagueCategory?: string | null;
  countryLimit?: string | number | null;
  countryLimitFormat?: CountryRestrictionFormat | null;
}

export const TOURNAMENT_EMOJI_OPTIONS = ['😅', '😢', '🥶', '🏆', '💪', '🔥', '❤️', '🍺', '⚽️'] as const;

export function getTournamentSpecialEmojis(context?: TournamentEmojiContext): string[] {
  if (!context) return [];

  const specialEmojis: string[] = [];
  if (context.leagueCategory === 'hfi') {
    const hfiEmoji = getLeagueWorldDetails(HFI_LEAGUE_ID)?.emoji;
    if (hfiEmoji) specialEmojis.push(hfiEmoji);
  }

  const countryRestriction = resolveCountryRestriction(context.countryLimit, context.countryLimitFormat);
  if (countryRestriction?.emoji) specialEmojis.push(countryRestriction.emoji);

  return [...new Set(specialEmojis)].slice(0, SPECIAL_EMOJI_LIMIT);
}

export function buildTournamentEmojiOptions(
  currentOptions: readonly string[],
  context?: TournamentEmojiContext,
  targetCount = DEFAULT_EMOJI_COUNT,
): string[] {
  const initialOptions = currentOptions.slice(0, INITIAL_EMOJI_COUNT);
  const fallbackOptions = currentOptions.slice(INITIAL_EMOJI_COUNT);
  const result: string[] = [];
  const used = new Set<string>();

  const addOption = (emoji: string) => {
    if (result.length >= targetCount || used.has(emoji)) return;
    result.push(emoji);
    used.add(emoji);
  };

  initialOptions.forEach(addOption);
  getTournamentSpecialEmojis(context).forEach(addOption);
  fallbackOptions.forEach(addOption);

  return result;
}
