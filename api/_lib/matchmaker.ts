import type { SupabaseClient } from '@supabase/supabase-js';
import { getAuthHeader } from './chpp-auth.js';
import {
  parseManagerCompendiumXml,
  parseMatchesXml,
  type ChppTeamOption,
  type ParsedMatch,
} from './chpp-xml.js';

export type MatchmakerAvailabilityStatus = 'available' | 'booked' | 'unknown';

export interface MatchmakerTeamOption extends ChppTeamOption {
  availabilityStatus: MatchmakerAvailabilityStatus;
  availabilityReason?: string;
  bookedMatch?: ParsedMatch | null;
}

export interface ManagerChppCredentials {
  hattrick_user_id: number;
  manager_name: string;
  oauth_token: string;
  oauth_token_secret: string;
  teams_json: ChppTeamOption[] | null;
}

export interface MatchmakerBookingResult {
  isBooked: boolean;
  match: ParsedMatch | null;
}

const BOOKED_FRIENDLY_MATCH_TYPES = new Set([4, 5, 8, 9]);

export function isBookedFriendlyMatch(match: ParsedMatch, now = new Date()): boolean {
  if (!BOOKED_FRIENDLY_MATCH_TYPES.has(match.matchType)) return false;

  const matchDate = new Date(match.matchDate.replace(' ', 'T'));
  const validDate = Number.isFinite(matchDate.getTime()) && matchDate > now;
  if (!validDate) return false;

  const status = match.status.toUpperCase();
  return status !== 'FINISHED' && status !== 'COMPLETED' && status !== 'CANCELLED';
}

export async function getManagerChppCredentials(
  supabase: SupabaseClient,
  managerId: number,
): Promise<ManagerChppCredentials | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('hattrick_user_id, manager_name, oauth_token, oauth_token_secret, teams_json')
    .eq('hattrick_user_id', managerId)
    .maybeSingle();

  if (!error && data?.oauth_token && data.oauth_token_secret) {
    return {
      hattrick_user_id: Number(data.hattrick_user_id),
      manager_name: data.manager_name,
      oauth_token: data.oauth_token,
      oauth_token_secret: data.oauth_token_secret,
      teams_json: Array.isArray(data.teams_json) ? (data.teams_json as ChppTeamOption[]) : null,
    };
  }

  const { data: teamAuth } = await supabase
    .from('teams')
    .select('hattrick_user_id, manager_name, oauth_token, oauth_token_secret')
    .eq('hattrick_user_id', managerId)
    .not('oauth_token', 'is', null)
    .order('active', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!teamAuth?.oauth_token || !teamAuth.oauth_token_secret) return null;

  return {
    hattrick_user_id: Number(teamAuth.hattrick_user_id ?? managerId),
    manager_name: teamAuth.manager_name ?? 'Unknown',
    oauth_token: teamAuth.oauth_token,
    oauth_token_secret: teamAuth.oauth_token_secret,
    teams_json: null,
  };
}

export async function fetchManagerTeamsFromChpp(
  consumerKey: string,
  consumerSecret: string,
  credentials: Pick<ManagerChppCredentials, 'oauth_token' | 'oauth_token_secret'>,
) {
  const url = 'https://chpp.hattrick.org/chppxml.ashx';
  const params = { file: 'managercompendium', version: '1.7' };
  const authHeader = getAuthHeader(
    'GET',
    url,
    params,
    consumerKey,
    consumerSecret,
    credentials.oauth_token,
    credentials.oauth_token_secret,
  );

  const response = await fetch(`${url}?file=managercompendium&version=1.7`, {
    headers: { Authorization: authHeader },
  });

  const xml = await response.text();
  if (!response.ok) {
    throw new Error(`CHPP managercompendium failed (${response.status})`);
  }

  const parsed = parseManagerCompendiumXml(xml);

  return {
    ...parsed,
    teams: parsed.teams ?? [],
  };
}

export async function fetchTeamBookingStatus(
  consumerKey: string,
  consumerSecret: string,
  credentials: Pick<ManagerChppCredentials, 'oauth_token' | 'oauth_token_secret'>,
  teamId: number | string,
): Promise<MatchmakerBookingResult> {
  const url = 'https://chpp.hattrick.org/chppxml.ashx';
  const teamIdString = String(teamId);
  const params = { file: 'matches', teamID: teamIdString };
  const authHeader = getAuthHeader(
    'GET',
    url,
    params,
    consumerKey,
    consumerSecret,
    credentials.oauth_token,
    credentials.oauth_token_secret,
  );

  const response = await fetch(`${url}?file=matches&teamID=${teamIdString}`, {
    headers: { Authorization: authHeader },
  });

  const xml = await response.text();
  if (!response.ok) {
    throw new Error(`CHPP matches fetch failed (${response.status})`);
  }

  const matches = parseMatchesXml(xml);
  const bookedFriendly = matches.find((match) => isBookedFriendlyMatch(match));

  return {
    isBooked: !!bookedFriendly,
    match: bookedFriendly ?? null,
  };
}
