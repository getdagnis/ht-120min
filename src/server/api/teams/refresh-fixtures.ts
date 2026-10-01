import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase, getSupabase } from '../_lib/supabase.js';
import { getAuthHeader } from '../_lib/chpp-auth.js';
import { readChppTag } from '../_lib/chpp-xml.js';
import {
  fetchArenaDetailsFromChpp,
  fetchTeamBookingStatus,
  fetchTeamDetailsFromChpp,
} from '../_lib/matchmaker.js';
import { buildArrangedFixtureStory, buildReserveFixtureStory, type FixtureStoryTeam } from '../../../utils/fixture-story.js';
import {
  getFootballScore,
  getPenaltyShootoutScore,
  mapMatchEventDetailsToFixture,
  parseMatchEventDetails,
  summarizeMatchEventDetails,
} from '../_lib/chpp-match-events.js';
import { buildChppAppgUpdate } from '../_lib/appg-chpp-classifier.js';
import {
  getHattrickCalendarContext,
  getHattrickWeekFromDate,
  getHattrickWeekStartDate,
  resolveHattrickWeekContext,
} from '../_lib/hattrick-time.js';
import { isFriendlyInsideAcceptedWindow } from '../_lib/match-window.js';
import type { MatchEventDetails } from '../../../../shared/match-events.js';
import { parseChppStockholmDate, serializeStoredStockholmDate } from '../../../../shared/chpp-dates.js';
import type {
  TournamentMatchArrangeStorySnapshot,
  TournamentReserveStorySnapshot,
} from '../../../types/tournament-activity.js';
import { findReserveFixtureMatch, isReserveUseAllowed } from './reserve-matching.js';
import {
  buildArchiveDateChunks,
  mergeChppMatchesById,
  parseChppMatchesXml,
  type ParsedChppMatch,
} from '../../../../shared/matches-archive.js';
import { progressLengthSchedule } from '../_lib/length-schedule-service.js';

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

export function selectUpcomingRefreshRound<
  Round extends {
    id: string;
    round_number: number;
    created_at: string;
    matches: Array<{ completed: boolean | null; status: string | null; scheduled_for?: string | null }>;
  },
>(rounds: Round[], now = new Date(), countryName?: string) {
  return rounds.find((round) =>
    round.matches.some((match) => {
      if (match.completed) return false;
      if (match.status !== 'misarranged') return true;
      return getMatchTargetDate(match, round, countryName).getTime() > now.getTime();
    }),
  );
}

export type FixtureWarningRecord = { round_id: string; team_id: string };

export function planFixtureWarningRefresh<T extends FixtureWarningRecord>(
  existingWarnings: T[] | null | undefined,
  upcomingRoundId: string,
  currentRoundWarnings: T[],
) {
  const storedWarnings = existingWarnings || [];
  const historicalWarnings = storedWarnings.filter((warning) => warning.round_id !== upcomingRoundId);
  const preservedCurrentRoundWarnings = storedWarnings.filter((warning) => warning.round_id === upcomingRoundId);
  const resultingCurrentRoundWarnings = [...preservedCurrentRoundWarnings];

  for (const warning of currentRoundWarnings) {
    const alreadyPresent = resultingCurrentRoundWarnings.some(
      (existingWarning) => existingWarning.round_id === warning.round_id && existingWarning.team_id === warning.team_id,
    );
    if (!alreadyPresent) resultingCurrentRoundWarnings.push(warning);
  }

  return {
    historicalWarnings,
    currentRoundWarnings: resultingCurrentRoundWarnings,
    resultingWarnings: [...historicalWarnings, ...resultingCurrentRoundWarnings],
  };
}

export function getFixtureWarningRoundIdsToDeactivate(input: {
  warnings: Array<{ round_id: string; active?: boolean | null }>;
  rounds: Array<{
    id: string;
    round_number: number;
    created_at: string;
    matches: Array<{
      home_team_id?: string | null;
      away_team_id?: string | null;
      scheduled_for?: string | null;
    }>;
  }>;
  now?: Date;
  countryName?: string;
}) {
  const nowMs = (input.now || new Date()).getTime();
  const roundStarts = input.rounds.map((round) => {
    const matchStarts = round.matches
      .filter((match) => match.home_team_id && match.away_team_id)
      .map((match) => getMatchTargetDate(match, round, input.countryName).getTime())
      .filter(Number.isFinite);
    return matchStarts.length > 0 ? Math.min(...matchStarts) : null;
  });

  return [
    ...new Set(
      input.warnings
        .filter((warning) => warning.active !== false)
        .filter((warning) => {
          const warningRoundIndex = input.rounds.findIndex((round) => round.id === warning.round_id);
          if (warningRoundIndex < 0) return false;
          return roundStarts
            .slice(warningRoundIndex + 1)
            .some((roundStart) => roundStart !== null && roundStart <= nowMs);
        })
        .map((warning) => warning.round_id),
    ),
  ];
}

export function getMisarrangedWarningTeamIds(input: {
  homeTeamId: string;
  awayTeamId: string;
  homeOffending: boolean;
  awayOffending: boolean;
  homeAlreadyWarned?: boolean;
  awayAlreadyWarned?: boolean;
}) {
  const homeAlreadyWarned = input.homeAlreadyWarned ?? false;
  const awayAlreadyWarned = input.awayAlreadyWarned ?? false;

  if (input.homeOffending && input.awayOffending) {
    return !homeAlreadyWarned && !awayAlreadyWarned ? [input.homeTeamId, input.awayTeamId] : [];
  }

  if (input.homeOffending) {
    return !awayAlreadyWarned ? [input.homeTeamId] : [];
  }

  if (input.awayOffending) {
    return !homeAlreadyWarned ? [input.awayTeamId] : [];
  }

  return [];
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
const CHPP_MATCHES_TIMEOUT_MS = 8_000;

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

function getSeasonDateRange(season: number) {
  return {
    start: getHattrickWeekStartDate(season, 1),
    end: getHattrickWeekStartDate(season + 1, 1),
  };
}

async function fetchChppMatchesXml(
  teamId: string,
  oauthToken: string,
  oauthTokenSecret: string,
  params: Record<string, string>,
) {
  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  const url = 'https://chpp.hattrick.org/chppxml.ashx';
  const authHeader = getAuthHeader('GET', url, params, consumerKey!, consumerSecret!, oauthToken, oauthTokenSecret);
  const query = new URLSearchParams(params).toString();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CHPP_MATCHES_TIMEOUT_MS);
  try {
    const response = await fetch(`${url}?${query}`, {
      headers: { Authorization: authHeader },
      signal: controller.signal,
    });
    if (!response.ok) return '';
    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

interface FetchTeamFriendliesResult {
  matches: TeamFriendlyMatch[];
  rawMatchesReturned: number;
  selectedCategoryMatches: number;
}

function toTeamFriendlyMatch(match: ParsedChppMatch): TeamFriendlyMatch {
  return {
    homeId: match.homeId,
    awayId: match.awayId,
    homeName: match.homeName,
    awayName: match.awayName,
    date: match.date,
    matchId: match.matchId,
    matchType: match.matchType,
    homeGoals: match.homeGoals,
    awayGoals: match.awayGoals,
    status: match.status,
  };
}

async function fetchTeamFriendlies(
  teamId: string,
  oauthToken: string,
  oauthTokenSecret: string,
  options: { fetchWindow?: MatchFetchWindow; matchTypes?: Set<number> } = {},
) {
  const fetchWindow = options.fetchWindow || 'current';
  const allowedMatchTypes = options.matchTypes || getMatchTypesForCategories(['friendlies']);
  if (fetchWindow === 'last50') {
    const xml = await fetchChppMatchesXml(teamId, oauthToken, oauthTokenSecret, { file: 'matches', teamID: teamId });
    const parsed = parseChppMatchesXml(xml, { matchTypes: allowedMatchTypes });
    return {
      matches: parsed.matches.map(toTeamFriendlyMatch),
      rawMatchesReturned: parsed.rawMatchesReturned,
      selectedCategoryMatches: parsed.selectedCategoryMatches,
    };
  }

  const targetSeason = getMatchFetchSeason(fetchWindow);
  if (!targetSeason) return { matches: [], rawMatchesReturned: 0, selectedCategoryMatches: 0 };
  const range = getSeasonDateRange(targetSeason);
  const archiveEnd = fetchWindow === 'current' ? new Date(Math.min(range.end.getTime(), Date.now())) : range.end;
  const chunks = buildArchiveDateChunks(range.start, archiveEnd);
  const archiveResults: ParsedChppMatch[][] = [];
  let rawMatchesReturned = 0;
  let selectedCategoryMatches = 0;

  for (const chunk of chunks) {
    const xml = await fetchChppMatchesXml(teamId, oauthToken, oauthTokenSecret, {
      file: 'matchesArchive',
      teamID: teamId,
      FirstMatchDate: formatChppDateTime(chunk.firstDate),
      LastMatchDate: formatChppDateTime(chunk.lastDate),
    });
    const parsed = parseChppMatchesXml(xml, {
      archive: true,
      matchTypes: allowedMatchTypes,
      firstDate: chunk.firstDate,
      lastDate: chunk.lastDate,
    });
    rawMatchesReturned += parsed.rawMatchesReturned;
    selectedCategoryMatches += parsed.selectedCategoryMatches;
    archiveResults.push(parsed.matches);
  }

  let matches = mergeChppMatchesById(archiveResults).map(toTeamFriendlyMatch);
  if (fetchWindow === 'current' && archiveEnd < range.end) {
    const xml = await fetchChppMatchesXml(teamId, oauthToken, oauthTokenSecret, { file: 'matches', teamID: teamId });
    const parsed = parseChppMatchesXml(xml, { matchTypes: allowedMatchTypes });
    rawMatchesReturned += parsed.rawMatchesReturned;
    const upcomingMatches = parsed.matches.filter(
      (match) => match.date > archiveEnd && getHattrickWeekFromDate(match.date).htSeason === targetSeason,
    );
    selectedCategoryMatches += upcomingMatches.length;
    matches = mergeChppMatchesById([
      matches,
      upcomingMatches,
    ]).map(toTeamFriendlyMatch);
  }

  return { matches, rawMatchesReturned, selectedCategoryMatches };
}

interface TeamWithAuth {
  id: string;
  name: string;
  ht_team_id: number;
  oauth_token: string | null;
  oauth_token_secret: string | null;
  active?: boolean | null;
  reserve_active?: boolean | null;
  reserve_joined_at?: string | null;
  is_placeholder?: boolean | null;
  country_name?: string;
  country_id?: number | null;
}

interface ManualLinkMatchRow {
  id: string;
  tournament_id: string;
  home_team_id: string | null;
  away_team_id: string | null;
  appg_outcome_source: string | null;
  home_team: { ht_team_id: number | null; name: string | null } | null;
  away_team: { ht_team_id: number | null; name: string | null } | null;
  reserve_team_id?: string | null;
  reserve_replaces_team_id?: string | null;
  reserve_team?: { ht_team_id: number | null } | null;
}

interface ChppMatchDetails {
  htMatchId: number;
  matchType: number | null;
  matchDate: Date | null;
  finishedAt: string | null;
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
  scoring_mode: string | null;
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
  const storedMatchDate = serializeStoredStockholmDate(matchDateText);
  const storedFinishedAt =
    finishedDate && finishedDate !== '0001-01-01 00:00:00'
      ? parseChppStockholmDate(finishedDate)?.toISOString() || null
      : null;
  const eventDetails = parseMatchEventDetails(xml);
  const footballScore = getFootballScore(eventDetails);

  return {
    htMatchId: parseInt(htMatchId, 10),
    matchType,
    matchDate,
    finishedAt: storedFinishedAt,
    storedMatchDate,
    actualHtHomeTeamId,
    actualHtAwayTeamId,
    actualHomeTeamName,
    actualAwayTeamName,
    homeGoals: footballScore?.home ?? parseInt(readChppTag(xml, 'HomeGoals') || '0', 10),
    awayGoals: footballScore?.away ?? parseInt(readChppTag(xml, 'AwayGoals') || '0', 10),
    status,
    completed: finished,
    went120,
    totalMinutes: (went120 ? 120 : 90) + addedMinutes,
    eventDetails,
  };
}

function mapHattrickMatchToFixture(match: ManualLinkMatchRow, details: ChppMatchDetails) {
  const scheduledHomeHtId = match.home_team?.ht_team_id ?? null;
  const scheduledAwayHtId = match.away_team?.ht_team_id ?? null;
  const reserveHtId = match.reserve_team?.ht_team_id ?? null;
  const homeAliases = match.reserve_replaces_team_id === match.home_team_id && reserveHtId ? [reserveHtId] : [];
  const awayAliases = match.reserve_replaces_team_id === match.away_team_id && reserveHtId ? [reserveHtId] : [];
  const actualHomeHtId = details.actualHtHomeTeamId;
  const actualAwayHtId = details.actualHtAwayTeamId;

  const homeIds = new Set([scheduledHomeHtId, ...homeAliases].filter((id): id is number => id !== null));
  const awayIds = new Set([scheduledAwayHtId, ...awayAliases].filter((id): id is number => id !== null));
  const homeSideMatchesActualHome = actualHomeHtId !== null && homeIds.has(actualHomeHtId);
  const homeSideMatchesActualAway = actualAwayHtId !== null && homeIds.has(actualAwayHtId);
  const awaySideMatchesActualHome = actualHomeHtId !== null && awayIds.has(actualHomeHtId);
  const awaySideMatchesActualAway = actualAwayHtId !== null && awayIds.has(actualAwayHtId);
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
    eventDetails: mapMatchEventDetailsToFixture(details.eventDetails, scheduledHomeHtId, scheduledAwayHtId, homeAliases, awayAliases),
  };
}

async function handleManualMatchLink(req: VercelRequest, res: VercelResponse) {
  const supabase = getSupabase();
  const matchId = String(getBodyValue(req, 'matchId') || '');
  const htMatchId = String(getBodyValue(req, 'htMatchId') || '').replace(/\D/g, '');
  const dryRun = Boolean(getBodyValue(req, 'dryRun'));
  const resetResult = getBodyValue(req, 'resetResult') === true;

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
      tournament_id,
      home_team_id,
      away_team_id,
      appg_outcome_source,
      ht_match_id,
      home_team:teams!matches_home_team_id_fkey(ht_team_id, name),
      away_team:teams!matches_away_team_id_fkey(ht_team_id, name),
      reserve_replaces_team_id,
      reserve_team:teams!matches_reserve_team_id_fkey(ht_team_id)
    `,
    )
    .eq('id', matchId)
    .single();

  if (!match) return res.status(404).json({ error: 'Tournament match not found.' });
  if (resetResult && match.ht_match_id !== Number(htMatchId)) {
    return res.status(400).json({ error: 'This fixture is no longer linked to that Hattrick match.' });
  }
  if (resetResult) {
    const { data: tournament } = await supabase.from('tournaments')
      .select('admin_password')
      .eq('id', match.tournament_id)
      .single();
    const adminPassword = getBodyValue(req, 'adminPassword');
    if (!tournament || typeof adminPassword !== 'string' ||
        !adminPassword || adminPassword !== tournament.admin_password) {
      return res.status(403).json({ error: 'Organizer access is required.' });
    }
  }

  const { data: scoringTournament } = await supabase
    .from('tournaments')
    .select('scoring_mode')
    .eq('id', match.tournament_id)
    .single();

  const details = await fetchMatchDetailsById(htMatchId, authTeam.oauth_token, authTeam.oauth_token_secret || '');
  if (!details.matchType || ![4, 5, 8, 9].includes(details.matchType)) {
    return res.status(400).json({ error: 'That Hattrick match is not a friendly match.' });
  }

  const mapping = mapHattrickMatchToFixture(match as unknown as ManualLinkMatchRow, details);
  if (!mapping) {
    return res.status(400).json({ error: 'That match does not include any team from this fixture.' });
  }

  const penaltyShootout = getPenaltyShootoutScore(mapping.eventDetails);
  const appgUpdate = buildChppAppgUpdate({
    scoringMode: scoringTournament?.scoring_mode,
    currentSource: resetResult ? 'unclassified' : match.appg_outcome_source,
    completed: details.completed,
    homeGoals: mapping.homeGoals,
    awayGoals: mapping.awayGoals,
    went120: details.went120,
    totalMinutes: details.totalMinutes,
    penaltyShootoutHomeGoals: penaltyShootout.home,
    penaltyShootoutAwayGoals: penaltyShootout.away,
    eventDetails: mapping.eventDetails,
  });

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
    penalty_shootout_home_goals: penaltyShootout.home,
    penalty_shootout_away_goals: penaltyShootout.away,
    ...appgUpdate,
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
      penalty_shootout_home_goals: penaltyShootout.home,
      penalty_shootout_away_goals: penaltyShootout.away,
      ...appgUpdate,
      actual_ht_home_team_id: details.actualHtHomeTeamId,
      actual_ht_away_team_id: details.actualHtAwayTeamId,
      finished_at: details.finishedAt,
      ...summarizeMatchEventDetails(mapping.eventDetails),
      match_event_details: mapping.eventDetails,
    };
    const { error } = await supabase.from('matches').update(updatePayload).eq('id', matchId);
    if (error) return res.status(500).json({ error: error.message });
    if (details.completed) {
      const serviceSupabase = getServiceSupabase();
      const { data: linkedTournament } = await serviceSupabase
        .from('tournaments')
        .select('schedule_mode, season')
        .eq('id', match.tournament_id)
        .maybeSingle();
      if (linkedTournament?.schedule_mode === 'length') {
        await progressLengthSchedule(serviceSupabase, match.tournament_id, Number(linkedTournament.season || 1));
      }
    }
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

async function handleSuggestHtMatchesInternal(req: VercelRequest, res: VercelResponse) {
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
    .select('id, admin_password, season, scoring_mode')
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
  const { data: rounds, error: roundsError } = await supabase
    .from('rounds')
    .select('matches(ht_match_id)')
    .eq('tournament_id', tournamentId)
    .eq('season_number', currentSeason);
  if (roundsError) return res.status(500).json({ error: roundsError.message });
  const existingMatchIds = new Set<number>();
  for (const round of rounds || []) {
    for (const match of Array.isArray(round.matches) ? round.matches : []) {
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
  const selectedCategoryMatchIds = new Set<number>();
  const registeredHeadToHeadMatchIds = new Set<number>();
  const alreadyImportedMatchIds = new Set<number>();
  const discoveredDates: Date[] = [];
  let rawMatchesReturned = 0;
  for (const team of selectedTeams) {
    let result: FetchTeamFriendliesResult = {
      matches: [],
      rawMatchesReturned: 0,
      selectedCategoryMatches: 0,
    };
    try {
      result = await fetchTeamFriendlies(
        String(team.ht_team_id),
        authTeam.oauth_token,
        authTeam.oauth_token_secret || '',
        { fetchWindow, matchTypes },
      );
    } catch (error) {
      console.error('Could not fetch suggested matches for team:', {
        teamId: team.ht_team_id,
        error: error instanceof Error ? error.message : error,
      });
    }
    rawMatchesReturned += result.rawMatchesReturned;
    for (const match of result.matches) {
      selectedCategoryMatchIds.add(match.matchId);
      discoveredDates.push(match.date);
      if (existingMatchIds.has(match.matchId)) {
        alreadyImportedMatchIds.add(match.matchId);
        continue;
      }
      if (!registeredHtIds.has(match.homeId) || !registeredHtIds.has(match.awayId)) continue;
      registeredHeadToHeadMatchIds.add(match.matchId);
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
  const discoveredTimes = discoveredDates.map((date) => date.getTime()).filter(Number.isFinite);

  return res.status(200).json({
    ok: true,
    matches: page,
    nextOffset: offset + page.length,
    hasMore: offset + page.length < ordered.length,
    diagnostics: {
      rawChppMatchesReturned: rawMatchesReturned,
      selectedCategoryMatches: selectedCategoryMatchIds.size,
      registeredTeamHeadToHeadMatches: registeredHeadToHeadMatchIds.size,
      alreadyImportedMatches: alreadyImportedMatchIds.size,
      uniqueSuggestions: ordered.length,
      earliestDiscoveredDate: discoveredTimes.length ? new Date(Math.min(...discoveredTimes)).toISOString() : null,
      latestDiscoveredDate: discoveredTimes.length ? new Date(Math.max(...discoveredTimes)).toISOString() : null,
    },
  });
}

async function handleSuggestHtMatches(req: VercelRequest, res: VercelResponse) {
  try {
    return await handleSuggestHtMatchesInternal(req, res);
  } catch (error) {
    console.error('Suggested Hattrick matches request failed:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Could not fetch suggested matches.',
    });
  }
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
    .select('id, admin_password, season, scoring_mode')
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
    const penaltyShootout = getPenaltyShootoutScore(eventDetails);
    const appgUpdate = buildChppAppgUpdate({
      scoringMode: tournament.scoring_mode,
      currentSource: 'unclassified',
      completed: details.completed,
      homeGoals: details.homeGoals,
      awayGoals: details.awayGoals,
      went120: details.went120,
      totalMinutes: details.totalMinutes,
      penaltyShootoutHomeGoals: penaltyShootout.home,
      penaltyShootoutAwayGoals: penaltyShootout.away,
      eventDetails,
    });
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
      scheduled_for: details.storedMatchDate,
      finished_at: details.finishedAt,
      actual_ht_home_team_id: details.actualHtHomeTeamId,
      actual_ht_away_team_id: details.actualHtAwayTeamId,
      penalty_shootout_home_goals: penaltyShootout.home,
      penalty_shootout_away_goals: penaltyShootout.away,
      ...appgUpdate,
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

async function handleTeamPlanningStatuses(req: VercelRequest, res: VercelResponse) {
  const tournamentId = String(getBodyValue(req, 'tournamentId') || '');
  const adminPassword = String(getBodyValue(req, 'adminPassword') || '');
  if (!tournamentId) return res.status(400).json({ error: 'Missing tournament.' });

  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) return res.status(500).json({ error: 'CHPP is not configured.' });

  const supabase = getServiceSupabase();
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, admin_password')
    .eq('id', tournamentId)
    .single();
  if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });
  if (!adminPassword || adminPassword !== tournament.admin_password) {
    return res.status(403).json({ error: 'Organizer password is required.' });
  }

  const { data: teamRows, error: teamsError } = await supabase
    .from('teams')
    .select('id, ht_team_id, oauth_token, oauth_token_secret, active, reserve_active, is_placeholder')
    .eq('tournament_id', tournamentId);
  if (teamsError) return res.status(500).json({ error: teamsError.message });

  const teams = (teamRows || []) as TeamWithAuth[];
  const eligibleTeams = teams.filter(
    (team) =>
      (team.active || team.reserve_active) &&
      !team.is_placeholder &&
      Number(team.ht_team_id) > 0,
  );
  const authTeam = eligibleTeams.find((team) => team.oauth_token && team.oauth_token_secret);
  if (!authTeam) return res.status(401).json({ error: 'No CHPP-authenticated team available.' });

  const { data: roundRows, error: roundsError } = await supabase
    .from('rounds')
    .select('matches(ht_match_id)')
    .eq('tournament_id', tournamentId);
  if (roundsError) return res.status(500).json({ error: roundsError.message });

  const tournamentMatchIds = new Set<number>();
  for (const round of roundRows || []) {
    const roundMatches = Array.isArray(round.matches) ? round.matches : round.matches ? [round.matches] : [];
    for (const match of roundMatches) {
      if (match.ht_match_id) tournamentMatchIds.add(Number(match.ht_match_id));
    }
  }

  const statuses = [];
  for (const team of eligibleTeams) {
    const credentials = team.oauth_token && team.oauth_token_secret ? team : authTeam;
    let details: Awaited<ReturnType<typeof fetchTeamDetailsFromChpp>> | null = null;
    let booking: Awaited<ReturnType<typeof fetchTeamBookingStatus>> | null = null;

    try {
      details = await fetchTeamDetailsFromChpp(consumerKey, consumerSecret, credentials, Number(team.ht_team_id));
    } catch {
      // Keep the other team's status usable if one CHPP request fails.
    }

    try {
      booking = await fetchTeamBookingStatus(consumerKey, consumerSecret, credentials, Number(team.ht_team_id));
    } catch {
      // Booking is optional enrichment; do not fail the whole planning refresh.
    }

    const bookedMatchId = booking?.match?.matchId ? Number(booking.match.matchId) : null;
    statuses.push({
      teamId: team.id,
      htTeamId: Number(team.ht_team_id),
      inCup: typeof details?.stillInCup === 'boolean' ? details.stillInCup : null,
      bookedOutsideTournament: bookedMatchId !== null && !tournamentMatchIds.has(bookedMatchId),
    });
  }

  return res.status(200).json({ statuses, checkedAt: new Date().toISOString() });
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
  if (req.method === 'POST' && getBodyValue(req, 'action') === 'team_planning_statuses') {
    return handleTeamPlanningStatuses(req, res);
  }

  const { tournament_id } = req.query;
  if (!tournament_id) return res.status(400).json({ error: 'Missing tournament_id' });
  const contextOnly = String(req.query.context_only || req.query.contextOnly || '') === '1';

  try {
    const supabase = getServiceSupabase();
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

    // Identify the closest actionable round. A past misarranged fixture no longer
    // needs reserve recovery and must not keep an older round selected.
    const now = new Date();
    const upcomingRound = selectUpcomingRefreshRound(rounds, now, teams[0]?.country_name);
    if (!upcomingRound) {
      if (tournament.schedule_mode === 'length') {
        await progressLengthSchedule(supabase, String(tournament_id), Number(tournament.season || 1));
      }
      return res.status(200).json({ status: 'No upcoming rounds to refresh' });
    }

    const warningRoundIdsToDeactivate = getFixtureWarningRoundIdsToDeactivate({
      warnings: existingWarnings || [],
      rounds,
      now,
      countryName: teams[0]?.country_name,
    });
    if (warningRoundIdsToDeactivate.length > 0) {
      const { error: expiredWarningError } = await supabase
        .from('fixture_warnings')
        .update({ active: false })
        .eq('tournament_id', tournament_id)
        .in('round_id', warningRoundIdsToDeactivate)
        .eq('active', true);
      if (expiredWarningError) throw expiredWarningError;
    }

    const teamCache: Record<
      string,
      { homeId: number; awayId: number; date: Date; matchId: number; matchType: number }[] | null
    > = {};
    const getFriendlies = async (team: TeamWithAuth) => {
      if (Object.prototype.hasOwnProperty.call(teamCache, team.id)) return teamCache[team.id];
      if (!team.oauth_token) {
        teamCache[team.id] = null;
        return null;
      }
      try {
        const secret = team.oauth_token_secret || '';
        const data = await fetchTeamFriendlies(team.ht_team_id.toString(), team.oauth_token, secret, {
          fetchWindow: 'last50',
          matchTypes: getMatchTypesForCategories(['friendlies']),
        });
        teamCache[team.id] = data.matches;
        return data.matches;
      } catch (e) {
        console.error(`Error fetching friendlies for team ${team.id}:`, e);
        teamCache[team.id] = null;
        return null;
      }
    };

    const teamDetailsCache = new Map<number, ReturnType<typeof fetchTeamDetailsFromChpp>>();
    const arenaDetailsCache = new Map<number, ReturnType<typeof fetchArenaDetailsFromChpp>>();
    const getStoryTeamDetails = async (team: TeamWithAuth) => {
      const credentials = team.oauth_token && team.oauth_token_secret ? team : authTeam;
      if (!consumerKey || !consumerSecret || !credentials?.oauth_token || !credentials.oauth_token_secret) return null;
      const cached = teamDetailsCache.get(team.ht_team_id);
      if (cached) return cached;
      const request = fetchTeamDetailsFromChpp(consumerKey, consumerSecret, credentials, team.ht_team_id).catch((error) => {
        console.error(`Error fetching story details for team ${team.id}:`, error);
        return null;
      });
      teamDetailsCache.set(team.ht_team_id, request);
      return request;
    };
    const getStoryArenaDetails = async (team: TeamWithAuth, arenaId: number) => {
      if (!consumerKey || !consumerSecret || !team.oauth_token) return null;
      const cached = arenaDetailsCache.get(arenaId);
      if (cached) return cached;
      const request = fetchArenaDetailsFromChpp(consumerKey, consumerSecret, team, arenaId).catch((error) => {
        console.error(`Error fetching arena details for team ${team.id}:`, error);
        return null;
      });
      arenaDetailsCache.set(arenaId, request);
      return request;
    };

    const buildArrangeStorySnapshot = async (
      match: {
        next_match_arrange_story?: TournamentMatchArrangeStorySnapshot | null;
        home_team_id: string | null;
        away_team_id: string | null;
        venue_mismatch?: boolean | null;
      },
      round: { round_number: number },
      confirmedMatch: { date: Date; homeId: number; awayId: number } | null,
      eventAt: string | null,
    ): Promise<TournamentMatchArrangeStorySnapshot | null> => {
      if (match.next_match_arrange_story || !confirmedMatch || !Number.isFinite(confirmedMatch.date.getTime())) return null;

      const actualHomeTeam = teams.find((team) => team.ht_team_id === confirmedMatch.homeId);
      const actualAwayTeam = teams.find((team) => team.ht_team_id === confirmedMatch.awayId);
      if (!actualHomeTeam || !actualAwayTeam) return null;
      if (actualHomeTeam.id !== match.home_team_id && actualHomeTeam.id !== match.away_team_id) return null;
      if (actualAwayTeam.id !== match.home_team_id && actualAwayTeam.id !== match.away_team_id) return null;

      const homeDetails = await getStoryTeamDetails(actualHomeTeam);
      const arenaDetails = homeDetails?.arenaId
        ? await getStoryArenaDetails(actualHomeTeam, homeDetails.arenaId)
        : null;
      const homeStoryTeam: FixtureStoryTeam = {
        name: actualHomeTeam.name,
        htTeamId: actualHomeTeam.ht_team_id,
        countryName: homeDetails?.countryName ?? actualHomeTeam.country_name,
        countryId: homeDetails?.countryId ?? actualHomeTeam.country_id,
        regionName: homeDetails?.regionName,
        regionId: homeDetails?.regionId,
      };
      const awayStoryTeam: FixtureStoryTeam = {
        name: actualAwayTeam.name,
        htTeamId: actualAwayTeam.ht_team_id,
        countryName: actualAwayTeam.country_name,
        countryId: actualAwayTeam.country_id,
      };

      return {
        eventAt,
        story: buildArrangedFixtureStory({
          roundNumber: round.round_number,
          matchDate: confirmedMatch.date,
          homeTeam: homeStoryTeam,
          awayTeam: awayStoryTeam,
          venue: {
            arenaName: arenaDetails?.arenaName ?? homeDetails?.arenaName,
            capacity: arenaDetails?.capacity,
            fanclubSize: homeDetails?.fanclubSize,
          },
        }),
      };
    };

    const buildReserveStorySnapshot = (
      match: { reserve_story?: TournamentReserveStorySnapshot | null },
      round: { round_number: number },
      reserveMatch: {
        reserve: TeamWithAuth;
        replaces: 'home' | 'away';
      },
      homeTeam: TeamWithAuth,
      awayTeam: TeamWithAuth,
      eventAt: string | null,
    ): TournamentReserveStorySnapshot | null => {
      if (match.reserve_story) return null;
      const replacedTeam = reserveMatch.replaces === 'home' ? homeTeam : awayTeam;
      const opponentTeam = reserveMatch.replaces === 'home' ? awayTeam : homeTeam;
      const toStoryTeam = (team: TeamWithAuth): FixtureStoryTeam => ({
        name: team.name,
        htTeamId: team.ht_team_id,
        countryName: team.country_name,
        countryId: team.country_id,
      });
      return {
        eventAt,
        story: buildReserveFixtureStory({
          roundNumber: round.round_number,
          reserveTeam: toStoryTeam(reserveMatch.reserve),
          replacedTeam: toStoryTeam(replacedTeam),
          opponentTeam: toStoryTeam(opponentTeam),
        }),
      };
    };

    // Active-round warnings are intentionally sticky. The first refresh that
    // detects a conflict decides who is warned; later CHPP state must not add
    // a warning to the opponent who had to arrange elsewhere afterward.
    const warningRoundIdsToDeactivateSet = new Set(warningRoundIdsToDeactivate);
    const activeExistingWarnings = (existingWarnings || []).filter(
      (warning) => warning.active !== false && !warningRoundIdsToDeactivateSet.has(warning.round_id),
    );
    const warningPlan = planFixtureWarningRefresh(activeExistingWarnings, upcomingRound.id, []);
    const existingWarningsOutsideRefresh = warningPlan.historicalWarnings;
    const currentRoundWarnings = warningPlan.currentRoundWarnings;
    const knownCupStatuses = new Map<string, boolean>();
    const getWarningHistory = (teamId: string) => [
      ...existingWarningsOutsideRefresh.filter((w) => w.team_id === teamId),
      ...currentRoundWarnings.filter((w) => w.team_id === teamId),
    ];

    const recordWarning = async (teamId: string, reason: 'misarranged' | 'in_cup' = 'misarranged') => {
      const alreadyHasWarning = currentRoundWarnings.some(
        (w) => w.round_id === upcomingRound.id && w.team_id === teamId,
      );
      if (alreadyHasWarning) return;

      const teamWarnings = getWarningHistory(teamId);
      const prevRound = rounds.find((r) => r.round_number === upcomingRound.round_number - 1);
      const isConsecutive = teamWarnings.some((w) => prevRound && w.round_id === prevRound.id);
      const type = reason === 'in_cup' ? 'yellow' : isConsecutive || teamWarnings.length >= 2 ? 'red' : 'yellow';

      await supabase.from('fixture_warnings').insert({
        tournament_id,
        round_id: upcomingRound.id,
        team_id: teamId,
        type,
        reason,
      });

      currentRoundWarnings.push({
        round_id: upcomingRound.id,
        team_id: teamId,
        type,
        reason,
      } as (typeof currentRoundWarnings)[number]);
    };

    const linkedMatchIds: number[] = [];

    const findConfirmedMatch = (
      match: {
        ht_match_id?: number | null;
        home_team_id: string | null;
        away_team_id: string | null;
        schedule_slot_type?: string | null;
        scheduled_for?: string | null;
      },
      round: { created_at: string; round_number: number },
      homeTeam: TeamWithAuth,
      awayTeam: TeamWithAuth,
      homeFriendlies: Array<{ homeId: number; awayId: number; date: Date; matchId: number; matchType: number }>,
      awayFriendlies: Array<{ homeId: number; awayId: number; date: Date; matchId: number; matchType: number }>,
    ) => {
      const candidates = [...homeFriendlies, ...awayFriendlies];
      const isCorrectMatch = (fixture: { homeId: number; awayId: number }) =>
        (fixture.homeId === homeTeam.ht_team_id && fixture.awayId === awayTeam.ht_team_id) ||
        (fixture.homeId === awayTeam.ht_team_id && fixture.awayId === homeTeam.ht_team_id);
      const exactMatch = match.ht_match_id
        ? candidates.find((fixture) => fixture.matchId === match.ht_match_id && isCorrectMatch(fixture))
        : null;
      if (exactMatch) return exactMatch;
      const targetDate = getMatchTargetDate(match, round, homeTeam.country_name);
      return candidates.find(
        (fixture) => isFriendlyInsideAcceptedWindow(fixture.date, targetDate, match.schedule_slot_type) && isCorrectMatch(fixture),
      ) || null;
    };

    const reserveTeams = teams.filter(
      (team) => team.active === false && team.reserve_active === true && team.ht_team_id > 0,
    );

    for (const match of upcomingRound.matches) {
      if (match.completed) continue;
      const currentStatus = match.status ?? 'not_arranged';
      if (!['not_arranged', 'arranged', 'misarranged'].includes(currentStatus)) continue;

      // Already-arranged matches only need a pass when their activity snapshot is missing.
      if (
        currentStatus === 'arranged' &&
        match.ht_match_id &&
        match.match_type &&
        (match.next_match_arrange_story || match.reserve_story || match.reserve_team_id) &&
        !currentRoundWarnings.some(
            (warning) =>
              warning.round_id === upcomingRound.id &&
              (warning.team_id === match.home_team_id || warning.team_id === match.away_team_id),
        )
      ) continue;

      const homeTeam = teams.find((t) => t.id === match.home_team_id);
      const awayTeam = teams.find((t) => t.id === match.away_team_id);
      if (!homeTeam || !awayTeam) continue;

      const [homeDetails, awayDetails] = await Promise.all([
        getStoryTeamDetails(homeTeam),
        getStoryTeamDetails(awayTeam),
      ]);
      if (typeof homeDetails?.stillInCup === 'boolean') knownCupStatuses.set(homeTeam.id, homeDetails.stillInCup);
      if (typeof awayDetails?.stillInCup === 'boolean') knownCupStatuses.set(awayTeam.id, awayDetails.stillInCup);
      if (homeDetails?.stillInCup === true) await recordWarning(homeTeam.id, 'in_cup');
      if (awayDetails?.stillInCup === true) await recordWarning(awayTeam.id, 'in_cup');

      const targetDate = getMatchTargetDate(match, upcomingRound, homeTeam.country_name);
      const homeFriendlies = await getFriendlies(homeTeam);
      const awayFriendlies = await getFriendlies(awayTeam);
      if (!homeFriendlies || !awayFriendlies) continue;

      const isCorrectMatch = (f: { homeId: number; awayId: number }) =>
        (f.homeId === homeTeam.ht_team_id && f.awayId === awayTeam.ht_team_id) ||
        (f.homeId === awayTeam.ht_team_id && f.awayId === homeTeam.ht_team_id);

      const withinWindow = (f: { date: Date }) =>
        isFriendlyInsideAcceptedWindow(f.date, targetDate, match.schedule_slot_type);
      const confirmedMatch = findConfirmedMatch(match, upcomingRound, homeTeam, awayTeam, homeFriendlies, awayFriendlies);
      const reserveAllowed = isReserveUseAllowed({ status: currentStatus, targetDate, now });
      const reserveResolution = confirmedMatch
        ? null
        : findReserveFixtureMatch({
            homeHtTeamId: homeTeam.ht_team_id,
            awayHtTeamId: awayTeam.ht_team_id,
            homeFriendlies,
            awayFriendlies,
            reserveTeams,
            targetDate,
            isInsideWindow: (friendlyDate, expectedTargetDate) =>
              isFriendlyInsideAcceptedWindow(friendlyDate, expectedTargetDate, match.schedule_slot_type),
            reserveAllowed,
          });
      const homeOffending = homeFriendlies.some((fixture) => withinWindow(fixture) && !isCorrectMatch(fixture));
      const awayOffending = awayFriendlies.some((fixture) => withinWindow(fixture) && !isCorrectMatch(fixture));

      let status: 'not_arranged' | 'arranged' | 'misarranged' = 'not_arranged';
      let htMatchId: number | null = null;
      let matchType: number | null = null;
      let venueMismatch = false;
      let actualHtHomeTeamId: number | null = null;
      let actualHtAwayTeamId: number | null = null;
      let reserveTeamId: string | null = null;
      let reserveReplacesTeamId: string | null = null;

      if (confirmedMatch) {
        status = 'arranged';
        htMatchId = confirmedMatch.matchId;
        matchType = confirmedMatch.matchType;
        actualHtHomeTeamId = confirmedMatch.homeId;
        actualHtAwayTeamId = confirmedMatch.awayId;
        venueMismatch = confirmedMatch.homeId === awayTeam.ht_team_id && confirmedMatch.awayId === homeTeam.ht_team_id;
        linkedMatchIds.push(confirmedMatch.matchId);
      } else if (reserveResolution?.kind === 'reserve') {
        status = 'arranged';
        htMatchId = reserveResolution.fixture.matchId;
        matchType = reserveResolution.fixture.matchType;
        actualHtHomeTeamId = reserveResolution.fixture.homeId;
        actualHtAwayTeamId = reserveResolution.fixture.awayId;
        reserveTeamId = reserveResolution.reserve.id;
        reserveReplacesTeamId = reserveResolution.replaces === 'home' ? homeTeam.id : awayTeam.id;
        linkedMatchIds.push(reserveResolution.fixture.matchId);
      } else {
        if (reserveResolution?.kind === 'both-reserves' || homeOffending || awayOffending) {
          status = 'misarranged';
        }
      }

      const arrangeStory =
        status === 'arranged'
          ? await buildArrangeStorySnapshot(
              match,
              upcomingRound,
              confirmedMatch,
              currentStatus === 'arranged' ? null : new Date().toISOString(),
          )
          : null;
      const reserveStory =
        status === 'arranged' && reserveResolution?.kind === 'reserve'
          ? buildReserveStorySnapshot(
              match,
              upcomingRound,
              reserveResolution,
              homeTeam,
              awayTeam,
              currentStatus === 'arranged' ? null : new Date().toISOString(),
            )
          : null;

      // Update match status and HT Match ID
      const { error: matchUpdateError } = await supabase
        .from('matches')
        .update({
          status,
          ht_match_id: htMatchId,
          match_type: matchType,
          venue_mismatch: venueMismatch,
          actual_ht_home_team_id: actualHtHomeTeamId,
          actual_ht_away_team_id: actualHtAwayTeamId,
          reserve_team_id: reserveTeamId,
          reserve_replaces_team_id: reserveReplacesTeamId,
          ...(arrangeStory ? { next_match_arrange_story: arrangeStory } : {}),
          ...(reserveStory ? { reserve_story: reserveStory } : {}),
        })
        .eq('id', match.id);
      if (matchUpdateError) throw matchUpdateError;

      if (reserveResolution?.kind === 'reserve') {
        const { error: warningError } = await supabase
          .from('fixture_warnings')
          .update({ active: false })
          .eq('tournament_id', tournament_id)
          .eq('round_id', upcomingRound.id)
          .in('team_id', [homeTeam.id, awayTeam.id])
          .eq('active', true);
        if (warningError) throw warningError;
      }

      if (reserveResolution?.kind !== 'reserve') {
        for (const teamId of getMisarrangedWarningTeamIds({
          homeTeamId: homeTeam.id,
          awayTeamId: awayTeam.id,
          homeOffending,
          awayOffending,
          homeAlreadyWarned: currentRoundWarnings.some(
            (warning) => warning.round_id === upcomingRound.id && warning.team_id === homeTeam.id,
          ),
          awayAlreadyWarned: currentRoundWarnings.some(
            (warning) => warning.round_id === upcomingRound.id && warning.team_id === awayTeam.id,
          ),
        })) {
          await recordWarning(teamId);
        }
      }
    }

    const staleCupWarningTeamIds = currentRoundWarnings
      .filter((warning) => warning.reason === 'in_cup' && knownCupStatuses.get(warning.team_id) === false)
      .map((warning) => warning.team_id);
    if (staleCupWarningTeamIds.length > 0) {
      const { error: staleCupWarningError } = await supabase
        .from('fixture_warnings')
        .update({ active: false })
        .eq('tournament_id', tournament_id)
        .eq('round_id', upcomingRound.id)
        .in('team_id', Array.from(new Set(staleCupWarningTeamIds)))
        .eq('reason', 'in_cup')
        .eq('active', true);
      if (staleCupWarningError) throw staleCupWarningError;
      for (let index = currentRoundWarnings.length - 1; index >= 0; index -= 1) {
        const warning = currentRoundWarnings[index];
        if (warning?.reason === 'in_cup' && knownCupStatuses.get(warning.team_id) === false) {
          currentRoundWarnings.splice(index, 1);
        }
      }
    }

    // Backfill story snapshots for recent or historical linked matches when the
    // exact CHPP friendly is still available. Their transition timestamp remains
    // null because the old transition cannot be reconstructed safely.
    for (const round of rounds) {
      for (const match of round.matches) {
        if (match.reserve_team_id && !match.reserve_story) {
          const reserveTeam = teams.find((team) => team.id === match.reserve_team_id);
          const homeTeam = teams.find((team) => team.id === match.home_team_id);
          const awayTeam = teams.find((team) => team.id === match.away_team_id);
          const replacedTeam = teams.find((team) => team.id === match.reserve_replaces_team_id);
          const opponentTeam = replacedTeam?.id === homeTeam?.id ? awayTeam : homeTeam;
          if (reserveTeam && replacedTeam && opponentTeam && homeTeam && awayTeam) {
            const reserveStory = buildReserveStorySnapshot(
              match,
              round,
              {
                reserve: reserveTeam,
                replaces: replacedTeam.id === homeTeam?.id ? 'home' : 'away',
              },
              homeTeam,
              awayTeam,
              null,
            );
            if (reserveStory) {
              await supabase.from('matches').update({ reserve_story: reserveStory }).eq('id', match.id);
            }
          }
        }
        if (match.completed === false && !['arranged', 'ongoing', 'finished'].includes(match.status || '')) continue;
        if (match.next_match_arrange_story || !match.ht_match_id) continue;
        const homeTeam = teams.find((team) => team.id === match.home_team_id);
        const awayTeam = teams.find((team) => team.id === match.away_team_id);
        if (!homeTeam || !awayTeam) continue;
        const homeFriendlies = await getFriendlies(homeTeam);
        const awayFriendlies = await getFriendlies(awayTeam);
        if (!homeFriendlies || !awayFriendlies) continue;
        const confirmedMatch = findConfirmedMatch(match, round, homeTeam, awayTeam, homeFriendlies, awayFriendlies);
        const arrangeStory = await buildArrangeStorySnapshot(match, round, confirmedMatch, null);
        if (!arrangeStory) continue;
        await supabase.from('matches').update({ next_match_arrange_story: arrangeStory }).eq('id', match.id);
      }
    }

    // Update tournament refresh timestamp
    await supabase.from('tournaments').update({ last_fixtures_refresh: new Date().toISOString() }).eq('id', tournament_id);

    if (tournament.schedule_mode === 'length') {
      await progressLengthSchedule(supabase, String(tournament_id), Number(tournament.season || 1));
    }

    return res.status(200).json({ status: 'Refresh successful', hattrick_context: hattrickContext, linked_match_ids: linkedMatchIds });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'An unknown error occurred' });
  }
}
