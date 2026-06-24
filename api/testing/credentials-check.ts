import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchManagerTeamsFromChpp, getManagerChppCredentials } from '../_lib/matchmaker.js';
import { getSupabase } from '../_lib/supabase.js';
import { rejectIfTestingDisabled } from './_lib/guard.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (rejectIfTestingDisabled(res)) return;

  const managerId = Number(req.query.managerId);
  if (!Number.isFinite(managerId)) {
    return res.status(400).json({ error: 'Missing managerId' });
  }

  const supabase = getSupabase();
  const credentials = await getManagerChppCredentials(supabase, managerId);

  if (!credentials) {
    return res.status(404).json({
      managerId,
      hasCredentials: false,
      message: 'No oauth_token/oauth_token_secret found. Log in via /api/auth/init.',
    });
  }

  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  let teams: Array<{ teamId: number; teamName: string }> = [];

  if (consumerKey && consumerSecret) {
    try {
      const snapshot = await fetchManagerTeamsFromChpp(consumerKey, consumerSecret, credentials, managerId);
      teams = snapshot.teams.map((team) => ({ teamId: team.teamId, teamName: team.teamName }));
    } catch {
      teams = [];
    }
  }

  return res.status(200).json({
    managerId,
    hasCredentials: true,
    managerName: credentials.manager_name,
    tokenPreview: `${credentials.oauth_token.slice(0, 6)}…`,
    teamsJsonCount: credentials.teams_json?.length ?? 0,
    teamsFromChpp: teams,
    chppConfigured: !!(consumerKey && consumerSecret),
  });
}
