import type { Avatar } from '../hooks/useAuth';

export type MatchmakerStatus = 'open' | 'matched' | 'expired' | 'cancelled';

export type MatchmakerActivityType = 'challenge_sent' | 'interest_shown';

export type MatchmakerSwipeAction = 'next' | 'challenge' | null;

export const MATCHMAKER_SWIPE_THRESHOLD = 56;
export const MATCHMAKER_SWIPE_DOMINANCE_RATIO = 1.2;

export const resolveMatchmakerSwipe = (
  deltaX: number,
  deltaY: number,
  threshold = MATCHMAKER_SWIPE_THRESHOLD,
): MatchmakerSwipeAction => {
  const horizontalDistance = Math.abs(deltaX);
  const verticalDistance = Math.abs(deltaY);

  if (horizontalDistance < threshold || horizontalDistance <= verticalDistance * MATCHMAKER_SWIPE_DOMINANCE_RATIO)
    return null;
  return deltaX < 0 ? 'next' : 'challenge';
};

export const getMatchmakerSwipePreviewOffset = (deltaX: number, deltaY: number, limit = 160) =>
  resolveMatchmakerSwipe(deltaX, deltaY) ? Math.max(-limit, Math.min(limit, deltaX)) : 0;

export type MatchmakerDeckView<T> =
  | { status: 'card'; index: number; item: T }
  | { status: 'exhausted'; index: number };

export const normalizeMatchmakerDeckCursor = (cursor: number, itemCount: number) => {
  const safeCount = Math.max(0, itemCount);
  return Math.max(0, Math.min(Math.trunc(cursor), safeCount));
};

export const getMatchmakerDeckView = <T>(items: readonly T[], cursor: number): MatchmakerDeckView<T> => {
  const index = normalizeMatchmakerDeckCursor(cursor, items.length);
  if (index >= items.length) return { status: 'exhausted', index };
  return { status: 'card', index, item: items[index] };
};

export const advanceMatchmakerDeckCursor = (cursor: number, itemCount: number) =>
  normalizeMatchmakerDeckCursor(cursor + 1, itemCount);

export const shouldAdvanceMatchmakerDeckAfterAction = (
  currentRequestId: string | undefined,
  actedOnRequestId: string,
) => currentRequestId === actedOnRequestId;

export type MatchmakerBrowseTab = 'browse' | 'hfi' | 'long-term';
export type MatchmakerBrowseAction = 'challenge' | 'interest';

export const getMatchmakerBrowseAction = (
  tab: MatchmakerBrowseTab,
  request: Pick<MatchmakerRequest, 'is_long_term' | 'team'>,
): MatchmakerBrowseAction => {
  if (tab === 'long-term') return 'interest';
  if (tab === 'hfi' && request.team?.availabilityStatus === 'booked') return 'interest';
  return 'challenge';
};

export interface MatchmakerRequestFormState {
  selectedHtTeamId: number;
  matchType: MatchmakerRequest['match_type'];
  location: 'domestic' | 'international_only' | 'any';
  homeAway: MatchmakerRequest['home_away'];
  message: string;
  isBackAndForth: boolean;
  isLongTerm: boolean;
}

export const getMatchmakerRequestFormState = (
  request?: MatchmakerRequest | null,
  selectedHtTeamId = 0,
): MatchmakerRequestFormState => ({
  selectedHtTeamId: request?.team?.ht_team_id ?? selectedHtTeamId,
  matchType: request?.match_type ?? '120min',
  location:
    request?.opponent_location === 'domestic'
      ? 'domestic'
      : request?.opponent_location === 'international' || request?.opponent_location === 'international_only'
        ? 'international_only'
        : 'any',
  homeAway: request?.home_away ?? 'any',
  message: request?.message ?? '',
  isBackAndForth: request?.is_back_and_forth ?? false,
  isLongTerm: request?.is_long_term ?? false,
});

export const upsertMockMatchmakerRequest = (
  requests: readonly MatchmakerRequest[],
  request: MatchmakerRequest,
  editingRequestId?: string | null,
) => {
  if (!editingRequestId) return [request, ...requests];
  return requests.map((item) => (item.id === editingRequestId ? request : item));
};

export const getMatchmakerMessagePlaceholder = (request: MatchmakerRequest) => {
  const matchType = request.match_type === '120min' ? '120 min training' : '90 min acceptable';
  const venue = request.home_away === 'home' ? 'My place' : request.home_away === 'away' ? 'Your place' : 'Either venue';
  const location =
    request.opponent_location === 'domestic'
      ? `Domestic (${request.team?.country_name || 'same country'})`
      : request.opponent_location === 'international_only' || request.opponent_location === 'international'
        ? 'International only'
        : 'Anywhere';
  const duration = request.is_long_term ? 'Long-term partner' : 'One-off match';

  return `${matchType}. ${venue}. ${location}. ${duration}. Reach out to me!`;
};

export interface MatchmakerActivity {
  id: string;
  created_at: string;
  ad_id: string;
  actor_user_id: number;
  actor_team_id: string | null;
  actor_team_name: string;
  type: MatchmakerActivityType;
  comment: string | null;
  metadata: {
    source?: string;
    trainingMatchId?: number;
    chppMatchType?: number;
    matchPlace?: number;
    opponentHtTeamId?: number;
    [key: string]: unknown;
  };
}

export interface MatchmakerTeamOption {
  teamId: number;
  teamName: string;
  logo_url?: string | null;
  leagueLevelUnitName?: string;
  regionName?: string;
  countryId?: number | null;
  countryName?: string | null;
  leagueId?: number | null;
  leagueSystemId?: number | null;
  leagueName?: string | null;
  availabilityStatus?: 'available' | 'booked' | 'unavailable' | 'unknown';
  availabilityReason?: string;
  genderId?: number | null;
  is_mock?: boolean;
}

export interface MatchmakerRequest {
  id: string;
  team_id: string;
  manager_ht_id: number;
  match_type: '120min' | '90min_acceptable';
  opponent_location: 'domestic' | 'international' | 'international_only' | 'any';
  home_away: 'home' | 'away' | 'any';
  match_day: string;
  time_window: string | null;
  message: string | null;
  status: MatchmakerStatus;
  matched_with_team_id: string | null;
  matched_at: string | null;
  expires_at: string;
  created_at: string;
  is_back_and_forth: boolean;
  is_long_term: boolean;
  gender_id: number;
  is_mock?: boolean;
  // Joined fields
  team?: {
    name: string;
    ht_team_id: number;
    logo_url: string | null;
    country_name: string | null;
    country_id?: number | null;
    league_id: number | null;
    gender_id: number;
    fanclub_size: number | null;
    arena_id: number | null;
    arena_size: number | null;
    arena_image_url: string | null;
    availabilityStatus?: 'available' | 'booked' | 'unavailable' | 'unknown';
    availabilityReason?: string;
    availabilityStatusRaw?: string | null;
  };
  profile?: {
    manager_name: string;
    avatar_json: Avatar | null;
    country_name: string | null;
    country_id?: number | null;
    league_id: number | null;
  };
  matched_team?: {
    name: string;
    ht_team_id: number;
    logo_url: string | null;
    country_name: string | null;
  };
}

/**
 * Calculates the next Tuesday 06:00 HT time as a baseline expiry.
 * Future refinement: Use global-match-times.json for region-specific cutoffs.
 */
export const calculateMatchmakerExpiry = (now = new Date()): Date => {
  const expiry = new Date(now);

  // Set to Tuesday
  const day = expiry.getUTCDay();
  const diff = day <= 2 ? 2 - day : 9 - day;
  expiry.setUTCDate(expiry.getUTCDate() + diff);

  // Tuesday 06:00 UTC
  expiry.setUTCHours(6, 0, 0, 0);

  if (expiry.getTime() <= now.getTime()) {
    expiry.setUTCDate(expiry.getUTCDate() + 7);
  }

  return expiry;
};

export const getDisplayTeamName = (teamName: string, genderId?: number | null) =>
  genderId === 0 ? `${teamName} (HFI)` : teamName;
