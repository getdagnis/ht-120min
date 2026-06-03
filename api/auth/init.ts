import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { getAuthHeader } from '../../src/utils/chpp-auth';

// Helper to get supabase client safely in serverless functions
const getSupabase = () => {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(`Supabase configuration missing. URL: ${!!url}, Key: ${!!key}`);
  }
  return createClient(url, key);
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { tournament_id, is_creation } = req.query;
  console.log('Init Params:', { tournament_id, is_creation });

  if (!tournament_id && is_creation !== 'true') {
    return res.status(400).json({ error: 'tournament_id is required' });
  }

  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    return res.status(500).json({ error: 'CHPP Consumer Key or Secret missing in environment' });
  }

  const url = 'https://chpp.hattrick.org/oauth/request_token.ashx';
  const method = 'GET';

  // Determine callback URL
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['host'];
  const callbackUrl = `${protocol}://${host}/api/auth/callback`;

  const params: Record<string, string> = {
    oauth_callback: callbackUrl,
  };

  const authHeader = getAuthHeader(method, url, params, consumerKey, consumerSecret);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: authHeader,
      },
    });

    const body = await response.text();

    if (!response.ok) {
      console.error('CHPP Request Token Error:', body);
      return res.status(response.status).json({ error: 'Failed to get request token', details: body });
    }

    const data = new URLSearchParams(body);
    const oauth_token = data.get('oauth_token');
    const oauth_token_secret = data.get('oauth_token_secret');

    if (!oauth_token || !oauth_token_secret) {
      return res.status(500).json({ error: 'Invalid response from Hattrick', body });
    }

    // Store temporary session
    const supabase = getSupabase();
    const { error } = await supabase.from('oauth_temp_sessions').insert({
      oauth_token,
      oauth_token_secret,
      tournament_id: tournament_id || '00000000-0000-0000-0000-000000000000',
      is_creation: is_creation === 'true',
    });

    if (error) {
      return res.status(500).json({ error: 'Failed to store session', details: error.message });
    }

    // Redirect to Hattrick for authorization
    const authUrl = `https://chpp.hattrick.org/oauth/authorize.aspx?oauth_token=${oauth_token}`;
    return res.redirect(authUrl);
  } catch (error: unknown) {
    console.error('Auth Init Handler Error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'An unknown error occurred' });
  }
}
