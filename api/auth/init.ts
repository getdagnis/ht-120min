import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { generateNonce, getTimestamp, generateSignature, getAuthHeader } from '../../src/utils/chpp-auth';

const supabase = createClient(process.env.VITE_SUPABASE_URL || '', process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { tournamentId } = req.query;
  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    return res.status(500).json({
      error:
        'CHPP Credentials missing. Please add CHPP_CONSUMER_KEY and CHPP_CONSUMER_SECRET to environment variables.',
    });
  }

  if (!tournamentId) {
    return res.status(400).json({ error: 'tournamentId is required' });
  }

  const url = 'https://chpp.hattrick.org/oauth/request_token.ashx';
  const callbackUrl = `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:5173'}/api/auth/callback?tournamentId=${tournamentId}`;

  const params = {
    oauth_callback: callbackUrl,
    oauth_consumer_key: consumerKey,
    oauth_nonce: generateNonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: getTimestamp(),
    oauth_version: '1.0',
  };

  const signature = generateSignature('GET', url, params, consumerSecret);
  const authHeader = getAuthHeader(params, signature);

  try {
    const response = await fetch(`${url}?oauth_callback=${encodeURIComponent(callbackUrl)}`, {
      method: 'GET',
      headers: { Authorization: authHeader },
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: `Failed to get request token: ${text}` });
    }

    const body = await response.text();
    const data = Object.fromEntries(new URLSearchParams(body));

    const { oauth_token, oauth_token_secret } = data;

    // Store in Supabase
    await supabase.from('oauth_temp_sessions').insert([
      {
        oauth_token,
        oauth_token_secret,
        tournament_id: tournamentId,
      },
    ]);

    // Redirect to Hattrick
    const authUrl = `https://chpp.hattrick.org/oauth/authorize.aspx?oauth_token=${oauth_token}&scope=manage_challenges`;
    return res.redirect(authUrl);
  } catch (error: unknown) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'An unknown error occurred' });
  }
}
