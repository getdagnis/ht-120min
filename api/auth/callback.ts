import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { generateNonce, getTimestamp, generateSignature, getAuthHeader } from '../../src/utils/chpp-auth';

const supabase = createClient(process.env.VITE_SUPABASE_URL || '', process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '');

function extractXmlTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'));
  return match ? match[1].trim() : '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { oauth_token, oauth_verifier, tournamentId } = req.query;
  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;

  if (!oauth_token || !oauth_verifier || !tournamentId) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    // 1. Get request token secret
    const { data: session } = await supabase
      .from('oauth_temp_sessions')
      .select('oauth_token_secret, tournament_id')
      .eq('oauth_token', oauth_token)
      .single();

    if (!session) return res.status(404).json({ error: 'Session not found' });

    // 2. Exchange for access token
    const url = 'https://chpp.hattrick.org/oauth/access_token.ashx';
    const params = {
      oauth_consumer_key: consumerKey!,
      oauth_nonce: generateNonce(),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: getTimestamp(),
      oauth_token: oauth_token as string,
      oauth_verifier: oauth_verifier as string,
      oauth_version: '1.0',
    };

    const signature = generateSignature('GET', url, params, consumerSecret!, session.oauth_token_secret);
    const authHeader = getAuthHeader(params, signature);

    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: authHeader },
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: `Failed to get access token: ${text}` });
    }

    const body = await response.text();
    const data = Object.fromEntries(new URLSearchParams(body));
    const { oauth_token: accessToken, oauth_token_secret: accessTokenSecret } = data;

    // 3. Fetch Team Details
    const chppUrl = 'https://chpp.hattrick.org/chppxml.ashx';
    const chppParams = {
      file: 'teamdetails',
      oauth_consumer_key: consumerKey!,
      oauth_nonce: generateNonce(),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: getTimestamp(),
      oauth_token: accessToken,
      oauth_version: '1.0',
    };

    const chppSignature = generateSignature('GET', chppUrl, chppParams, consumerSecret!, accessTokenSecret);
    const chppAuthHeader = getAuthHeader(chppParams, chppSignature);

    const teamRes = await fetch(`${chppUrl}?file=teamdetails`, {
      method: 'GET',
      headers: { Authorization: chppAuthHeader },
    });

    const xml = await teamRes.text();

    // Parse minimal data
    const htUserId = extractXmlTag(xml, 'UserID');
    const htTeamId = extractXmlTag(xml, 'TeamID');
    const teamName = extractXmlTag(xml, 'TeamName');
    const logoUrl = extractXmlTag(xml, 'LogoURL');
    const countryName = extractXmlTag(xml, 'CountryName');

    // 4. Upsert into teams table
    const { data: tournament } = await supabase
      .from('tournaments')
      .select('slug')
      .eq('id', session.tournament_id)
      .single();

    const { error: upsertError } = await supabase.from('teams').upsert(
      {
        tournament_id: session.tournament_id,
        ht_team_id: parseInt(htTeamId),
        name: teamName,
        hattrick_user_id: parseInt(htUserId),
        oauth_token: accessToken,
        oauth_token_secret: accessTokenSecret,
        logo_url: logoUrl,
        country_name: countryName,
        joined_via_oauth: true,
        active: true,
        oauth_scope: 'manage_challenges',
      },
      {
        onConflict: 'tournament_id,ht_team_id',
      },
    );

    if (upsertError) throw upsertError;

    // 5. Cleanup temp session
    await supabase.from('oauth_temp_sessions').delete().eq('oauth_token', oauth_token);

    // Redirect back to tournament
    return res.redirect(`/t/${tournament?.slug}`);
  } catch (error: unknown) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'An unknown error occurred' });
  }
}
