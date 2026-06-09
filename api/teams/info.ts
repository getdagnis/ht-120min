import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';
import { getAuthHeader } from '../_lib/chpp-auth.js';

interface TeamTournamentCheck {
  tournament_id: string;
  tournaments: { name: string; status: string } | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { team_id } = req.query;

  if (!team_id) {
    return res.status(400).json({ error: 'Missing team_id' });
  }

  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    return res.status(500).json({ error: 'CHPP config missing' });
  }

  try {
    const supabase = getSupabase();

    // Find any valid OAuth token to use as a gateway
    const { data: teamWithToken, error: tError } = await supabase
      .from('teams')
      .select('oauth_token, oauth_token_secret')
      .not('oauth_token', 'is', null)
      .limit(1)
      .single();

    if (tError || !teamWithToken) {
      return res.status(503).json({ error: 'No CHPP gateway available. Please link a team first.' });
    }

    // 2. Check if team is in another active tournament
    const isSuperAdmin = req.headers.cookie?.includes('issuperadmin=you%20bet') || req.headers.cookie?.includes('issuperadmin="you bet"');

    if (!isSuperAdmin) {
      const { data: existing } = await supabase
        .from('teams')
        .select('tournament_id, tournaments(name, status)')
        .eq('ht_team_id', team_id)
        .eq('active', true);

      if (existing && existing.length > 0) {
        const activeTournament = existing.find(e => e.tournaments?.status !== 'finished');
        if (activeTournament) {
          return res.status(400).json({ 
            error: `Team ID ${team_id} is already active in another tournament: "${activeTournament.tournaments?.name}". You must leave that tournament first.` 
          });
        }
      }
    }

    // 3. Fetch team details using managercompendium (simplest way to get name and league)
    const url = 'https://chpp.hattrick.org/chppxml.ashx';
    const params = { file: 'teamdetails', teamID: team_id as string };
    
    const authHeader = getAuthHeader(
      'GET',
      url,
      params,
      consumerKey,
      consumerSecret,
      teamWithToken.oauth_token!,
      teamWithToken.oauth_token_secret!
    );

    const response = await fetch(`${url}?file=teamdetails&teamID=${team_id}`, {
      headers: { Authorization: authHeader },
    });

    const xml = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({ error: 'CHPP fetch failed', details: xml });
    }

    // Surgical XML parsing for name and league info
    const teamName = xml.match(/<TeamName>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/TeamName>/i)?.[1]?.trim() || 'Unknown';
    const leagueId = xml.match(/<LeagueID>(\d+)<\/LeagueID>/i)?.[1];
    const leagueSystemId = xml.match(/<LeagueSystemID>(\d+)<\/LeagueSystemID>/i)?.[1];
    const leagueName = xml.match(/<LeagueName>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/LeagueName>/i)?.[1]?.trim();
    const countryName = xml.match(/<CountryName>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/CountryName>/i)?.[1]?.trim();

    return res.status(200).json({
      teamId: parseInt(team_id as string),
      teamName,
      leagueId: leagueId ? parseInt(leagueId) : undefined,
      leagueSystemId: leagueSystemId ? parseInt(leagueSystemId) : undefined,
      leagueName,
      countryName
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'An unknown error occurred' });
  }
}
