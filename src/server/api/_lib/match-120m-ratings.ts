import type { SupabaseClient } from '@supabase/supabase-js';
import type { MatchEventDetails } from '../../../../shared/match-events.js';
import { calculateMatch120mRating, usesMatch120mRatings } from '../../../../shared/match-120m-rating.js';

type TeamRef = { id: string; ht_team_id: number | null };
const one = <T>(value: T | T[] | null): T | null => Array.isArray(value) ? value[0] ?? null : value;

/** Reads the saved match snapshot. No CHPP calls and no browser-supplied performance. */
export async function prepareMatch120mRatings(supabase: SupabaseClient, matchId: string) {
  const { data: match, error } = await supabase.from('matches').select(`
    id, round_id, completed, match_event_details,
    home_team_id, away_team_id, reserve_team_id, reserve_replaces_team_id,
    actual_ht_home_team_id, actual_ht_away_team_id,
    home_team:teams!matches_home_team_id_fkey(id,ht_team_id),
    away_team:teams!matches_away_team_id_fkey(id,ht_team_id),
    reserve_team:teams!matches_reserve_team_id_fkey(id,ht_team_id)
  `).eq('id', matchId).maybeSingle();
  if (error) throw error;
  if (!match?.completed || !match.match_event_details) return null;
  const { data: round, error: roundError } = await supabase.from('rounds')
    .select('tournament_id,season_number').eq('id', match.round_id).single();
  if (roundError) throw roundError;
  const { data: tournament, error: tournamentError } = await supabase.from('tournaments')
    .select('scoring_mode,season').eq('id', round.tournament_id).single();
  if (tournamentError) throw tournamentError;
  if (!usesMatch120mRatings(tournament.scoring_mode) || round.season_number !== tournament.season) return null;
  const home = one(match.home_team as TeamRef | TeamRef[] | null);
  const away = one(match.away_team as TeamRef | TeamRef[] | null);
  const reserve = one(match.reserve_team as TeamRef | TeamRef[] | null);
  const homePlayer = match.reserve_replaces_team_id === match.home_team_id && reserve ? reserve : home;
  const awayPlayer = match.reserve_replaces_team_id === match.away_team_id && reserve ? reserve : away;
  const details = match.match_event_details as MatchEventDetails;
  const actualHome = match.actual_ht_home_team_id ?? details.actualHomeTeamId;
  const actualAway = match.actual_ht_away_team_id ?? details.actualAwayTeamId;
  if (!homePlayer?.ht_team_id || !awayPlayer?.ht_team_id || homePlayer.id === awayPlayer.id ||
    !((actualHome === homePlayer.ht_team_id && actualAway === awayPlayer.ht_team_id) ||
      (actualHome === awayPlayer.ht_team_id && actualAway === homePlayer.ht_team_id))) return null;
  // Saved details normally follow fixture sides; older/raw snapshots may still
  // follow Hattrick venue sides. Identify each performance by its club ID.
  const homeIds = [home?.ht_team_id, homePlayer.ht_team_id];
  const awayIds = [away?.ht_team_id, awayPlayer.ht_team_id];
  const matchesSide = (teamId: number | null, ids: (number | null)[]) =>
    teamId !== null && ids.includes(teamId);
  const mapped = matchesSide(details.home?.teamId ?? null, homeIds) &&
    matchesSide(details.away?.teamId ?? null, awayIds);
  const reversed = matchesSide(details.home?.teamId ?? null, awayIds) &&
    matchesSide(details.away?.teamId ?? null, homeIds);
  if (mapped === reversed) return null;
  const homeRating = calculateMatch120mRating((mapped ? details.home : details.away)?.performance);
  const awayRating = calculateMatch120mRating((mapped ? details.away : details.home)?.performance);
  const withTeam = (rating: NonNullable<typeof homeRating>, team: TeamRef) => ({
    ...rating, team_id: team.id, ht_team_id: team.ht_team_id,
  });
  return {
    matchId,
    details,
    home: homeRating ? withTeam(homeRating, homePlayer) : null,
    away: awayRating ? withTeam(awayRating, awayPlayer) : null,
  };
}

export async function recalculateMatch120mRatings(supabase: SupabaseClient, matchId: string): Promise<void> {
  const prepared = await prepareMatch120mRatings(supabase, matchId);
  if (!prepared) return;
  try {
    await persistPreparedMatch120mRatings(supabase, prepared);
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== '40001') throw error;
    const current = await prepareMatch120mRatings(supabase, matchId);
    if (current) await persistPreparedMatch120mRatings(supabase, current);
  }
}

/** Rating errors are reported separately so saved results can still advance a round. */
export async function tryRecalculateMatch120mRatings(
  supabase: SupabaseClient,
  matchId: string,
): Promise<{ matchId: string; error: string } | null> {
  try {
    await recalculateMatch120mRatings(supabase, matchId);
    return null;
  } catch (error) {
    console.error('[match-120m-ratings] calculation failed', { matchId, error });
    return { matchId, error: '120mRt calculation failed; retry the rating refresh.' };
  }
}

export async function persistPreparedMatch120mRatings(
  supabase: SupabaseClient,
  prepared: NonNullable<Awaited<ReturnType<typeof prepareMatch120mRatings>>>,
): Promise<void> {
  const { error } = await supabase.rpc('replace_match_120m_ratings', {
    p_match_id: prepared.matchId,
    p_details: prepared.details,
    p_home: prepared.home,
    p_away: prepared.away,
  });
  if (error) throw error;
}
