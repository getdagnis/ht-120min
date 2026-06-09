import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { selection_token } = req.query;

  if (!selection_token || typeof selection_token !== 'string') {
    return res.status(400).json({ error: 'Missing selection_token' });
  }

  try {
    const supabase = getSupabase();
    
    // Fetch pending join data
    const { data: pending, error } = await supabase
      .from('oauth_temp_sessions')
      .select('manager_name, teams_json, tournament_id')
      .eq('selection_token', selection_token)
      .single();

    if (error || !pending) {
      return res.status(404).json({ error: 'Session not found or expired' });
    }

    // Fetch tournament name if exists
    let tournamentName = null;
    if (pending.tournament_id) {
      const { data: tournament } = await supabase
        .from('tournaments')
        .select('name')
        .eq('id', pending.tournament_id)
        .single();
      tournamentName = tournament?.name;
    }

    return res.status(200).json({
      manager_name: pending.manager_name,
      teams: pending.teams_json,
      tournament_name: tournamentName,
      tournament_id: pending.tournament_id
    });
  } catch (error: unknown) {
    console.error('Pending Join Fetch Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
