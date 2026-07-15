import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';
import { getAuthHeader } from '../_lib/chpp-auth.js';
import { readChppTag } from '../_lib/chpp-xml.js';

interface LiveMatchResult {
  status: 'ongoing' | 'finished';
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
}

const PENALTY_GOAL_EVENT_TYPES = new Set([55, 56, 57]);
const YELLOW_CARD_EVENT_TYPES = new Set([510, 511]);
const RED_CARD_EVENT_TYPES = new Set([512, 513, 514]);

function getEventTypeId(eventXml: string): number | null {
  const eventTypeId = eventXml.match(/<EventTypeID>(\d+)<\/EventTypeID>/i)?.[1];
  if (eventTypeId) return parseInt(eventTypeId, 10);

  const eventKey = eventXml.match(/<EventKey>(\d+)(?:_\d+)?<\/EventKey>/i)?.[1];
  if (eventKey) return parseInt(eventKey, 10);

  return null;
}

function parseScoreBeforeShootout(xml: string, homeTeamId: number | null, awayTeamId: number | null) {
  if (!homeTeamId || !awayTeamId) {
    return { homeGoals: null, awayGoals: null, hasShootout: false };
  }

  const eventBlocks = xml.match(/<Event(?:\s[^>]*)?>[\s\S]*?<\/Event>/gi) ?? [];
  const hasShootout = eventBlocks.some((eventXml) => {
    const eventTypeId = getEventTypeId(eventXml);
    return Boolean(eventTypeId && PENALTY_GOAL_EVENT_TYPES.has(eventTypeId));
  });

  if (!hasShootout) {
    return { homeGoals: null, awayGoals: null, hasShootout: false };
  }

  const scorersBlock = xml.match(/<Scorers>([\s\S]*?)<\/Scorers>/i)?.[1] ?? '';
  const allGoals = [...scorersBlock.matchAll(/<Goal[^>]*>([\s\S]*?)<\/Goal>/gi)];
  if (allGoals.length === 0) {
    return { homeGoals: 0, awayGoals: 0, hasShootout: true };
  }

  const lastGoal = allGoals[allGoals.length - 1][1];
  return {
    homeGoals: parseInt(lastGoal.match(/<ScorerHomeGoals>(\d+)<\/ScorerHomeGoals>/i)?.[1] ?? '0', 10),
    awayGoals: parseInt(lastGoal.match(/<ScorerAwayGoals>(\d+)<\/ScorerAwayGoals>/i)?.[1] ?? '0', 10),
    hasShootout: true,
  };
}

function parseMatchEventSummary(xml: string, homeTeamId: number | null, awayTeamId: number | null) {
  const summary = {
    home_yellow_cards: 0,
    home_red_cards: 0,
    home_injuries: 0,
    away_yellow_cards: 0,
    away_red_cards: 0,
    away_injuries: 0,
  };

  if (!homeTeamId || !awayTeamId) return summary;

  const teamPlayers = new Map<number, Map<number, { yellowCards: number; redCards: number }>>();
  const teamInjuries = new Map<number, Array<{ playerId: number | null }>>();

  const ensurePlayer = (teamId: number, playerId: number) => {
    let players = teamPlayers.get(teamId);
    if (!players) {
      players = new Map();
      teamPlayers.set(teamId, players);
    }

    let player = players.get(playerId);
    if (!player) {
      player = { yellowCards: 0, redCards: 0 };
      players.set(playerId, player);
    }

    return player;
  };

  const ensureInjuryList = (teamId: number) => {
    let injuries = teamInjuries.get(teamId);
    if (!injuries) {
      injuries = [];
      teamInjuries.set(teamId, injuries);
    }
    return injuries;
  };

  const injuryBlocks = xml.match(/<Injuries>([\s\S]*?)<\/Injuries>/i)?.[1] ?? '';
  const parsedInjuries = [...injuryBlocks.matchAll(/<Injury(?:\s[^>]*)?>[\s\S]*?<\/Injury>/gi)];
  for (const injuryXml of parsedInjuries) {
    const teamId = parseInt(injuryXml[0].match(/<InjuryTeamID>(\d+)<\/InjuryTeamID>/i)?.[1] ?? '0', 10) || null;
    const injuryType = parseInt(injuryXml[0].match(/<InjuryType>(\d+)<\/InjuryType>/i)?.[1] ?? '0', 10) || null;
    const playerId = parseInt(injuryXml[0].match(/<InjuryPlayerID>(\d+)<\/InjuryPlayerID>/i)?.[1] ?? '0', 10) || null;
    if (!teamId || (teamId !== homeTeamId && teamId !== awayTeamId)) continue;
    if (injuryType !== 2) continue;
    ensureInjuryList(teamId).push({ playerId });
  }

  const eventBlocks = xml.match(/<Event(?:\s[^>]*)?>[\s\S]*?<\/Event>/gi) ?? [];
  for (const eventXml of eventBlocks) {
    const eventTypeId = getEventTypeId(eventXml);
    const subjectTeamId = parseInt(eventXml.match(/<SubjectTeamID>(\d+)<\/SubjectTeamID>/i)?.[1] ?? '0', 10) || null;
    if (!eventTypeId || !subjectTeamId) continue;

    if (subjectTeamId !== homeTeamId && subjectTeamId !== awayTeamId) continue;

    if (YELLOW_CARD_EVENT_TYPES.has(eventTypeId) || RED_CARD_EVENT_TYPES.has(eventTypeId)) {
      const playerId = parseInt(eventXml.match(/<SubjectPlayerID>(\d+)<\/SubjectPlayerID>/i)?.[1] ?? '0', 10) || null;
      if (!playerId) continue;

      const player = ensurePlayer(subjectTeamId, playerId);
      if (YELLOW_CARD_EVENT_TYPES.has(eventTypeId)) {
        player.yellowCards += 1;
      } else {
        player.redCards += 1;
      }
    }
  }

  for (const [teamId, players] of teamPlayers.entries()) {
    let yellowCards = 0;
    let redCards = 0;

    for (const player of players.values()) {
      if (player.redCards > 0) {
        redCards += 1;
      } else {
        yellowCards += player.yellowCards;
      }
    }

    const injuries = teamInjuries.get(teamId) || [];

    if (teamId === homeTeamId) {
      summary.home_yellow_cards = yellowCards;
      summary.home_red_cards = redCards;
      summary.home_injuries = injuries.length;
    } else if (teamId === awayTeamId) {
      summary.away_yellow_cards = yellowCards;
      summary.away_red_cards = redCards;
      summary.away_injuries = injuries.length;
    }
  }

  const homeInjuries = teamInjuries.get(homeTeamId) || [];
  const awayInjuries = teamInjuries.get(awayTeamId) || [];
  summary.home_injuries = homeInjuries.length;
  summary.away_injuries = awayInjuries.length;

  return summary;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { tournament_id, match_ids } = req.query;
  const ids = Array.isArray(match_ids) ? match_ids : (match_ids as string)?.split(',') || [];

  if (!tournament_id || ids.length === 0) return res.status(400).json({ error: 'Missing params' });

  try {
    const supabase = getSupabase();
    const { data: team } = await supabase.from('teams').select('oauth_token, oauth_token_secret').not('oauth_token', 'is', null).limit(1).single();
    if (!team) return res.status(401).json({ error: 'No auth team' });

    // Fetch all tournament matches in one query so we can resolve home/away team ht_team_id
    const { data: tournamentMatches } = await supabase
      .from('matches')
      .select(`
        id,
        ht_match_id,
        home_team:home_team_id ( ht_team_id ),
        away_team:away_team_id ( ht_team_id )
      `)
      .in('ht_match_id', ids.map((id) => parseInt(id, 10)));

    // Build a lookup: ht_match_id -> { scheduledHomeHtId, scheduledAwayHtId }
    const matchFixtureMap = new Map<
      number,
      { scheduledHomeHtId: number | null; scheduledAwayHtId: number | null }
    >();
    if (tournamentMatches) {
      for (const m of tournamentMatches) {
        if (m.ht_match_id) {
          const homeTeam = m.home_team as { ht_team_id: number | null } | null;
          const awayTeam = m.away_team as { ht_team_id: number | null } | null;
          matchFixtureMap.set(m.ht_match_id, {
            scheduledHomeHtId: homeTeam?.ht_team_id ?? null,
            scheduledAwayHtId: awayTeam?.ht_team_id ?? null,
          });
        }
      }
    }

    const url = 'https://chpp.hattrick.org/chppxml.ashx';
    const results: Record<string, LiveMatchResult> = {};
    for (const htMatchId of ids) {
      // Use version 3.0 to ensure EventList is returned
      const params = { file: 'matchdetails', version: '3.0', matchID: htMatchId, matchEvents: 'true' };
      const authHeader = getAuthHeader('GET', url, params, process.env.CHPP_CONSUMER_KEY!, process.env.CHPP_CONSUMER_SECRET!, team.oauth_token!, team.oauth_token_secret!);

      const response = await fetch(`${url}?file=matchdetails&version=3.0&matchEvents=true&matchID=${htMatchId}`, { headers: { Authorization: authHeader } });
      const xml = await response.text();

      const finishedDate = readChppTag(xml, 'FinishedDate');
      const finished = (finishedDate && finishedDate !== '0001-01-01 00:00:00') || xml.includes('<MatchStatus>2</MatchStatus>');

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
      const scoreBeforeShootout = parseScoreBeforeShootout(xml, actualHtHomeTeamId, actualHtAwayTeamId);
      const eventSummary = parseMatchEventSummary(xml, actualHtHomeTeamId, actualHtAwayTeamId);

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

      results[htMatchId] = {
        status: finished ? 'finished' : 'ongoing',
        homeGoals,
        awayGoals,
        total_minutes: totalMinutes,
        went_120: isExtraTime,
        venue_mismatch: venueMismatch,
        penalty_shootout_home_goals: scoreBeforeShootout.homeGoals,
        penalty_shootout_away_goals: scoreBeforeShootout.awayGoals,
        home_yellow_cards: eventSummary.home_yellow_cards,
        home_red_cards: eventSummary.home_red_cards,
        home_injuries: eventSummary.home_injuries,
        away_yellow_cards: eventSummary.away_yellow_cards,
        away_red_cards: eventSummary.away_red_cards,
        away_injuries: eventSummary.away_injuries,
      };

      await supabase.from('matches').update({
        home_goals: homeGoals,
        away_goals: awayGoals,
        completed: finished,
        status: finished ? 'finished' : 'ongoing',
        total_minutes: totalMinutes,
        went_120: isExtraTime,
        venue_mismatch: venueMismatch,
        penalty_shootout_home_goals: scoreBeforeShootout.homeGoals,
        penalty_shootout_away_goals: scoreBeforeShootout.awayGoals,
        home_yellow_cards: eventSummary.home_yellow_cards,
        home_red_cards: eventSummary.home_red_cards,
        home_injuries: eventSummary.home_injuries,
        away_yellow_cards: eventSummary.away_yellow_cards,
        away_red_cards: eventSummary.away_red_cards,
        away_injuries: eventSummary.away_injuries,
        actual_ht_home_team_id: actualHtHomeTeamId,
        actual_ht_away_team_id: actualHtAwayTeamId,
      }).eq('ht_match_id', htMatchIdNum);
    }
    return res.status(200).json({ results });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
}
