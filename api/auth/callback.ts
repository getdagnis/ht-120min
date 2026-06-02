import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthHeader } from '../../src/utils/chpp-auth';
import { parseManagerCompendiumXml } from '../../src/utils/chpp-xml';
import crypto from 'crypto';
import { getSupabase } from '../_lib/supabase';
import { registerOAuthTeam } from '../_lib/chpp-register';

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

    console.log(managerXml);

    const parsed = parseManagerCompendiumXml(managerXml);
    const { hattrickUserId, managerName, teams } = parsed;

    if (!teams.length) {
      return res.status(500).json({ error: 'No teams found in managercompendium response' });
    }

    // 4. Fetch Tournament Details for filtering
    const { data: tournament, error: tError } = await supabase
      .from('tournaments')
      .select('id, slug, league_category, country_limit, registration_type')
      .eq('id', session.tournament_id)
      .single();

    if (tError || !tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const isSuperAdmin = req.headers.cookie?.includes('issuperadmin=you%20bet') || req.headers.cookie?.includes('issuperadmin="you bet"');

    // Handle Organizer Linking
    if (session.is_creation) {
      await supabase
        .from('tournaments')
        .update({
          organizer_name: managerName,
        })
        .eq('id', tournament.id);

      await supabase.from('oauth_temp_sessions').delete().eq('oauth_token', oauth_token);
      return res.redirect(`/create?step=teams&slug=${tournament.slug}&linked=true`);
    }

    // Filter teams based on tournament criteria
    const filteredTeams = teams.filter((team) => {
      const isFemaleLeague = team.leagueName?.includes('Femme') || team.leagueId === 3000;
      const isMaleLeague = !isFemaleLeague;

      if (tournament.league_category === 'hfi' && !isFemaleLeague) return false;
      if (tournament.league_category === 'male' && !isMaleLeague) return false;
      if (!isSuperAdmin && tournament.country_limit && team.countryName !== tournament.country_limit) return false;

      return true;
    });

    if (filteredTeams.length === 0) {
      const categoryName =
        tournament.league_category === 'hfi' ? 'Hattrick Femme International (HFI)' : 'Regular league (male)';
      
      // Construct a verbose message for at least the first team
      const team = teams[0];
      const isFemale = team.leagueName?.includes('Femme') || team.leagueId === 3000;
      const teamCategory = isFemale ? 'HFI' : 'male league';
      
      const verboseError = `Team ID ${team.teamId} "${team.teamName}" (${teamCategory}) is not eligible to play in a ${categoryName}. Please register a ${categoryName} team.`;
      
      return res.redirect(`/t/${tournament.slug}?error=${encodeURIComponent(verboseError)}`);
    }

    if (filteredTeams.length === 1) {
      try {
        await registerOAuthTeam(supabase, {
          tournamentId: session.tournament_id,
          team: filteredTeams[0],
          managerName,
          hattrickUserId,
          accessToken,
          accessTokenSecret,
          skipMembershipCheck: isSuperAdmin,
        });
      } catch (err: any) {
        return res.redirect(`/t/${tournament.slug}?error=${encodeURIComponent(err.message)}`);
      }

      // 5. Cleanup
      await supabase.from('oauth_temp_sessions').delete().eq('oauth_token', oauth_token);

      // Redirect back to tournament
      return res.redirect(`/t/${tournament.slug}`);
    }

    const selectionToken = crypto.randomBytes(16).toString('hex');
    const { error } = await supabase.from('oauth_pending_joins').insert({
      selection_token: selectionToken,
      tournament_id: session.tournament_id,
      access_token: accessToken,
      access_token_secret: accessTokenSecret,
      hattrick_user_id: hattrickUserId,
      manager_name: managerName,
      teams_json: filteredTeams, // Only store teams that passed initial filter
      tournament: tournament, // Store tournament details for UI validation text
    });

    if (error) {
      return res.status(500).json({ error: 'Failed to store pending OAuth join', details: error.message });
    }

    // 5. Cleanup
    await supabase.from('oauth_temp_sessions').delete().eq('oauth_token', oauth_token);

    return res.redirect(`/oauth/select/${selectionToken}`);
  } catch (error: unknown) {
    console.error('Auth Callback Handler Error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'An unknown error occurred' });
  }
}
