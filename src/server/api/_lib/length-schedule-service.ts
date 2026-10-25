import {
  buildRoundRepair,
  generateBalancedRound,
  resolveChampionshipTeam,
  seedPlayoffPairings,
  type ReservedRegularPairing,
  type LengthSchedulePairing,
  type LengthScheduleTeam,
  type PairingHistory,
} from '../../../utils/length-schedule.js';
import { getScheduledDateForSlot, type CalendarSlot } from '../../../utils/hattrick-calendar.js';
import { calculateSeasonSlotStandings, type SeasonSlotAssignment, type Team } from '../../../utils/standings.js';
import type { PersistedScoringMode } from '../../../../shared/scoring-profile.js';
import type { getServiceSupabase } from './supabase.js';

type ServiceSupabase = ReturnType<typeof getServiceSupabase>;

interface StoredRound {
  id: string;
  round_number: number;
  phase: 'regular' | 'postseason';
  phase_status: 'pending' | 'materialized' | 'completed';
  phase_round_number?: number;
  reserved_slot_id: string | null;
  reserved_slot_kind: 'midweek_friendly' | 'weekend_friendly' | null;
  reserved_slot_date: string | null;
  matches: StoredMatch[];
}

interface StoredMatch {
  id: string;
  home_team_id: string | null;
  away_team_id: string | null;
  home_slot_id: string | null;
  away_slot_id: string | null;
  status: string | null;
  completed: boolean;
  home_goals: number | null;
  away_goals: number | null;
  went_120: boolean;
  total_minutes: number | null;
  penalty_shootout_home_goals: number | null;
  penalty_shootout_away_goals: number | null;
  schedule_resolution: 'pending' | 'played' | 'finalized_unplayed';
  ht_match_id: number | null;
  scheduled_for: string | null;
  finished_at: string | null;
  playoff_match_number?: number | null;
}

interface TeamRow {
  id: string;
  name: string;
  ht_team_id: number | null;
  hattrick_user_id: number | null;
  active: boolean;
  replacement_for_team_id: string | null;
  country_name: string | null;
  country_id: number | null;
  league_id: number | null;
  league_level: number | null;
  logo_url: string | null;
  manager_name: string | null;
  team_rank: number | null;
  reserve_active: boolean | null;
  actively_waiting?: boolean;
}

interface SlotRow {
  id: string;
  slot_index?: number;
  current_team_id: string | null;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function isResolvedMatch(match: StoredMatch) {
  if (!match.home_team_id || !match.away_team_id) return true;
  if (match.status === 'ongoing') return false;
  return match.completed || match.status === 'finished' || match.schedule_resolution === 'finalized_unplayed';
}

function buildPairingHistory(rounds: StoredRound[]): PairingHistory {
  const playedPairs: Array<[string, string]> = [];
  const homeCounts: Record<string, number> = {};
  const byeCounts: Record<string, number> = {};
  for (const round of rounds.filter((item) => item.phase === 'regular')) {
    for (const match of round.matches) {
      if (
        round.phase_status === 'completed' &&
        match.schedule_resolution !== 'finalized_unplayed' &&
        (!match.home_team_id || !match.away_team_id)
      ) {
        const byeTeamId = match.home_team_id || match.away_team_id;
        if (byeTeamId) byeCounts[byeTeamId] = (byeCounts[byeTeamId] || 0) + 1;
        continue;
      }
      if (match.schedule_resolution === 'played' || match.completed || match.status === 'finished') {
        if (match.home_team_id && match.away_team_id) {
          playedPairs.push([match.home_team_id, match.away_team_id]);
          homeCounts[match.home_team_id] = (homeCounts[match.home_team_id] || 0) + 1;
        }
      }
    }
  }
  return { playedPairs, homeCounts, byeCounts };
}

async function loadLengthSeason(supabase: ServiceSupabase, tournamentId: string, seasonNumber: number) {
  const [{ data: tournament, error: tournamentError }, { data: season, error: seasonError }] = await Promise.all([
    supabase.from('tournaments').select('id, schedule_mode, scoring_mode, league_category').eq('id', tournamentId).maybeSingle(),
    supabase
      .from('tournament_seasons')
      .select('id, schedule_plan_json, ranking_snapshot_json, champion_team_id')
      .eq('tournament_id', tournamentId)
      .eq('season_number', seasonNumber)
      .maybeSingle(),
  ]);
  if (tournamentError) throw tournamentError;
  if (seasonError) throw seasonError;
  if (!tournament || tournament.schedule_mode !== 'length' || !season) return null;

  const [{ data: roundRows, error: roundsError }, { data: slots, error: slotsError }] = await Promise.all([
      supabase
        .from('rounds')
        .select(`
          id, round_number, phase, phase_round_number, phase_status, reserved_slot_id, reserved_slot_kind, reserved_slot_date,
          matches (
            id, home_team_id, away_team_id, home_slot_id, away_slot_id, status, completed,
            home_goals, away_goals, went_120, total_minutes,
            penalty_shootout_home_goals, penalty_shootout_away_goals, schedule_resolution,
            ht_match_id, scheduled_for, finished_at, playoff_match_number
          )
        `)
        .eq('tournament_id', tournamentId)
        .eq('season_number', seasonNumber)
        .order('round_number'),
      supabase.from('tournament_season_slots').select('id, slot_index, current_team_id').eq('tournament_season_id', season.id),
    ]);
  if (roundsError) throw roundsError;
  if (slotsError) throw slotsError;

  const slotRows = (slots || []) as SlotRow[];
  let assignmentRows: SeasonSlotAssignment[] = [];
  if (slotRows.length > 0) {
    const assignmentResult = await supabase
      .from('tournament_season_slot_assignments')
      .select('id, tournament_season_slot_id, team_id, assigned_at, released_at, team_name, ht_team_id, manager_name, hattrick_user_id, logo_url, admission_request_id, entry_round_id, ranking_source, ranking_value')
      .in('tournament_season_slot_id', slotRows.map((slot) => slot.id));
    if (assignmentResult.error) throw assignmentResult.error;
    assignmentRows = (assignmentResult.data || []) as SeasonSlotAssignment[];
  }

  // Membership is authoritative; physical slot occupancy is compatibility data.
  const { data: teams, error: teamsError } = await supabase
    .from('teams')
    .select('id, name, ht_team_id, hattrick_user_id, active, replacement_for_team_id, country_name, country_id, league_id, league_level, logo_url, manager_name, team_rank, reserve_active, is_placeholder')
    .eq('tournament_id', tournamentId).eq('active', true);
  if (teamsError) throw teamsError;
  const { data: pendingTeams, error: pendingError } = await supabase
    .from('teams')
    .select('id, name, ht_team_id, hattrick_user_id, active, replacement_for_team_id, country_name, country_id, league_id, league_level, logo_url, manager_name, team_rank, reserve_active, actively_waiting')
    .eq('tournament_id', tournamentId)
    .eq('active', false);
  if (pendingError) throw pendingError;
  return {
    tournament,
    season,
    rounds: (roundRows || []) as unknown as StoredRound[],
    slots: slotRows,
    assignments: assignmentRows,
    teams: (teams || []).filter(team => team.reserve_active !== true && team.is_placeholder !== true) as TeamRow[],
    allTeams: [...(teams || []), ...(pendingTeams || [])] as TeamRow[],
    pendingTeams: ((pendingTeams || []) as TeamRow[]).filter((team) => team.reserve_active === true && team.actively_waiting === true),
  };
}

function rankingMap(snapshot: unknown) {
  const map = new Map<string, number>();
  if (!Array.isArray(snapshot)) return map;
  for (const row of snapshot) {
    if (!row || typeof row !== 'object') continue;
    const teamId = 'team_id' in row ? String(row.team_id) : '';
    const rank = 'seed' in row ? Number(row.seed) : 'team_rank' in row ? Number(row.team_rank) : NaN;
    if (teamId && Number.isInteger(rank) && rank > 0) map.set(teamId, rank);
  }
  return map;
}

function readSchedulePlan(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const plan = value as { version?: number; regular_pairings?: ReservedRegularPairing[][]; postseason_rounds?: number };
  return plan.version === 2 && Array.isArray(plan.regular_pairings) ? plan : null;
}

function seasonRanks(state: NonNullable<Awaited<ReturnType<typeof loadLengthSeason>>>) {
  const ranks = rankingMap(state.season.ranking_snapshot_json);
  const admissions = state.assignments;
  if (admissions.some(assignment => assignment.admission_request_id)) {
    const snapshot = Array.isArray(state.season.ranking_snapshot_json) ? state.season.ranking_snapshot_json : [];
    const values = state.slots.filter(slot => slot.current_team_id).map(slot => {
      const original = snapshot.find(row => Number(row.seed) === slot.slot_index || (row.team_id === slot.current_team_id)) || (slot.slot_index ? snapshot[slot.slot_index - 1] : null);
      const admission = admissions.find(assignment => assignment.tournament_season_slot_id === slot.id && assignment.admission_request_id);
      const value = original ? original.ranking_value ?? original.team_rank : admission?.ranking_value;
      return { id: slot.current_team_id!, value: value == null ? null : Number(value) };
    });
    values.sort((a, b) => (a.value == null ? b.value == null ? 0 : 1 : b.value == null ? -1 :
      state.tournament.league_category === 'hfi' ? a.value - b.value : b.value - a.value) || a.id.localeCompare(b.id));
    return new Map(values.map((team, i) => [team.id, i + 1]));
  }
  if (readSchedulePlan(state.season.schedule_plan_json)) {
    for (const slot of state.slots) if (slot.current_team_id && slot.slot_index) ranks.set(slot.current_team_id, slot.slot_index);
  }
  return ranks;
}

function reservedPairings(state: NonNullable<Awaited<ReturnType<typeof loadLengthSeason>>>, roundNumber: number) {
  const plan = readSchedulePlan(state.season.schedule_plan_json);
  if (!plan) return null;
  if (state.assignments.some(a => a.admission_request_id) || state.pendingTeams.length > 0) return null;
  const pairs = plan.regular_pairings![roundNumber - 1];
  if (!pairs) throw new Error('The reserved regular-round pairing plan is missing.');
  const occupants = new Map(state.slots.map(slot => [slot.slot_index, slot.current_team_id]));
  const rosterSize = Array.isArray(state.season.ranking_snapshot_json) ? state.season.ranking_snapshot_json.length : 0;
  if (state.teams.length !== rosterSize) return null; // Reuse the repair-compatible fallback for vacancies.
  const slotIds = new Map(state.slots.map(slot => [slot.slot_index, slot.id]));
  // Preserve the existing repair/played-history behavior if a past round was
  // missed, repaired or reoriented. The normal cycle plan must not overwrite it.
  for (const previous of state.rounds.filter(round => round.phase === 'regular' && round.round_number < roundNumber)) {
    const planned = plan.regular_pairings![previous.round_number - 1];
    const expected = planned?.map(pair => `${slotIds.get(pair.home_slot_index)}:${pair.away_slot_index ? slotIds.get(pair.away_slot_index) : ''}`).sort();
    const actual = previous.matches.map(match => `${match.home_slot_id || ''}:${match.away_slot_id || ''}`).sort();
    if (!expected || JSON.stringify(expected) !== JSON.stringify(actual) || previous.matches.some(match =>
      Boolean(match.home_team_id && match.away_team_id) &&
      (match.schedule_resolution === 'finalized_unplayed' || (!match.completed && match.status !== 'finished')),
    )) return null;
  }
  return pairs.map(pair => {
    const home = occupants.get(pair.home_slot_index) || null;
    const away = pair.away_slot_index ? occupants.get(pair.away_slot_index) || null : null;
    if (!home) throw new Error('A reserved season slot has no participant.');
    return { homeTeamId: home, awayTeamId: away, isBye: !away };
  });
}

function playoffWinner(match: StoredMatch) {
  if (!match.completed || !match.home_team_id || !match.away_team_id || match.home_goals == null || match.away_goals == null) {
    throw new Error('Every playoff fixture needs a completed, decisive result.');
  }
  const winner = resolveChampionshipTeam({
    homeTeamId: match.home_team_id, awayTeamId: match.away_team_id,
    homeGoals: match.home_goals, awayGoals: match.away_goals, went120: match.went_120,
    penaltyShootoutHomeGoals: match.penalty_shootout_home_goals,
    penaltyShootoutAwayGoals: match.penalty_shootout_away_goals,
  });
  if (!winner) throw new Error('A playoff fixture does not yet have a decisive winner.');
  return winner;
}

function toLengthTeams(teams: TeamRow[], ranks: Map<string, number>): LengthScheduleTeam[] {
  return teams.map((team) => ({
    id: team.id,
    name: team.name,
    teamRank: ranks.get(team.id) ?? team.team_rank,
    countryName: team.country_name,
    leagueLevel: team.league_level,
  }));
}

function toOriginalRoundTeams(
  teams: TeamRow[],
  slots: SlotRow[],
  snapshot: unknown,
): LengthScheduleTeam[] {
  const rosterIds = slots.map((slot) => slot.current_team_id).filter((id): id is string => Boolean(id));
  const rosterIdSet = new Set(rosterIds);
  const snapshotRows = Array.isArray(snapshot)
    ? snapshot.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    : [];
  const snapshotIds = snapshotRows.map((row) => (typeof row.team_id === 'string' ? row.team_id : ''));
  const snapshotRanks = rankingMap(snapshot);

  if (
    rosterIds.length < 2 ||
    rosterIdSet.size !== rosterIds.length ||
    snapshotRows.length !== rosterIds.length ||
    new Set(snapshotIds).size !== snapshotIds.length ||
    snapshotIds.some((id) => !rosterIdSet.has(id)) ||
    snapshotRanks.size !== rosterIds.length ||
    teams.length !== rosterIds.length ||
    teams.some((team) => !rosterIdSet.has(team.id) || !snapshotRanks.has(team.id))
  ) {
    throw new Error('Round 1 recovery requires a complete ranking snapshot for the current season roster.');
  }

  return toLengthTeams(teams, snapshotRanks);
}

function buildStoredPairings(round: StoredRound, pairings: LengthSchedulePairing[], teams: LengthScheduleTeam[]) {
  if (!round.reserved_slot_date || !round.reserved_slot_id || !round.reserved_slot_kind) {
    throw new Error(`Round ${round.round_number} has no reserved calendar slot.`);
  }
  const slotDate = new Date(round.reserved_slot_date);
  const htWeekMatch = round.reserved_slot_id.match(/S(\d+)-W(\d+)-/);
  if (!htWeekMatch) throw new Error(`Round ${round.round_number} has an invalid reserved slot.`);
  const slot: CalendarSlot = {
    id: round.reserved_slot_id,
    kind: round.reserved_slot_kind,
    htSeason: Number(htWeekMatch[1]),
    htWeek: Number(htWeekMatch[2]),
    ht120minSeason: Number(htWeekMatch[1]) - 93,
    nominalDate: slotDate,
    selectable: true,
    blockedReason: null,
    warning: null,
  };
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  return pairings.map((pairing) => {
    const kickoffTeam = teamsById.get(pairing.homeTeamId || pairing.awayTeamId || '');
    const scheduledFor = kickoffTeam ? getScheduledDateForSlot(slot, kickoffTeam) : null;
    if (!scheduledFor) throw new Error(`Could not resolve the kickoff time for Round ${round.round_number}.`);
    return {
      home_team_id: pairing.homeTeamId,
      away_team_id: pairing.awayTeamId,
      scheduled_for: scheduledFor.toISOString(),
      schedule_resolution: 'pending',
    };
  });
}

function balanceExpandedHistory(history: PairingHistory) {
  if (!history.boundedCandidates) return;
  // Late entrants have fewer appearances. Compare home bias per appearance,
  // rather than giving every newcomer home games until older totals catch up.
  const appearances: Record<string, number> = {};
  for (const pair of history.playedPairs || []) for (const id of pair) appearances[id] = (appearances[id] || 0) + 1;
  history.homeCounts = Object.fromEntries(Object.entries(appearances).map(([id, count]) => [id, (history.homeCounts?.[id] || 0) - count / 2]));
}

export async function progressLengthSchedule(
  supabase: ServiceSupabase,
  tournamentId: string,
  seasonNumber: number,
  retry = 0,
): Promise<{ advanced: boolean; reason?: string; [key: string]: unknown }> {
  const { data: admission, error: admissionError } = await supabase.rpc('get_waiting_admission_plan', {
    p_tournament_id: tournamentId, p_season_number: seasonNumber, p_for_transition: true,
  });
  if (admissionError) throw admissionError;
  const plan = admission as { teamIds: string[]; activeTeamIds: string[]; departingTeamIds?: string[]; rosterVersion: string };
  const state = await loadLengthSeason(supabase, tournamentId, seasonNumber);
  if (!state) return { advanced: false, reason: 'not_length_schedule' };
  const current = state.rounds.find((round) => round.phase_status === 'materialized');
  if (!current) return { advanced: false, reason: 'no_materialized_round' };
  const hasExpiredUnlinkedFixture = current.matches.some((match) =>
    !match.completed &&
    match.ht_match_id === null &&
    (match.status === null || match.status === 'not_arranged' || match.status === 'misarranged') &&
    match.scheduled_for !== null &&
    new Date(match.scheduled_for).getTime() <= Date.now() &&
    (match.schedule_resolution === 'finalized_unplayed' || !isResolvedMatch(match))
  );
  if (current.matches.some((match) => !isResolvedMatch(match)) && !hasExpiredUnlinkedFixture) {
    return { advanced: false, reason: 'round_unresolved' };
  }
  const next = state.rounds.find((round) => round.round_number === current.round_number + 1) || null;
  const activeTeamIds = state.teams.map(team => team.id);
  const roundState = next?.phase === 'regular' && plan.departingTeamIds?.length
    ? { ...state, teams: state.teams.filter(team => !plan.departingTeamIds!.includes(team.id)) } : state;
  const ranks = seasonRanks(roundState);
  const lengthTeams = toLengthTeams(roundState.teams, ranks);
  let nextMatches: Array<Record<string, unknown>> = [];
  let championTeamId: string | null = null;

  if (next?.phase === 'regular') {
    const enteringTeams = state.pendingTeams.filter((team) => plan.teamIds.includes(team.id));
    const roundTeams = toLengthTeams([...roundState.teams, ...enteringTeams], ranks);
    const versionTwo = Boolean(readSchedulePlan(state.season.schedule_plan_json));
    const history = buildPairingHistory(state.rounds.filter(round => round.round_number <= current.round_number).map(round =>
      versionTwo && round.id === current.id ? { ...round, phase_status: 'completed' as const } : round,
    ));
    history.balanceRepeats = versionTwo || state.assignments.some(a => a.admission_request_id) || enteringTeams.length > 0;
    history.boundedCandidates = state.assignments.some(a => a.admission_request_id) || enteringTeams.length > 0;
    balanceExpandedHistory(history);
    nextMatches = buildStoredPairings(
      next,
      reservedPairings({ ...roundState, pendingTeams: enteringTeams }, next.round_number) ?? generateBalancedRound(roundTeams, history, next.round_number - 1),
      roundTeams,
    );
  } else if (next?.phase === 'postseason') {
    const plan = readSchedulePlan(state.season.schedule_plan_json);
    if (current.phase === 'postseason') {
      const matches = [...current.matches].sort((a, b) => (a.playoff_match_number || 1) - (b.playoff_match_number || 1));
      const currentPhaseRound = current.phase_round_number || state.rounds.filter(round => round.phase === 'postseason' && round.round_number <= current.round_number).length;
      const expectedMatches = 2 ** ((plan?.postseason_rounds || 1) - currentPhaseRound);
      if (matches.length !== expectedMatches || matches.length < 2) throw new Error('The preceding playoff round is incomplete.');
      const winners = matches.map(playoffWinner);
      const pairs = Array.from({ length: winners.length / 2 }, (_, i) => ({
        homeTeamId: winners[i * 2]!, awayTeamId: winners[i * 2 + 1]!, isBye: false,
      }));
      nextMatches = buildStoredPairings(next, pairs, lengthTeams).map((match, i) => ({ ...match, playoff_match_number: i + 1 }));
    } else {
      const regularMatches = state.rounds
        .filter((round) => round.phase === 'regular')
        .flatMap((round) => round.matches)
        .filter((match) => match.schedule_resolution !== 'finalized_unplayed');
      const standings = calculateSeasonSlotStandings(
        state.allTeams.map((team): Team => ({
          id: team.id,
          name: team.name,
          ht_team_id: team.ht_team_id,
          hattrick_user_id: team.hattrick_user_id,
          active: team.active,
          replacement_for_team_id: team.replacement_for_team_id,
          country_name: team.country_name,
          country_id: team.country_id,
          league_id: team.league_id,
          logo_url: team.logo_url,
          manager_name: team.manager_name,
          reserve_active: team.reserve_active ?? false,
          team_rank: team.team_rank,
        })),
        regularMatches.map((match) => ({
          ...match,
          total_minutes: match.total_minutes ?? undefined,
        })),
        state.slots,
        state.tournament.scoring_mode as PersistedScoringMode,
        state.assignments,
        true,
      );
      const activeIds = new Set(state.teams.map(team => team.id));
      const eligibleStandings = standings.filter((standing) => activeIds.has(standing.teamId));
      const qualifierCount = 2 ** (plan?.postseason_rounds || 1);
      if (eligibleStandings.length < qualifierCount) throw new Error('Regular standings do not contain enough active playoff qualifiers.');
      const qualifiers = eligibleStandings.slice(0, qualifierCount).map(standing => standing.teamId);
      nextMatches = buildStoredPairings(next, seedPlayoffPairings(qualifiers), lengthTeams)
        .map((match, i) => ({ ...match, ...(plan ? { playoff_match_number: i + 1 } : {}) }));
    }
  } else if (!next && current.phase === 'postseason') {
    const finalMatch = current.matches.find((match) => match.home_team_id && match.away_team_id && match.completed);
    if (!finalMatch?.home_team_id || !finalMatch.away_team_id || finalMatch.home_goals == null || finalMatch.away_goals == null) {
      throw new Error('The Championship Final does not have a completed result.');
    }
    championTeamId = resolveChampionshipTeam({
      homeTeamId: finalMatch.home_team_id,
      awayTeamId: finalMatch.away_team_id,
      homeGoals: finalMatch.home_goals,
      awayGoals: finalMatch.away_goals,
      went120: finalMatch.went_120,
      penaltyShootoutHomeGoals: finalMatch.penalty_shootout_home_goals,
      penaltyShootoutAwayGoals: finalMatch.penalty_shootout_away_goals,
    });
    if (!championTeamId) throw new Error('The Championship Final does not yet have a decisive winner.');
  }

  const finalizedWarningRoundIds = state.rounds
    .filter((round) =>
      round.phase_status === 'completed' &&
      round.matches.some((match) => match.schedule_resolution === 'finalized_unplayed'),
    )
    .map((round) => round.id);

  const { data, error } = await supabase.rpc('apply_length_round_transition_with_membership', {
    p_tournament_id: tournamentId,
    p_season_number: seasonNumber,
    p_completed_round_id: current.id,
    p_next_round_id: next?.id || null,
    p_matches: nextMatches,
    p_champion_team_id: championTeamId,
    p_active_team_ids: activeTeamIds,
    p_roster_version: plan.rosterVersion,
    p_pending_team_ids: next?.phase === 'regular'
      ? state.pendingTeams.filter((team) => plan.teamIds.includes(team.id)).map((team) => team.id)
      : [],
  });
  if (error) {
    if (error.code === '40001' && retry < 2) return progressLengthSchedule(supabase, tournamentId, seasonNumber, retry + 1);
    throw error;
  }

  // The transition may finalize an expired fixture and progress the round.
  // Keep its warning record as history while clearing its active state.
  const warningRoundIds = [...new Set([
    ...finalizedWarningRoundIds,
    ...(hasExpiredUnlinkedFixture ? [current.id] : []),
  ])];
  if (warningRoundIds.length > 0) {
    const { error: warningError } = await supabase
      .from('fixture_warnings')
      .update({ active: false })
      .in('round_id', warningRoundIds)
      .eq('active', true);
    if (warningError) throw warningError;
  }

  return data;
}

export async function recoverLengthRoundOne(
  supabase: ServiceSupabase,
  tournamentId: string,
  seasonNumber: number,
) {
  const state = await loadLengthSeason(supabase, tournamentId, seasonNumber);
  if (!state) throw new Error('This tournament does not use staged length scheduling.');
  const roundOne = state.rounds.find((round) => round.round_number === 1);
  if (!roundOne || roundOne.round_number !== 1) throw new Error('Round 1 was not found.');
  if (roundOne.phase !== 'regular') throw new Error('Round 1 recovery requires the regular phase.');
  if (state.tournament.schedule_mode !== 'length') {
    throw new Error('Round 1 recovery requires length scheduling.');
  }

  // Reconstruct from the frozen original plan (or the legacy TeamRank snapshot),
  // never from the current Round 1 fixture rows.
  if (state.assignments.some(a => a.admission_request_id)) throw new Error('Original Round 1 recovery is unavailable after reserve admission.');
  const originalTeams = toOriginalRoundTeams(state.teams, state.slots, state.season.ranking_snapshot_json);
  const originalPairings = reservedPairings(state, 1) ?? generateBalancedRound(originalTeams, {}, 0);
  const replacementMatches = buildStoredPairings(roundOne, originalPairings, originalTeams);
  const { data, error } = await supabase.rpc('recover_length_schedule_round_one', {
    p_tournament_id: tournamentId,
    p_season_number: seasonNumber,
    p_round_id: roundOne.id,
    p_matches: replacementMatches,
  });
  if (error) throw error;
  return {
    ...(firstRelation(data as Record<string, unknown> | Record<string, unknown>[] | null) || {}),
    roundNumber: 1,
    reconstructedFixtures: replacementMatches.length,
  };
}

export async function repairLengthRound(
  supabase: ServiceSupabase,
  tournamentId: string,
  seasonNumber: number,
) {
  const state = await loadLengthSeason(supabase, tournamentId, seasonNumber);
  if (!state) throw new Error('This tournament does not use staged length scheduling.');
  const current = state.rounds.find((round) => round.phase_status === 'materialized' && round.phase === 'regular');
  if (!current) throw new Error('There is no repairable regular round.');
  const protectedMatches = current.matches.filter(
    (match) =>
      match.completed ||
      Boolean(
        match.ht_match_id ||
          match.status === 'arranged' ||
          match.status === 'ongoing' ||
          match.status === 'finished' ||
          (match.scheduled_for && new Date(match.scheduled_for).getTime() <= Date.now()),
      ),
  );
  if (protectedMatches.some(
    (match) =>
      match.completed ||
      match.status === 'ongoing' ||
      match.status === 'finished' ||
      Boolean(match.finished_at) ||
      Boolean(match.scheduled_for && new Date(match.scheduled_for).getTime() <= Date.now()),
  )) {
    throw new Error('This round has already started and can no longer be repaired.');
  }
  const warningsResult = await supabase
    .from('fixture_warnings')
    .select('team_id')
    .eq('tournament_id', tournamentId)
    .eq('round_id', current.id)
    .eq('active', true);
  if (warningsResult.error) throw warningsResult.error;
  const unavailableTeamIds = Array.from(new Set((warningsResult.data || []).map((warning) => warning.team_id)));
  const hasVacantSlot = (match: StoredMatch) =>
    (Boolean(match.home_slot_id) && !match.home_team_id) ||
    (Boolean(match.away_slot_id) && !match.away_team_id);
  const unprotectedByes = current.matches.filter((match) =>
    !protectedMatches.includes(match) && Boolean(match.home_team_id) !== Boolean(match.away_team_id),
  );
  const excessByeMatches = unprotectedByes.length > 1 ? unprotectedByes : [];
  if (unavailableTeamIds.length === 0 && excessByeMatches.length === 0 &&
      !current.matches.some(match => !protectedMatches.includes(match) && hasVacantSlot(match))) {
    throw new Error('No booked-elsewhere teams, vacant fixtures, or excess BYEs were detected in this round.');
  }
  const affectedMatches = current.matches.filter(
    (match) =>
      !protectedMatches.includes(match) &&
      (excessByeMatches.includes(match) || hasVacantSlot(match) || Boolean(
        (match.home_team_id && unavailableTeamIds.includes(match.home_team_id)) ||
          (match.away_team_id && unavailableTeamIds.includes(match.away_team_id)),
      )),
  );
  if (affectedMatches.length === 0) throw new Error('No repairable affected fixtures were detected.');
  const untouchedMatches = current.matches.filter((match) => !affectedMatches.includes(match));
  const ranks = seasonRanks(state);
  const lengthTeams = toLengthTeams(state.teams, ranks);
  const history = buildPairingHistory(state.rounds.filter((round) => round.round_number < current.round_number));
  history.balanceRepeats = Boolean(readSchedulePlan(state.season.schedule_plan_json)) || state.assignments.some(a => a.admission_request_id);
  history.boundedCandidates = true;
  balanceExpandedHistory(history);
  const repair = buildRoundRepair({
    teams: lengthTeams,
    lockedPairs: untouchedMatches.flatMap((match) =>
      match.home_team_id && match.away_team_id ? [[match.home_team_id, match.away_team_id] as [string, string]] : [],
    ),
    lockedTeamIds: untouchedMatches.flatMap(match => [match.home_team_id, match.away_team_id].filter((id): id is string => Boolean(id))),
    unavailableTeamIds,
    history,
  });
  const freePairings = buildStoredPairings(current, repair.repairedPairs, lengthTeams);
  const containmentPairings = buildStoredPairings(current, repair.containmentPairs, lengthTeams).map((pairing) => ({
    ...pairing,
    schedule_resolution: 'finalized_unplayed',
  }));
  const { data, error } = await supabase.rpc('repair_length_schedule_round', {
    p_tournament_id: tournamentId,
    p_season_number: seasonNumber,
    p_round_id: current.id,
    p_unlocked_matches: [...containmentPairings, ...freePairings],
  });
  if (error) throw error;
  return {
    ...(firstRelation(data as Record<string, unknown> | Record<string, unknown>[] | null) || {}),
    lockedFixtures: untouchedMatches.filter((match) => match.home_team_id && match.away_team_id).length,
    unavailableTeams: unavailableTeamIds.length,
    repairedPlayableFixtures: repair.repairedPairs.filter((pairing) => !pairing.isBye).length,
    containedUnplayableFixtures: repair.containmentPairs.length,
    byeFixturesCreated: repair.repairedPairs.filter((pairing) => pairing.isBye).length,
  };
}
