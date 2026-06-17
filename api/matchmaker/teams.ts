import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';
import {
  fetchManagerTeamsFromChpp,
  fetchTeamBookingStatus,
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

    const availabilityChecks = await Promise.all(
      snapshot.teams.map(async (team) => {
        try {
          const booking = await fetchTeamBookingStatus(consumerKey, consumerSecret, credentials, team.teamId);
          return {
            teamId: team.teamId,
            availabilityStatus: booking.isBooked ? 'booked' : 'available',
            availabilityReason: booking.isBooked ? 'Friendly already booked' : undefined,
            bookedMatch: booking.match,
          } as const;
        } catch (error) {
          return {
            teamId: team.teamId,
            availabilityStatus: 'unknown',
            availabilityReason:
              error instanceof Error
                ? error.message
                : 'Could not verify whether this team already has a booked friendly.',
          } as const;
        }
      }),
    );

    const availabilityMap = new Map<number, (typeof availabilityChecks)[number]>();
    for (const result of availabilityChecks) {
      availabilityMap.set(result.teamId, result);
    }

    const teams: MatchmakerTeamOption[] = snapshot.teams.map((team) => {
      const availability = availabilityMap.get(team.teamId);
      return {
        ...team,
        availabilityStatus: availability?.availabilityStatus ?? 'unknown',
        availabilityReason:
          availability && 'availabilityReason' in availability ? availability.availabilityReason : undefined,
        bookedMatch: availability && 'bookedMatch' in availability ? availability.bookedMatch : null,
      };
    });

    // Developer Test Mode
    if (process.env.MATCHMAKER_DEV_MODE === 'true') {
      teams.forEach((t) => {
        t.availabilityStatus = 'available';
        t.availabilityReason = undefined;
      });
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
          availabilityReason: 'Friendly already booked (Mock)',
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
