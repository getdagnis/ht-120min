import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';
import { getAuthHeader } from '../_lib/chpp-auth.js';
import { readChppTag } from '../_lib/chpp-xml.js';
import {
  mapMatchEventDetailsToFixture,
  parseMatchEventDetails,
  summarizeMatchEventDetails,
} from '../_lib/chpp-match-events.js';
import {
  getHattrickCalendarContext,
  getHattrickWeekFromDate,
  getHattrickWeekStartDate,
  resolveHattrickWeekContext,
} from '../_lib/hattrick-time.js';
import { isFriendlyInsideAcceptedWindow } from '../_lib/match-window.js';
import type { MatchEventDetails } from '../../shared/match-events.js';

// Simplified helper for match date calculation on server
// Compare with docs/global-match-time.json before actual implementation
// Or other more detailed source of truth.
// Main issue: large HT leagues (Spain, Germany, Netherlands etc.) have
// multiple start times for weekly friendlies
const COUNTRY_FRIENDLY_TIMES: Record<string, { day: number; time: string }> = {
  Argentina: { day: 3, time: '23:20' },
  Australia: { day: 3, time: '04:00' },
  Austria: { day: 3, time: '09:30' },
  Belgium: { day: 3, time: '13:30' },
  Bolivia: { day: 2, time: '22:45' },
  Brazil: { day: 3, time: '23:55' },
  Bulgaria: { day: 2, time: '21:15' },
  Canada: { day: 3, time: '23:00' },
  Chile: { day: 3, time: '22:50' },
  China: { day: 3, time: '07:00' },
  Colombia: { day: 3, time: '23:40' },
  'Costa Rica': { day: 3, time: '23:45' },
  Croatia: { day: 3, time: '08:45' },
  Cyprus: { day: 2, time: '20:15' },
  'Czech Republic': { day: 3, time: '14:00' },
  Denmark: { day: 3, time: '16:30' },
  Ecuador: { day: 2, time: '23:45' },
  England: { day: 2, time: '21:00' },
  Estonia: { day: 3, time: '12:15' },
  Finland: { day: 2, time: '20:05' },
  France: { day: 3, time: '15:05' },
  Germany: { day: 2, time: '18:15' },
  Greece: { day: 3, time: '09:45' },
  Honduras: { day: 3, time: '21:55' },
  Hungary: { day: 3, time: '09:45' },
  Indonesia: { day: 3, time: '07:45' },
  Ireland: { day: 3, time: '20:15' },
  Israel: { day: 2, time: '20:30' },
  Italy: { day: 2, time: '19:05' },
  Japan: { day: 3, time: '02:30' },
  Latvia: { day: 3, time: '13:45' },
  Lithuania: { day: 3, time: '19:20' },
  Malaysia: { day: 3, time: '05:00' },
  Mexico: { day: 3, time: '02:30' },
  Netherlands: { day: 3, time: '17:05' },
  'New Zealand': { day: 3, time: '04:00' },
  Norway: { day: 3, time: '16:00' },
  Paraguay: { day: 2, time: '23:15' },
  Peru: { day: 3, time: '22:50' },
  Poland: { day: 3, time: '17:50' },
  Portugal: { day: 3, time: '21:50' },
  Romania: { day: 3, time: '10:00' },
  Russia: { day: 3, time: '08:30' },
  Scotland: { day: 3, time: '11:30' },
  Serbia: { day: 3, time: '12:45' },
  Singapore: { day: 3, time: '04:30' },
  Slovakia: { day: 2, time: '19:25' },
  Slovenia: { day: 2, time: '19:30' },
  'South Africa': { day: 3, time: '21:30' },
  'South Korea': { day: 3, time: '02:00' },
  Spain: { day: 3, time: '12:05' },
  Sweden: { day: 3, time: '19:15' },
  Switzerland: { day: 3, time: '10:35' },
  Thailand: { day: 3, time: '05:30' },
  Turkey: { day: 3, time: '08:00' },
  Ukraine: { day: 3, time: '08:15' },
  Uruguay: { day: 3, time: '22:30' },
  USA: { day: 3, time: '23:25' },
  Venezuela: { day: 3, time: '23:30' },
  Wales: { day: 2, time: '21:30' },
};

function calculateMatchDate(tournamentCreatedAt: string, roundNumber: number, countryName?: string): Date {
  const settings = COUNTRY_FRIENDLY_TIMES[countryName || ''] || { day: 2, time: '20:00' };
  const [hours, minutes] = settings.time.split(':').map(Number);
  const date = new Date(tournamentCreatedAt);
  
  // Hattrick Time (Europe/Stockholm) is CET (UTC+1) or CEST (UTC+2)
  // We use the Intl API to find the offset for the given date in Stockholm
  const getHTOffset = (d: Date) => {
    const stockholmDate = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Stockholm',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false
    }).formatToParts(d);
    
    const parts: Record<string, number> = {};
    stockholmDate.forEach((p) => {
      if (p.type !== 'literal') {
        parts[p.type] = parseInt(p.value, 10);
      }
    });
    
    const wallClockHT = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return Math.round((wallClockHT - d.getTime()) / 60000);
  };

  const currentOffset = getHTOffset(date);
  const htDate = new Date(date.getTime() + currentOffset * 60000);
  const currentHTDay = htDate.getUTCDay();
  
  let diff = (settings.day - currentHTDay + 7) % 7;
  if (diff === 0 && (htDate.getUTCHours() > hours || (htDate.getUTCHours() === hours && htDate.getUTCMinutes() >= minutes))) {
    diff = 7;
  }
  
  date.setUTCDate(date.getUTCDate() + diff);
  
  // Re-calculate target UTC hours based on HT offset at the target date
  const targetDate = new Date(date.getTime());
  const targetOffset = getHTOffset(targetDate);
  targetDate.setUTCHours(hours - (targetOffset / 60), minutes, 0, 0);
  
  if (roundNumber > 1) {
    targetDate.setUTCDate(targetDate.getUTCDate() + (roundNumber - 1) * 7);
    // Adjust for potential DST change across weeks
    const finalOffset = getHTOffset(targetDate);
    targetDate.setUTCHours(hours - (finalOffset / 60), minutes, 0, 0);
  }
  
  return targetDate;
}

function getMatchTargetDate(match: { scheduled_for?: string | null }, round: { created_at: string; round_number: number }, countryName?: string) {
  return match.scheduled_for ? new Date(match.scheduled_for) : calculateMatchDate(round.created_at, round.round_number, countryName);
}

async function fetchWorldDetailsContext(
  consumerKey: string,
  consumerSecret: string,
  oauthToken: string,
  oauthTokenSecret: string,
) {
  const url = 'https://chpp.hattrick.org/chppxml.ashx';
  const params = { file: 'worlddetails' };
  const authHeader = getAuthHeader('GET', url, params, consumerKey, consumerSecret, oauthToken, oauthTokenSecret);

  const response = await fetch(`${url}?file=worlddetails`, {
    headers: { Authorization: authHeader },
  });

  const xml = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    xml,
    context: resolveHattrickWeekContext(xml),
  };
}

interface TeamFriendlyMatch {
  homeId: number;
  awayId: number;
  homeName: string | null;
  awayName: string | null;
  date: Date;
  matchId: number;
  matchType: number;
  homeGoals: number | null;
  awayGoals: number | null;
  status: string | null;
}

type MatchFetchWindow = 'current' | 'previous' | 'last50';
type MatchFetchCategory = 'friendlies' | 'cup' | 'league';

const MATCH_TYPE_GROUPS: Record<MatchFetchCategory, number[]> = {
  friendlies: [4, 5, 8, 9],
  cup: [3],
  league: [1],
};
const ADDABLE_MATCH_TYPES = new Set([...MATCH_TYPE_GROUPS.friendlies, ...MATCH_TYPE_GROUPS.cup, ...MATCH_TYPE_GROUPS.league]);

function getMatchTypesForCategories(categories: MatchFetchCategory[]) {
  const selected = categories.length > 0 ? categories : ['friendlies'];
  return new Set(selected.flatMap((category) => MATCH_TYPE_GROUPS[category] || []));
}

function getSuggestedFetchWindow(value: unknown): MatchFetchWindow {
  return value === 'current' || value === 'previous' || value === 'last50' ? value : 'current';
}

function getSuggestedFetchCategories(value: unknown): MatchFetchCategory[] {
  if (!Array.isArray(value)) return ['friendlies'];
  return value.filter((item): item is MatchFetchCategory => item === 'friendlies' || item === 'cup' || item === 'league');
}

function formatChppDateTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours(),
  )}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function getMatchFetchSeason(window: MatchFetchWindow) {
  if (window === 'last50') return null;
  const context = getHattrickCalendarContext();
  return window === 'previous' ? context.htSeason - 1 : context.htSeason;
}

function getLastMatchDateForWindow(window: MatchFetchWindow) {
  const targetSeason = getMatchFetchSeason(window);
  if (!targetSeason) return null;
  return getHattrickWeekStartDate(targetSeason + 1, 1);
}

function isInsideFetchWindow(matchDate: Date, window: MatchFetchWindow) {
  const targetSeason = getMatchFetchSeason(window);
  if (!targetSeason) return true;
  return getHattrickWeekFromDate(matchDate).htSeason === targetSeason;
}

async function fetchTeamFriendlies(
  teamId: string,
  oauthToken: string,
  oauthTokenSecret: string,
  options: { fetchWindow?: MatchFetchWindow; matchTypes?: Set<number> } = {},
) {
  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  const url = 'https://chpp.hattrick.org/chppxml.ashx';
  const fetchWindow = options.fetchWindow || 'current';
  const lastMatchDate = getLastMatchDateForWindow(fetchWindow);
  const params = lastMatchDate
    ? { file: 'matches', teamID: teamId, LastMatchDate: formatChppDateTime(lastMatchDate) }
    : { file: 'matches', teamID: teamId };
  const authHeader = getAuthHeader('GET', url, params, consumerKey!, consumerSecret!, oauthToken, oauthTokenSecret);
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`${url}?${query}`, { headers: { Authorization: authHeader } });
  if (!response.ok) return [];
  const xml = await response.text();
  const friendlies: TeamFriendlyMatch[] = [];
  const allowedMatchTypes = options.matchTypes || getMatchTypesForCategories(['friendlies']);
  for (const match of xml.matchAll(/<Match>([\s\S]*?)<\/Match>/gi)) {
    const block = match[1];
    const matchType = parseInt(readChppTag(block, 'MatchType') || '0', 10);
    if (allowedMatchTypes.has(matchType)) {
      const status = readChppTag(block, 'Status');
      if (status === 'FINISHED' || status === 'UPCOMING') {
        const homeId = parseInt(readChppTag(block, 'HomeTeamID') || '0', 10);
        const awayId = parseInt(readChppTag(block, 'AwayTeamID') || '0', 10);
        const homeName = readChppTag(block, 'HomeTeamName') || null;
        const awayName = readChppTag(block, 'AwayTeamName') || null;
        const dateStr = readChppTag(block, 'MatchDate');
        const matchId = parseInt(readChppTag(block, 'MatchID') || '0', 10);
        const homeGoalsText = readChppTag(block, 'HomeGoals');
        const awayGoalsText = readChppTag(block, 'AwayGoals');
        const date = dateStr ? new Date(dateStr.replace(' ', 'T')) : null;
        if (homeId && awayId && date && isInsideFetchWindow(date, fetchWindow)) {
          friendlies.push({
            homeId,
            awayId,
            homeName,
            awayName,
            matchId,
            date,
            matchType,
            homeGoals: homeGoalsText === '' ? null : Number(homeGoalsText),
            awayGoals: awayGoalsText === '' ? null : Number(awayGoalsText),
            status,
          });
        }
      }
    }
  }
  return friendlies;
}

interface TeamWithAuth {
  id: string;
  ht_team_id: number;
  oauth_token: string | null;
  oauth_token_secret: string | null;
  country_name?: string;
}

interface ManualLinkMatchRow {
  id: string;
  home_team_id: string | null;
  away_team_id: string | null;
  home_team: { ht_team_id: number | null; name: string | null } | null;
  away_team: { ht_team_id: number | null; name: string | null } | null;
}

interface ChppMatchDetails {
  htMatchId: number;
  matchType: number | null;
  matchDate: Date | null;
  actualHtHomeTeamId: number | null;
  actualHtAwayTeamId: number | null;
  actualHomeTeamName: string | null;
  actualAwayTeamName: string | null;
  homeGoals: number;
  awayGoals: number;
  status: 'arranged' | 'ongoing' | 'finished';
  completed: boolean;
  went120: boolean;
  totalMinutes: number;
  eventDetails: MatchEventDetails;
}

interface AddHtMatchTeamRow {
  id: string;
  name: string;
  ht_team_id: number | null;
  logo_url: string | null;
}

interface AddHtMatchTournamentRow {
  id: string;
  admin_password: string;
  season: number | null;
}

function getBodyValue(req: VercelRequest, key: string) {
  if (req.body && typeof req.body === 'object') return req.body[key];
  if (typeof req.body === 'string') {
    try {
      const parsed = JSON.parse(req.body);
      return parsed?.[key];
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function fetchMatchDetailsById(
  htMatchId: string,
  oauthToken: string,
  oauthTokenSecret: string,
): Promise<ChppMatchDetails> {
  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  const url = 'https://chpp.hattrick.org/chppxml.ashx';
  const params = { file: 'matchdetails', version: '3.1', matchID: htMatchId, matchEvents: 'true' };
  const authHeader = getAuthHeader('GET', url, params, consumerKey!, consumerSecret!, oauthToken, oauthTokenSecret);
  const response = await fetch(`${url}?file=matchdetails&version=3.1&matchEvents=true&matchID=${htMatchId}`, {
    headers: { Authorization: authHeader },
  });
  const xml = await response.text();

  if (!response.ok || /<Error/i.test(xml)) {
    throw new Error('Could not fetch that Hattrick match.');
  }

  const actualHtHomeTeamId =
    parseInt(xml.match(/<HomeTeam>[\s\S]*?<HomeTeamID>(\d+)<\/HomeTeamID>/i)?.[1] || '0', 10) || null;
  const actualHtAwayTeamId =
    parseInt(xml.match(/<AwayTeam>[\s\S]*?<AwayTeamID>(\d+)<\/AwayTeamID>/i)?.[1] || '0', 10) || null;
  const actualHomeTeamName = xml.match(/<HomeTeam>[\s\S]*?<HomeTeamName>([^<]+)<\/HomeTeamName>/i)?.[1] || null;
  const actualAwayTeamName = xml.match(/<AwayTeam>[\s\S]*?<AwayTeamName>([^<]+)<\/AwayTeamName>/i)?.[1] || null;
  const matchType = parseInt(readChppTag(xml, 'MatchType') || '0', 10) || null;
  const matchDateText = readChppTag(xml, 'MatchDate');
  const matchDate = matchDateText ? new Date(matchDateText.replace(' ', 'T')) : null;
  const finishedDate = readChppTag(xml, 'FinishedDate');
  const matchStatus = readChppTag(xml, 'MatchStatus');
  const finished = (finishedDate && finishedDate !== '0001-01-01 00:00:00') || matchStatus === '2';
  const status = finished ? 'finished' : matchStatus === '1' ? 'ongoing' : 'arranged';
  const addedMinutes = parseInt(readChppTag(xml, 'AddedMinutes') || '0', 10);
  const went120 = xml.includes('<MatchPart>3</MatchPart>') || xml.includes('<MatchPart>4</MatchPart>');

  return {
    htMatchId: parseInt(htMatchId, 10),
    matchType,
    matchDate,
    actualHtHomeTeamId,
    actualHtAwayTeamId,
    actualHomeTeamName,
    actualAwayTeamName,
    homeGoals: parseInt(readChppTag(xml, 'HomeGoals') || '0', 10),
    awayGoals: parseInt(readChppTag(xml, 'AwayGoals') || '0', 10),
    status,
    completed: finished,
    went120,
    totalMinutes: (went120 ? 120 : 90) + addedMinutes,
    eventDetails: parseMatchEventDetails(xml),
  };
}

function mapHattrickMatchToFixture(match: ManualLinkMatchRow, details: ChppMatchDetails) {
  const scheduledHomeHtId = match.home_team?.ht_team_id ?? null;
  const scheduledAwayHtId = match.away_team?.ht_team_id ?? null;
  const actualHomeHtId = details.actualHtHomeTeamId;
  const actualAwayHtId = details.actualHtAwayTeamId;

  const homeSideMatchesActualHome = scheduledHomeHtId !== null && scheduledHomeHtId === actualHomeHtId;
  const homeSideMatchesActualAway = scheduledHomeHtId !== null && scheduledHomeHtId === actualAwayHtId;
  const awaySideMatchesActualHome = scheduledAwayHtId !== null && scheduledAwayHtId === actualHomeHtId;
  const awaySideMatchesActualAway = scheduledAwayHtId !== null && scheduledAwayHtId === actualAwayHtId;
  const matchedSides = [
    homeSideMatchesActualHome || homeSideMatchesActualAway ? 'home' : null,
    awaySideMatchesActualHome || awaySideMatchesActualAway ? 'away' : null,
  ].filter(Boolean);

  if (matchedSides.length === 0) {
    return null;
  }

  let homeGoals: number;
  let awayGoals: number;

  if (homeSideMatchesActualHome) {
    homeGoals = details.homeGoals;
    awayGoals = details.awayGoals;
  } else if (homeSideMatchesActualAway) {
    homeGoals = details.awayGoals;
    awayGoals = details.homeGoals;
  } else if (awaySideMatchesActualHome) {
    awayGoals = details.homeGoals;
    homeGoals = details.awayGoals;
  } else {
    awayGoals = details.awayGoals;
    homeGoals = details.homeGoals;
  }

  const venueMismatch = Boolean(
    scheduledHomeHtId &&
      scheduledAwayHtId &&
      scheduledHomeHtId === actualAwayHtId &&
      scheduledAwayHtId === actualHomeHtId,
  );

  return {
    homeGoals,
    awayGoals,
    venueMismatch,
    matchedBothTournamentTeams:
      Boolean(scheduledHomeHtId && (homeSideMatchesActualHome || homeSideMatchesActualAway)) &&
      Boolean(scheduledAwayHtId && (awaySideMatchesActualHome || awaySideMatchesActualAway)),
    eventDetails: mapMatchEventDetailsToFixture(details.eventDetails, scheduledHomeHtId, scheduledAwayHtId),
  };
}

async function handleManualMatchLink(req: VercelRequest, res: VercelResponse) {
  const supabase = getSupabase();
  const matchId = String(getBodyValue(req, 'matchId') || '');
  const htMatchId = String(getBodyValue(req, 'htMatchId') || '').replace(/\D/g, '');
  const dryRun = Boolean(getBodyValue(req, 'dryRun'));

  if (!matchId || !htMatchId) return res.status(400).json({ error: 'Missing match id.' });

  const { data: authTeam } = await supabase
    .from('teams')
    .select('oauth_token, oauth_token_secret')
    .not('oauth_token', 'is', null)
    .limit(1)
    .single();

  if (!authTeam?.oauth_token) return res.status(401).json({ error: 'No CHPP-authenticated team available.' });

  const { data: match } = await supabase
    .from('matches')
    .select(
      `
      id,
      home_team_id,
      away_team_id,
      home_team:teams!matches_home_team_id_fkey(ht_team_id, name),
      away_team:teams!matches_away_team_id_fkey(ht_team_id, name)
    `,
    )
    .eq('id', matchId)
    .single();

  if (!match) return res.status(404).json({ error: 'Tournament match not found.' });

  const details = await fetchMatchDetailsById(htMatchId, authTeam.oauth_token, authTeam.oauth_token_secret || '');
  if (!details.matchType || ![4, 5, 8, 9].includes(details.matchType)) {
    return res.status(400).json({ error: 'That Hattrick match is not a friendly match.' });
  }

  const mapping = mapHattrickMatchToFixture(match as unknown as ManualLinkMatchRow, details);
  if (!mapping) {
    return res.status(400).json({ error: 'That match does not include any team from this fixture.' });
  }

  const preview = {
    ht_match_id: details.htMatchId,
    match_type: details.matchType,
    status: details.status,
    completed: details.completed,
    actual_home_team_id: details.actualHtHomeTeamId,
    actual_away_team_id: details.actualHtAwayTeamId,
    actual_home_team_name: details.actualHomeTeamName,
    actual_away_team_name: details.actualAwayTeamName,
    home_goals: mapping.homeGoals,
    away_goals: mapping.awayGoals,
    went_120: details.went120,
    total_minutes: details.totalMinutes,
    matched_both_tournament_teams: mapping.matchedBothTournamentTeams,
    ...summarizeMatchEventDetails(mapping.eventDetails),
    match_event_details: mapping.eventDetails,
  };

  if (!dryRun) {
    const updatePayload = {
      ht_match_id: details.htMatchId,
      match_type: details.matchType,
      status: details.status,
      completed: details.completed,
      home_goals: details.completed || details.status === 'ongoing' ? mapping.homeGoals : null,
      away_goals: details.completed || details.status === 'ongoing' ? mapping.awayGoals : null,
      went_120: details.went120,
      total_minutes: details.totalMinutes,
      venue_mismatch: mapping.venueMismatch,
      actual_ht_home_team_id: details.actualHtHomeTeamId,
      actual_ht_away_team_id: details.actualHtAwayTeamId,
      ...summarizeMatchEventDetails(mapping.eventDetails),
      match_event_details: mapping.eventDetails,
    };
    const { error } = await supabase.from('matches').update(updatePayload).eq('id', matchId);
    if (error) return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ ok: true, preview });
}

function formatMatchDateKey(date: Date | null) {
  return date && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function buildAddHtMatchPreview(details: ChppMatchDetails, homeTeam: AddHtMatchTeamRow | null, awayTeam: AddHtMatchTeamRow | null) {
  return {
    ht_match_id: details.htMatchId,
    match_type: details.matchType,
    match_date: details.matchDate?.toISOString() || null,
    status: details.status,
    completed: details.completed,
    actual_home_team_id: details.actualHtHomeTeamId,
    actual_away_team_id: details.actualHtAwayTeamId,
    actual_home_team_name: details.actualHomeTeamName,
    actual_away_team_name: details.actualAwayTeamName,
    home_goals: details.completed || details.status === 'ongoing' ? details.homeGoals : null,
    away_goals: details.completed || details.status === 'ongoing' ? details.awayGoals : null,
    went_120: details.went120,
    total_minutes: details.totalMinutes,
    home_team_known: Boolean(homeTeam),
    away_team_known: Boolean(awayTeam),
    home_team: homeTeam
      ? { id: homeTeam.id, name: homeTeam.name, ht_team_id: homeTeam.ht_team_id, logo_url: homeTeam.logo_url }
      : null,
    away_team: awayTeam
      ? { id: awayTeam.id, name: awayTeam.name, ht_team_id: awayTeam.ht_team_id, logo_url: awayTeam.logo_url }
      : null,
  };
}

function formatSuggestedStatus(status: string | null): 'arranged' | 'finished' {
  return status === 'FINISHED' ? 'finished' : 'arranged';
}

function toSuggestedMatch(
  match: TeamFriendlyMatch,
  teamByHtId: Map<number, AddHtMatchTeamRow>,
) {
  const homeTeam = teamByHtId.get(match.homeId) || null;
  const awayTeam = teamByHtId.get(match.awayId) || null;
  return {
    ht_match_id: match.matchId,
    match_type: match.matchType,
    match_date: match.date.toISOString(),
    status: formatSuggestedStatus(match.status),
    actual_home_team_id: match.homeId,
    actual_away_team_id: match.awayId,
    actual_home_team_name: match.homeName,
    actual_away_team_name: match.awayName,
    home_goals: match.status === 'FINISHED' ? match.homeGoals : null,
    away_goals: match.status === 'FINISHED' ? match.awayGoals : null,
    home_team: homeTeam
      ? { id: homeTeam.id, name: homeTeam.name, ht_team_id: homeTeam.ht_team_id, logo_url: homeTeam.logo_url }
      : null,
    away_team: awayTeam
      ? { id: awayTeam.id, name: awayTeam.name, ht_team_id: awayTeam.ht_team_id, logo_url: awayTeam.logo_url }
      : null,
  };
}

async function handleSuggestHtMatches(req: VercelRequest, res: VercelResponse) {
  const supabase = getSupabase();
  const tournamentId = String(getBodyValue(req, 'tournamentId') || '');
  const adminPassword = String(getBodyValue(req, 'adminPassword') || '');
  const teamHtId = String(getBodyValue(req, 'teamHtId') || '').replace(/\D/g, '');
  const offset = Math.max(0, Number(getBodyValue(req, 'offset') || 0));
  const limit = Math.min(10, Math.max(1, Number(getBodyValue(req, 'limit') || 10)));
  const fetchWindow = getSuggestedFetchWindow(getBodyValue(req, 'fetchWindow'));
  const categories = getSuggestedFetchCategories(getBodyValue(req, 'matchCategories'));
  const matchTypes = getMatchTypesForCategories(categories);

  if (!tournamentId) return res.status(400).json({ error: 'Missing tournament.' });

  const { data: tournament } = (await supabase
    .from('tournaments')
    .select('id, admin_password, season')
    .eq('id', tournamentId)
    .single()) as { data: AddHtMatchTournamentRow | null };
  if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });
  if (!adminPassword || adminPassword !== tournament.admin_password) {
    return res.status(403).json({ error: 'Organizer password is required.' });
  }

  const { data: authTeam } = await supabase
    .from('teams')
    .select('oauth_token, oauth_token_secret')
    .not('oauth_token', 'is', null)
    .limit(1)
    .single();
  if (!authTeam?.oauth_token) return res.status(401).json({ error: 'No CHPP-authenticated team available.' });

  const { data: teams } = (await supabase
    .from('teams')
    .select('id, name, ht_team_id, logo_url')
    .eq('tournament_id', tournamentId)
    .eq('active', true)) as { data: AddHtMatchTeamRow[] | null };
  const activeTeams = (teams || []).filter((team) => team.ht_team_id);
  if (activeTeams.length < 2) return res.status(400).json({ error: 'Add at least two teams before fetching matches.' });

  const currentSeason = Number(tournament.season || 1);
  const { data: rounds } = await supabase
    .from('rounds')
    .select('matches(ht_match_id)')
    .eq('tournament_id', tournamentId)
    .eq('season_number', currentSeason);
  const existingMatchIds = new Set<number>();
  for (const round of rounds || []) {
    for (const match of round.matches || []) {
      if (match.ht_match_id) existingMatchIds.add(Number(match.ht_match_id));
    }
  }

  const registeredHtIds = new Set(activeTeams.map((team) => Number(team.ht_team_id)));
  const teamByHtId = new Map(activeTeams.map((team) => [Number(team.ht_team_id), team]));
  const selectedTeams = teamHtId
    ? activeTeams.filter((team) => Number(team.ht_team_id) === Number(teamHtId))
    : activeTeams.length > 4
      ? []
      : activeTeams.slice(0, Math.max(1, activeTeams.length - 1));
  if (selectedTeams.length === 0) {
    return res.status(400).json({ error: 'Choose one team to fetch matches for this tournament size.' });
  }

  const deduped = new Map<number, TeamFriendlyMatch>();
  for (const team of selectedTeams) {
    const matches = await fetchTeamFriendlies(
      String(team.ht_team_id),
      authTeam.oauth_token,
      authTeam.oauth_token_secret || '',
      { fetchWindow, matchTypes },
    );
    for (const match of matches) {
      if (existingMatchIds.has(match.matchId)) continue;
      if (!registeredHtIds.has(match.homeId) || !registeredHtIds.has(match.awayId)) continue;
      if (deduped.has(match.matchId)) continue;
      deduped.set(match.matchId, match);
    }
  }

  const now = Date.now();
  const matches = [...deduped.values()];
  const pastMatches = matches
    .filter((match) => match.date.getTime() <= now)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  const futureMatches = matches
    .filter((match) => match.date.getTime() > now)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const ordered = [...pastMatches, ...futureMatches];
  const page = ordered.slice(offset, offset + limit).map((match) => toSuggestedMatch(match, teamByHtId));

  return res.status(200).json({
    ok: true,
    matches: page,
    nextOffset: offset + page.length,
    hasMore: offset + page.length < ordered.length,
  });
}

async function handleAddHtMatch(req: VercelRequest, res: VercelResponse) {
  const supabase = getSupabase();
  const tournamentId = String(getBodyValue(req, 'tournamentId') || '');
  const adminPassword = String(getBodyValue(req, 'adminPassword') || '');
  const htMatchId = String(getBodyValue(req, 'htMatchId') || '').replace(/\D/g, '');
  const dryRun = Boolean(getBodyValue(req, 'dryRun'));

  if (!tournamentId || !htMatchId) return res.status(400).json({ error: 'Missing tournament or match id.' });

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, admin_password, season')
    .eq('id', tournamentId)
    .single();
  if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });
  if (!adminPassword || adminPassword !== tournament.admin_password) {
    return res.status(403).json({ error: 'Organizer password is required.' });
  }

  const { data: authTeam } = await supabase
    .from('teams')
    .select('oauth_token, oauth_token_secret')
    .not('oauth_token', 'is', null)
    .limit(1)
    .single();
  if (!authTeam?.oauth_token) return res.status(401).json({ error: 'No CHPP-authenticated team available.' });

  const { data: teams } = (await supabase
    .from('teams')
    .select('id, name, ht_team_id, logo_url')
    .eq('tournament_id', tournamentId)
    .eq('active', true)) as { data: AddHtMatchTeamRow[] | null };
  const activeTeams = (teams || []).filter((team) => team.ht_team_id);
  if (activeTeams.length === 0) return res.status(400).json({ error: 'Add teams before adding Hattrick matches.' });

  const currentSeason = Number(tournament.season || 1);
  const { data: rounds } = await supabase
    .from('rounds')
    .select('id, round_number, matches(id, ht_match_id, scheduled_for)')
    .eq('tournament_id', tournamentId)
    .eq('season_number', currentSeason)
    .order('round_number', { ascending: true });

  const existingMatchIds = new Set<number>();
  const roundByDate = new Map<string, string>();
  for (const round of rounds || []) {
    for (const match of round.matches || []) {
      if (match.ht_match_id) existingMatchIds.add(Number(match.ht_match_id));
      const key = formatMatchDateKey(match.scheduled_for ? new Date(match.scheduled_for) : null);
      if (key && !roundByDate.has(key)) roundByDate.set(key, round.id);
    }
  }

  const teamByHtId = new Map(activeTeams.map((team) => [Number(team.ht_team_id), team]));
  const details = await fetchMatchDetailsById(htMatchId, authTeam.oauth_token, authTeam.oauth_token_secret || '');
  const homeTeam = details.actualHtHomeTeamId ? teamByHtId.get(details.actualHtHomeTeamId) || null : null;
  const awayTeam = details.actualHtAwayTeamId ? teamByHtId.get(details.actualHtAwayTeamId) || null : null;
  const dateKey = formatMatchDateKey(details.matchDate);

  if (existingMatchIds.has(details.htMatchId)) {
    return res.status(409).json({ error: 'That Hattrick match is already added to this tournament.' });
  }
  if (!details.matchType || !ADDABLE_MATCH_TYPES.has(details.matchType)) {
    return res.status(400).json({ error: 'That Hattrick match is not a supported league, cup, or friendly match.' });
  }
  if (!dateKey || !details.matchDate) {
    return res.status(400).json({ error: 'Match date is unavailable.' });
  }

  const preview = buildAddHtMatchPreview(details, homeTeam, awayTeam);

  if (!dryRun) {
    if (!homeTeam || !awayTeam) {
      return res.status(400).json({ error: 'Both match teams must be registered in this tournament first.' });
    }

    let roundId = roundByDate.get(dateKey);
    if (!roundId) {
      const nextRoundNumber = Math.max(0, ...(rounds || []).map((round) => Number(round.round_number || 0))) + 1;
      const { data: insertedRound, error: roundError } = await supabase
        .from('rounds')
        .insert({
          tournament_id: tournamentId,
          season_number: currentSeason,
          round_number: nextRoundNumber,
        })
        .select('id')
        .single();
      if (roundError || !insertedRound) {
        return res.status(500).json({ error: roundError?.message || 'Could not create a round for this match.' });
      }
      roundId = insertedRound.id;
    }

    const eventDetails = mapMatchEventDetailsToFixture(
      details.eventDetails,
      details.actualHtHomeTeamId,
      details.actualHtAwayTeamId,
    );
    const summary = summarizeMatchEventDetails(eventDetails);
    const { error: matchError } = await supabase.from('matches').insert({
      round_id: roundId,
      home_team_id: homeTeam?.id || null,
      away_team_id: awayTeam?.id || null,
      home_goals: details.completed || details.status === 'ongoing' ? details.homeGoals : null,
      away_goals: details.completed || details.status === 'ongoing' ? details.awayGoals : null,
      completed: details.completed,
      status: details.status,
      went_120: details.went120,
      total_minutes: details.totalMinutes,
      ht_match_id: details.htMatchId,
      match_type: details.matchType,
      scheduled_for: details.matchDate.toISOString(),
      actual_ht_home_team_id: details.actualHtHomeTeamId,
      actual_ht_away_team_id: details.actualHtAwayTeamId,
      appg_outcome: 'needs_review',
      appg_outcome_source: 'unclassified',
      ...summary,
      match_event_details: eventDetails,
    });
    if (matchError) return res.status(500).json({ error: matchError.message });
  }

  return res.status(200).json({
    ok: true,
    preview,
    inserted: dryRun ? 0 : 1,
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST' && getBodyValue(req, 'action') === 'link_match') {
    return handleManualMatchLink(req, res);
  }
  if (req.method === 'POST' && getBodyValue(req, 'action') === 'add_ht_match') {
    return handleAddHtMatch(req, res);
  }
  if (req.method === 'POST' && getBodyValue(req, 'action') === 'suggest_ht_matches') {
    return handleSuggestHtMatches(req, res);
  }

  const { tournament_id } = req.query;
  if (!tournament_id) return res.status(400).json({ error: 'Missing tournament_id' });
  const contextOnly = String(req.query.context_only || req.query.contextOnly || '') === '1';

  try {
    const supabase = getSupabase();
    const { data: tournament } = await supabase.from('tournaments').select('*').eq('id', tournament_id).single();
    const { data: rounds } = await supabase
      .from('rounds')
      .select('*, matches(*)')
      .eq('tournament_id', tournament_id)
      .eq('season_number', tournament?.season || 1)
      .order('round_number');
    const { data: teams } = (await supabase.from('teams').select('*').eq('tournament_id', tournament_id)) as {
      data: TeamWithAuth[] | null;
    };
    const { data: existingWarnings } = await supabase
      .from('fixture_warnings')
      .select('*')
      .eq('tournament_id', tournament_id);

    if (!tournament || !teams || (!rounds && !contextOnly)) return res.status(404).json({ error: 'Data not found' });

    const authTeam = teams.find((team) => team.oauth_token && team.oauth_token_secret);
    const consumerKey = process.env.CHPP_CONSUMER_KEY;
    const consumerSecret = process.env.CHPP_CONSUMER_SECRET;

    let hattrickContext = resolveHattrickWeekContext(undefined);
    if (authTeam && consumerKey && consumerSecret) {
      try {
        const worlddetails = await fetchWorldDetailsContext(
          consumerKey,
          consumerSecret,
          authTeam.oauth_token!,
          authTeam.oauth_token_secret!,
        );
        hattrickContext = worlddetails.context;
      } catch (error) {
        console.error('Failed to fetch worlddetails context:', error);
        hattrickContext = resolveHattrickWeekContext(undefined);
      }
    }

    if (contextOnly) {
      return res.status(200).json({
        hattrick_context: hattrickContext,
      });
    }

    // Identify the closest upcoming round (the first round that has non-resolved matches).
    const now = new Date();
    const upcomingRound = rounds.find((r) => {
      return r.matches.some((m: { completed: boolean; status: string }) => {
        if (m.completed) return false;
        if (m.status === 'misarranged') {
          // If misarranged but the match time has already passed, consider it "resolved" for refresh purposes.
          const matchDate = getMatchTargetDate(m as { scheduled_for?: string | null }, r, teams[0].country_name);
          if (now > matchDate) return false;
        }
        return true;
      });
    });
    if (!upcomingRound) return res.status(200).json({ status: 'No upcoming rounds to refresh' });

    const teamCache: Record<string, { homeId: number; awayId: number; date: Date; matchId: number; matchType: number }[]> = {};
    const getFriendlies = async (team: TeamWithAuth) => {
      if (teamCache[team.id]) return teamCache[team.id];
      if (!team.oauth_token) return [];
      try {
        const secret = team.oauth_token_secret || '';
        const data = await fetchTeamFriendlies(team.ht_team_id.toString(), team.oauth_token, secret, {
          fetchWindow: 'last50',
          matchTypes: getMatchTypesForCategories(['friendlies']),
        });
        teamCache[team.id] = data;
        return data;
      } catch (e) {
        console.error(`Error fetching friendlies for team ${team.id}:`, e);
        return [];
      }
    };

    // Clear warnings for the upcoming round — stale warnings from the current
    // pass must not persist.
    const futureRoundIds = [upcomingRound.id];
    await supabase
      .from('fixture_warnings')
      .delete()
      .eq('tournament_id', tournament_id)
      .in('round_id', futureRoundIds);

    const existingWarningsOutsideRefresh = existingWarnings?.filter((w) => !futureRoundIds.includes(w.round_id)) || [];
    const freshWarnings: { round_id: string; team_id: string }[] = [];
    const getWarningHistory = (teamId: string) => [
      ...existingWarningsOutsideRefresh.filter((w) => w.team_id === teamId),
      ...freshWarnings.filter((w) => w.team_id === teamId),
    ];

    // Only process matches in the upcoming round that are eligible:
    // status ∈ {not_arranged, arranged} AND completed = false
    // Never touch: finished, misarranged, or completed=true
    const linkedMatchIds: number[] = [];

    for (const match of upcomingRound.matches) {
      if (match.completed) continue;
      const currentStatus = match.status ?? 'not_arranged';
      if (!['not_arranged', 'arranged'].includes(currentStatus)) continue;

      // If already has ht_match_id and match_type, we can skip
      if (currentStatus === 'arranged' && match.ht_match_id && match.match_type) continue;

      const homeTeam = teams.find((t) => t.id === match.home_team_id);
      const awayTeam = teams.find((t) => t.id === match.away_team_id);
      if (!homeTeam || !awayTeam) continue;

      const targetDate = getMatchTargetDate(match, upcomingRound, homeTeam.country_name);
      const homeFriendlies = await getFriendlies(homeTeam);
      const awayFriendlies = await getFriendlies(awayTeam);

      const isCorrectMatch = (f: { homeId: number; awayId: number }) =>
        (f.homeId === homeTeam.ht_team_id && f.awayId === awayTeam.ht_team_id) ||
        (f.homeId === awayTeam.ht_team_id && f.awayId === homeTeam.ht_team_id);

      const withinWindow = (f: { date: Date }) =>
        isFriendlyInsideAcceptedWindow(f.date, targetDate, match.schedule_slot_type);
      const homeCorrectMatch = homeFriendlies.find((fixture) => withinWindow(fixture) && isCorrectMatch(fixture));
      const awayCorrectMatch = awayFriendlies.find((fixture) => withinWindow(fixture) && isCorrectMatch(fixture));
      const confirmedMatch = homeCorrectMatch ?? awayCorrectMatch;

      let status: 'not_arranged' | 'arranged' | 'misarranged' = 'not_arranged';
      let htMatchId: number | null = null;
      let matchType: number | null = null;
      let venueMismatch = false;
      let actualHtHomeTeamId: number | null = null;
      let actualHtAwayTeamId: number | null = null;

      if (confirmedMatch) {
        status = 'arranged';
        htMatchId = confirmedMatch.matchId;
        matchType = confirmedMatch.matchType;
        actualHtHomeTeamId = confirmedMatch.homeId;
        actualHtAwayTeamId = confirmedMatch.awayId;
        venueMismatch = confirmedMatch.homeId === awayTeam.ht_team_id && confirmedMatch.awayId === homeTeam.ht_team_id;
        linkedMatchIds.push(confirmedMatch.matchId);
      } else {
        const homeOffending = homeFriendlies.find((fixture) => withinWindow(fixture) && !isCorrectMatch(fixture));
        const awayOffending = awayFriendlies.find((fixture) => withinWindow(fixture) && !isCorrectMatch(fixture));

        if (homeOffending || awayOffending) {
          status = 'misarranged';
        }
      }

      // Update match status and HT Match ID
      await supabase
        .from('matches')
        .update({
          status,
          ht_match_id: htMatchId,
          match_type: matchType,
          venue_mismatch: venueMismatch,
          actual_ht_home_team_id: actualHtHomeTeamId,
          actual_ht_away_team_id: actualHtAwayTeamId,
        })
        .eq('id', match.id);

      // Warning Logic Helper
      const recordWarning = async (teamId: string) => {
        const alreadyHasWarning = freshWarnings.some((w) => w.round_id === upcomingRound.id && w.team_id === teamId);
        if (alreadyHasWarning) return;

        const teamWarnings = getWarningHistory(teamId);
        const prevRound = rounds.find((r) => r.round_number === upcomingRound.round_number - 1);
        const isConsecutive = teamWarnings.some((w) => prevRound && w.round_id === prevRound.id);
        const type = isConsecutive || teamWarnings.length >= 2 ? 'red' : 'yellow';

        await supabase.from('fixture_warnings').insert({
          tournament_id,
          round_id: upcomingRound.id,
          team_id: teamId,
          type,
          reason: 'misarranged',
        });
        freshWarnings.push({ round_id: upcomingRound.id, team_id: teamId });
      };

      const homeAlreadyWarned = freshWarnings.some((w) => w.round_id === upcomingRound.id && w.team_id === homeTeam.id);
      const awayAlreadyWarned = freshWarnings.some((w) => w.round_id === upcomingRound.id && w.team_id === awayTeam.id);
      const homeOffending = !!homeFriendlies.find((fixture) => withinWindow(fixture) && !isCorrectMatch(fixture));
      const awayOffending = !!awayFriendlies.find((fixture) => withinWindow(fixture) && !isCorrectMatch(fixture));

      if (homeOffending && awayOffending) {
        if (!homeAlreadyWarned && !awayAlreadyWarned) {
          await recordWarning(homeTeam.id);
          await recordWarning(awayTeam.id);
        }
      } else if (homeOffending) {
        if (!awayAlreadyWarned) await recordWarning(homeTeam.id);
      } else if (awayOffending) {
        if (!homeAlreadyWarned) await recordWarning(awayTeam.id);
      }
    }

    // Update tournament refresh timestamp
    await supabase.from('tournaments').update({ last_fixtures_refresh: new Date().toISOString() }).eq('id', tournament_id);

    return res.status(200).json({ status: 'Refresh successful', hattrick_context: hattrickContext, linked_match_ids: linkedMatchIds });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'An unknown error occurred' });
  }
}
