import type { Avatar } from '../hooks/useAuth';

export type MatchmakerStatus = 'open' | 'matched' | 'expired' | 'cancelled';

export interface MatchmakerRequest {
  id: string;
  team_id: string;
  manager_ht_id: number;
  match_type: '120min' | '90min_acceptable';
  opponent_location: 'domestic' | 'international' | 'any';
  home_away: 'home' | 'away' | 'any';
  match_day: string;
  time_window: string | null;
  message: string | null;
  status: MatchmakerStatus;
  matched_with_team_id: string | null;
  matched_at: string | null;
  expires_at: string;
  created_at: string;
  // Joined fields
  team?: {
    name: string;
    ht_team_id: number;
    logo_url: string | null;
    country_name: string | null;
    league_id: number | null;
  };
  profile?: {
    manager_name: string;
    avatar_json: Avatar | null;
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
  const diff = (day <= 2) ? (2 - day) : (9 - day);
  expiry.setUTCDate(expiry.getUTCDate() + diff);
  
  // Tuesday 06:00 UTC
  expiry.setUTCHours(6, 0, 0, 0);
  
  if (expiry.getTime() <= now.getTime()) {
    expiry.setUTCDate(expiry.getUTCDate() + 7);
  }
  
  return expiry;
};
