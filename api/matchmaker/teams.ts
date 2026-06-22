import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';
import {
  fetchManagerTeamsFromChpp,
  fetchTeamDetailsFromChpp,
  fetchTeamBookingStatus,
  fetchArenaDetailsFromChpp,
  classifyTeamAvailability,
  getManagerChppCredentials,
  type MatchmakerTeamOption,
} from '../_lib/matchmaker.js';

async function backfillOpenMatchmakerTeams(
  supabase: ReturnType<typeof getSupabase>,
  consumerKey: string,
  consumerSecret: string,
) {
  const { data: openRequests } = await supabase
    .from('matchmaker_requests')
    .select(
      `
      id,
      team:teams!matchmaker_requests_team_id_fkey(
        id, ht_team_id, oauth_token, oauth_token_secret,
        name, logo_url, arena_id, arena_image_url, country_id, country_name, availability_status, availability_reason
      )
    `,
    )
    .eq('status', 'open')
    .not('team.oauth_token', 'is', null);

  const uniqueTeams = new Map<
    number,
    NonNullable<(typeof openRequests)[number]['team']>
  >();

  for (const request of openRequests ?? []) {
    if (request.team?.ht_team_id) {
      uniqueTeams.set(request.team.ht_team_id, request.team);
    }
  }

  for (const team of uniqueTeams.values()) {
    try {
      const credentials = {
        oauth_token: team.oauth_token!,
        oauth_token_secret: team.oauth_token_secret!,
      };

      const details = await fetchTeamDetailsFromChpp(consumerKey, consumerSecret, credentials, team.ht_team_id);
      let bookingResult = null;
      try {
        bookingResult = await fetchTeamBookingStatus(consumerKey, consumerSecret, credentials, team.ht_team_id);
      } catch (bookingError) {
        console.error(`Backfill booking fetch failed for team ${team.ht_team_id}:`, bookingError);
      }
      const arenaId = details.arenaId ?? team.arena_id ?? null;
      let arenaImageUrl = team.arena_image_url ?? null;
      const availability = classifyTeamAvailability(details, bookingResult);

      if (arenaId) {
        try {
          const arena = await fetchArenaDetailsFromChpp(consumerKey, consumerSecret, credentials, arenaId);
          arenaImageUrl = arena.arenaImageUrl ?? arena.arenaFallbackImageUrl ?? arenaImageUrl;
        } catch (arenaError) {
          console.error(`Backfill arena fetch failed for team ${team.ht_team_id}:`, arenaError);
        }
      }

      await supabase
        .from('teams')
        .update({
          logo_url: details.logoUrl ?? team.logo_url ?? null,
          arena_id: arenaId,
          arena_image_url: arenaImageUrl,
          country_id: details.countryId ?? team.country_id ?? null,
          country_name: details.countryName ?? team.country_name ?? null,
          gender_id: details.genderId ?? null,
          fanclub_size: details.fanclubSize ?? null,
          availability_status: availability.availabilityStatus,
          availability_reason: availability.availabilityReason ?? null,
        })
        .eq('id', team.id);
    } catch (error) {
      console.error(`Backfill failed for team ${team.ht_team_id}:`, error);
    }
  }
}

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
        let bookingResult = null;
        let teamDetails: Awaited<ReturnType<typeof fetchTeamDetailsFromChpp>> | null = null;

        try {
          teamDetails = await fetchTeamDetailsFromChpp(consumerKey, consumerSecret, credentials, team.teamId);
          // Prefer freshly fetched assets over existing DB values when available
          logoUrl = teamDetails.logoUrl ?? logoUrl;
          arenaId = teamDetails.arenaId ?? arenaId;

          if (arenaId) {
            const arena = await fetchArenaDetailsFromChpp(consumerKey, consumerSecret, credentials, arenaId);
            // prefer the fetched arena image (which may be higher-res) over stored value
            arenaImageUrl = arena.arenaImageUrl ?? arena.arenaFallbackImageUrl ?? arenaImageUrl;
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

        try {
          bookingResult = await fetchTeamBookingStatus(consumerKey, consumerSecret, credentials, team.teamId);
        } catch (e) {
          console.error(`Failed to fetch booking status for team ${team.teamId}:`, e);
        }

        const availability = classifyTeamAvailability(teamDetails, bookingResult);
        if (
          dbEntry ||
          logoUrl ||
          arenaImageUrl ||
          arenaId ||
          teamDetails?.countryId ||
          teamDetails?.countryName ||
          availability.availabilityStatus ||
          availability.availabilityReason
        ) {
          await supabase
            .from('teams')
            .update({
              logo_url: logoUrl || team.logo_url || null,
              arena_image_url: arenaImageUrl || team.arena_image_url || null,
              arena_id: arenaId || null,
              country_id: teamDetails?.countryId ?? team.countryId ?? null,
              country_name: teamDetails?.countryName ?? team.countryName ?? null,
              availability_status: availability.availabilityStatus,
              availability_reason: availability.availabilityReason ?? null,
              gender_id: teamDetails?.genderId ?? team.genderId ?? null,
              fanclub_size: teamDetails?.fanclubSize ?? null,
            })
            .eq('ht_team_id', team.teamId)
            .is('tournament_id', null);
        }

        const finalTeam = {
          ...team,
          genderId: teamDetails?.genderId ?? team.genderId,
          logo_url: logoUrl || team.logo_url,
          arena_image_url: arenaImageUrl || team.arena_image_url,
          countryId: teamDetails?.countryId ?? team.countryId,
          countryName: teamDetails?.countryName ?? team.countryName,
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

    await backfillOpenMatchmakerTeams(supabase, consumerKey, consumerSecret);

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
