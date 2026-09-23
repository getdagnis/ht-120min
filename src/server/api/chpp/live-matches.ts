import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase } from '../_lib/supabase.js';
import { getAuthHeader } from '../_lib/chpp-auth.js';
import { readChppTag } from '../_lib/chpp-xml.js';
import {
  advanceMatchStatus,
  readLiveMatch,
  readMatchDetailsState,
  shouldFetchMatchDetailsAfterLive,
} from '../_lib/chpp-live-state.js';
import {
  getFootballScore,
  getPenaltyShootoutScore,
  mapMatchEventDetailsToFixture,
  parseMatchEventDetails,
  summarizeMatchEventDetails,
} from '../_lib/chpp-match-events.js';
import { buildChppAppgUpdate } from '../_lib/appg-chpp-classifier.js';
import type { MatchEventDetails } from '../../../../shared/match-events.js';
import type { LiveMatchClock } from '../../../../shared/live-match.js';

interface LiveMatchResult extends LiveMatchClock {
  status: 'arranged' | 'ongoing' | 'finished';
  homeGoals: number;
  awayGoals: number;
  total_minutes?: number | null;
  went_120?: boolean;
  venue_mismatch?: boolean;
  penalty_shootout_home_goals?: number | null;
  penalty_shootout_away_goals?: number | null;
  home_yellow_cards?: number;
  home_red_cards?: number;
  home_injuries?: number;
  away_yellow_cards?: number;
  away_red_cards?: number;
  away_injuries?: number;
  appg_outcome?: 'ET3' | 'ET2' | 'PS1' | 'RT0' | 'OPW' | 'needs_review';
  appg_outcome_source?: 'unclassified' | 'chpp';
  match_event_details?: MatchEventDetails;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { tournament_id, match_ids } = req.query;
  const ids = Array.isArray(match_ids) ? match_ids : (match_ids as string)?.split(',') || [];

  if (!tournament_id || ids.length === 0 || ids.length > 30 || ids.some((id) => !/^\d+$/.test(id))) {
    return res.status(400).json({ error: 'Invalid match request' });
  }

  try {
    const supabase = getServiceSupabase();
    const { data: tournament } = await supabase
      .from('tournaments')
      .select('scoring_mode')
      .eq('id', String(tournament_id))
      .single();
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

    const { data: rounds, error: roundsError } = await supabase
      .from('rounds').select('id').eq('tournament_id', String(tournament_id));
    if (roundsError) throw roundsError;
    if (!rounds?.length) return res.status(200).json({ results: {} });

    const { data: tournamentMatches, error: matchesError } = await supabase
      .from('matches')
      .select(`
        id, ht_match_id, status, completed, home_goals, away_goals, appg_outcome_source,
        home_team:home_team_id ( ht_team_id, oauth_token, oauth_token_secret ),
        away_team:away_team_id ( ht_team_id, oauth_token, oauth_token_secret )
      `)
      .in('round_id', rounds.map((round) => round.id))
      .in('ht_match_id', ids.map((id) => parseInt(id, 10)));
    if (matchesError) throw matchesError;

    // Build a lookup: ht_match_id -> { scheduledHomeHtId, scheduledAwayHtId }
    const matchFixtureMap = new Map<
      number,
      {
        scheduledHomeHtId: number | null;
        scheduledAwayHtId: number | null;
        appgOutcomeSource: string | null;
        id: string;
        status: 'arranged' | 'ongoing' | 'finished';
        completed: boolean;
        homeGoals: number | null;
        awayGoals: number | null;
        oauthToken: string | null;
        oauthTokenSecret: string | null;
      }
    >();
    if (tournamentMatches) {
      for (const m of tournamentMatches) {
        if (m.ht_match_id) {
          const homeTeam = m.home_team as { ht_team_id: number | null; oauth_token: string | null; oauth_token_secret: string | null } | null;
          const awayTeam = m.away_team as { ht_team_id: number | null; oauth_token: string | null; oauth_token_secret: string | null } | null;
          matchFixtureMap.set(m.ht_match_id, {
            id: m.id,
            status: m.status === 'finished' || m.completed ? 'finished' : m.status === 'ongoing' ? 'ongoing' : 'arranged',
            completed: m.completed,
            homeGoals: m.home_goals,
            awayGoals: m.away_goals,
            oauthToken: homeTeam?.oauth_token || awayTeam?.oauth_token || null,
            oauthTokenSecret: homeTeam?.oauth_token_secret || awayTeam?.oauth_token_secret || null,
            scheduledHomeHtId: homeTeam?.ht_team_id ?? null,
            scheduledAwayHtId: awayTeam?.ht_team_id ?? null,
            appgOutcomeSource: m.appg_outcome_source ?? null,
          });
        }
      }
    }

    const url = 'https://chpp.hattrick.org/chppxml.ashx';
    const results: Record<string, LiveMatchResult> = {};
    for (const htMatchId of ids) {
      const htMatchIdNum = parseInt(htMatchId, 10);
      const fixture = matchFixtureMap.get(htMatchIdNum);
      if (!fixture?.oauthToken || !fixture.oauthTokenSecret) continue;
      let live = null;
      if (fixture.status !== 'finished') {
        const liveParams = { file: 'live', version: '2.3', actionType: 'view', matchID: htMatchId };
        const liveAuth = getAuthHeader('GET', url, liveParams, process.env.CHPP_CONSUMER_KEY!, process.env.CHPP_CONSUMER_SECRET!, fixture.oauthToken, fixture.oauthTokenSecret);
        const liveResponse = await fetch(`${url}?file=live&version=2.3&actionType=view&matchID=${htMatchId}`, { headers: { Authorization: liveAuth } });
        if (liveResponse.ok && liveResponse.headers.get('content-type')?.includes('xml')) {
          live = readLiveMatch(await liveResponse.text(), htMatchIdNum);
        }
      }

      let detailsXml: string | null = null;
      let detailsState: ReturnType<typeof readMatchDetailsState> = 'unknown';
      // A positive live.xml observation is sufficient proof of an ongoing
      // match. MatchDetails is reserved for a finished row or a live match
      // that has disappeared and needs final-result confirmation.
      if (shouldFetchMatchDetailsAfterLive(fixture.status, Boolean(live))) {
        const detailsParams = { file: 'matchdetails', version: '3.1', matchID: htMatchId, matchEvents: 'true' };
        const detailsAuth = getAuthHeader('GET', url, detailsParams, process.env.CHPP_CONSUMER_KEY!, process.env.CHPP_CONSUMER_SECRET!, fixture.oauthToken, fixture.oauthTokenSecret);
        const detailsResponse = await fetch(
          `${url}?file=matchdetails&version=3.1&matchEvents=true&matchID=${htMatchId}`,
          { headers: { Authorization: detailsAuth } },
        );
        const xml = await detailsResponse.text();
        if (detailsResponse.ok && detailsResponse.headers.get('content-type')?.includes('xml')) {
          detailsXml = xml;
          detailsState = readMatchDetailsState(xml, htMatchIdNum);
        }
      }

      const status = advanceMatchStatus(fixture.status, detailsState === 'finished' ? 'finished' : live ? 'ongoing' : detailsState);
      if (status === 'arranged' || (status === 'ongoing' && !live) ||
          (status === 'finished' && detailsState !== 'finished')) continue;
      const finished = status === 'finished';
      const sourceXml = finished ? detailsXml : live?.xml;
      if (!sourceXml) continue;

      const finalHomeGoals = parseInt(readChppTag(sourceXml, 'HomeGoals') || '0', 10);
      const finalAwayGoals = parseInt(readChppTag(sourceXml, 'AwayGoals') || '0', 10);

      // Actual team IDs from Hattrick MatchDetails
      const actualHtHomeTeamId =
        parseInt(sourceXml.match(/<HomeTeam>[\s\S]*?<HomeTeamID>(\d+)<\/HomeTeamID>/i)?.[1] || '0', 10) || null;
      const actualHtAwayTeamId =
        parseInt(sourceXml.match(/<AwayTeam>[\s\S]*?<AwayTeamID>(\d+)<\/AwayTeamID>/i)?.[1] || '0', 10) || null;

      const addedMinutes = parseInt(readChppTag(sourceXml, 'AddedMinutes') || '0', 10);

      // Robust extra-time detection: Check EventList for Part 3/4
      const isExtraTime = sourceXml.includes('<MatchPart>3</MatchPart>') || sourceXml.includes('<MatchPart>4</MatchPart>');

      const baseMinutes = isExtraTime ? 120 : 90;
      const totalMinutes = finished ? baseMinutes + addedMinutes : null;
      const actualEventDetails = parseMatchEventDetails(sourceXml);
      if (!finished) {
        actualEventDetails.source = 'live-2.3';
        delete actualEventDetails.result;
      }
      const footballScore = finished ? getFootballScore(actualEventDetails) : null;

      // Map actual Hattrick goals back to the scheduled fixture perspective.
      // Manual links may intentionally include only one scheduled team, such as
      // a BYE outside-friendly or an admin-approved replacement match.
      let venueMismatch = false;
      let homeGoals = footballScore?.home ?? (finished ? finalHomeGoals : live!.homeGoals);
      let awayGoals = footballScore?.away ?? (finished ? finalAwayGoals : live!.awayGoals);

      if (fixture && actualHtHomeTeamId !== null && actualHtAwayTeamId !== null) {
        const actualHomeGoals = footballScore?.home ?? (finished ? finalHomeGoals : live!.homeGoals);
        const actualAwayGoals = footballScore?.away ?? (finished ? finalAwayGoals : live!.awayGoals);
        const scheduledHomeMatchedActualHome = fixture.scheduledHomeHtId === actualHtHomeTeamId;
        const scheduledHomeMatchedActualAway = fixture.scheduledHomeHtId === actualHtAwayTeamId;
        const scheduledAwayMatchedActualHome = fixture.scheduledAwayHtId === actualHtHomeTeamId;
        const scheduledAwayMatchedActualAway = fixture.scheduledAwayHtId === actualHtAwayTeamId;

        if (scheduledHomeMatchedActualHome) {
          homeGoals = actualHomeGoals;
          awayGoals = actualAwayGoals;
        } else if (scheduledHomeMatchedActualAway) {
          homeGoals = actualAwayGoals;
          awayGoals = actualHomeGoals;
        } else if (scheduledAwayMatchedActualHome) {
          awayGoals = actualHomeGoals;
          homeGoals = actualAwayGoals;
        } else if (scheduledAwayMatchedActualAway) {
          awayGoals = actualAwayGoals;
          homeGoals = actualHomeGoals;
        }

        venueMismatch = Boolean(
          fixture.scheduledHomeHtId !== null &&
            fixture.scheduledAwayHtId !== null &&
            scheduledHomeMatchedActualAway &&
            scheduledAwayMatchedActualHome,
        );
      }

      const eventDetails = fixture
        ? mapMatchEventDetailsToFixture(
            actualEventDetails,
            fixture.scheduledHomeHtId,
            fixture.scheduledAwayHtId,
          )
        : actualEventDetails;
      const eventSummary = summarizeMatchEventDetails(eventDetails);
      const penaltyShootout = getPenaltyShootoutScore(eventDetails);
      const appgUpdate = finished ? buildChppAppgUpdate({
        scoringMode: tournament.scoring_mode,
        currentSource: fixture?.appgOutcomeSource,
        completed: finished,
        homeGoals: finished ? homeGoals : null,
        awayGoals: finished ? awayGoals : null,
        went120: isExtraTime,
        totalMinutes: totalMinutes!,
        penaltyShootoutHomeGoals: penaltyShootout.home,
        penaltyShootoutAwayGoals: penaltyShootout.away,
        eventDetails,
      }) : {};

      results[htMatchId] = {
        status,
        phase: finished ? null : live?.phase ?? null,
        matchPart: finished ? null : live?.matchPart ?? null,
        lastEventMinute: finished ? null : live?.lastEventMinute ?? null,
        nextEventMinute: finished ? null : live?.nextEventMinute ?? null,
        nextEventMatchPart: finished ? null : live?.nextEventMatchPart ?? null,
        announcedAddedMinutes: finished ? null : live?.announcedAddedMinutes ?? null,
        fetchedAt: finished ? null : live?.fetchedAt ?? null,
        homeGoals,
        awayGoals,
        total_minutes: totalMinutes,
        went_120: finished ? isExtraTime : false,
        venue_mismatch: venueMismatch,
        penalty_shootout_home_goals: finished ? penaltyShootout.home : null,
        penalty_shootout_away_goals: finished ? penaltyShootout.away : null,
        ...appgUpdate,
        home_yellow_cards: eventSummary.home_yellow_cards,
        home_red_cards: eventSummary.home_red_cards,
        home_injuries: eventSummary.home_injuries,
        away_yellow_cards: eventSummary.away_yellow_cards,
        away_red_cards: eventSummary.away_red_cards,
        away_injuries: eventSummary.away_injuries,
        match_event_details: eventDetails,
      };

      const update = supabase.from('matches').update({
        home_goals: homeGoals,
        away_goals: awayGoals,
        completed: finished,
        status,
        total_minutes: totalMinutes,
        went_120: finished ? isExtraTime : false,
        venue_mismatch: venueMismatch,
        penalty_shootout_home_goals: finished ? penaltyShootout.home : null,
        penalty_shootout_away_goals: finished ? penaltyShootout.away : null,
        ...appgUpdate,
        home_yellow_cards: eventSummary.home_yellow_cards,
        home_red_cards: eventSummary.home_red_cards,
        home_injuries: eventSummary.home_injuries,
        away_yellow_cards: eventSummary.away_yellow_cards,
        away_red_cards: eventSummary.away_red_cards,
        away_injuries: eventSummary.away_injuries,
        match_event_details: eventDetails,
        actual_ht_home_team_id: actualHtHomeTeamId,
        actual_ht_away_team_id: actualHtAwayTeamId,
      })
        .eq('id', fixture.id);
      const { error: updateError } = finished ? await update : await update.eq('completed', false);
      if (updateError) {
        // Older databases still exclude 'ongoing' from matches_status_check.
        // Keep the verified live response available until migration 070 is applied.
        if (!finished && updateError.code === '23514' && updateError.message.includes('matches_status_check')) {
          console.warn('[live-matches] ongoing state not persisted: apply migration 070');
        } else {
          throw updateError;
        }
      }
    }
    return res.status(200).json({ results });
  } catch (error) {
    const message = error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : 'Unknown error';
    console.error('[live-matches] poll failed:', message);
    return res.status(500).json({ error: 'Could not refresh live matches.' });
  }
}
