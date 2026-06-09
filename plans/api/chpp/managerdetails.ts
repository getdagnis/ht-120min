import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthHeader } from '../_lib/chpp-auth.js';
import { XMLParser } from 'fast-xml-parser';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { access_token, access_token_secret } = req.body ?? {};

  if (!access_token || !access_token_secret) {
    return res.status(400).json({ error: 'access_token and access_token_secret are required' });
  }

  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    return res.status(500).json({ error: 'CHPP config missing' });
  }

  try {
    const chppUrl = 'https://chpp.hattrick.org/chppxml.ashx';
    const chppParams = {
      file: 'managercompendium',
      version: '1.7',
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

    const query = new URLSearchParams(chppParams);
    const response = await fetch(`${chppUrl}?${query.toString()}`, {
      headers: { Authorization: authHeader },
    });

    const xml = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({ error: 'CHPP fetch failed', details: xml });
    }

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
    });
    const jsonObj = parser.parse(xml);
    const manager = jsonObj.HattrickData?.Manager;

    if (!manager) {
      return res.status(400).json({ error: 'Manager data not found in XML' });
    }

    return res.status(200).json({
      userId: manager.UserId,
      loginname: manager.Loginname,
      country: {
        id: manager.Country?.CountryId,
        name: manager.Country?.CountryName,
      },
      avatar: manager.Avatar,
      teams: Array.isArray(manager.Teams?.Team) ? manager.Teams.Team : manager.Teams?.Team ? [manager.Teams.Team] : [],
    });
  } catch (error: unknown) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}
