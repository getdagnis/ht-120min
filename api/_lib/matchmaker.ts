import type { SupabaseClient } from '@supabase/supabase-js';
import { getAuthHeader } from './chpp-auth.js';
import {
  parseManagerCompendiumXml,
  parseMatchesXml,
  parseTeamDetailsXml,
  parseArenaDetailsXml,
  type ChppTeamOption,
  type ParsedMatch,
  type ParsedTeamDetails,
  type ParsedArenaDetails,
} from './chpp-xml.js';

export type MatchmakerAvailabilityStatus = 'available' | 'booked' | 'unavailable' | 'unknown';

export interface MatchmakerTeamOption extends ChppTeamOption {
  availabilityStatus: MatchmakerAvailabilityStatus;
  availabilityReason?: string;
  bookedMatch?: ParsedMatch | null;
  friendlyTeamId?: number | null;
  possibleToChallengeMidweek?: boolean;
  possibleToChallengeWeekend?: boolean;
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

export function classifyTeamAvailability(
  teamDetails?: Pick<
    ParsedTeamDetails,
    'friendlyTeamId' | 'possibleToChallengeMidweek' | 'possibleToChallengeWeekend'
  > | null,
): {
  availabilityStatus: MatchmakerAvailabilityStatus;
  availabilityReason?: string;
} {
  if (!teamDetails) {
    return {
      availabilityStatus: 'unknown',
      availabilityReason: 'CHPP team details were not available.',
    };
  }

  if ((teamDetails.friendlyTeamId ?? 0) > 0) {
    return {
      availabilityStatus: 'booked',
      availabilityReason: 'Friendly already scheduled.',
    };
  }

  const canChallengeMidweek = teamDetails.possibleToChallengeMidweek;
  const canChallengeWeekend = teamDetails.possibleToChallengeWeekend;

  if (canChallengeMidweek === false && canChallengeWeekend === false) {
    return {
      availabilityStatus: 'unavailable',
      availabilityReason: 'This team cannot be challenged right now.',
    };
  }

  if (canChallengeMidweek === false || canChallengeWeekend === false) {
    return {
      availabilityStatus: 'available',
      availabilityReason: 'At least one friendly window is still open.',
    };
  }

  return {
    availabilityStatus: 'available',
  };
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

export async function fetchTeamDetailsFromChpp(
  consumerKey: string,
  consumerSecret: string,
  credentials: Pick<ManagerChppCredentials, 'oauth_token' | 'oauth_token_secret'>,
  teamId: number,
): Promise<ParsedTeamDetails> {
  const url = 'https://chpp.hattrick.org/chppxml.ashx';
  const params = { file: 'teamdetails', version: '3.9', teamID: String(teamId) };
  const authHeader = getAuthHeader(
    'GET',
    url,
    params,
    consumerKey,
    consumerSecret,
    credentials.oauth_token,
    credentials.oauth_token_secret,
  );

  const response = await fetch(`${url}?file=teamdetails&version=3.9&teamID=${teamId}`, {
    headers: { Authorization: authHeader },
  });

  const xml = await response.text();
  if (!response.ok) {
    throw new Error(`CHPP teamdetails failed (${response.status})`);
  }

  return parseTeamDetailsXml(xml, teamId);
}

export async function fetchArenaDetailsFromChpp(
  consumerKey: string,
  consumerSecret: string,
  credentials: Pick<ManagerChppCredentials, 'oauth_token' | 'oauth_token_secret'>,
  arenaId: number,
): Promise<ParsedArenaDetails> {
  const url = 'https://chpp.hattrick.org/chppxml.ashx';
  const params = { file: 'arenadetails', version: '1.2', arenaID: String(arenaId) };
  const authHeader = getAuthHeader(
    'GET',
    url,
    params,
    consumerKey,
    consumerSecret,
    credentials.oauth_token,
    credentials.oauth_token_secret,
  );

  const response = await fetch(`${url}?file=arenadetails&version=1.2&arenaID=${arenaId}`, {
    headers: { Authorization: authHeader },
  });

  const xml = await response.text();
  if (!response.ok) {
    throw new Error(`CHPP arenadetails failed (${response.status})`);
  }

  return parseArenaDetailsXml(xml);
}

export async function fetchManagerTeamsFromChpp(
  consumerKey: string,
  consumerSecret: string,
  credentials: Pick<ManagerChppCredentials, 'oauth_token' | 'oauth_token_secret'>,
  managerId?: number | string,
) {
  const url = 'https://chpp.hattrick.org/chppxml.ashx';
  const params: Record<string, string> = { file: 'managercompendium', version: '1.7' };
  if (managerId) {
    params.userID = String(managerId);
  }
  
  const authHeader = getAuthHeader(
    'GET',
    url,
    params,
    consumerKey,
    consumerSecret,
    credentials.oauth_token,
    credentials.oauth_token_secret,
  );

  const query = new URLSearchParams(params);
  const response = await fetch(`${url}?${query.toString()}`, {
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
