import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchManagerTeamsFromChpp, fetchTeamDetailsFromChpp, fetchTeamBookingStatus, getManagerChppCredentials, type MatchmakerBookingResult } from './matchmaker.js';
import { teamMatchesCategory, teamMatchesCountryLimit, validateTeamEligibility } from './eligibility.js';
import { validateTournamentCountrySizeEligibility } from './country-size-eligibility.js';
import { managerCountrySizeAllowance } from '../../../../shared/country-size-eligibility.js';
import { getActiveTournamentConflicts } from './chpp-register.js';
import { buildRoundRobinCycles } from '../../../utils/round-robin-cycles.js';
import { getScheduledDateForSlot, type CalendarSlot } from '../../../utils/hattrick-calendar.js';
import { parseChppStockholmDate } from '../../../../shared/chpp-dates.js';
import { normalizeLeagueLimit } from '../../../../shared/worlddetails.js';
import { isFriendlyInsideAcceptedWindow } from './match-window.js';

export function resolveReserveCupStatus(booking: MatchmakerBookingResult, teamId: number, roundDate: Date): boolean | null {
  const matches = booking.scheduledMatches;
  if (!matches) return null;
  if (matches.some(match => ![match.homeTeamId, match.awayTeamId].includes(teamId)
    || !match.matchId || !match.matchType || !parseChppStockholmDate(match.matchDate)
    || !['UPCOMING', 'ONGOING', 'FINISHED'].includes(match.status.toUpperCase()))) return null;
  const unresolved = matches.filter(match =>
    [match.homeTeamId, match.awayTeamId].includes(teamId) &&
    ['UPCOMING', 'ONGOING'].includes(match.status.toUpperCase()));
  if (unresolved.some(match => match.matchType === 3)) return true;
  // An empty feed does not prove elimination. Require the identified team's
  // league schedule to cover the reserved friendly week, with no pending cup.
  return unresolved.some(match => match.matchType === 1 &&
    (parseChppStockholmDate(match.matchDate)?.getTime() ?? 0) > roundDate.getTime() + 24 * 60 * 60 * 1000) ? false : null;
}

export async function findVerifiedReserveOwner(supabase: SupabaseClient, teamId: number) {
  const { data, error } = await supabase.rpc('find_known_team_managers', { p_ht_team_id: teamId });
  if (error) throw error;
  let known = false;
  for (const managerId of new Set<number>((data || []).map((row: { hattrick_user_id: number }) => Number(row.hattrick_user_id)))) {
    known = true;
    const credentials = await getManagerChppCredentials(supabase, managerId);
    if (!credentials) continue;
    try {
      // Omit userID: the returned manager must be the token owner, not a public lookup.
      const owned = await fetchManagerTeamsFromChpp(process.env.CHPP_CONSUMER_KEY!, process.env.CHPP_CONSUMER_SECRET!, credentials);
      if (Number(owned.hattrickUserId) !== managerId) continue;
      const team = owned.teams.find(team => team.teamId === teamId);
      if (team) return { known: true, credentials, team, managerName: owned.managerName || credentials.manager_name };
    } catch { /* A cached owner must never become validated on a failed check. */ }
  }
  return { known, credentials: null, team: null, managerName: null };
}

export async function checkReserveAdmission(
  supabase: SupabaseClient,
  tournamentId: string,
  teamIds: string[],
  options: { isSiteAdmin?: boolean; roundId?: string; persistRankings?: boolean } = {},
) {
  if (teamIds.length < 2 || teamIds.length % 2 || new Set(teamIds).size !== teamIds.length) throw new Error('Select an even number of at least two reserves.');
  const { data: tournament, error: tournamentError } = await supabase.from('tournaments').select('id, season, schedule_mode, status, is_archived, max_teams, league_category, country_limit, country_limit_format, max_country_active_teams, allow_manager_country_size_exception').eq('id', tournamentId).single();
  if (tournamentError) throw tournamentError;
  if (tournament.is_archived || tournament.schedule_mode !== 'length' || ['finished', 'stopped', 'archived'].includes(tournament.status)) throw new Error('Reserve admission is available for running staged schedules.');
  const { data: rounds, error: roundError } = await supabase.from('rounds').select('id, round_number, phase, phase_status, round_source, reserved_slot_id, reserved_slot_kind, reserved_slot_date').eq('is_unscored', false).eq('tournament_id', tournamentId).eq('season_number', tournament.season).order('round_number');
  if (roundError) throw roundError;
  const round = options.roundId
    ? rounds?.find(round => round.id === options.roundId)
    : rounds?.find(round => round.phase_status === 'materialized' && round.round_source !== 'organizer');
  if (!round || round.phase !== 'regular' || round.phase_status !== 'materialized' || round.round_source === 'organizer' ||
      rounds?.some(round => round.phase === 'postseason' && round.phase_status !== 'pending')) throw new Error('Choose a materialized generated regular round before playoffs begin.');
  const { data: teams, error: teamError } = await supabase.from('teams').select('*').eq('tournament_id', tournamentId).in('id', teamIds);
  if (teamError) throw teamError;
  if (!teams || teams.length !== teamIds.length || teams.some(team => team.active || !team.reserve_active || team.is_placeholder)) throw new Error('The selected reserve list changed. Refresh and try again.');
  const { data: roster, error: rosterError } = await supabase.from('teams')
    .select('id, ht_team_id, hattrick_user_id, country_id, is_placeholder, active, reserve_active')
    .eq('tournament_id', tournamentId);
  if (rosterError) throw rosterError;
  const projectedRoster = (roster || []).map(row => teamIds.includes(row.id)
    ? { ...row, active: true, reserve_active: false } : row);
  const { data: fixtures, error: fixtureError } = await supabase.from('matches').select('home_team_id, away_team_id, reserve_team_id').eq('round_id', round.id);
  if (fixtureError) throw fixtureError;
  const conflicts = await getActiveTournamentConflicts(
    supabase,
    teams.map(team => Number(team.ht_team_id)),
    tournamentId,
  );
  const { data: gateway } = await supabase.from('teams').select('oauth_token, oauth_token_secret').eq('tournament_id', tournamentId).not('oauth_token', 'is', null).not('oauth_token_secret', 'is', null).limit(1).maybeSingle();
  const rankingSource = tournament.league_category === 'hfi' ? 'team_rank' : 'power_rating';
  const match = String(round.reserved_slot_id).match(/S(\d+)-W(\d+)-/);
  if (!match || !round.reserved_slot_date || !round.reserved_slot_kind) throw new Error('The round has no reserved calendar slot.');
  const slot: CalendarSlot = { id: round.reserved_slot_id, htSeason: Number(match[1]), htWeek: Number(match[2]), ht120minSeason: Number(match[1]) - 93, kind: round.reserved_slot_kind, nominalDate: new Date(round.reserved_slot_date), selectable: true, blockedReason: null, warning: null };
  const statuses: Array<{
    teamId: string;
    name: string;
    inCup: boolean | null;
    booked: boolean | null;
    error: string | null;
    warnings: string[];
  }> = [];
  for (const team of teams) {
    const warnings: string[] = [];
    const conflict = conflicts.get(Number(team.ht_team_id));
    let error: string | null = conflict && !options.isSiteAdmin
      ? `Already participating in another active tournament: "${conflict.name}".`
      : null;
    if (conflict && options.isSiteAdmin) warnings.push(`Already participating in another active tournament: "${conflict.name}".`);
    if ((fixtures || []).some(fixture => [fixture.home_team_id, fixture.away_team_id, fixture.reserve_team_id].includes(team.id))) error = 'Already assigned a fixture in this round.';
    let inCup: boolean | null = null;
    let booked: boolean | null = null;
    const credentials = team.oauth_token && team.oauth_token_secret ? team : gateway;
    try {
      if (!credentials) throw new Error('No CHPP authorization available.');
      const details = await fetchTeamDetailsFromChpp(process.env.CHPP_CONSUMER_KEY!, process.env.CHPP_CONSUMER_SECRET!, credentials, Number(team.ht_team_id));
      const category = tournament.league_category === 'hfi' ? 'hfi' : 'male';
      const countryLimit = normalizeLeagueLimit(tournament.country_limit, tournament.country_limit_format ?? 'league_id');
      const eligibility = validateTeamEligibility(details, { category, countryLimit });
      if (options.isSiteAdmin) {
        if (!teamMatchesCategory(details, category)) {
          warnings.push(`Team is not eligible for ${category === 'hfi' ? 'HFI' : 'Regular male'} category.`);
        }
        if (!teamMatchesCountryLimit(details, countryLimit)) {
          warnings.push(`Team is not from the required league (${countryLimit}).`);
        }
      } else if (!eligibility.eligible) {
        error = eligibility.reason || 'This team is not eligible.';
      }
      const countrySizeEligibility = await validateTournamentCountrySizeEligibility(supabase, {
        tournamentId,
        managerId: team.hattrick_user_id,
        countryId: details.countryId,
        maximumActiveTeams: tournament.max_country_active_teams,
        allowManagerException: tournament.allow_manager_country_size_exception,
        ...(tournament.allow_manager_country_size_exception
          ? { hasQualifyingParticipant: tournament.max_country_active_teams != null &&
              managerCountrySizeAllowance(projectedRoster.filter(row => row.id !== team.id),
                Number(team.hattrick_user_id), tournament.max_country_active_teams, true).active > 0 }
          : {}),
      });
      if (!countrySizeEligibility.eligible) {
        if (options.isSiteAdmin) warnings.push(countrySizeEligibility.reason);
        else error = countrySizeEligibility.reason;
      }
      const rankingUpdates = {
        ...(details.teamRank !== undefined ? { team_rank: details.teamRank } : {}),
        ...(details.powerRating !== undefined ? { power_rating: details.powerRating } : {}),
      };
      if (options.persistRankings !== false && Object.keys(rankingUpdates).length) {
        const update = await supabase.from('teams').update(rankingUpdates).eq('id', team.id).eq('tournament_id', tournamentId).eq('active', false).eq('reserve_active', true);
        if (update.error) throw update.error;
        Object.assign(team, rankingUpdates);
      }
      inCup = typeof details.stillInCup === 'boolean' ? details.stillInCup : null;
      const booking = await fetchTeamBookingStatus(process.env.CHPP_CONSUMER_KEY!, process.env.CHPP_CONSUMER_SECRET!, credentials, Number(team.ht_team_id));
      if (inCup === null) inCup = resolveReserveCupStatus(booking, Number(team.ht_team_id), new Date(round.reserved_slot_date));
      const bookingDate = booking.match ? parseChppStockholmDate(booking.match.matchDate) : null;
      if (booking.isBooked && !bookingDate) throw new Error('Booking date unavailable.');
      booked = booking.isBooked && Boolean(bookingDate && isFriendlyInsideAcceptedWindow(bookingDate, new Date(round.reserved_slot_date), round.reserved_slot_kind));
      if (inCup === null) {
        if (options.isSiteAdmin) warnings.push('Cup status could not be confirmed from Hattrick.');
        else error = error || 'Cup status unavailable from Hattrick. Check again before admission.';
      }
      if (options.isSiteAdmin && inCup) warnings.push('Team is still in the Hattrick cup.');
      if (options.isSiteAdmin && booked) warnings.push('Team has a conflicting Hattrick booking.');
    } catch {
      if (options.isSiteAdmin) warnings.push('Booking/cup status could not be verified from Hattrick.');
      else error = error || 'Booking/cup status could not be verified.';
    }
    if (rankingSource === 'team_rank' && !(Number(team.team_rank) > 0)) {
      if (options.isSiteAdmin) warnings.push('Update HFI ranks before admission; the current reserve order may be incomplete.');
      else error = error || 'Update HFI ranks before admission.';
    }
    statuses.push({ teamId: team.id, name: team.name, inCup, booked, error, warnings });
  }
  teams.sort((a, b) => {
    const av = Number(a[rankingSource]); const bv = Number(b[rankingSource]);
    return (av > 0 ? bv > 0 ? (rankingSource === 'team_rank' ? av - bv : bv - av) : -1 : bv > 0 ? 1 : 0) || a.id.localeCompare(b.id);
  });
  const pairs = buildRoundRobinCycles(teams.map(team => team.id), 1)[0]!;
  const matches = pairs.map(pair => {
    const home = teams.find(team => team.id === pair.homeTeamId)!;
    const scheduled = getScheduledDateForSlot(slot, { countryName: home.country_name, leagueLevel: home.league_level });
    if (!scheduled) throw new Error('Could not resolve the newcomer kickoff time.');
    return { home_team_id: pair.homeTeamId, away_team_id: pair.awayTeamId, scheduled_for: scheduled.toISOString() };
  });
  const { data: season, error: seasonError } = await supabase.from('tournament_seasons').select('id').eq('tournament_id', tournamentId).eq('season_number', tournament.season).single();
  if (seasonError) throw seasonError;
  const { count, error: countError } = await supabase.from('tournament_season_slots').select('id', { count: 'exact', head: true }).eq('tournament_season_id', season.id).not('current_team_id', 'is', null);
  if (countError) throw countError;
  return { tournament, round, teamIds: teams.map(team => String(team.id)), matches, statuses, canAdmit: statuses.every(status => !status.error && (options.isSiteAdmin || (status.inCup === false && status.booked === false))), newFieldSize: (count || 0) + teams.length,
    pairs: matches.map(pair => ({ home: teams.find(team => team.id === pair.home_team_id)!.name, away: teams.find(team => team.id === pair.away_team_id)!.name, scheduledFor: pair.scheduled_for })) };
}
