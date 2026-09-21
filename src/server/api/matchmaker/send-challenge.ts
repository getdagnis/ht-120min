import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';
import {
  mapAdHomeAwayToChppMatchPlace,
  mapAdMatchTypeToChpp,
  sendChppChallenge,
} from '../_lib/chpp-challenges.js';
import {
  ensureActorTeamRow,
  getOpenAdForAction,
  insertMatchmakerActivity,
} from '../_lib/matchmaker-activity.js';
import {
  fetchManagerTeamsFromChpp,
  fetchTeamBookingStatus,
  getManagerChppCredentials,
} from '../_lib/matchmaker.js';

const logChallengeTrace = (step: string, details: Record<string, unknown>) => {
  if (process.env.NODE_ENV === 'production' && process.env.CHPP_DEBUG !== 'true') return;
  console.log(`[Matchmaker challenge] ${step}`, details);
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { managerId, adId, actorTeamId, comment } = req.body ?? {};
  const parsedManagerId = Number(managerId);
  const parsedActorTeamId = Number(actorTeamId);

  logChallengeTrace('received browser request', {
    managerId: parsedManagerId,
    adId,
    actorTeamId: parsedActorTeamId,
    hasComment: typeof comment === 'string' && comment.trim().length > 0,
  });

  if (!Number.isFinite(parsedManagerId) || !adId || typeof adId !== 'string') {
    return res.status(400).json({ error: 'Missing managerId or adId' });
  }

  if (!Number.isFinite(parsedActorTeamId)) {
    return res.status(400).json({ error: 'Missing actorTeamId' });
  }

  try {
    const supabase = getSupabase();
    const ad = await getOpenAdForAction(supabase, adId);
    logChallengeTrace('loaded advertised team', {
      adId: ad.id,
      advertisedManagerId: ad.manager_ht_id,
      opponentTeamId: ad.team?.ht_team_id,
      isLongTerm: ad.is_long_term,
      matchType: ad.match_type,
      homeAway: ad.home_away,
    });

    if (ad.manager_ht_id === parsedManagerId) {
      return res.status(400).json({ error: 'You cannot challenge your own advertisement.' });
    }

    if (ad.team!.ht_team_id === parsedActorTeamId) {
      return res.status(400).json({ error: 'You cannot challenge yourself.' });
    }

    const credentials = await getManagerChppCredentials(supabase, parsedManagerId);
    logChallengeTrace('resolved manager CHPP credentials', {
      managerId: parsedManagerId,
      found: Boolean(credentials),
    });
    if (!credentials) {
      return res.status(401).json({
        error: 'CHPP authorization not found. Please sign in with Hattrick again.',
      });
    }

    const consumerKey = process.env.CHPP_CONSUMER_KEY;
    const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
    if (!consumerKey || !consumerSecret) {
      return res.status(500).json({ error: 'CHPP config missing' });
    }

    const snapshot = await fetchManagerTeamsFromChpp(consumerKey, consumerSecret, credentials);
    const actorTeam = snapshot.teams.find((team) => team.teamId === parsedActorTeamId);
    logChallengeTrace('verified selected Hattrick team ownership', {
      managerId: parsedManagerId,
      selectedActorTeamId: parsedActorTeamId,
      ownedTeamCount: snapshot.teams.length,
      selectedTeamFound: Boolean(actorTeam),
    });

    if (!actorTeam) {
      return res.status(403).json({ error: 'This team is not part of your current Hattrick clubs.' });
    }

    if (!ad.is_long_term) {
      try {
        const booking = await fetchTeamBookingStatus(
          consumerKey,
          consumerSecret,
          credentials,
          parsedActorTeamId,
        );
        if (booking.isBooked) {
          return res.status(409).json({
            error: 'Your team already has a booked friendly this week.',
          });
        }
      } catch (bookingError) {
        console.warn('Booking check failed before challenge:', bookingError);
      }
    } else {
      logChallengeTrace('skipped local booking precheck for long-term ad', {
        actorTeamId: parsedActorTeamId,
        reason: 'The established flow defers availability validation to CHPP for long-term ads.',
      });
    }

    const chppMatchType = mapAdMatchTypeToChpp(ad.match_type);
    const chppMatchPlace = mapAdHomeAwayToChppMatchPlace(ad.home_away);
    logChallengeTrace('sending CHPP challenge request', {
      actorTeamId: parsedActorTeamId,
      opponentTeamId: ad.team!.ht_team_id,
      matchType: chppMatchType,
      matchPlace: chppMatchPlace,
    });

    const challengeResult = await sendChppChallenge({
      consumerKey,
      consumerSecret,
      oauthToken: credentials.oauth_token,
      oauthTokenSecret: credentials.oauth_token_secret,
      teamId: parsedActorTeamId,
      opponentTeamId: ad.team!.ht_team_id,
      matchType: chppMatchType,
      matchPlace: chppMatchPlace,
    });

    logChallengeTrace('received CHPP challenge response', {
      success: challengeResult.success,
      errorCode: challengeResult.errorCode,
      errorMessage: challengeResult.errorMessage,
      trainingMatchId: challengeResult.trainingMatchId,
      challengeable: challengeResult.challengeable,
      skippedChallengeableCheck: challengeResult.skippedChallengeableCheck,
    });

    if (!challengeResult.success) {
      const status = challengeResult.errorCode ? 502 : 502;
      const message =
        challengeResult.errorMessage ||
        'Hattrick could not send the challenge. Use /api/testing/challenge-send to inspect raw CHPP XML.';

      return res.status(status).json({
        error: message,
        errorCode: challengeResult.errorCode,
        requestUrl: challengeResult.requestUrl,
        skippedChallengeableCheck: challengeResult.skippedChallengeableCheck,
        challengeable: challengeResult.challengeable,
        testingHint:
          process.env.NODE_ENV !== 'production'
            ? `/api/testing/challenge-send?managerId=${parsedManagerId}&teamId=${parsedActorTeamId}&opponentTeamId=${ad.team!.ht_team_id}&confirm=1`
            : undefined,
      });
    }

    const actorTeamDbId = await ensureActorTeamRow(supabase, {
      htTeamId: parsedActorTeamId,
      teamName: actorTeam.teamName,
      managerId: parsedManagerId,
      managerName: credentials.manager_name,
    });

    const activity = await insertMatchmakerActivity(supabase, {
      adId,
      actorUserId: parsedManagerId,
      actorTeamId: actorTeamDbId,
      actorTeamName: actorTeam.teamName,
      type: 'challenge_sent',
      comment: typeof comment === 'string' ? comment : null,
      metadata: {
        trainingMatchId: challengeResult.trainingMatchId,
        chppMatchType,
        matchPlace: chppMatchPlace,
        opponentHtTeamId: ad.team!.ht_team_id,
      },
    });

    logChallengeTrace('recorded successful challenge activity', {
      adId,
      actorTeamId: parsedActorTeamId,
      trainingMatchId: challengeResult.trainingMatchId,
    });

    return res.status(200).json({
      success: true,
      trainingMatchId: challengeResult.trainingMatchId,
      activity,
      message:
        'Challenge sent successfully. The advertisement owner will see that it originated from HT-120min.',
    });
  } catch (error) {
    logChallengeTrace('handler failed before a successful challenge response', {
      message: error instanceof Error ? error.message : String(error),
    });
    console.error('Matchmaker send-challenge error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Could not send challenge right now.',
    });
  }
}
