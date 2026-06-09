import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';
import { registerOAuthTeam } from '../_lib/chpp-register.js';
import { getAuthHeader } from '../_lib/chpp-auth.js';
import { parseTeamDetailsXml } from '../_lib/chpp-xml.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { selection_token, team_id, team_name } = req.body;

  if (!selection_token) {
    return res.status(400).json({ error: 'Missing selection_token' });
  }

  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    return res.status(500).json({ error: 'CHPP configuration missing' });
  }

  try {
    const supabase = getSupabase();

    const isSuperAdmin =
      req.headers.cookie?.includes('issuperadmin=you%20bet') ||
      req.headers.cookie?.includes('issuperadmin="you bet"');

    // 1. Get pending join data
    const { data: pending, error: pError } = await supabase
      .from('oauth_temp_sessions')
      .select('*')
      .eq('selection_token', selection_token)
      .single();

    if (pError || !pending) {
      return res.status(404).json({ error: 'Selection session not found or expired' });
    }

    if (pending.is_creation && pending.tournament_id) {
      // Return data for creation flow to finalize
      return res.status(200).json({
        redirect: `/create?step=teams&linked=true&manager=${encodeURIComponent(
          pending.manager_name,
        )}&teamId=${team_id}&teamName=${encodeURIComponent(team_name)}&token=${selection_token}`,
      });
    }

    // 2. Fetch additional team details (Logo, Country)
    let logoUrl: string | undefined;
    let countryName: string | undefined;

    try {
      const chppUrl = 'https://chpp.hattrick.org/chppxml.ashx';
      const teamIdStr = String(team_id);
      const chppParams = {
        file: 'teamdetails',
        teamID: teamIdStr,
        version: '3.9',
      };

      const authHeader = getAuthHeader(
        'GET',
        chppUrl,
        chppParams,
        consumerKey,
        consumerSecret,
        pending.access_token,
        pending.access_token_secret,
      );

      const chppRes = await fetch(`${chppUrl}?file=teamdetails&teamID=${teamIdStr}&version=3.9`, {
        headers: { Authorization: authHeader },
      });

      if (chppRes.ok) {
        const xml = await chppRes.text();
        const parsed = parseTeamDetailsXml(xml, parseInt(teamIdStr, 10));
        logoUrl = parsed.logoUrl;
        countryName = parsed.countryName;
      }
    } catch (e) {
      console.error('Failed to fetch team details during join:', e);
      // Non-critical, continue registration
    }

    // 3. Register the specific team (Standard joining flow)
    let redirectUrl = `/`;
    
    if (pending.tournament_id && team_id && team_name) {
      const { data: tournament } = await supabase
        .from('tournaments')
        .select('slug, country_limit')
        .eq('id', pending.tournament_id)
        .single();

      if (tournament?.country_limit && countryName !== tournament.country_limit && !isSuperAdmin) {
        throw new Error(`This team is not from the required league (${tournament.country_limit}).`);
      }

      await registerOAuthTeam(supabase, {
        tournamentId: pending.tournament_id!,
        team: {
          teamId: parseInt(team_id),
          teamName: team_name,
        },
        managerName: pending.manager_name,
        hattrickUserId: pending.hattrick_user_id,
        accessToken: pending.access_token,
        accessTokenSecret: pending.access_token_secret,
        logoUrl,
        countryName,
        skipMembershipCheck: isSuperAdmin,
      });

      redirectUrl = `/t/${tournament?.slug}?joined=true`;
    }

    // 4. Update/Create Profile
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
        pending.access_token,
        pending.access_token_secret,
      );
      const mRes = await fetch(`${chppUrl}?file=managercompendium&version=1.7`, {
        headers: { Authorization: authHeader },
      });
      if (mRes.ok) {
        const mXml = await mRes.text();
        const { parseManagerCompendiumXml } = await import('../_lib/chpp-xml.js');
        const mParsed = parseManagerCompendiumXml(mXml);
        
        await supabase.from('profiles').upsert({
          hattrick_user_id: pending.hattrick_user_id,
          manager_name: pending.manager_name,
          country_id: mParsed.countryId,
          country_name: mParsed.countryName,
          avatar_json: mParsed.avatar,
        });
      }
    } catch (e) {
      console.error('Failed to update profile during login:', e);
    }

    // 5. Get tournament slug for redirect
    const { data: tournamentAfter } = await supabase
      .from('tournaments')
      .select('slug')
      .eq('id', pending.tournament_id)
      .single();

    // 6. Cleanup
    await supabase.from('oauth_temp_sessions').delete().eq('selection_token', selection_token);

    return res.status(200).json({ 
      slug: tournamentAfter?.slug, 
      hattrick_user_id: pending.hattrick_user_id,
      manager_name: pending.manager_name,
      team_name: team_name,
      redirect: redirectUrl
    });

  } catch (error: unknown) {
    console.error('Auth Complete Handler Error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'An unknown error occurred' });
  }
}
