import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';
import {
  ensureActorTeamRow,
  getOpenAdForAction,
  insertMatchmakerActivity,
} from '../_lib/matchmaker-activity.js';
import { fetchManagerTeamsFromChpp, getManagerChppCredentials } from '../_lib/matchmaker.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { managerId, adId, actorTeamId, comment } = req.body ?? {};
  const parsedManagerId = Number(managerId);
  const parsedActorTeamId = actorTeamId ? Number(actorTeamId) : null;

  if (!Number.isFinite(parsedManagerId) || !adId || typeof adId !== 'string') {
    return res.status(400).json({ error: 'Missing managerId or adId' });
  }

  const trimmedComment = typeof comment === 'string' ? comment.trim() : '';
  if (!trimmedComment) {
    return res.status(400).json({ error: 'Please add a short comment with your interest.' });
  }

  try {
    const supabase = getSupabase();
    const ad = await getOpenAdForAction(supabase, adId);

    if (ad.manager_ht_id === parsedManagerId) {
      return res.status(400).json({ error: 'You cannot show interest on your own advertisement.' });
    }

    const credentials = await getManagerChppCredentials(supabase, parsedManagerId);
    if (!credentials) {
      return res.status(401).json({
        error: 'CHPP authorization not found. Please sign in with Hattrick again.',
      });
    }

    let actorTeamName = credentials.manager_name;
    let actorTeamDbId: string | null = null;

    if (parsedActorTeamId && Number.isFinite(parsedActorTeamId)) {
      const consumerKey = process.env.CHPP_CONSUMER_KEY;
      const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
      if (!consumerKey || !consumerSecret) {
        return res.status(500).json({ error: 'CHPP config missing' });
      }

      const snapshot = await fetchManagerTeamsFromChpp(consumerKey, consumerSecret, credentials);
      const actorTeam = snapshot.teams.find((team) => team.teamId === parsedActorTeamId);

      if (!actorTeam) {
        return res.status(403).json({ error: 'This team is not part of your current Hattrick clubs.' });
      }

      actorTeamName = actorTeam.teamName;
      actorTeamDbId = await ensureActorTeamRow(supabase, {
        htTeamId: parsedActorTeamId,
        teamName: actorTeam.teamName,
        managerId: parsedManagerId,
        managerName: credentials.manager_name,
      });
    }

    const activity = await insertMatchmakerActivity(supabase, {
      adId,
      actorUserId: parsedManagerId,
      actorTeamId: actorTeamDbId,
      actorTeamName,
      type: 'interest_shown',
      comment: trimmedComment,
      metadata: {
        opponentHtTeamId: ad.team!.ht_team_id,
      },
    });

    return res.status(200).json({
      success: true,
      activity,
      message: 'Interest recorded. The advertisement owner will see it on HT-120min.',
    });
  } catch (error) {
    console.error('Matchmaker show-interest error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Could not record interest right now.',
    });
  }
}
