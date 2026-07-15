import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';
import { getAuthHeader } from '../_lib/chpp-auth.js';
import { readChppTag } from '../_lib/chpp-xml.js';
import { resolveHattrickWeekContext } from '../_lib/hattrick-time.js';
import { isFriendlyInsideAcceptedWindow } from '../_lib/match-window.js';

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

async function fetchTeamFriendlies(teamId: string, oauthToken: string, oauthTokenSecret: string) {
  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  const url = 'https://chpp.hattrick.org/chppxml.ashx';
  // matchType omitted to get all matches for the team
  const params = { file: 'matches', teamID: teamId };
  const authHeader = getAuthHeader('GET', url, params, consumerKey!, consumerSecret!, oauthToken, oauthTokenSecret);
  const response = await fetch(`${url}?file=matches&teamID=${teamId}`, { headers: { Authorization: authHeader } });
  if (!response.ok) return [];
  const xml = await response.text();
  const friendlies: { homeId: number; awayId: number; date: Date; matchId: number; matchType: number }[] = [];
  for (const match of xml.matchAll(/<Match>([\s\S]*?)<\/Match>/gi)) {
    const block = match[1];
    const matchType = parseInt(readChppTag(block, 'MatchType') || '0', 10);
    // Valid friendlies: 4=Normal, 5=Cup, 8=Int. Normal, 9=Int. Cup
    if ([4, 5, 8, 9].includes(matchType)) {
      const status = readChppTag(block, 'Status');
      if (status === 'FINISHED' || status === 'UPCOMING') {
        const homeId = parseInt(readChppTag(block, 'HomeTeamID') || '0', 10);
        const awayId = parseInt(readChppTag(block, 'AwayTeamID') || '0', 10);
        const dateStr = readChppTag(block, 'MatchDate');
        const matchId = parseInt(readChppTag(block, 'MatchID') || '0', 10);
        if (homeId && awayId && dateStr) friendlies.push({ homeId, awayId, matchId, date: new Date(dateStr.replace(' ', 'T')), matchType });
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
  const params = { file: 'matchdetails', version: '3.0', matchID: htMatchId, matchEvents: 'true' };
  const authHeader = getAuthHeader('GET', url, params, consumerKey!, consumerSecret!, oauthToken, oauthTokenSecret);
  const response = await fetch(`${url}?file=matchdetails&version=3.0&matchEvents=true&matchID=${htMatchId}`, {
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
  const finishedDate = readChppTag(xml, 'FinishedDate');
  const matchStatus = readChppTag(xml, 'MatchStatus');
  const finished = (finishedDate && finishedDate !== '0001-01-01 00:00:00') || matchStatus === '2';
  const status = finished ? 'finished' : matchStatus === '1' ? 'ongoing' : 'arranged';
  const addedMinutes = parseInt(readChppTag(xml, 'AddedMinutes') || '0', 10);
  const went120 = xml.includes('<MatchPart>3</MatchPart>') || xml.includes('<MatchPart>4</MatchPart>');

  return {
    htMatchId: parseInt(htMatchId, 10),
    matchType,
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
    };
    const { error } = await supabase.from('matches').update(updatePayload).eq('id', matchId);
    if (error) return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ ok: true, preview });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST' && getBodyValue(req, 'action') === 'link_match') {
    return handleManualMatchLink(req, res);
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
        const data = await fetchTeamFriendlies(team.ht_team_id.toString(), team.oauth_token, secret);
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
