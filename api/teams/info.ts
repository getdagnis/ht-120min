import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';
import { getAuthHeader } from '../_lib/chpp-auth.js';
import { validateTeamEligibility } from '../_lib/eligibility.js';
import { parseTeamDetailsXml } from '../_lib/chpp-xml.js';
import { hasSuperAdminBypassCookie } from '../_lib/superadmin-bypass.js';

interface TeamDetails {
  leagueName?: string;
  leagueId?: number;
  leagueSystemId?: number;
  leagueLevel?: number;
  countryId?: number;
  countryName?: string;
  genderId?: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { team_id, tournament_id, sandbox, league_category } = req.query;
  const isSandboxLookup = sandbox === '1' || sandbox === 'true';

  if (!team_id) {
    return res.status(400).json({ error: 'Missing team_id' });
  }

  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    return res.status(500).json({ error: 'CHPP config missing' });
  }

  try {
    const supabase = getSupabase();

    // Find any valid OAuth token to use as a gateway
    const { data: teamWithToken, error: tError } = await supabase
      .from('teams')
      .select('oauth_token, oauth_token_secret')
      .not('oauth_token', 'is', null)
      .limit(1)
      .single();

    if (tError || !teamWithToken) {
      return res.status(503).json({ error: 'No CHPP gateway available. Please link a team first.' });
    }

    // 2. Check if team is in another active tournament
    const isSuperAdmin = hasSuperAdminBypassCookie(req.headers.cookie);

    if (!isSuperAdmin && !isSandboxLookup) {
      const { data: existing } = await supabase
        .from('teams')
        .select('name, tournament_id, tournaments(name, status, is_test, registration_type)')
        .eq('ht_team_id', team_id)
        .eq('active', true);

      if (existing && existing.length > 0) {
        const activeTournament = existing.find((e) => {
          const t = e.tournaments as unknown as {
            status: string;
            is_test?: boolean | null;
            registration_type?: string | null;
          } | null;
          return t && t.status !== 'finished' && t.status !== 'stopped' && !t.is_test && t.registration_type !== 'sandbox';
        });
        if (activeTournament) {
          const t = activeTournament.tournaments as unknown as { name: string };
          const teamName = activeTournament.name || `Team ID ${team_id}`;
          return res.status(400).json({
            error: `Team "${teamName}" (${team_id}) is already active in another tournament: "${t.name}". It must leave that tournament first.`,
          });
        }
      }
    }

    // 3. Fetch team details using teamdetails
    const url = 'https://chpp.hattrick.org/chppxml.ashx';
    const params = { file: 'teamdetails', teamID: team_id as string, version: '3.9' };

    const authHeader = getAuthHeader(
      'GET',
      url,
      params,
      consumerKey,
      consumerSecret,
      teamWithToken.oauth_token!,
      teamWithToken.oauth_token_secret!,
    );

    const response = await fetch(`${url}?file=teamdetails&teamID=${team_id}&version=3.9`, {
      headers: { Authorization: authHeader },
    });

    const xml = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({ error: 'CHPP fetch failed', details: xml });
    }

    const parsed = parseTeamDetailsXml(xml, Number(team_id));
    const teamName = parsed.teamName || 'Unknown';
    const leagueId = parsed.leagueId?.toString();
    const leagueSystemId = parsed.leagueSystemId?.toString();
    const leagueLevel = parsed.leagueLevel;
    const leagueName = parsed.leagueName;
    const countryId = parsed.countryId;
    const countryName = parsed.countryName;
    const genderId = parsed.genderId?.toString();

    // Validation Check
    if (tournament_id && !isSuperAdmin) {
      const { data: tournament } = await supabase
        .from('tournaments')
        .select('scoring_mode, league_category, country_limit')
        .eq('id', tournament_id)
        .single();

      if (tournament) {
        const validation = validateTeamEligibility(
          {
            leagueName,
            leagueId: leagueId ? parseInt(leagueId) : undefined,
            leagueSystemId: leagueSystemId ? parseInt(leagueSystemId) : undefined,
            leagueLevel,
            countryId,
            countryName,
            genderId: genderId ? parseInt(genderId) : undefined,
          } as TeamDetails,
          { category: tournament.league_category as 'male' | 'hfi', countryLimit: tournament.country_limit },
        );
        if (!validation.eligible) {
          return res.status(400).json({ error: validation.reason });
        }
      }
    }

    if (isSandboxLookup) {
      const requestedCategory = league_category === 'hfi' ? 'hfi' : 'male';
      const validation = validateTeamEligibility(
        {
          leagueName,
          leagueId: leagueId ? parseInt(leagueId) : undefined,
          leagueSystemId: leagueSystemId ? parseInt(leagueSystemId) : undefined,
          leagueLevel,
          countryId,
          countryName,
          genderId: genderId ? parseInt(genderId) : undefined,
        } as TeamDetails,
        { category: requestedCategory, countryLimit: null },
      );
      if (!validation.eligible) {
        return res.status(400).json({ error: validation.reason });
      }
    }

    return res.status(200).json({
      teamId: parseInt(team_id as string),
      teamName,
      leagueId: leagueId ? parseInt(leagueId) : undefined,
      leagueSystemId: leagueSystemId ? parseInt(leagueSystemId) : undefined,
      leagueLevel,
      leagueName,
      countryId,
      countryName,
      genderId: genderId ? parseInt(genderId) : undefined,
      logoUrl: parsed.logoUrl,
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'An unknown error occurred' });
  }
}
