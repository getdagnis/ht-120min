import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { getAuthHeader } from '../../src/utils/chpp-auth';

// Helper to get supabase client safely in serverless functions
const getSupabase = () => {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(`Supabase configuration missing. URL: ${!!url}, Key: ${!!key}`);
  }
  return createClient(url, key);
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { oauth_token, oauth_verifier } = req.query;

  if (!oauth_token || !oauth_verifier) {
    return res.status(400).json({ error: 'Missing oauth parameters' });
  }

  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    return res.status(500).json({ error: 'CHPP Consumer Key or Secret missing in environment' });
  }

  try {
    const supabase = getSupabase();

    // 1. Get temporary secret
    const { data: session, error: sError } = await supabase
      .from('oauth_temp_sessions')
      .select('*')
      .eq('oauth_token', oauth_token)
      .single();

    if (sError || !session) {
      return res.status(404).json({ error: 'Session not found or expired' });
    }

    const url = 'https://chpp.hattrick.org/oauth/access_token.ashx';
    const method = 'GET';

    const params: Record<string, string> = {
      oauth_token: oauth_token as string,
      oauth_verifier: oauth_verifier as string,
    };

    const authHeader = getAuthHeader(
      method,
      url,
      params,
      consumerKey,
      consumerSecret,
      oauth_token as string,
      session.oauth_token_secret,
    );

    // 2. Exchange for access token
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: authHeader,
      },
    });

    const body = await response.text();
    if (!response.ok) {
      console.error('CHPP Access Token Error:', body);
      return res.status(response.status).json({ error: 'Failed to exchange access token', details: body });
    }

    const tokenData = new URLSearchParams(body);
    const accessToken = tokenData.get('oauth_token')!;
    const accessTokenSecret = tokenData.get('oauth_token_secret')!;

    // 3. Fetch Manager Details to get User ID and Team ID
    const chppUrl = 'https://chpp.hattrick.org/chppxml.ashx';
    const chppParams = { file: 'manager' };
    const chppHeader = getAuthHeader(
      'GET',
      chppUrl,
      chppParams,
      consumerKey,
      consumerSecret,
      accessToken,
      accessTokenSecret,
    );

    const chppRes = await fetch(`${chppUrl}?file=manager`, {
      headers: { Authorization: chppHeader },
    });

    const managerXml = await chppRes.text();
    console.log('Manager XML Length:', managerXml.length);
    if (managerXml.length < 500) {
      console.log('Raw XML Response:', managerXml);
    }

    // Improved XML parsing with case-insensitivity and CDATA awareness
    const userIdMatch = managerXml.match(/<UserId>(\d+)<\/UserId>/i) || managerXml.match(/<UserID>(\d+)<\/UserID>/i);
    const loginNameMatch = managerXml.match(/<Loginname>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/Loginname>/i);

    // Find the first <Team> block inside <Teams>
    const teamBlockMatch = managerXml.match(/<Team>([\s\S]*?)<\/Team>/i);
    const teamXml = teamBlockMatch ? teamBlockMatch[1] : '';

    const teamIdMatch = teamXml.match(/<TeamId>(\d+)<\/TeamId>/i) || teamXml.match(/<TeamID>(\d+)<\/TeamID>/i);
    const teamNameMatch = teamXml.match(/<TeamName>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/TeamName>/i);

    const hattrick_user_id = userIdMatch ? parseInt(userIdMatch[1]) : null;
    const manager_name = loginNameMatch ? loginNameMatch[1] : 'Unknown';
    const ht_team_id = teamIdMatch ? parseInt(teamIdMatch[1]) : null;
    const ht_team_name = teamNameMatch ? teamNameMatch[1] : 'Unknown';

    console.log('Parsed CHPP Data:', { hattrick_user_id, manager_name, ht_team_id, ht_team_name });

    if (!ht_team_id) {
      console.error('FAILED TO PARSE TEAM ID. Check XML structure.');
    }

    // 4. Upsert Team into Supabase
    const { data: tournament } = await supabase
      .from('tournaments')
      .select('slug')
      .eq('id', session.tournament_id)
      .single();

    const { error: tError } = await supabase.from('teams').upsert(
      {
        tournament_id: session.tournament_id,
        ht_team_id,
        name: ht_team_name, // Default name to HT Team Name
        ht_team_name,
        manager_name,
        hattrick_user_id,
        oauth_token: accessToken,
        oauth_token_secret: accessTokenSecret,
        joined_via_oauth: true,
        active: true,
      },
      { onConflict: 'tournament_id, ht_team_id' },
    );

    if (tError) {
      console.error('Team Upsert Error:', tError);
    }

    // 5. Cleanup
    await supabase.from('oauth_temp_sessions').delete().eq('oauth_token', oauth_token);

    // Redirect back to tournament
    return res.redirect(`/t/${tournament?.slug}`);
  } catch (error: unknown) {
    console.error('Auth Callback Handler Error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'An unknown error occurred' });
  }
}
