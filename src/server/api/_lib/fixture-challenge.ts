import type { ChppChallengeMatchPlace, ChppChallengeMatchType } from './chpp-challenges.js';

export type FixtureChallengeSide = 'home' | 'away';
export type FixtureChallengeMatchTypeChoice = 'cup_rules' | 'normal';
export type FixtureChallengeVenueChoice = 'home' | 'away';

export type FixtureChallengeOptions = {
  matchType: ChppChallengeMatchType;
  matchPlace: ChppChallengeMatchPlace;
};

export function getFixtureChallengeMatchType(scoringMode?: string | null): ChppChallengeMatchType {
  return scoringMode === '120m' || scoringMode === '120min' ? 1 : 0;
}

export function getFixtureChallengeMatchPlace(side: FixtureChallengeSide): ChppChallengeMatchPlace {
  // CHPP: 0 = home, 1 = away. The fixture side is authoritative.
  return side === 'home' ? 0 : 1;
}

/**
 * Fixture identity remains server-derived. Managers may choose only the
 * friendly rules and venue for an otherwise verified opponent.
 */
export function resolveFixtureChallengeOptions(
  input: { matchType?: string; venue?: string },
  fallback: FixtureChallengeOptions,
): FixtureChallengeOptions | null {
  const matchType =
    !input.matchType
      ? fallback.matchType
      : input.matchType === 'cup_rules'
        ? 1
        : input.matchType === 'normal'
          ? 0
          : null;
  const matchPlace =
    !input.venue ? fallback.matchPlace : input.venue === 'home' ? 0 : input.venue === 'away' ? 1 : null;

  return matchType === null || matchPlace === null ? null : { matchType, matchPlace };
}

export function getFixtureChallengeSide(input: {
  viewerUserId: number;
  homeOwnerId?: number | null;
  awayOwnerId?: number | null;
}): FixtureChallengeSide | null {
  if (input.homeOwnerId === input.viewerUserId) return 'home';
  if (input.awayOwnerId === input.viewerUserId) return 'away';
  return null;
}
