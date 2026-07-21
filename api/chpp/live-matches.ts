import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';
import { getAuthHeader } from '../_lib/chpp-auth.js';
import { readChppTag } from '../_lib/chpp-xml.js';
import {
  getPenaltyShootoutScore,
  mapMatchEventDetailsToFixture,
  parseMatchEventDetails,
  summarizeMatchEventDetails,
} from '../_lib/chpp-match-events.js';
import { buildChppAppgUpdate } from '../_lib/appg-chpp-classifier.js';
import type { MatchEventDetails } from '../../shared/match-events.js';

interface LiveMatchResult {
  status: 'arranged' | 'ongoing' | 'finished';
  homeGoals: number;
  awayGoals: number;
  total_minutes?: number;
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

  if (!tournament_id || ids.length === 0) return res.status(400).json({ error: 'Missing params' });

  try {
    const supabase = getSupabase();
    const { data: tournament } = await supabase
      .from('tournaments')
      .select('scoring_mode')
      .eq('id', String(tournament_id))
      .single();
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

    const { data: team } = await supabase.from('teams').select('oauth_token, oauth_token_secret').not('oauth_token', 'is', null).limit(1).single();
    if (!team) return res.status(401).json({ error: 'No auth team' });

    // Fetch all tournament matches in one query so we can resolve home/away team ht_team_id
    const { data: tournamentMatches } = await supabase
      .from('matches')
      .select(`
        id,
        ht_match_id,
        appg_outcome_source,
        home_team:home_team_id ( ht_team_id ),
        away_team:away_team_id ( ht_team_id )
      `)
      .eq('tournament_id', String(tournament_id))
      .in('ht_match_id', ids.map((id) => parseInt(id, 10)));

    // Build a lookup: ht_match_id -> { scheduledHomeHtId, scheduledAwayHtId }
    const matchFixtureMap = new Map<
      number,
      {
        scheduledHomeHtId: number | null;
        scheduledAwayHtId: number | null;
        appgOutcomeSource: string | null;
      }
    >();
    if (tournamentMatches) {
      for (const m of tournamentMatches) {
        if (m.ht_match_id) {
          const homeTeam = m.home_team as { ht_team_id: number | null } | null;
          const awayTeam = m.away_team as { ht_team_id: number | null } | null;
          matchFixtureMap.set(m.ht_match_id, {
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
      const params = { file: 'matchdetails', version: '3.1', matchID: htMatchId, matchEvents: 'true' };
      const authHeader = getAuthHeader('GET', url, params, process.env.CHPP_CONSUMER_KEY!, process.env.CHPP_CONSUMER_SECRET!, team.oauth_token!, team.oauth_token_secret!);

      const response = await fetch(`${url}?file=matchdetails&version=3.1&matchEvents=true&matchID=${htMatchId}`, { headers: { Authorization: authHeader } });
      const xml = await response.text();

      const finishedDate = readChppTag(xml, 'FinishedDate');
      const finished = (finishedDate && finishedDate !== '0001-01-01 00:00:00') || xml.includes('<MatchStatus>2</MatchStatus>');
      const isOngoing = xml.includes('<MatchStatus>1</MatchStatus>');
      const status = finished ? 'finished' : isOngoing ? 'ongoing' : 'arranged';

      // For ongoing matches, use the live running score from the last scorer entry.
      // For finished matches, trust the official HomeGoals/AwayGoals result.
      const scorersBlock = xml.match(/<Scorers>([\s\S]*?)<\/Scorers>/i)?.[1] ?? '';
      const allGoals = [...scorersBlock.matchAll(/<Goal[^>]*>([\s\S]*?)<\/Goal>/gi)];
      const finalHomeGoals = parseInt(readChppTag(xml, 'HomeGoals') || '0', 10);
      const finalAwayGoals = parseInt(readChppTag(xml, 'AwayGoals') || '0', 10);
      let liveHomeGoals: number;
      let liveAwayGoals: number;
      if (allGoals.length > 0) {
        const lastGoal = allGoals[allGoals.length - 1][1];
        liveHomeGoals = parseInt(lastGoal.match(/<ScorerHomeGoals>(\d+)<\/ScorerHomeGoals>/i)?.[1] ?? '0', 10);
        liveAwayGoals = parseInt(lastGoal.match(/<ScorerAwayGoals>(\d+)<\/ScorerAwayGoals>/i)?.[1] ?? '0', 10);
      } else {
        // No goals scored yet (0-0), fall back to team block fields
        liveHomeGoals = finalHomeGoals;
        liveAwayGoals = finalAwayGoals;
      }

      // Actual team IDs from Hattrick MatchDetails
      const actualHtHomeTeamId =
        parseInt(xml.match(/<HomeTeam>[\s\S]*?<HomeTeamID>(\d+)<\/HomeTeamID>/i)?.[1] || '0', 10) || null;
      const actualHtAwayTeamId =
        parseInt(xml.match(/<AwayTeam>[\s\S]*?<AwayTeamID>(\d+)<\/AwayTeamID>/i)?.[1] || '0', 10) || null;

      const addedMinutes = parseInt(readChppTag(xml, 'AddedMinutes') || '0', 10);

      // Robust extra-time detection: Check EventList for Part 3/4
      const isExtraTime = xml.includes('<MatchPart>3</MatchPart>') || xml.includes('<MatchPart>4</MatchPart>');

      const baseMinutes = isExtraTime ? 120 : 90;
      const totalMinutes = baseMinutes + addedMinutes;
      const actualEventDetails = parseMatchEventDetails(xml);

      // Map actual Hattrick goals back to the scheduled fixture perspective.
      // Manual links may intentionally include only one scheduled team, such as
      // a BYE outside-friendly or an admin-approved replacement match.
      const htMatchIdNum = parseInt(htMatchId, 10);
      const fixture = matchFixtureMap.get(htMatchIdNum);
      let venueMismatch = false;
      let homeGoals = finished ? finalHomeGoals : liveHomeGoals;
      let awayGoals = finished ? finalAwayGoals : liveAwayGoals;

      if (fixture && actualHtHomeTeamId !== null && actualHtAwayTeamId !== null) {
        const actualHomeGoals = finished ? finalHomeGoals : liveHomeGoals;
        const actualAwayGoals = finished ? finalAwayGoals : liveAwayGoals;
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
      const appgUpdate = buildChppAppgUpdate({
        scoringMode: tournament.scoring_mode,
        currentSource: fixture?.appgOutcomeSource,
        completed: finished,
        homeGoals: finished ? homeGoals : null,
        awayGoals: finished ? awayGoals : null,
        went120: isExtraTime,
        totalMinutes,
        penaltyShootoutHomeGoals: penaltyShootout.home,
        penaltyShootoutAwayGoals: penaltyShootout.away,
        eventDetails,
      });

      results[htMatchId] = {
        status,
        homeGoals,
        awayGoals,
        total_minutes: totalMinutes,
        went_120: isExtraTime,
        venue_mismatch: venueMismatch,
        penalty_shootout_home_goals: penaltyShootout.home,
        penalty_shootout_away_goals: penaltyShootout.away,
        ...appgUpdate,
        home_yellow_cards: eventSummary.home_yellow_cards,
        home_red_cards: eventSummary.home_red_cards,
        home_injuries: eventSummary.home_injuries,
        away_yellow_cards: eventSummary.away_yellow_cards,
        away_red_cards: eventSummary.away_red_cards,
        away_injuries: eventSummary.away_injuries,
        match_event_details: eventDetails,
      };

      await supabase.from('matches').update({
        home_goals: status === 'arranged' ? null : homeGoals,
        away_goals: status === 'arranged' ? null : awayGoals,
        completed: finished,
        status,
        total_minutes: totalMinutes,
        went_120: isExtraTime,
        venue_mismatch: venueMismatch,
        penalty_shootout_home_goals: penaltyShootout.home,
        penalty_shootout_away_goals: penaltyShootout.away,
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
        .eq('tournament_id', String(tournament_id))
        .eq('ht_match_id', htMatchIdNum);
    }
    return res.status(200).json({ results });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
}
