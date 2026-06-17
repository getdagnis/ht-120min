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
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { tournament_id, match_ids } = req.query;
  const ids = Array.isArray(match_ids) ? match_ids : (match_ids as string)?.split(',') || [];

  if (!tournament_id || ids.length === 0) return res.status(400).json({ error: 'Missing params' });

  try {
    const supabase = getSupabase();
    const { data: team } = await supabase.from('teams').select('oauth_token, oauth_token_secret').not('oauth_token', 'is', null).limit(1).single();
    if (!team) return res.status(401).json({ error: 'No auth team' });

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
  const homeGoals = parseInt(readChppTag(xml, 'HomeGoals') || '0', 10);
  const awayGoals = parseInt(readChppTag(xml, 'AwayGoals') || '0', 10);
  const addedMinutes = parseInt(readChppTag(xml, 'AddedMinutes') || '0', 10);

  // Robust extra-time detection: Check EventList for Part 3/4
  const isExtraTime = xml.includes('<MatchPart>3</MatchPart>') || xml.includes('<MatchPart>4</MatchPart>');

  const baseMinutes = isExtraTime ? 120 : 90;
  const totalMinutes = baseMinutes + addedMinutes;

  results[htMatchId] = {
    status: finished ? 'finished' : 'ongoing',
    homeGoals,
    awayGoals,
    total_minutes: totalMinutes,
    went_120: isExtraTime,
  };

  await supabase.from('matches').update({
    home_goals: homeGoals,
    away_goals: awayGoals,
    completed: finished,
    status: finished ? 'finished' : 'ongoing',
    total_minutes: totalMinutes,
    went_120: isExtraTime,
  }).eq('ht_match_id', parseInt(htMatchId, 10));
}
    return res.status(200).json({ results });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
}
