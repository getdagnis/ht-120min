import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';
import {
  fetchManagerTeamsFromChpp,
  fetchTeamBookingStatus,
  fetchTeamDetailsFromChpp,
  fetchArenaDetailsFromChpp,
  classifyTeamAvailability,
  getManagerChppCredentials,
  type MatchmakerBookingResult,
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

  const {
    managerId,
    teamId,
    matchType,
    opponentLocation,
    homeAway,
    message,
    matchDay,
    timeWindow,
    isBackAndForth,
    isLongTerm,
  } = req.body ?? {};

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
    let selectedTeam = snapshot.teams.find((team) => team.teamId === parsedTeamId);
    let isMockTeam = false;
    let extraDetails: Awaited<ReturnType<typeof fetchTeamDetailsFromChpp>> | null = null;
    let arenaDetails: Awaited<ReturnType<typeof fetchArenaDetailsFromChpp>> | null = null;
    let bookingStatus: MatchmakerBookingResult | null = null;

    // Developer Test Mode
    if (process.env.NODE_ENV === 'development') {
      if (parsedTeamId === 999001) {
        selectedTeam = {
          teamId: 999001,
          teamName: 'FC Testing United (Mock)',
          countryName: 'Latvia',
          leagueId: 53,
          genderId: 1,
        };
        isMockTeam = true;
      } else if (parsedTeamId === 999002) {
        selectedTeam = {
          teamId: 999002,
          teamName: 'Bug Hunters FC (Mock)',
          countryName: 'England',
          leagueId: 2,
          genderId: 1,
        };
        isMockTeam = true;
      }
    }

    if (!selectedTeam) {
      return res.status(403).json({
        error: 'This team is not part of your current Hattrick clubs.',
      });
    }

    if (!isMockTeam) {
      bookingStatus = await fetchTeamBookingStatus(consumerKey, consumerSecret, credentials, parsedTeamId);
      // Allow creating long-term ads even if a booked friendly exists — long-term expresses future interest only
      if (bookingStatus.isBooked && !isLongTerm) {
        return res.status(409).json({
          error: 'This team already has a booked friendly. Please choose a different team.',
        });
      }

      const details = await fetchTeamDetailsFromChpp(consumerKey, consumerSecret, credentials, parsedTeamId);
      extraDetails = details;

      if (details.arenaId) {
        try {
          arenaDetails = await fetchArenaDetailsFromChpp(consumerKey, consumerSecret, credentials, details.arenaId);
        } catch (e) {
          console.error('Failed to fetch arena details:', e);
        }
      }
    } else if (parsedTeamId === 999002) {
      // Specifically test a "booked" mock team if it somehow gets through
      return res.status(409).json({
        error: `This team already has a booked friendly on next matchup dates (Mock).`,
      });
    }

    const availability = classifyTeamAvailability(extraDetails, isMockTeam ? null : bookingStatus);

    const teamData = {
      name: selectedTeam.teamName,
      ht_team_name: selectedTeam.teamName,
      hattrick_user_id: parsedManagerId,
      manager_name: credentials.manager_name,
      logo_url: extraDetails?.logoUrl ?? null,
      country_id: extraDetails?.countryId ?? null,
      country_name: extraDetails?.countryName ?? selectedTeam.countryName ?? null,
      league_id: selectedTeam.leagueId ?? null,
      league_level: extraDetails?.leagueLevel ?? null,
      gender_id: extraDetails?.genderId ?? selectedTeam.genderId ?? 1,
      fanclub_size: extraDetails?.fanclubSize ?? null,
      arena_id: extraDetails?.arenaId ?? null,
      arena_size: arenaDetails?.capacity ?? null,
      arena_image_url: arenaDetails?.arenaImageUrl ?? arenaDetails?.arenaFallbackImageUrl ?? null,
      availability_status: availability.availabilityStatus,
      availability_reason: availability.availabilityReason ?? null,
      active: true,
    };

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
      const { error: updateTeamError } = await supabase.from('teams').update(teamData).eq('id', teamId);

      if (updateTeamError) {
        return res.status(500).json({
          error: updateTeamError.message || 'Could not save your team details right now. Please try again.',
        });
      }
    } else {
      const { data: insertedTeam, error: insertTeamError } = await supabase
        .from('teams')
        .insert({
          ...teamData,
          ht_team_id: parsedTeamId,
          tournament_id: null,
        })
        .select('id')
        .single();

      if (insertTeamError || !insertedTeam) {
        return res.status(500).json({
          error: insertTeamError?.message || 'Could not save your team details right now. Please try again.',
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
      const { data: request, error: updateError } = await supabase
        .from('matchmaker_requests')
        .update({
          match_type: matchType ?? '120min',
          opponent_location: opponentLocation ?? 'any',
          home_away: homeAway ?? 'any',
          match_day: matchDay ?? null,
          time_window: timeWindow ?? null,
          message: typeof message === 'string' && message.trim() ? message.trim() : null,
          is_back_and_forth: !!isBackAndForth,
          is_long_term: !!isLongTerm,
          gender_id: teamData.gender_id,
        })
        .eq('id', existingOpen.id)
        .select('id')
        .single();

      if (updateError) {
        throw updateError;
      }

      return res.status(200).json({
        request,
        team: {
          teamId: selectedTeam.teamId,
          teamName: selectedTeam.teamName,
        },
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
        match_day: matchDay ?? null,
        time_window: timeWindow ?? null,
        message: typeof message === 'string' && message.trim() ? message.trim() : null,
        expires_at: calculateMatchmakerExpiry().toISOString(),
        is_back_and_forth: !!isBackAndForth,
        is_long_term: !!isLongTerm,
        gender_id: teamData.gender_id,
        created_by_admin: false,
      })
      .select('id')
      .single();

    if (requestError || !request) {
      return res.status(500).json({
        error: requestError?.message || 'Could not create your Matchmaker request right now. Please try again.',
      });
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
        error instanceof Error ? error.message : 'Could not publish this request right now. Please try again later.',
    });
  }
}
