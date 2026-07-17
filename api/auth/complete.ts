import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { ChppTeamOption } from '../_lib/chpp-xml.js';
import { getSupabase } from '../_lib/supabase.js';
import { registerOAuthTeam } from '../_lib/chpp-register.js';
import { getAuthHeader } from '../_lib/chpp-auth.js';
import { parseTeamDetailsXml } from '../_lib/chpp-xml.js';
import { validateTeamEligibility } from '../_lib/eligibility.js';
import { buildAppSessionCookie, getAppSessionSecret, verifyAppSessionCookie } from '../_lib/app-session.js';
import { hasSuperAdminBypassCookie } from '../_lib/superadmin-bypass.js';

interface CompleteAuthBody {
  action?: 'claim_teams';
  selection_token?: string;
  team_id?: string | number;
  team_name?: string;
  teamIds?: number[];
}

interface ProfileForClaim {
  manager_name: string;
  teams_json: ChppTeamOption[] | null;
  oauth_token: string | null;
  oauth_token_secret: string | null;
  oauth_scope: string | null;
}

interface TeamForClaim {
  id: string;
  ht_team_id: number | null;
  active: boolean | null;
  is_placeholder: boolean | null;
  joined_via_oauth: boolean | null;
  hattrick_user_id: number | null;
}

function getRequestedTeamIds(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { selection_token, team_id, team_name, action, teamIds } = req.body as CompleteAuthBody;

  let supabase: ReturnType<typeof getSupabase>;
  try {
    supabase = getSupabase();
  } catch (error) {
    console.error('Auth Complete Supabase init error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Supabase configuration missing',
    });
  }

  if (action === 'claim_teams') {
    const secret = getAppSessionSecret();
    if (!secret) {
      return res.status(500).json({ error: 'APP_SESSION_SECRET is missing' });
    }

    const session = verifyAppSessionCookie(req.headers.cookie, secret);
    if (!session) {
      return res.status(401).json({ error: 'Login required' });
    }

    const requestedTeamIds = getRequestedTeamIds(teamIds);
    if (requestedTeamIds.length === 0) {
      return res.status(400).json({ error: 'No teams selected' });
    }

    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('manager_name, teams_json, oauth_token, oauth_token_secret, oauth_scope')
      .eq('hattrick_user_id', session.userId)
      .maybeSingle();

    if (profileError || !profileData) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const profile = profileData as ProfileForClaim;
    const profileTeams = Array.isArray(profile.teams_json) ? profile.teams_json : [];
    const verifiedTeamsById = new Map(profileTeams.map((team) => [team.teamId, team]));
    const verifiedRequestedIds = requestedTeamIds.filter((id) => verifiedTeamsById.has(id));

    if (verifiedRequestedIds.length === 0) {
      return res.status(403).json({ error: 'No selected teams belong to this Hattrick account' });
    }

    const { data: teamRowsRaw, error: teamsError } = await supabase
      .from('teams')
      .select('id, ht_team_id, active, is_placeholder, joined_via_oauth, hattrick_user_id')
      .in('ht_team_id', verifiedRequestedIds)
      .eq('active', true);

    if (teamsError) {
      return res.status(500).json({ error: teamsError.message });
    }

    const claimableRows = ((teamRowsRaw as TeamForClaim[] | null) ?? []).filter(
      (team) =>
        team.ht_team_id &&
        !team.is_placeholder &&
        (!team.joined_via_oauth || !team.hattrick_user_id) &&
        verifiedTeamsById.has(team.ht_team_id),
    );

    for (const team of claimableRows) {
      const verifiedTeam = team.ht_team_id ? verifiedTeamsById.get(team.ht_team_id) : null;
      const { error: updateError } = await supabase
        .from('teams')
        .update({
          name: verifiedTeam?.teamName ?? undefined,
          ht_team_name: verifiedTeam?.teamName ?? undefined,
          manager_name: profile.manager_name,
          hattrick_user_id: session.userId,
          joined_via_oauth: true,
          oauth_token: profile.oauth_token,
          oauth_token_secret: profile.oauth_token_secret,
          oauth_scope: profile.oauth_scope,
          can_manage_challenges: Boolean(profile.oauth_scope?.includes('manage_challenges')),
        })
        .eq('id', team.id);

      if (updateError) {
        return res.status(500).json({ error: updateError.message });
      }
    }

    return res.status(200).json({
      claimed: claimableRows.length,
      teamIds: claimableRows.map((team) => team.ht_team_id).filter(Boolean),
    });
  }

  if (!selection_token) {
    return res.status(400).json({ error: 'Missing selection_token' });
  }

  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    return res.status(500).json({ error: 'CHPP configuration missing' });
  }

  try {
    const isSuperAdmin = hasSuperAdminBypassCookie(req.headers.cookie);

    // 1. Get pending join data
    const { data: pending, error: pError } = await supabase
      .from('oauth_temp_sessions')
      .select('*')
      .eq('selection_token', selection_token)
      .single();

    if (pError || !pending) {
      return res.status(404).json({ error: 'Selection session not found or expired' });
    }

    if (pending.is_creation && team_id && team_name) {
      // Return data for creation flow to finalize
      return res.status(200).json({
        redirect: `/create?step=teams&linked=true&manager=${encodeURIComponent(
          pending.manager_name,
        )}&teamId=${team_id}&teamName=${encodeURIComponent(team_name)}&token=${selection_token}`,
      });
    }

    // 2. Fetch additional team details (Logo, Country) - ONLY IF JOINING
    let logoUrl: string | undefined;
    let countryId: number | undefined;
    let countryName: string | undefined;
    let teamDetails: ReturnType<typeof parseTeamDetailsXml> | undefined;

    if (pending.tournament_id && team_id && team_name) {
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
          teamDetails = parseTeamDetailsXml(xml, parseInt(teamIdStr, 10));
          logoUrl = teamDetails.logoUrl;
          countryId = teamDetails.countryId;
          countryName = teamDetails.countryName;
        }
      } catch (e) {
        console.error('Failed to fetch team details:', e);
      }
    }

    // 3. Register the specific team (Standard joining flow)
    let redirectUrl = `/`;

    if (pending.tournament_id && team_id && team_name) {
      const { data: tournament, error: tErr } = await supabase
        .from('tournaments')
        .select('slug, country_limit, league_category')
        .eq('id', pending.tournament_id)
        .single();

      if (tErr || !tournament) {
        throw new Error('Tournament not found');
      }

      const eligibility = validateTeamEligibility(
        {
          leagueName: teamDetails?.leagueName,
          leagueId: teamDetails?.leagueId,
          leagueSystemId: teamDetails?.leagueSystemId,
          countryId,
          countryName,
          genderId: teamDetails?.genderId,
        },
        { category: tournament.league_category === 'hfi' ? 'hfi' : 'male', countryLimit: tournament.country_limit },
      );
      if (!eligibility.eligible && !isSuperAdmin) {
        throw new Error(`This team is not from the required league (${tournament.country_limit}).`);
      }

      await registerOAuthTeam(supabase, {
        tournamentId: pending.tournament_id!,
        team: {
          teamId: parseInt(team_id),
          teamName: team_name,
          leagueId: teamDetails?.leagueId,
          leagueSystemId: teamDetails?.leagueSystemId,
          leagueName: teamDetails?.leagueName,
          leagueLevel: teamDetails?.leagueLevel,
          genderId: teamDetails?.genderId,
          countryId,
          countryName,
        },
        managerName: pending.manager_name,
        hattrickUserId: pending.hattrick_user_id,
        accessToken: pending.access_token,
        accessTokenSecret: pending.access_token_secret,
        logoUrl,
        countryId,
        countryName,
        skipMembershipCheck: isSuperAdmin,
      });

      redirectUrl = `/t/${tournament.slug}?joined=true`;
    }

    // 4. Update/Create Profile
    try {
      let countryId: number | undefined;
      let countryName: string | undefined;
      let leagueId: number | undefined;
      let avatar = null;
      let teamsJson = pending.teams_json;

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
        countryId = mParsed.countryId;
        countryName = mParsed.countryName;
        leagueId = mParsed.leagueId;
        avatar = mParsed.avatar ?? null;
        teamsJson = mParsed.teams;
      } else {
        console.warn('Failed to refresh managercompendium during login, using cached teams_json:', mRes.status);
      }

      await supabase.from('profiles').upsert({
        hattrick_user_id: pending.hattrick_user_id,
        manager_name: pending.manager_name,
        country_id: countryId ?? null,
        country_name: countryName ?? null,
        league_id: leagueId ?? null,
        avatar_json: avatar,
        teams_json: teamsJson,
        oauth_token: pending.access_token,
        oauth_token_secret: pending.access_token_secret,
        oauth_scope: pending.oauth_scope ?? null,
        chpp_synced_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      });
    } catch (e) {
      console.error('Failed to update profile during login:', e);
    }

    // 5. Cleanup
    await supabase.from('oauth_temp_sessions').delete().eq('selection_token', selection_token);

    // 6. Set signed session cookie
    const secret = getAppSessionSecret();
    if (!secret) {
      return res.status(500).json({ error: 'APP_SESSION_SECRET is missing' });
    }

    const host = String(req.headers.host || '').split(':')[0].toLowerCase();
    const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
    const secureCookie = !isLocalHost && (process.env.NODE_ENV === 'production' || forwardedProto === 'https');
    res.setHeader('Set-Cookie', buildAppSessionCookie(pending.hattrick_user_id, secret, secureCookie));

    return res.status(200).json({
      hattrick_user_id: pending.hattrick_user_id,
      manager_name: pending.manager_name,
      redirect: redirectUrl,
    });
  } catch (error: unknown) {
    console.error('Auth Complete Handler Error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'An unknown error occurred' });
  }
}
