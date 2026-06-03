import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthHeader } from '../../src/utils/chpp-auth';
import { parseTeamDetailsXml } from '../../src/utils/chpp-xml';

const CHPP_TEAMDETAILS_VERSION = '3.9';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { team_id, access_token, access_token_secret } = req.body ?? {};

  if (!team_id || !access_token || !access_token_secret) {
    return res.status(400).json({ error: 'team_id, access_token, and access_token_secret are required' });
  }

  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    return res.status(500).json({ error: 'CHPP config missing' });
  }

  try {
    const chppUrl = 'https://chpp.hattrick.org/chppxml.ashx';
    const teamId = String(team_id);
    const chppParams = {
      file: 'teamdetails',
      teamID: teamId,
      version: CHPP_TEAMDETAILS_VERSION,
    };

    const authHeader = getAuthHeader(
      'GET',
      chppUrl,
      chppParams,
      consumerKey,
      consumerSecret,
      access_token,
      access_token_secret,
    );

    const query = new URLSearchParams({
      file: 'teamdetails',
      teamID: teamId,
      version: CHPP_TEAMDETAILS_VERSION,
    });

    const response = await fetch(`${chppUrl}?${query.toString()}`, {
      headers: { Authorization: authHeader },
    });

    const xml = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({ error: 'CHPP fetch failed', details: xml });
    }

    const parsed = parseTeamDetailsXml(xml, parseInt(teamId, 10));

    if (parsed.errorCode) {
      return res.status(400).json({
        error: `CHPP teamdetails error (code ${parsed.errorCode})`,
        errorCode: parsed.errorCode,
      });
    }

    if (process.env.NODE_ENV !== 'production' && !parsed.logoUrl) {
      console.log('teamdetails: no LogoURL for team', teamId, 'snippet:', xml.slice(0, 800));
    }

    return res.status(200).json({
      teamId: parsed.teamId,
      teamName: parsed.teamName ?? null,
      countryName: parsed.countryName ?? null,
      logoUrl: parsed.logoUrl ?? null,
    });
  } catch (error: unknown) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}
