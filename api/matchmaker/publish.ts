import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';
import {
  fetchManagerTeamsFromChpp,
  fetchTeamBookingStatus,
  getManagerChppCredentials,
} from '../_lib/matchmaker.js';

const calculateMatchmakerExpiry = (now = new Date()): Date => {
  const expiry = new Date(now);
  const day = expiry.getUTCDay();
  const diff = day <= 2 ? 2 - day : 9 - day;
  expiry.setUTCDate(expiry.getUTCDate() + diff);
  expiry.setUTCHours(6, 0, 0, 0);
  if (expiry.getTime() <= now.getTime()) {
    expiry.setUTCDate(expiry.getUTCDate() + 7);
  }
  return expiry;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { managerId, teamId, matchType, opponentLocation, homeAway, message } = req.body ?? {};
  const parsedManagerId = Number(managerId);
  const parsedTeamId = Number(teamId);

  if (!Number.isFinite(parsedManagerId) || !Number.isFinite(parsedTeamId)) {
    return res.status(400).json({ error: 'Missing managerId or teamId' });
  }

  try {
    const supabase = getSupabase();
    const credentials = await getManagerChppCredentials(supabase, parsedManagerId);

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
    const selectedTeam = snapshot.teams.find((team) => team.teamId === parsedTeamId);

    if (!selectedTeam) {
      return res.status(403).json({
        error: 'This team is not part of your current Hattrick clubs.',
      });
    }

    const booking = await fetchTeamBookingStatus(consumerKey, consumerSecret, credentials, parsedTeamId);
    if (booking.isBooked) {
      const bookingDate = booking.match?.matchDate ? new Date(booking.match.matchDate) : null;
      const when = bookingDate && Number.isFinite(bookingDate.getTime()) ? ` on ${bookingDate.toLocaleString()}` : '';
      return res.status(409).json({
        error: `This team already has a booked friendly${when}. Please choose a different team.`,
      });
    }

    const { data: existingTeam, error: existingTeamError } = await supabase
      .from('teams')
      .select('id')
      .eq('ht_team_id', parsedTeamId)
      .is('tournament_id', null)
      .maybeSingle();

    if (existingTeamError) {
      throw existingTeamError;
    }

    let teamId = existingTeam?.id;
    if (teamId) {
      const { error: updateTeamError } = await supabase
        .from('teams')
        .update({
          name: selectedTeam.teamName,
          ht_team_name: selectedTeam.teamName,
          hattrick_user_id: parsedManagerId,
          manager_name: credentials.manager_name,
          country_name: selectedTeam.countryName ?? null,
          active: true,
        })
        .eq('id', teamId);

      if (updateTeamError) {
        return res.status(500).json({
          error: updateTeamError.message || 'Could not save your team details right now. Please try again.',
        });
      }
    } else {
      const { data: insertedTeam, error: insertTeamError } = await supabase
        .from('teams')
        .insert({
          ht_team_id: parsedTeamId,
          name: selectedTeam.teamName,
          ht_team_name: selectedTeam.teamName,
          hattrick_user_id: parsedManagerId,
          manager_name: credentials.manager_name,
          country_name: selectedTeam.countryName ?? null,
          tournament_id: null,
          active: true,
        })
        .select('id')
        .single();

      if (insertTeamError || !insertedTeam) {
        return res.status(500).json({
          error:
            insertTeamError?.message ||
            'Could not save your team details right now. Please try again.',
        });
      }

      teamId = insertedTeam.id;
    }

    const { data: existingOpen, error: existingError } = await supabase
      .from('matchmaker_requests')
      .select('id')
      .eq('team_id', teamId)
      .eq('status', 'open')
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existingOpen) {
      return res.status(409).json({
        error: 'This team already has an open Matchmaker request.',
      });
    }

    const { data: request, error: requestError } = await supabase
      .from('matchmaker_requests')
      .insert({
        manager_ht_id: parsedManagerId,
        team_id: teamId,
        match_type: matchType ?? '120min',
        opponent_location: opponentLocation ?? 'any',
        home_away: homeAway ?? 'any',
        message: typeof message === 'string' && message.trim() ? message.trim() : null,
        expires_at: calculateMatchmakerExpiry().toISOString(),
      })
      .select('id')
      .single();

    if (requestError || !request) {
      return res.status(500).json({
        error: 'Could not create your Matchmaker request right now. Please try again.',
      });
    }

    await supabase
      .from('profiles')
      .update({
        manager_name: snapshot.managerName,
        country_id: snapshot.countryId ?? null,
        country_name: snapshot.countryName ?? null,
        avatar_json: snapshot.avatar ?? null,
        teams_json: snapshot.teams,
        chpp_synced_at: new Date().toISOString(),
      })
      .eq('hattrick_user_id', parsedManagerId);

    return res.status(200).json({
      request,
      team: {
        teamId: selectedTeam.teamId,
        teamName: selectedTeam.teamName,
      },
    });
  } catch (error) {
    console.error('Matchmaker publish error:', error);
    return res.status(503).json({
      error:
        error instanceof Error
          ? error.message
          : 'Could not publish this request right now. Please try again later.',
    });
  }
}
