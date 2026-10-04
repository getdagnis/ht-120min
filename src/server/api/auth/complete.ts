import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { ChppTeamOption, ParsedManagerCompendium, ParsedTeamDetails } from '../_lib/chpp-xml.js';
import { getServiceSupabase } from '../_lib/supabase.js';
import { registerOAuthTeam } from '../_lib/chpp-register.js';
import { validateTeamEligibility } from '../_lib/eligibility.js';
import { buildAppSessionCookie, clearAppSessionCookie, getAppSessionSecret, verifyAppSessionCookie } from '../_lib/app-session.js';
import { hasSuperAdminBypassCookie } from '../_lib/superadmin-bypass.js';
import { normalizeLeagueLimit } from '../../../../shared/worlddetails.js';
import { buildForgeSessionCookie, getForgeSuperadminId } from '../_lib/forge-session.js';
import { isForgeEnabled } from '../../forge-availability.js';
import {
  fetchManagerTeamsFromChpp,
  fetchManagerTeamDetailsFromChpp,
  mergeManagerTeamSnapshot,
  ManagerCompendiumRequestError,
} from '../_lib/manager-compendium.js';
import { fetchTeamDetailsFromChpp } from '../_lib/matchmaker.js';
import { buildTournamentJoinStory } from '../_lib/join-story.js';

interface CompleteAuthBody {
  action?: 'claim_teams' | 'create_session' | 'clear_session';
  forgeAuth?: boolean;
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
  tournament_id: string;
  ht_team_id: number | null;
  active: boolean | null;
  is_placeholder: boolean | null;
  joined_via_oauth: boolean | null;
  hattrick_user_id: number | null;
  tournaments:
    | {
        status: string | null;
        registration_type: string | null;
        is_test: boolean | null;
        is_archived: boolean | null;
      }
    | {
        status: string | null;
        registration_type: string | null;
        is_test: boolean | null;
        is_archived: boolean | null;
      }[]
    | null;
}

function getClaimTournament(team: TeamForClaim) {
  return Array.isArray(team.tournaments) ? team.tournaments[0] : team.tournaments;
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

  const { selection_token, team_id, team_name, action, teamIds, forgeAuth } = req.body as CompleteAuthBody;
  if (forgeAuth && !isForgeEnabled()) return res.status(404).json({ error: 'Not found.' });

  if (action === 'clear_session') {
    const host = String(req.headers.host || '').split(':')[0].toLowerCase();
    const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
    const secureCookie = !isLocalHost && (process.env.NODE_ENV === 'production' || forwardedProto === 'https');
    res.setHeader('Set-Cookie', clearAppSessionCookie(secureCookie));
    return res.status(200).json({ cleared: true });
  }

  let supabase: ReturnType<typeof getServiceSupabase>;
  try {
    supabase = getServiceSupabase();
  } catch (error) {
    console.error('Auth Complete Supabase init error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Supabase configuration missing',
    });
  }

  if (action === 'create_session') {
    if (!selection_token) return res.status(400).json({ error: 'Missing selection_token' });
    const { data: creationSession, error: creationSessionError } = await supabase
      .from('oauth_temp_sessions')
      .select('selection_token, is_creation, hattrick_user_id, manager_name')
      .eq('selection_token', selection_token)
      .maybeSingle();
    if (creationSessionError || !creationSession || !creationSession.is_creation || !creationSession.hattrick_user_id) {
      return res.status(401).json({ error: 'Invalid or expired creation session.' });
    }

    const secret = getAppSessionSecret();
    if (!secret) return res.status(500).json({ error: 'APP_SESSION_SECRET is missing' });
    const host = String(req.headers.host || '').split(':')[0].toLowerCase();
    const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
    const secureCookie = !isLocalHost && (process.env.NODE_ENV === 'production' || forwardedProto === 'https');
    res.setHeader('Set-Cookie', buildAppSessionCookie(creationSession.hattrick_user_id, secret, secureCookie));
    return res.status(200).json({ hattrick_user_id: creationSession.hattrick_user_id, manager_name: creationSession.manager_name });
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
      .select(
        'id, tournament_id, ht_team_id, active, is_placeholder, joined_via_oauth, hattrick_user_id, tournaments(status, registration_type, is_test, is_archived)',
      )
      .in('ht_team_id', verifiedRequestedIds)
      .eq('active', true);

    if (teamsError) {
      return res.status(500).json({ error: teamsError.message });
    }

    const teamRows = (teamRowsRaw as TeamForClaim[] | null) ?? [];
    const linkedTeamIds = new Set(
      teamRows
        .filter((team) => team.ht_team_id && team.hattrick_user_id === session.userId && team.joined_via_oauth === true)
        .map((team) => team.ht_team_id),
    );

    const claimableRows = teamRows.filter((team) => {
      const tournament = getClaimTournament(team);
      const isActiveParticipation =
        Boolean(tournament) &&
        (!tournament?.status || ['open', 'active', 'ongoing', 'paused'].includes(tournament.status));

      return (
        team.ht_team_id &&
        !team.is_placeholder &&
        !linkedTeamIds.has(team.ht_team_id) &&
        team.hattrick_user_id == null &&
        Boolean(tournament) &&
        tournament?.registration_type !== 'sandbox' &&
        !tournament?.is_test &&
        !tournament?.is_archived &&
        team.joined_via_oauth !== true &&
        isActiveParticipation &&
        verifiedTeamsById.has(team.ht_team_id)
      );
    });

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
      tournamentIds: [...new Set(claimableRows.map((team) => team.tournament_id))],
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

    // 2. Refresh the manager's current club snapshot during authenticated login.
    let logoUrl: string | undefined;
    let countryId: number | undefined;
    let countryName: string | undefined;
    let teamDetails: ParsedTeamDetails | undefined;
    let managerCompendium: ParsedManagerCompendium | undefined;
    let managerTeamDetails: ParsedTeamDetails[] = [];
    let nationalTeamRoles: Array<{ staffType: number; nationalTeamId: number; nationalTeamName: string; isU21: boolean }> = [];
    let teamDetailsRefreshed = false;
    let publicTournamentIds: string[] = [];

    try {
      managerCompendium = await fetchManagerTeamsFromChpp(consumerKey, consumerSecret, {
        oauth_token: pending.access_token,
        oauth_token_secret: pending.access_token_secret,
      });
    } catch (error) {
      console.warn(
        'Failed to refresh managercompendium during login, using cached teams_json:',
        error instanceof ManagerCompendiumRequestError ? error.status : error,
      );
    }
    if (managerCompendium) {
      try {
        const teamDetailsSnapshot = await fetchManagerTeamDetailsFromChpp(
          consumerKey, consumerSecret,
          { oauth_token: pending.access_token, oauth_token_secret: pending.access_token_secret },
        );
        managerTeamDetails = teamDetailsSnapshot.teams;
        nationalTeamRoles = teamDetailsSnapshot.nationalTeamRoles;
        teamDetailsRefreshed = true;
        teamDetails = managerTeamDetails.find((details) => details.teamId === Number(team_id));
        logoUrl = teamDetails?.logoUrl;
        countryId = teamDetails?.countryId;
        countryName = teamDetails?.countryName;
      } catch (error) {
        console.warn('Failed to refresh manager teamdetails during login:', error);
      }
    }
    if (pending.tournament_id && team_id && !teamDetails) {
      try {
        teamDetails = await fetchTeamDetailsFromChpp(
          consumerKey, consumerSecret,
          { oauth_token: pending.access_token, oauth_token_secret: pending.access_token_secret },
          Number(team_id),
        );
        logoUrl = teamDetails.logoUrl;
        countryId = teamDetails.countryId;
        countryName = teamDetails.countryName;
      } catch (error) {
        console.warn('Could not refresh selected teamdetails after manager-wide refresh:', error);
      }
    }

    // 3. Register the specific team (Standard joining flow)
    let redirectUrl = `/`;

    if (pending.tournament_id && team_id && team_name) {
      const { data: tournament, error: tErr } = await supabase
        .from('tournaments')
        .select('slug, country_limit, country_limit_format, league_category')
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
        {
          category: tournament.league_category === 'hfi' ? 'hfi' : 'male',
          countryLimit: normalizeLeagueLimit(tournament.country_limit, tournament.country_limit_format ?? 'league_id'),
        },
      );
      if (!eligibility.eligible && !isSuperAdmin) {
        throw new Error(`This team is not from the required league (${tournament.country_limit}).`);
      }

      const selectedManagerTeam =
        managerCompendium?.teams.find((team) => team.teamId === Number(team_id)) ?? {
          teamId: Number(team_id),
          teamName: team_name,
          leagueId: teamDetails?.leagueId,
          leagueSystemId: teamDetails?.leagueSystemId,
          leagueName: teamDetails?.leagueName,
          leagueLevel: teamDetails?.leagueLevel,
          leagueLevelUnitName: teamDetails?.leagueLevelUnitName,
          countryId,
          countryName,
          regionName: teamDetails?.regionName,
        };
      const joinStory = buildTournamentJoinStory({
        manager: managerCompendium,
        managerName: pending.manager_name,
        managerId: pending.hattrick_user_id,
        team: selectedManagerTeam,
        teamDetails,
      });

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
          leagueLevelUnitName: teamDetails?.leagueLevelUnitName,
        },
        managerName: pending.manager_name,
        hattrickUserId: pending.hattrick_user_id,
        accessToken: pending.access_token,
        accessTokenSecret: pending.access_token_secret,
        logoUrl,
        countryId,
        countryName,
        teamRank: teamDetails?.teamRank ?? null,
        powerRating: teamDetails?.powerRating ?? null,
        powerGlobalRank: teamDetails?.powerGlobalRank ?? null,
        powerLeagueRank: teamDetails?.powerLeagueRank ?? null,
        powerRegionRank: teamDetails?.powerRegionRank ?? null,
        joinStory,
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

      try {
        const mParsed = managerCompendium;
        if (!mParsed) throw new Error('managercompendium unavailable');
        countryId = mParsed.countryId;
        countryName = mParsed.countryName;
        leagueId = mParsed.leagueId;
        avatar = mParsed.avatar ?? null;
        const previousProfile = await supabase.from('profiles')
          .select('teams_json').eq('hattrick_user_id', pending.hattrick_user_id).maybeSingle();
        const previousTeams = Array.isArray(previousProfile.data?.teams_json)
          ? previousProfile.data.teams_json as ChppTeamOption[] : [];
        teamsJson = mergeManagerTeamSnapshot(mParsed.teams, managerTeamDetails, previousTeams);
      } catch (error) {
        console.warn(
          'Failed to refresh managercompendium during login, using cached teams_json:',
          error instanceof ManagerCompendiumRequestError ? error.status : error,
        );
      }

      const profilePayload = {
        hattrick_user_id: pending.hattrick_user_id,
        manager_name: pending.manager_name,
        country_id: countryId ?? null,
        country_name: countryName ?? null,
        league_id: leagueId ?? null,
        language_id: managerCompendium?.languageId ?? null,
        language_name: managerCompendium?.languageName ?? null,
        avatar_json: avatar,
        teams_json: teamsJson,
        ...(teamDetailsRefreshed ? { national_team_roles_json: nationalTeamRoles } : {}),
        oauth_token: pending.access_token,
        oauth_token_secret: pending.access_token_secret,
        oauth_scope: pending.oauth_scope ?? null,
        chpp_synced_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      };
      let profileWrite = await supabase.from('profiles').upsert(profilePayload);
      if (profileWrite.error && /language_(id|name)/i.test(profileWrite.error.message)) {
        const { language_id: _languageId, language_name: _languageName, ...withoutLanguage } = profilePayload;
        void _languageId;
        void _languageName;
        profileWrite = await supabase.from('profiles').upsert(withoutLanguage);
      }
      if (profileWrite.error) throw profileWrite.error;
      const ownedTeamIds = (teamsJson ?? []).map((team) => team.teamId).filter((id) => Number.isSafeInteger(id) && id > 0);
      if (ownedTeamIds.length) {
        const { data: linkedTeams, error: linkedTeamsError } = await supabase
          .from('teams')
          .select('tournament_id')
          .in('ht_team_id', ownedTeamIds)
          .eq('active', true);
        if (linkedTeamsError) console.warn('Could not resolve public tournaments for refreshed manager identity:', linkedTeamsError.message);
        else publicTournamentIds = Array.from(new Set((linkedTeams ?? []).map((row) => String(row.tournament_id)).filter(Boolean)));
      }
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
    const cookies = [buildAppSessionCookie(pending.hattrick_user_id, secret, secureCookie)];
    if (forgeAuth && pending.hattrick_user_id === getForgeSuperadminId()) {
      cookies.push(buildForgeSessionCookie(pending.hattrick_user_id, secureCookie));
    }
    res.setHeader('Set-Cookie', cookies);

    return res.status(200).json({
      hattrick_user_id: pending.hattrick_user_id,
      manager_name: pending.manager_name,
      redirect: redirectUrl,
      tournamentId: pending.tournament_id || null,
      tournamentIds: publicTournamentIds,
    });
  } catch (error: unknown) {
    console.error('Auth Complete Handler Error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'An unknown error occurred' });
  }
}
