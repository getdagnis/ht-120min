import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthHeader } from './chpp-auth.js';
import { filterTeamsForCategory, type LeagueCategory } from './team-eligibility.js';
import crypto from 'crypto';
import { getSupabase } from './supabase.js';
import { OAUTH_CREATION_TOURNAMENT_ID } from './oauth-constants.js';
import { hasSuperAdminBypassCookie } from './superadmin-bypass.js';
import { getActiveTournamentConflicts } from './chpp-register.js';
import { fetchTeamDetailsFromChpp } from './matchmaker.js';
import type { ChppTeamOption } from './chpp-xml.js';
import { normalizeLeagueLimit } from '../../../../shared/worlddetails.js';
import { buildAppSessionCookie, getAppSessionSecret } from './app-session.js';
import {
  fetchManagerTeamsFromChpp,
  ManagerCompendiumRequestError,
} from './manager-compendium.js';

async function hydratePickerTeamLogos(
  supabase: ReturnType<typeof getSupabase>,
  teams: ChppTeamOption[],
  consumerKey: string,
  consumerSecret: string,
  credentials: { oauth_token: string; oauth_token_secret: string },
): Promise<ChppTeamOption[]> {
  const teamIds = teams.map((team) => team.teamId);
  const { data: storedTeams } = await supabase
    .from('teams')
    .select('ht_team_id, logo_url')
    .in('ht_team_id', teamIds)
    .not('logo_url', 'is', null);
  const storedLogos = new Map<number, string>();
  for (const team of (storedTeams ?? []) as Array<{ ht_team_id: number | null; logo_url: string | null }>) {
    if (team.ht_team_id && team.logo_url) storedLogos.set(team.ht_team_id, team.logo_url);
  }

  const missingLogoTeams = teams.filter((team) => !storedLogos.has(team.teamId));
  const fetchedLogos = await Promise.all(
    missingLogoTeams.map(async (team) => {
      try {
        const details = await fetchTeamDetailsFromChpp(consumerKey, consumerSecret, credentials, team.teamId);
        return [team.teamId, details.logoUrl] as const;
      } catch {
        return [team.teamId, undefined] as const;
      }
    }),
  );

  for (const [teamId, logoUrl] of fetchedLogos) {
    if (logoUrl) storedLogos.set(teamId, logoUrl);
  }

  return teams.map((team) => (storedLogos.has(team.teamId) ? { ...team, logoUrl: storedLogos.get(team.teamId) } : team));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'HEAD' || req.method === 'OPTIONS') {
    return res.status(204).end();
  }

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
    console.log('Callback Session tournament_id:', session.tournament_id);


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
    const grantedScope = tokenData.get('scope') ?? '';

    // 3. Fetch every senior team owned by this manager. Version 1.7 is
    // required for accounts that own both regular and HFI teams.
    let parsed;
    try {
      parsed = await fetchManagerTeamsFromChpp(consumerKey, consumerSecret, {
        oauth_token: accessToken,
        oauth_token_secret: accessTokenSecret,
      });
    } catch (error) {
      if (error instanceof ManagerCompendiumRequestError) {
        if (process.env.NODE_ENV !== 'production') {
          console.log('🚨 CHPP status:', error.status);
        }
        return res
          .status(error.status)
          .json({ error: 'Failed to fetch managercompendium', details: error.responseBody });
      }
      throw error;
    }

    const { hattrickUserId, managerName, teams } = parsed;

    if (!teams.length) {
      return res.status(500).json({ error: 'No teams found in managercompendium response' });
    }

    const teamsWithLogos = await hydratePickerTeamLogos(
      supabase,
      teams,
      consumerKey,
      consumerSecret,
      { oauth_token: accessToken, oauth_token_secret: accessTokenSecret },
    );

    // 4. Fetch Tournament Details for filtering (if not creating)
    let tournament = null;
    if (!session.is_creation && session.tournament_id) {
      const { data: tData, error: tError } = await supabase
        .from('tournaments')
        .select('id, slug, league_category, country_limit, country_limit_format, registration_type')
        .eq('id', session.tournament_id)
        .single();

      if (tError || !tData) {
        console.error('Tournament lookup failed:', { tError, tournament_id: session.tournament_id });
        return res.status(404).json({ error: 'Tournament not found' });
      }
      tournament = tData;
    }

    const isSuperAdmin = hasSuperAdminBypassCookie(req.headers.cookie);

    const leagueCategory: LeagueCategory = session.is_creation
      ? session.league_category === 'hfi'
        ? 'hfi'
        : 'male'
      : tournament?.league_category === 'hfi'
        ? 'hfi'
        : 'male';

    const countryLimit = session.is_creation
      ? session.country_limit
      : normalizeLeagueLimit(tournament?.country_limit, tournament?.country_limit_format ?? 'league_id');

    const filteredTeams = isSuperAdmin
      ? teamsWithLogos
      : filterTeamsForCategory(teamsWithLogos, leagueCategory, {
          countryLimit,
        });

    // Tournament joins show every CHPP team in the picker. Filtering here
    // hides useful category/country explanations behind an empty state.
    // Creation retains its existing restricted selection flow.
    let teamsForSelection = session.is_creation ? filteredTeams : teamsWithLogos;
    if (!session.is_creation && session.tournament_id && !isSuperAdmin) {
      const conflicts = await getActiveTournamentConflicts(
        supabase,
        teamsWithLogos.map((team) => team.teamId),
        session.tournament_id,
      );
      teamsForSelection = teamsWithLogos.map((team) => {
        const conflict = conflicts.get(team.teamId);
        return conflict ? { ...team, activeTournament: { name: conflict.name, slug: conflict.slug } } : team;
      });
    }

    const selectionToken = crypto.randomBytes(16).toString('hex');
    console.log('Callback - Generated Selection Token:', selectionToken);
    const { error } = await supabase
      .from('oauth_temp_sessions')
      .update({
        selection_token: selectionToken,
        tournament_id: session.is_creation ? OAUTH_CREATION_TOURNAMENT_ID : session.tournament_id,
        access_token: accessToken,
        access_token_secret: accessTokenSecret,
        hattrick_user_id: hattrickUserId,
        manager_name: managerName,
        teams_json: teamsForSelection,
        is_creation: session.is_creation,
        oauth_scope: grantedScope,
      })
      .eq('oauth_token', oauth_token);

    if (error) {
      return res.status(500).json({ error: 'Failed to store pending OAuth join', details: error.message });
    }

    // A successful CHPP callback is a completed Hattrick login, even when the
    // manager cannot select a team from this particular tournament picker.
    // The picker may be entirely read-only, so waiting for /auth/complete to
    // set this cookie leaves the client looking logged in via localStorage
    // while server-authorized endpoints correctly reject it.
    const appSessionSecret = getAppSessionSecret();
    if (!appSessionSecret) {
      return res.status(500).json({ error: 'APP_SESSION_SECRET is missing' });
    }
    const host = String(req.headers.host || '').split(':')[0].toLowerCase();
    const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
    const secureCookie = !isLocalHost && (process.env.NODE_ENV === 'production' || forwardedProto === 'https');
    const responseCookies = [buildAppSessionCookie(hattrickUserId, appSessionSecret, secureCookie)];

    // Redirect to AuthCallback to handle final login
    const returnUrl = req.cookies?.auth_return_url ? decodeURIComponent(req.cookies.auth_return_url) : null;
    
    let redirectPath = `/auth/callback?token=${selectionToken}`;
    if (returnUrl) {
      // Clear cookie
      responseCookies.push('auth_return_url=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT');
      redirectPath += `&returnUrl=${encodeURIComponent(returnUrl)}`;
    }
    res.setHeader('Set-Cookie', responseCookies);
    
    if (session.is_creation) {
      return res.redirect(`/create?step=teams&token=${selectionToken}`);
    }

    if (tournament) {
      return res.redirect(`/t/${tournament.slug}?token=${selectionToken}${returnUrl ? `&returnUrl=${encodeURIComponent(returnUrl)}` : ''}`);
    }

    return res.redirect(redirectPath);
  } catch (error: unknown) {
    console.error('Auth Callback Handler Error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'An unknown error occurred' });
  }
}
