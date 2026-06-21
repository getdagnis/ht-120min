import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';
import { fetchTeamDetailsFromChpp, getManagerChppCredentials } from '../_lib/matchmaker.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { teamId, managerId } = req.query;

  if (!teamId || Array.isArray(teamId)) {
    return res.status(400).json({ error: 'Missing teamId' });
  }

  if (!managerId || Array.isArray(managerId)) {
    return res.status(400).json({ error: 'Missing managerId' });
  }

  try {
    const supabase = getSupabase();
    const managerCredentials = await getManagerChppCredentials(supabase, Number(managerId));

    if (!managerCredentials) {
      return res.status(401).json({
        error: 'CHPP authorization not found for this manager. Please sign in with CHPP again.',
      });
    }

    const consumerKey = process.env.CHPP_CONSUMER_KEY!;
    const consumerSecret = process.env.CHPP_CONSUMER_SECRET!;
    const details = await fetchTeamDetailsFromChpp(consumerKey, consumerSecret, managerCredentials, Number(teamId));

    return res.status(200).json({
      isBooked: (details.friendlyTeamId ?? 0) > 0,
      match: null,
    });
  } catch (error: unknown) {
    console.error('Booking status error:', error);
    return res.status(503).json({
      error:
        error instanceof Error ? error.message : 'Could not verify whether this team already has a booked friendly.',
    });
  }
}
