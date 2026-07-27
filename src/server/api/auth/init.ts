import type { VercelRequest, VercelResponse } from '@vercel/node';
import { redirectAuthFailure } from '../_lib/auth-failure.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'HEAD' || req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    const { getAuthHeader } = await import('../_lib/chpp-auth.js');
    const { createClient } = await import('@supabase/supabase-js');
    const { tournament_id, is_creation, league_category, country_limit } = req.query;
    console.log('Auth Init - Params:', { tournament_id, is_creation });

    const consumerKey = process.env.CHPP_CONSUMER_KEY;
    const consumerSecret = process.env.CHPP_CONSUMER_SECRET;

    if (!consumerKey || !consumerSecret) {
      return res.status(500).json({ error: 'CHPP Consumer Key or Secret missing in environment' });
    }

    const url = 'https://chpp.hattrick.org/oauth/request_token.ashx';
    const method = 'GET';
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['host'];
    const callbackUrl = `${protocol}://${host}/api/auth/callback`;
    const params: Record<string, string> = { oauth_callback: callbackUrl };
    const authHeader = getAuthHeader(method, url, params, consumerKey, consumerSecret);

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
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      throw new Error(`Supabase configuration missing. URL: ${!!supabaseUrl}, Key: ${!!supabaseKey}`);
    }
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { error } = await supabase.from('oauth_temp_sessions').insert({
      oauth_token,
      oauth_token_secret,
      tournament_id: typeof tournament_id === 'string' && tournament_id ? tournament_id : null,
      is_creation: is_creation === 'true',
      league_category: league_category === 'hfi' ? 'hfi' : 'male',
      country_limit: typeof country_limit === 'string' ? country_limit : null,
    });

    if (error) {
      return res.status(500).json({ error: 'Failed to store session', details: error.message });
    }

    // Redirect to Hattrick for authorization (request manage_challenges for friendly actions)
    const authUrl = `https://chpp.hattrick.org/oauth/authorize.aspx?oauth_token=${oauth_token}&scope=manage_challenges`;
    return res.redirect(authUrl);
  } catch (error: unknown) {
    return redirectAuthFailure(req, res, 'auth-init', error);
  }
}
