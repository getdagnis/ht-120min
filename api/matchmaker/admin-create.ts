import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';
import {
  classifyTeamAvailability,
  fetchManagerTeamsFromChpp,
  fetchTeamBookingStatus,
  fetchTeamDetailsFromChpp,
  fetchArenaDetailsFromChpp,
} from '../_lib/matchmaker.js';

const calculateMatchmakerExpiry = (now = new Date()): Date => {
  const expiry = new Date(now);
  expiry.setUTCDate(expiry.getUTCDate() + 30); // Admin posts last longer
  return expiry;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Admin Check
  console.log('Admin Check:', {
    cookies: req.cookies,
    devMode: process.env.MATCHMAKER_DEV_MODE,
  });
  const isAdmin = req.cookies.issuperadmin === 'you bet' || req.cookies.issuperadmin === 'youbet' || process.env.MATCHMAKER_DEV_MODE === 'true';
  if (!isAdmin) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { managerId, teamId, matchType, opponentLocation, homeAway, message, isBackAndForth, isLongTerm } =
    req.body ?? {};

  const targetManagerId = Number(managerId);
  const targetTeamId = teamId ? Number(teamId) : null;

  if (!targetManagerId) {
    return res.status(400).json({ error: 'managerId is required' });
  }

  try {
    const supabase = getSupabase();

    // Admin must provide their own hattrick_user_id to identify their token.
    const { adminManagerId } = req.body;
    if (!adminManagerId) {
      return res.status(400).json({ error: 'adminManagerId is required for admin actions' });
    }

    const { data: adminToken } = await supabase
      .from('teams')
      .select('oauth_token, oauth_token_secret')
      .eq('hattrick_user_id', adminManagerId)
      .not('oauth_token', 'is', null)
      .order('active', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!adminToken) {
      return res.status(500).json({ error: 'No CHPP session found for the provided adminManagerId' });
    }

    const consumerKey = process.env.CHPP_CONSUMER_KEY;
    const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
    if (!consumerKey || !consumerSecret) {
      return res.status(500).json({ error: 'CHPP config missing' });
    }

    const credentials = {
      oauth_token: adminToken.oauth_token,
      oauth_token_secret: adminToken.oauth_token_secret,
    };

    // 1. Fetch Manager Snapshot
    const managerSnapshot = await fetchManagerTeamsFromChpp(consumerKey, consumerSecret, credentials, targetManagerId);

    if (!managerSnapshot.teams || managerSnapshot.teams.length === 0) {
      return res.status(404).json({ error: 'Target manager has no teams or not found' });
    }

    // 2. Select Team
    let selectedTeam = null;
    if (targetTeamId) {
      selectedTeam = managerSnapshot.teams.find((t) => t.teamId === targetTeamId);
    } else if (managerSnapshot.teams.length >= 1) {
      selectedTeam = managerSnapshot.teams[0];
    }

    if (!selectedTeam) {
      return res.status(400).json({
        error: 'Multiple teams found. Please specify teamId.',
        availableTeams: managerSnapshot.teams.map((t) => ({ id: t.teamId, name: t.teamName })),
      });
    }

    // 3. Fetch Team & Arena Details
    const [teamDetails] = await Promise.all([
      fetchTeamDetailsFromChpp(consumerKey, consumerSecret, credentials, selectedTeam.teamId),
    ]);
    const bookingStatus = await fetchTeamBookingStatus(consumerKey, consumerSecret, credentials, selectedTeam.teamId).catch(
      (error) => {
        console.error('Failed to fetch booking status:', error);
        return null;
      },
    );
    const availability = classifyTeamAvailability(teamDetails, bookingStatus);
    // Arena fetch needs arenaId from teamDetails, so we do it after

    let finalArenaDetails = null;
    if (teamDetails.arenaId) {
      finalArenaDetails = await fetchArenaDetailsFromChpp(
        consumerKey,
        consumerSecret,
        credentials,
        teamDetails.arenaId,
      );
    }

    // 4. Update Profile & Team (Caching snapshot)
    await supabase.from('profiles').upsert(
      {
        hattrick_user_id: targetManagerId,
        manager_name: managerSnapshot.managerName,
        country_id: managerSnapshot.countryId ?? null,
        country_name: managerSnapshot.countryName ?? null,
        avatar_json: managerSnapshot.avatar ?? null,
      },
      { onConflict: 'hattrick_user_id' },
    );

    // Try to find existing team first
    const { data: existingTeam } = await supabase
      .from('teams')
      .select('id')
      .eq('ht_team_id', selectedTeam.teamId)
      .is('tournament_id', null)
      .maybeSingle();

    let teamRec;
    if (existingTeam) {
      const { data, error: teamErr } = await supabase
        .from('teams')
        .update({
          name: selectedTeam.teamName,
          ht_team_name: selectedTeam.teamName,
          hattrick_user_id: targetManagerId,
          manager_name: managerSnapshot.managerName,
          country_name: teamDetails.countryName ?? selectedTeam.countryName ?? managerSnapshot.countryName ?? null,
          country_id: teamDetails.countryId ?? managerSnapshot.countryId ?? null,
          league_id: selectedTeam.leagueId ?? null,
          gender_id: teamDetails.genderId ?? selectedTeam.genderId ?? 1,
          fanclub_size: teamDetails.fanclubSize ?? null,
          arena_id: teamDetails.arenaId ?? null,
          arena_size: finalArenaDetails?.capacity ?? null,
          arena_image_url: finalArenaDetails?.arenaImageUrl ?? null,
          availability_status: availability.availabilityStatus,
          availability_reason: availability.availabilityReason ?? null,
          active: true,
        })
        .eq('id', existingTeam.id)
        .select('id')
        .single();
      teamRec = data;
      if (teamErr) throw new Error(teamErr.message);
    } else {
      const { data, error: teamErr } = await supabase
        .from('teams')
        .insert({
          ht_team_id: selectedTeam.teamId,
          name: selectedTeam.teamName,
          ht_team_name: selectedTeam.teamName,
          hattrick_user_id: targetManagerId,
          manager_name: managerSnapshot.managerName,
          country_name: teamDetails.countryName ?? selectedTeam.countryName ?? managerSnapshot.countryName ?? null,
          country_id: teamDetails.countryId ?? managerSnapshot.countryId ?? null,
          league_id: selectedTeam.leagueId ?? null,
          gender_id: teamDetails.genderId ?? selectedTeam.genderId ?? 1,
          fanclub_size: teamDetails.fanclubSize ?? null,
          arena_id: teamDetails.arenaId ?? null,
          arena_size: finalArenaDetails?.capacity ?? null,
          arena_image_url: finalArenaDetails?.arenaImageUrl ?? null,
          availability_status: availability.availabilityStatus,
          availability_reason: availability.availabilityReason ?? null,
          active: true,
          tournament_id: null,
        })
        .select('id')
        .single();
      teamRec = data;
      if (teamErr) throw new Error(teamErr.message);
    }

    // 5. Create Request
    const { data: request, error: requestErr } = await supabase
      .from('matchmaker_requests')
      .insert({
        manager_ht_id: targetManagerId,
        team_id: teamRec.id,
        match_type: matchType ?? '120min',
        opponent_location: opponentLocation ?? 'any',
        home_away: homeAway ?? 'any',
        message: message ?? null,
        is_back_and_forth: !!isBackAndForth,
        is_long_term: !!isLongTerm,
        gender_id: teamDetails.genderId ?? selectedTeam.genderId ?? 1,
        expires_at: calculateMatchmakerExpiry().toISOString(),
        created_by_admin: true,
        status: 'open',
      })
      .select()
      .single();

    if (requestErr) throw new Error(requestErr.message);

    return res.status(200).json({
      success: true,
      message: `Realistic ad created for ${managerSnapshot.managerName} (${selectedTeam.teamName})`,
      request,
    });
  } catch (error: unknown) {
    console.error('Admin Create Error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Internal Server Error' });
  }
}
