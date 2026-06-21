import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';
import {
  fetchManagerTeamsFromChpp,
  fetchTeamDetailsFromChpp,
  fetchArenaDetailsFromChpp,
  classifyTeamAvailability,
  getManagerChppCredentials,
  type MatchmakerTeamOption,
} from '../_lib/matchmaker.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { managerId } = req.query;
  if (!managerId || Array.isArray(managerId)) {
    return res.status(400).json({ error: 'Missing managerId' });
  }

  try {
    const supabase = getSupabase();
    const credentials = await getManagerChppCredentials(supabase, Number(managerId));

    if (!credentials) {
      return res.status(401).json({
        error: 'CHPP authorization not found for this manager. Please sign in with CHPP again.',
      });
    }

    const consumerKey = process.env.CHPP_CONSUMER_KEY;
    const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
    if (!consumerKey || !consumerSecret) {
      return res.status(500).json({ error: 'CHPP config missing' });
    }

    const snapshot = await fetchManagerTeamsFromChpp(consumerKey, consumerSecret, credentials);

    // Create a map to track DB state
    const { data: dbTeams } = await supabase
      .from('teams')
      .select('ht_team_id, logo_url, arena_id, arena_image_url')
      .in('ht_team_id', snapshot.teams.map((t) => t.teamId))
      .is('tournament_id', null);

    const dbTeamMap = new Map(dbTeams?.map((t) => [t.ht_team_id, t]));

    // Fetch and update missing assets
    const enrichedTeams = await Promise.all(
      snapshot.teams.map(async (team) => {
        const dbEntry = dbTeamMap.get(team.teamId);
        let logoUrl = dbEntry?.logo_url;
        let arenaImageUrl = dbEntry?.arena_image_url;
        let arenaId = dbEntry?.arena_id;
        let teamDetails: Awaited<ReturnType<typeof fetchTeamDetailsFromChpp>> | null = null;

        try {
          teamDetails = await fetchTeamDetailsFromChpp(consumerKey, consumerSecret, credentials, team.teamId);
          logoUrl = logoUrl || teamDetails.logoUrl;
          arenaId = arenaId || teamDetails.arenaId;

          if (arenaId) {
            const arena = await fetchArenaDetailsFromChpp(consumerKey, consumerSecret, credentials, arenaId);
            arenaImageUrl = arenaImageUrl || arena.arenaImageUrl;
          }

          if ((!dbEntry?.logo_url && logoUrl) || (!dbEntry?.arena_image_url && arenaImageUrl) || (!dbEntry?.arena_id && arenaId)) {
            await supabase
              .from('teams')
              .update({
                logo_url: logoUrl,
                arena_image_url: arenaImageUrl,
                arena_id: arenaId,
              })
              .eq('ht_team_id', team.teamId)
              .is('tournament_id', null);
          }
        } catch (e) {
          console.error(`Failed to fetch details for team ${team.teamId}:`, e);
        }

        const availability = classifyTeamAvailability(teamDetails);
        const finalTeam = {
          ...team,
          genderId: teamDetails?.genderId ?? team.genderId,
          logo_url: logoUrl || team.logo_url,
          arena_image_url: arenaImageUrl || team.arena_image_url,
          availabilityStatus: availability.availabilityStatus,
          availabilityReason: availability.availabilityReason,
          friendlyTeamId: teamDetails?.friendlyTeamId ?? null,
          possibleToChallengeMidweek: teamDetails?.possibleToChallengeMidweek,
          possibleToChallengeWeekend: teamDetails?.possibleToChallengeWeekend,
        };

        if (process.env.NODE_ENV !== 'production' || process.env.MATCHMAKER_AUDIT === 'true') {
          console.log('[matchmaker/teams] availability', {
            teamId: finalTeam.teamId,
            teamName: finalTeam.teamName,
            genderId: finalTeam.genderId,
            availabilityStatus: finalTeam.availabilityStatus,
            availabilityReason: finalTeam.availabilityReason ?? null,
          });
        }

        return finalTeam;
      })
    );

    const teams: MatchmakerTeamOption[] = enrichedTeams.map((team) => team);

    // Developer Test Mode
    if (process.env.MATCHMAKER_DEV_MODE === 'true') {
      console.warn('[matchmaker/teams] MATCHMAKER_DEV_MODE is enabled; adding mock teams only.');
      teams.push(
        {
          teamId: 999001,
          teamName: 'FC Testing United (Mock)',
          countryName: 'Latvia',
          availabilityStatus: 'available',
        },
        {
          teamId: 999002,
          teamName: 'Bug Hunters FC (Mock)',
          countryName: 'England',
          availabilityStatus: 'booked',
          availabilityReason: 'Friendly already scheduled (Mock)',
        },
      );
    }

    await supabase
      .from('profiles')
      .update({
        manager_name: snapshot.managerName,
        country_id: snapshot.countryId ?? null,
        country_name: snapshot.countryName ?? null,
        league_id: snapshot.leagueId ?? null,
        avatar_json: snapshot.avatar ?? null,
        teams_json: snapshot.teams,
      })
      .eq('hattrick_user_id', credentials.hattrick_user_id);

    return res.status(200).json({
      teams,
      refreshed_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Matchmaker teams error:', error);
    return res.status(503).json({
      error: error instanceof Error ? error.message : 'Could not refresh your Hattrick teams right now.',
    });
  }
}
