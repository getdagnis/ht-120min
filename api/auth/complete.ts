import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase';
import { registerOAuthTeam } from '../_lib/chpp-register';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { selection_token, team_id, team_name } = req.body;

  if (!selection_token || !team_id) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    const supabase = getSupabase();

    // 1. Get pending join data
    const { data: pending, error: pError } = await supabase
      .from('oauth_pending_joins')
      .select('*')
      .eq('selection_token', selection_token)
      .single();

    if (pError || !pending) {
      return res.status(404).json({ error: 'Selection session not found or expired' });
    }

    // 2. Register the specific team
    await registerOAuthTeam(supabase, {
      tournamentId: pending.tournament_id,
      team: {
        teamId: parseInt(team_id),
        teamName: team_name,
      },
      managerName: pending.manager_name,
      hattrickUserId: pending.hattrick_user_id,
      accessToken: pending.access_token,
      accessTokenSecret: pending.access_token_secret,
    });

    // 3. Get tournament slug for redirect
    const { data: tournament } = await supabase
      .from('tournaments')
      .select('slug')
      .eq('id', pending.tournament_id)
      .single();

    // 4. Cleanup
    await supabase.from('oauth_pending_joins').delete().eq('selection_token', selection_token);

    return res.status(200).json({ slug: tournament?.slug });
  } catch (error: unknown) {
    console.error('Auth Complete Handler Error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'An unknown error occurred' });
  }
}
