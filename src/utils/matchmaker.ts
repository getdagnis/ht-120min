import type { Avatar } from '../hooks/useAuth';

export type MatchmakerStatus = 'open' | 'matched' | 'expired' | 'cancelled';

export type MatchmakerActivityType = 'challenge_sent' | 'interest_shown';

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
