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

      // Raw goals as reported by Hattrick (from actual venue perspective)
      const htHomeGoals = parseInt(readChppTag(xml, 'HomeGoals') || '0', 10);
      const htAwayGoals = parseInt(readChppTag(xml, 'AwayGoals') || '0', 10);

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
      };

      await supabase.from('matches').update({
        home_goals: homeGoals,
        away_goals: awayGoals,
        completed: finished,
        status: finished ? 'finished' : 'ongoing',
        total_minutes: totalMinutes,
        went_120: isExtraTime,
        venue_mismatch: venueMismatch,
        actual_ht_home_team_id: actualHtHomeTeamId,
        actual_ht_away_team_id: actualHtAwayTeamId,
      }).eq('ht_match_id', htMatchIdNum);
    }
    return res.status(200).json({ results });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
}
