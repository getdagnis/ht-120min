import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthHeader } from '../_lib/chpp-auth.js';
import { parseManagerCompendiumXml, parseTeamDetailsXml } from '../_lib/chpp-xml.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { file, access_token, access_token_secret, ...params } = req.body ?? {};
  if (!file || !access_token || !access_token_secret) return res.status(400).json({ error: 'Missing required parameters' });

  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) return res.status(500).json({ error: 'CHPP config missing' });

  try {
    const chppUrl = 'https://chpp.hattrick.org/chppxml.ashx';
    const chppParams: Record<string, string> = { file, ...params };
    const authHeader = getAuthHeader('GET', chppUrl, chppParams, consumerKey, consumerSecret, access_token, access_token_secret);

    const query = new URLSearchParams(chppParams);
    const response = await fetch(`${chppUrl}?${query.toString()}`, { headers: { Authorization: authHeader } });
    const xml = await response.text();
    if (!response.ok) return res.status(response.status).json({ error: 'CHPP fetch failed', details: xml });

    if (file === 'managercompendium') return res.status(200).json(parseManagerCompendiumXml(xml));
    if (file === 'teamdetails') return res.status(200).json(parseTeamDetailsXml(xml, params.teamID));
    
    return res.status(200).json({ xml });
  } catch (error: unknown) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}
