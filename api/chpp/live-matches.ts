import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';
import { getAuthHeader } from '../_lib/chpp-auth.js';
import { readChppTag } from '../_lib/chpp-xml.js';

interface LiveMatchResult {
  status: 'ongoing' | 'finished';
  homeGoals: number;
  awayGoals: number;
  total_minutes?: number;
  went_120?: boolean;
  venue_mismatch?: boolean;
  penalty_shootout_home_goals?: number | null;
  penalty_shootout_away_goals?: number | null;
}

const PENALTY_GOAL_EVENT_TYPES = new Set([55, 56, 57]);
const PENALTY_CONTEST_EVENT_TYPES = new Set([55, 56, 57, 58, 59, 71, 73]);

function getEventTypeId(eventXml: string): number | null {
  const eventTypeId = eventXml.match(/<EventTypeID>(\d+)<\/EventTypeID>/i)?.[1];
  if (eventTypeId) return parseInt(eventTypeId, 10);

  const eventKey = eventXml.match(/<EventKey>(\d+)(?:_\d+)?<\/EventKey>/i)?.[1];
  if (eventKey) return parseInt(eventKey, 10);

  return null;
}

function parsePenaltyShootout(xml: string, homeTeamId: number | null, awayTeamId: number | null) {
  if (!homeTeamId || !awayTeamId) {
    return { homeGoals: null, awayGoals: null, hasShootout: false };
  }

  let homeGoals = 0;
  let awayGoals = 0;
  let hasShootout = false;

  const eventBlocks = xml.match(/<Event(?:\s[^>]*)?>[\s\S]*?<\/Event>/gi) ?? [];
  for (const eventXml of eventBlocks) {
    const eventTypeId = getEventTypeId(eventXml);
    if (!eventTypeId || !PENALTY_CONTEST_EVENT_TYPES.has(eventTypeId)) continue;

    hasShootout = true;
    if (!PENALTY_GOAL_EVENT_TYPES.has(eventTypeId)) continue;

    const subjectTeamId = parseInt(eventXml.match(/<SubjectTeamID>(\d+)<\/SubjectTeamID>/i)?.[1] ?? '0', 10) || null;
    if (subjectTeamId === homeTeamId) {
      homeGoals++;
    } else if (subjectTeamId === awayTeamId) {
      awayGoals++;
    }
  }

  return {
    homeGoals: hasShootout ? homeGoals : null,
    awayGoals: hasShootout ? awayGoals : null,
    hasShootout,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { tournament_id, match_ids } = req.query;
  const ids = Array.isArray(match_ids) ? match_ids : (match_ids as string)?.split(',') || [];

  if (!tournament_id || ids.length === 0) return res.status(400).json({ error: 'Missing params' });

  try {
    const supabase = getSupabase();
    const { data: team } = await supabase.from('teams').select('oauth_token, oauth_token_secret').not('oauth_token', 'is', null).limit(1).single();
    if (!team) return res.status(401).json({ error: 'No auth team' });

    // Fetch all tournament matches in one query so we can resolve home/away team ht_team_id
    const { data: tournamentMatches } = await supabase
      .from('matches')
      .select(`
        id,
        ht_match_id,
        home_team:home_team_id ( ht_team_id ),
        away_team:away_team_id ( ht_team_id )
      `)
      .in('ht_match_id', ids.map((id) => parseInt(id, 10)));

    // Build a lookup: ht_match_id -> { scheduledHomeHtId, scheduledAwayHtId }
    const matchFixtureMap = new Map<
      number,
      { scheduledHomeHtId: number | null; scheduledAwayHtId: number | null }
    >();
    if (tournamentMatches) {
      for (const m of tournamentMatches) {
        if (m.ht_match_id) {
          const homeTeam = m.home_team as { ht_team_id: number | null } | null;
          const awayTeam = m.away_team as { ht_team_id: number | null } | null;
          matchFixtureMap.set(m.ht_match_id, {
            scheduledHomeHtId: homeTeam?.ht_team_id ?? null,
            scheduledAwayHtId: awayTeam?.ht_team_id ?? null,
          });
        }
      }
    }

    const url = 'https://chpp.hattrick.org/chppxml.ashx';
    const results: Record<string, LiveMatchResult> = {};
    for (const htMatchId of ids) {
      // Use version 3.0 to ensure EventList is returned
      const params = { file: 'matchdetails', version: '3.0', matchID: htMatchId, matchEvents: 'true' };
      const authHeader = getAuthHeader('GET', url, params, process.env.CHPP_CONSUMER_KEY!, process.env.CHPP_CONSUMER_SECRET!, team.oauth_token!, team.oauth_token_secret!);

      const response = await fetch(`${url}?file=matchdetails&version=3.0&matchEvents=true&matchID=${htMatchId}`, { headers: { Authorization: authHeader } });
      const xml = await response.text();

      const finishedDate = readChppTag(xml, 'FinishedDate');
      const finished = (finishedDate && finishedDate !== '0001-01-01 00:00:00') || xml.includes('<MatchStatus>2</MatchStatus>');

      // For ongoing matches, HomeGoals/AwayGoals in the team blocks are 0.
      // The Scorers list has running totals — grab the last Goal entry's cumulative score.
      const scorersBlock = xml.match(/<Scorers>([\s\S]*?)<\/Scorers>/i)?.[1] ?? '';
      const allGoals = [...scorersBlock.matchAll(/<Goal[^>]*>([\s\S]*?)<\/Goal>/gi)];
      let htHomeGoals: number;
      let htAwayGoals: number;
      if (allGoals.length > 0) {
        const lastGoal = allGoals[allGoals.length - 1][1];
        htHomeGoals = parseInt(lastGoal.match(/<ScorerHomeGoals>(\d+)<\/ScorerHomeGoals>/i)?.[1] ?? '0', 10);
        htAwayGoals = parseInt(lastGoal.match(/<ScorerAwayGoals>(\d+)<\/ScorerAwayGoals>/i)?.[1] ?? '0', 10);
      } else {
        // No goals scored yet (0-0), fall back to team block fields
        htHomeGoals = parseInt(readChppTag(xml, 'HomeGoals') || '0', 10);
        htAwayGoals = parseInt(readChppTag(xml, 'AwayGoals') || '0', 10);
      }

      // Actual team IDs from Hattrick MatchDetails
      const actualHtHomeTeamId =
        parseInt(xml.match(/<HomeTeam>[\s\S]*?<HomeTeamID>(\d+)<\/HomeTeamID>/i)?.[1] || '0', 10) || null;
      const actualHtAwayTeamId =
        parseInt(xml.match(/<AwayTeam>[\s\S]*?<AwayTeamID>(\d+)<\/AwayTeamID>/i)?.[1] || '0', 10) || null;

      const addedMinutes = parseInt(readChppTag(xml, 'AddedMinutes') || '0', 10);

      // Robust extra-time detection: Check EventList for Part 3/4
      const isExtraTime = xml.includes('<MatchPart>3</MatchPart>') || xml.includes('<MatchPart>4</MatchPart>');

      const baseMinutes = isExtraTime ? 120 : 90;
      const totalMinutes = baseMinutes + addedMinutes;
      const penaltyShootout = parsePenaltyShootout(xml, actualHtHomeTeamId, actualHtAwayTeamId);

      // Detect venue mismatch: teams played each other but swapped home/away
      const htMatchIdNum = parseInt(htMatchId, 10);
      const fixture = matchFixtureMap.get(htMatchIdNum);
      let venueMismatch = false;
      let homeGoals = htHomeGoals;
      let awayGoals = htAwayGoals;

      if (
        fixture &&
        fixture.scheduledHomeHtId !== null &&
        fixture.scheduledAwayHtId !== null &&
        actualHtHomeTeamId !== null &&
        actualHtAwayTeamId !== null
      ) {
        const scheduledHomeMatchedActualAway =
          fixture.scheduledHomeHtId === actualHtAwayTeamId &&
          fixture.scheduledAwayHtId === actualHtHomeTeamId;

        if (scheduledHomeMatchedActualAway) {
          // Venue reversed: map goals back to scheduled fixture perspective
          // scheduled home team actually played as away → their goals are htAwayGoals
          homeGoals = htAwayGoals;
          awayGoals = htHomeGoals;
          venueMismatch = true;
        }
      }

      results[htMatchId] = {
        status: finished ? 'finished' : 'ongoing',
        homeGoals,
        awayGoals,
        total_minutes: totalMinutes,
        went_120: isExtraTime,
        venue_mismatch: venueMismatch,
        penalty_shootout_home_goals: penaltyShootout.homeGoals,
        penalty_shootout_away_goals: penaltyShootout.awayGoals,
      };

      await supabase.from('matches').update({
        home_goals: homeGoals,
        away_goals: awayGoals,
        completed: finished,
        status: finished ? 'finished' : 'ongoing',
        total_minutes: totalMinutes,
        went_120: isExtraTime,
        venue_mismatch: venueMismatch,
        penalty_shootout_home_goals: penaltyShootout.homeGoals,
        penalty_shootout_away_goals: penaltyShootout.awayGoals,
        actual_ht_home_team_id: actualHtHomeTeamId,
        actual_ht_away_team_id: actualHtAwayTeamId,
      }).eq('ht_match_id', htMatchIdNum);
    }
    return res.status(200).json({ results });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
}
