import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';
import { getAuthHeader } from '../_lib/chpp-auth.js';
import { readChppTag } from '../_lib/chpp-xml.js';

interface LiveMatchResult {
  status: 'ongoing' | 'finished';
  homeGoals: number;
  awayGoals: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { tournament_id, match_ids } = req.query;
  const ids = Array.isArray(match_ids) ? match_ids : (match_ids as string)?.split(',') || [];

  if (!tournament_id || ids.length === 0) {
    return res.status(400).json({ error: 'Missing tournament_id or match_ids' });
  }

  try {
    const supabase = getSupabase();

    // 1. Get an OAuth token from the tournament organizer or any authorized team
    const { data: tournament } = await supabase
      .from('tournaments')
      .select('organizer_id')
      .eq('id', tournament_id)
      .single();

    let authTeam;
    if (tournament?.organizer_id) {
      const { data } = await supabase
        .from('teams')
        .select('oauth_token, oauth_token_secret')
        .eq('id', tournament.organizer_id)
        .single();
      if (data?.oauth_token) authTeam = data;
    }

    if (!authTeam) {
      const { data } = await supabase
        .from('teams')
        .select('oauth_token, oauth_token_secret')
        .eq('tournament_id', tournament_id)
        .not('oauth_token', 'is', null)
        .limit(1)
        .single();
      authTeam = data;
    }

    if (!authTeam || !authTeam.oauth_token) {
      return res.status(401).json({ error: 'No authorized team found to fetch live data' });
    }

    const consumerKey = process.env.CHPP_CONSUMER_KEY;
    const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
    const url = 'https://chpp.hattrick.org/chppxml.ashx';

    // 2. Fetch live data for each match
    // Use live.xml actionType=view to get all ongoing matches for the authenticated user
    const liveParams = { file: 'live', actionType: 'view' };
    const liveAuthHeader = getAuthHeader(
      'GET',
      url,
      liveParams,
      consumerKey!,
      consumerSecret!,
      authTeam.oauth_token,
      authTeam.oauth_token_secret!,
    );
    const liveResponse = await fetch(`${url}?file=live&actionType=view`, {
      headers: { Authorization: liveAuthHeader },
    });

    let liveMatchesXml = '';
    if (liveResponse.ok) {
      liveMatchesXml = await liveResponse.text();
    }

    const results: Record<string, LiveMatchResult> = {};

    for (const htMatchId of ids) {
      // 3. Try to find score in live.xml first (more reliable for live scores)
      let liveScoreMatch = null;
      for (const m of liveMatchesXml.matchAll(/<Match>([\s\S]*?)<\/Match>/gi)) {
        const block = m[1];
        if (readChppTag(block, 'MatchID') === htMatchId) {
          liveScoreMatch = block;
          break;
        }
      }

      if (liveScoreMatch) {
        const homeGoals = parseInt(readChppTag(liveScoreMatch, 'HomeGoals') || '0', 10);
        const awayGoals = parseInt(readChppTag(liveScoreMatch, 'AwayGoals') || '0', 10);

        // Check for Event 599 (Match finished)
        const isFinished =
          liveScoreMatch.includes('<EventKey>599</EventKey>') ||
          liveScoreMatch.includes('<EventKey>599_') ||
          liveScoreMatch.includes('Match finished');

        results[htMatchId] = {
          status: isFinished ? 'finished' : 'ongoing',
          homeGoals,
          awayGoals,
        };

        if (isFinished) {
          await supabase
            .from('matches')
            .update({ home_goals: homeGoals, away_goals: awayGoals, completed: true, status: 'finished' })
            .eq('ht_match_id', parseInt(htMatchId, 10));
        }
      } else {
        // 4. If not in live list, try to add it so it's available in next poll
        const addParams = { file: 'live', actionType: 'addMatch', matchID: htMatchId };
        const addAuthHeader = getAuthHeader(
          'GET',
          url,
          addParams,
          consumerKey!,
          consumerSecret!,
          authTeam.oauth_token,
          authTeam.oauth_token_secret!,
        );
        await fetch(`${url}?file=live&actionType=addMatch&matchID=${htMatchId}`, {
          headers: { Authorization: addAuthHeader },
        });

        // 5. Fallback to matchdetails.xml
        const params = { file: 'matchdetails', matchID: htMatchId, sourceSystem: 'HTOIntegrated' };
        const authHeader = getAuthHeader(
          'GET',
          url,
          params,
          consumerKey!,
          consumerSecret!,
          authTeam.oauth_token,
          authTeam.oauth_token_secret!,
        );

        const response = await fetch(`${url}?file=matchdetails&matchID=${htMatchId}&sourceSystem=HTOIntegrated`, {
          headers: { Authorization: authHeader },
        });

        if (!response.ok) continue;
        const xml = await response.text();

        const finished = readChppTag(xml, 'FinishedDate') !== undefined || xml.includes('<MatchStatus>2</MatchStatus>');
        const homeGoals = parseInt(readChppTag(xml, 'HomeGoals') || '0', 10);
        const awayGoals = parseInt(readChppTag(xml, 'AwayGoals') || '0', 10);
        const addedMinutes = parseInt(readChppTag(xml, 'AddedMinutes') || '0', 10);
        
        // MatchPart >= 3 (First half extra time) indicates the match went to Extra Time
        const isExtraTime = xml.includes('<MatchPart>3</MatchPart>') || xml.includes('<MatchPart>4</MatchPart>');
        const baseMinutes = isExtraTime ? 120 : 90;
        const totalMinutes = baseMinutes + addedMinutes;

        results[htMatchId] = {
          status: finished ? 'finished' : 'ongoing',
          homeGoals,
          awayGoals,
        };

        if (finished) {
          await supabase
            .from('matches')
            .update({ 
              home_goals: homeGoals, 
              away_goals: awayGoals, 
              completed: true, 
              status: 'finished',
              total_minutes: totalMinutes,
              went_120: isExtraTime
            })
            .eq('ht_match_id', parseInt(htMatchId, 10));
        }
      }
    }

    const now = new Date().toISOString();
    // Update tournament refresh timestamp
    await supabase.from('tournaments').update({ last_fixtures_refresh: now }).eq('id', tournament_id);

    return res.status(200).json({ results, lastRefresh: now });
  } catch (error) {
    console.error('Live matches fetch error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
