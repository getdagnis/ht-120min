import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';
import {
  fetchTeamDetailsFromChpp,
  fetchArenaDetailsFromChpp,
  getManagerChppCredentials,
} from '../_lib/matchmaker.js';

/**
 * Backfill script to fetch missing logos and arena images for teams.
 * This is meant to be called manually or via a cron/background process.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Simple protection: only allow if VITE_MATCHMAKER_DEV_MODE is true or secret header
  const isDev = process.env.VITE_MATCHMAKER_DEV_MODE === 'true';
  const authHeader = req.headers['x-backfill-secret'];
  
  if (!isDev && authHeader !== process.env.BACKFILL_SECRET) {
    return res.status(401).json({ error: 'Unauthorized backfill request' });
  }

  try {
    const supabase = getSupabase();
    const consumerKey = process.env.CHPP_CONSUMER_KEY;
    const consumerSecret = process.env.CHPP_CONSUMER_SECRET;

    if (!consumerKey || !consumerSecret) {
      return res.status(500).json({ error: 'CHPP config missing' });
    }

    const targetUserIds = [12306434, 13304362, 1315661, 11419808, 11963511, 13181044, 1123755, 712393, 713120, 711686, 13613923, 5798176, 13673513, 186307, 11120196];
    const adminManagerId = 8777402; // Using admin's credentials

    // 1. Find teams belonging to the target seeded users
    const { data: teams, error: fetchError } = await supabase
      .from('teams')
      .select('id, ht_team_id, hattrick_user_id, logo_url, arena_image_url, arena_id')
      .in('hattrick_user_id', targetUserIds);

    if (fetchError) throw fetchError;
    if (!teams || teams.length === 0) {
      return res.status(200).json({ message: 'No teams need backfill at the moment.' });
    }

    const results = [];
    
    // Get admin credentials
    const credentials = await getManagerChppCredentials(supabase, adminManagerId);
    if (!credentials) {
      return res.status(401).json({ error: 'Admin CHPP credentials not found' });
    }

    for (const team of teams) {
      try {
        let logoUrl = team.logo_url;
        let arenaImageUrl = team.arena_image_url;
        let arenaId = team.arena_id;

        // Fetch team details
        const details = await fetchTeamDetailsFromChpp(consumerKey, consumerSecret, credentials, team.ht_team_id);
        logoUrl = logoUrl || details.logoUrl;
        arenaId = arenaId || details.arenaId;

        // Fetch arena details
        if (arenaId) {
          const arena = await fetchArenaDetailsFromChpp(consumerKey, consumerSecret, credentials, arenaId);
          arenaImageUrl = arenaImageUrl || arena.arenaImageUrl;
        }

        // Update DB
        const { error: updateError } = await supabase
          .from('teams')
          .update({
            logo_url: logoUrl,
            arena_image_url: arenaImageUrl,
            arena_id: arenaId,
          })
          .eq('id', team.id);

        if (updateError) throw updateError;

        results.push({ id: team.id, status: 'success', ht_team_id: team.ht_team_id });
      } catch (err) {
        console.error(`Error backfilling team ${team.id}:`, err);
        results.push({ id: team.id, status: 'error', reason: err instanceof Error ? err.message : String(err) });
      }
    }

    return res.status(200).json({ results });
  } catch (error) {
    console.error('Backfill error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}
