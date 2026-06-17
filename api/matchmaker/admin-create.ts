import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';
import {
  fetchManagerTeamsFromChpp,
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
  const isAdmin = req.cookies.issuperadmin === 'you bet' || process.env.DEV_MATCHMAKER_TEST_MODE === 'true';
  if (!isAdmin) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const {
    managerId,
    teamId,
    matchType,
    opponentLocation,
    homeAway,
    message,
    isBackAndForth,
    isLongTerm,
  } = req.body ?? {};

  const targetManagerId = Number(managerId);
  const targetTeamId = teamId ? Number(teamId) : null;

  if (!targetManagerId) {
    return res.status(400).json({ error: 'managerId is required' });
  }

  try {
    const supabase = getSupabase();
    
    // We use the admin's own credentials to fetch other managers' data
    // For simplicity in this admin tool, we'll pick the most recently active token in the DB
    const { data: adminToken } = await supabase
      .from('profiles')
      .select('oauth_token, oauth_token_secret')
      .not('oauth_token', 'is', null)
      .limit(1)
      .single();

    if (!adminToken) {
      return res.status(500).json({ error: 'No active CHPP session found to perform admin fetch' });
    }

    const consumerKey = process.env.CHPP_CONSUMER_KEY;
    const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
    if (!consumerKey || !consumerSecret) {
      return res.status(500).json({ error: 'CHPP config missing' });
    }

    const credentials = {
      oauth_token: adminToken.oauth_token,
      oauth_token_secret: adminToken.oauth_token_secret
    };

    // 1. Fetch Manager Snapshot
    const managerSnapshot = await fetchManagerTeamsFromChpp(consumerKey, consumerSecret, credentials, targetManagerId);
    
    if (!managerSnapshot.teams || managerSnapshot.teams.length === 0) {
      return res.status(404).json({ error: 'Target manager has no teams or not found' });
    }

    // 2. Select Team
    let selectedTeam = null;
    if (targetTeamId) {
      selectedTeam = managerSnapshot.teams.find(t => t.teamId === targetTeamId);
    } else if (managerSnapshot.teams.length === 1) {
      selectedTeam = managerSnapshot.teams[0];
    }

    if (!selectedTeam) {
      return res.status(400).json({ 
        error: 'Multiple teams found. Please specify teamId.',
        availableTeams: managerSnapshot.teams.map(t => ({ id: t.teamId, name: t.teamName }))
      });
    }

    // 3. Fetch Team & Arena Details
    const [teamDetails, arenaDetails] = await Promise.all([
      fetchTeamDetailsFromChpp(consumerKey, consumerSecret, credentials, selectedTeam.teamId),
      selectedTeam.leagueId ? null : null // Arena fetch needs arenaId from teamDetails
    ]);

    let finalArenaDetails = null;
    if (teamDetails.arenaId) {
      finalArenaDetails = await fetchArenaDetailsFromChpp(consumerKey, consumerSecret, credentials, teamDetails.arenaId);
    }

    // 4. Update Profile & Team (Caching snapshot)
    await supabase.from('profiles').upsert({
      hattrick_user_id: targetManagerId,
      manager_name: managerSnapshot.managerName,
      country_id: managerSnapshot.countryId ?? null,
      country_name: managerSnapshot.countryName ?? null,
      avatar_json: managerSnapshot.avatar ?? null,
    }, { onConflict: 'hattrick_user_id' });

    const { data: teamRec, error: teamErr } = await supabase.from('teams').upsert({
      ht_team_id: selectedTeam.teamId,
      name: selectedTeam.teamName,
      ht_team_name: selectedTeam.teamName,
      hattrick_user_id: targetManagerId,
      manager_name: managerSnapshot.managerName,
      country_name: selectedTeam.countryName ?? teamDetails.countryName ?? null,
      league_id: selectedTeam.leagueId ?? null,
      gender_id: teamDetails.genderId ?? selectedTeam.genderId ?? 1,
      fanclub_size: teamDetails.fanclubSize ?? null,
      arena_id: teamDetails.arenaId ?? null,
      arena_size: finalArenaDetails?.capacity ?? null,
      arena_image_url: finalArenaDetails?.arenaImageUrl ?? null,
      active: true,
    }, { onConflict: 'ht_team_id' }).select('id').single();

    if (teamErr || !teamRec) throw new Error(teamErr?.message || 'Failed to cache team');

    // 5. Create Request
    const { data: request, error: requestErr } = await supabase.from('matchmaker_requests').insert({
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
      status: 'open'
    }).select().single();

    if (requestErr) throw new Error(requestErr.message);

    return res.status(200).json({
      success: true,
      message: `Realistic ad created for ${managerSnapshot.managerName} (${selectedTeam.teamName})`,
      request
    });

  } catch (error: any) {
    console.error('Admin Create Error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
