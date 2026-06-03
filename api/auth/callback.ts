import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthHeader } from '../_lib/chpp-auth';
import { parseManagerCompendiumXml } from '../_lib/chpp-xml';
import {
  filterTeamsForCategory,
  isHfiTeam,
  teamMatchesCategory,
  type LeagueCategory,
} from '../_lib/team-eligibility';
import crypto from 'crypto';
import { getSupabase } from '../_lib/supabase';
import { OAUTH_CREATION_TOURNAMENT_ID } from '../_lib/oauth-constants';

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

    // 1. Get OAuth session
    const { data: session, error: sError } = await supabase
      .from('oauth_temp_sessions')
      .select('*')
      .eq('oauth_token', oauth_token)
      .single();

    if (sError || !session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    console.log('Callback Session is_creation:', session.is_creation);


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
    const chppParams = { file: 'managercompendium' };
    const chppHeader = getAuthHeader(
      'GET',
      chppUrl,
      chppParams,
      consumerKey,
      consumerSecret,
      accessToken,
      accessTokenSecret,
    );

    const chppRes = await fetch(`${chppUrl}?file=managercompendium`, {
      headers: { Authorization: chppHeader },
    });

    const managerXml = await chppRes.text();

    if (!chppRes.ok) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('🚨 CHPP status:', chppRes.status);
        console.log('🚨 CHPP headers:', Object.fromEntries(chppRes.headers.entries()));
      }
      return res.status(chppRes.status).json({ error: 'Failed to fetch managercompendium', details: managerXml });
    }

    const parsed = parseManagerCompendiumXml(managerXml);
    const { hattrickUserId, managerName, teams } = parsed;

    if (!teams.length) {
      return res.status(500).json({ error: 'No teams found in managercompendium response' });
    }

    // 4. Fetch Tournament Details for filtering (if not creating)
    let tournament = null;
    if (!session.is_creation) {
      const { data: tData, error: tError } = await supabase
        .from('tournaments')
        .select('id, slug, league_category, country_limit, registration_type')
        .eq('id', session.tournament_id)
        .single();

      if (tError || !tData) {
        return res.status(404).json({ error: 'Tournament not found' });
      }
      tournament = tData;
    }

    const isSuperAdmin = req.headers.cookie?.includes('issuperadmin=you%20bet') || req.headers.cookie?.includes('issuperadmin="you bet"');

    const leagueCategory: LeagueCategory = session.is_creation
      ? session.league_category === 'hfi'
        ? 'hfi'
        : 'male'
      : tournament?.league_category === 'hfi'
        ? 'hfi'
        : 'male';

    const countryLimit = session.is_creation ? session.country_limit : tournament?.country_limit;

    const filteredTeams = filterTeamsForCategory(teams, leagueCategory, {
      countryLimit,
      skipCountryCheck: isSuperAdmin,
    });

    if (filteredTeams.length === 0) {
      const categoryName = leagueCategory === 'hfi' ? 'Hattrick Femme International (HFI)' : 'Regular league (male)';

      const team = teams.find((t) => !teamMatchesCategory(t, leagueCategory)) ?? teams[0];
      const teamCategory = isHfiTeam(team) ? 'HFI' : 'male league';
      
      const verboseError = `Team ID ${team.teamId} "${team.teamName}" (${teamCategory}) is not eligible to play in a ${categoryName}. Please register a ${categoryName} team.`;
      
      if (session.is_creation) {
        return res.redirect(`/create?error=${encodeURIComponent(verboseError)}`);
      }
      return res.redirect(`/t/${tournament?.slug}?error=${encodeURIComponent(verboseError)}`);
    }

    // ALWAYS redirect to selection for creators, or if multiple teams
    const selectionToken = crypto.randomBytes(16).toString('hex');
    const { error } = await supabase.from('oauth_pending_joins').insert({
      selection_token: selectionToken,
      tournament_id: session.is_creation ? OAUTH_CREATION_TOURNAMENT_ID : session.tournament_id,
      access_token: accessToken,
      access_token_secret: accessTokenSecret,
      hattrick_user_id: hattrickUserId,
      manager_name: managerName,
      teams_json: filteredTeams,
      is_creation: session.is_creation,
    });

    if (error) {
      return res.status(500).json({ error: 'Failed to store pending OAuth join', details: error.message });
    }

    // 5. Cleanup
    await supabase.from('oauth_temp_sessions').delete().eq('oauth_token', oauth_token);

    if (session.is_creation) {
      return res.redirect(`/create?step=teams&token=${selectionToken}`);
    }

    return res.redirect(`/t/${tournament?.slug}?token=${selectionToken}`);
  } catch (error: unknown) {
    console.error('Auth Callback Handler Error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'An unknown error occurred' });
  }
}
