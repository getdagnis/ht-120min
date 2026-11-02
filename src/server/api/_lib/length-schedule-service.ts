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
import {
  getRoundManagementClosesAt,
  getRoundPreparationOpensAt,
  getScheduledDateForSlot,
  type CalendarSlot,
} from '../../../utils/hattrick-calendar.js';
import { calculateSeasonSlotStandings, type SeasonSlotAssignment, type Team } from '../../../utils/standings.js';
import type { PersistedScoringMode } from '../../../../shared/scoring-profile.js';
import type { getServiceSupabase } from './supabase.js';
import { createHash } from 'node:crypto';
import { fetchTeamBookingStatus, isBookedFriendlyMatch } from './matchmaker.js';
import { parseChppStockholmDate } from '../../../../shared/chpp-dates.js';
import { isFriendlyInsideAcceptedWindow } from './match-window.js';

type ServiceSupabase = ReturnType<typeof getServiceSupabase>;

interface StoredRound {
  id: string;
  round_number: number;
  phase: 'regular' | 'postseason';
  phase_status: 'pending' | 'materialized' | 'completed';
  phase_round_number?: number;
  round_source?: 'scheduled' | 'organizer';
  is_unscored?: boolean;
  round_participants?: Array<{ team_id: string }>;
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
  power_rating: number | null;
  reserve_active: boolean | null;
  actively_waiting?: boolean;
}

interface SlotRow {
  id: string;
  slot_index?: number;
  current_team_id: string | null;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
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
        round.phase_status === 'pending' ||
        match.schedule_resolution === 'finalized_unplayed' ||
        match.status === 'misarranged'
      )
        continue;

      const home = match.home_team_id;
      const away = match.away_team_id;

      if (home && away) {
        playedPairs.push([home, away]);
        homeCounts[home] = (homeCounts[home] || 0) + 1;
      } else if (round.phase_status === 'completed') {
        const teamId = home || away;
        if (teamId) byeCounts[teamId] = (byeCounts[teamId] || 0) + 1;
      }
    }
  }
  return { playedPairs, homeCounts, byeCounts };
}

async function loadLengthSeason(supabase: ServiceSupabase, tournamentId: string, seasonNumber: number) {
  const [{ data: tournament, error: tournamentError }, { data: season, error: seasonError }] = await Promise.all([
    supabase
      .from('tournaments')
      .select('id, schedule_mode, scoring_mode, league_category, max_teams')
      .eq('id', tournamentId)
      .maybeSingle(),
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
      .select(
        `
          id, round_number, phase, phase_round_number, phase_status, round_source, is_unscored, round_participants(team_id), reserved_slot_id, reserved_slot_kind, reserved_slot_date,
          matches (
            id, home_team_id, away_team_id, home_slot_id, away_slot_id, status, completed,
            home_goals, away_goals, went_120, total_minutes,
            penalty_shootout_home_goals, penalty_shootout_away_goals, schedule_resolution,
            ht_match_id, scheduled_for, finished_at, playoff_match_number
          )
        `,
      )
      .eq('tournament_id', tournamentId)
      .eq('season_number', seasonNumber)
      .order('round_number'),
    supabase
      .from('tournament_season_slots')
      .select('id, slot_index, current_team_id')
      .eq('tournament_season_id', season.id),
  ]);
  if (roundsError) throw roundsError;
  if (slotsError) throw slotsError;

  const slotRows = (slots || []) as SlotRow[];
  let assignmentRows: SeasonSlotAssignment[] = [];
  if (slotRows.length > 0) {
    const assignmentResult = await supabase
      .from('tournament_season_slot_assignments')
      .select(
        'id, tournament_season_slot_id, team_id, assigned_at, released_at, team_name, ht_team_id, manager_name, hattrick_user_id, logo_url, admission_request_id, entry_round_id, ranking_source, ranking_value',
      )
      .in(
        'tournament_season_slot_id',
        slotRows.map((slot) => slot.id),
      );
    if (assignmentResult.error) throw assignmentResult.error;
    assignmentRows = (assignmentResult.data || []) as SeasonSlotAssignment[];
  }

  // Membership is authoritative; physical slot occupancy is compatibility data.
  const { data: teams, error: teamsError } = await supabase
    .from('teams')
    .select(
      'id, name, ht_team_id, hattrick_user_id, active, replacement_for_team_id, country_name, country_id, league_id, league_level, logo_url, manager_name, team_rank, power_rating, reserve_active, is_placeholder',
    )
    .eq('tournament_id', tournamentId)
    .eq('active', true);
  if (teamsError) throw teamsError;
  const { data: pendingTeams, error: pendingError } = await supabase
    .from('teams')
    .select(
      'id, name, ht_team_id, hattrick_user_id, active, replacement_for_team_id, country_name, country_id, league_id, league_level, logo_url, manager_name, team_rank, power_rating, reserve_active, actively_waiting',
    )
    .eq('tournament_id', tournamentId)
    .eq('active', false);
  if (pendingError) throw pendingError;
  return {
    tournament,
    season,
    rounds: ((roundRows || []) as unknown as StoredRound[]).filter((round) => !round.is_unscored),
    slots: slotRows,
    assignments: assignmentRows,
    teams: (teams || []).filter((team) => team.reserve_active !== true && team.is_placeholder !== true) as TeamRow[],
    allTeams: [...(teams || []), ...(pendingTeams || [])] as TeamRow[],
    pendingTeams: ((pendingTeams || []) as TeamRow[]).filter(
      (team) => team.reserve_active === true && team.actively_waiting === true,
    ),
    lobbyTeams: ((pendingTeams || []) as TeamRow[]).filter((team) => team.reserve_active === true),
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
  if (admissions.some((assignment) => assignment.admission_request_id)) {
    const snapshot = Array.isArray(state.season.ranking_snapshot_json) ? state.season.ranking_snapshot_json : [];
    const values = state.slots
      .filter((slot) => slot.current_team_id)
      .map((slot) => {
        const original =
          snapshot.find((row) => Number(row.seed) === slot.slot_index || row.team_id === slot.current_team_id) ||
          (slot.slot_index ? snapshot[slot.slot_index - 1] : null);
        const admission = admissions.find(
          (assignment) => assignment.tournament_season_slot_id === slot.id && assignment.admission_request_id,
        );
        const value = original ? (original.ranking_value ?? original.team_rank) : admission?.ranking_value;
        return { id: slot.current_team_id!, value: value == null ? null : Number(value) };
      });
    values.sort(
      (a, b) =>
        (a.value == null
          ? b.value == null
            ? 0
            : 1
          : b.value == null
            ? -1
            : state.tournament.league_category === 'hfi'
              ? a.value - b.value
              : b.value - a.value) || a.id.localeCompare(b.id),
    );
    return new Map(values.map((team, i) => [team.id, i + 1]));
  }
  if (readSchedulePlan(state.season.schedule_plan_json)) {
    for (const slot of state.slots)
      if (slot.current_team_id && slot.slot_index) ranks.set(slot.current_team_id, slot.slot_index);
  }
  return ranks;
}

function reservedPairings(
  state: NonNullable<Awaited<ReturnType<typeof loadLengthSeason>>>,
  roundNumber: number,
  allowUnresolvedHistory = false,
) {
  const plan = readSchedulePlan(state.season.schedule_plan_json);
  if (!plan) return null;
  if (state.assignments.some((a) => a.admission_request_id) || state.pendingTeams.length > 0) return null;
  const pairs = plan.regular_pairings![roundNumber - 1];
  if (!pairs) throw new Error('The reserved regular-round pairing plan is missing.');
  const occupants = new Map(state.slots.map((slot) => [slot.slot_index, slot.current_team_id]));
  const rosterSize = Array.isArray(state.season.ranking_snapshot_json) ? state.season.ranking_snapshot_json.length : 0;
  if (state.teams.length !== rosterSize) return null; // Reuse the repair-compatible fallback for vacancies.
  const slotIds = new Map(state.slots.map((slot) => [slot.slot_index, slot.id]));
  // Preserve the existing repair/played-history behavior if a past round was
  // missed, repaired or reoriented. The normal cycle plan must not overwrite it.
  for (const previous of state.rounds.filter(
    (round) => round.phase === 'regular' && round.round_number < roundNumber,
  )) {
    const planned = plan.regular_pairings![previous.round_number - 1];
    const expected = planned
      ?.map(
        (pair) =>
          `${slotIds.get(pair.home_slot_index)}:${pair.away_slot_index ? slotIds.get(pair.away_slot_index) : ''}`,
      )
      .sort();
    const actual = previous.matches.map((match) => `${match.home_slot_id || ''}:${match.away_slot_id || ''}`).sort();
    if (
      !expected ||
      JSON.stringify(expected) !== JSON.stringify(actual) ||
      previous.matches.some(
        (match) =>
          Boolean(match.home_team_id && match.away_team_id) &&
          (match.schedule_resolution === 'finalized_unplayed' ||
            (!allowUnresolvedHistory && !match.completed && match.status !== 'finished')),
      )
    )
      return null;
  }
  return pairs.map((pair) => {
    const home = occupants.get(pair.home_slot_index) || null;
    const away = pair.away_slot_index ? occupants.get(pair.away_slot_index) || null : null;
    if (!home) throw new Error('A reserved season slot has no participant.');
    return { homeTeamId: home, awayTeamId: away, isBye: !away };
  });
}

function playoffWinner(match: StoredMatch) {
  if (
    !match.completed ||
    !match.home_team_id ||
    !match.away_team_id ||
    match.home_goals == null ||
    match.away_goals == null
  ) {
    throw new Error('Every playoff fixture needs a completed, decisive result.');
  }
  const winner = resolveChampionshipTeam({
    homeTeamId: match.home_team_id,
    awayTeamId: match.away_team_id,
    homeGoals: match.home_goals,
    awayGoals: match.away_goals,
    went120: match.went_120,
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

function toOriginalRoundTeams(teams: TeamRow[], slots: SlotRow[], snapshot: unknown): LengthScheduleTeam[] {
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

export function findUnslottedPairingTeamIds(
  matches: Array<{ home_team_id: string | null; away_team_id: string | null }>,
  slotTeamIds: Iterable<string>,
  pendingAdmissionTeamIds: Iterable<string> = [],
) {
  const allowedIds = new Set([...slotTeamIds, ...pendingAdmissionTeamIds]);
  return [
    ...new Set(
      matches
        .flatMap((match) => [match.home_team_id, match.away_team_id])
        .filter((teamId): teamId is string => Boolean(teamId) && !allowedIds.has(teamId)),
    ),
  ];
}

export async function prepareDueLengthScheduleRounds(
  supabase: ServiceSupabase,
  tournamentId: string,
  seasonNumber: number,
  now = new Date(),
) {
  const prepared: Array<{ roundId: string; roundNumber: number }> = [];
  let lastReason: string;

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const state = await loadLengthSeason(supabase, tournamentId, seasonNumber);
    if (!state) return { prepared, reason: 'not_length_schedule' };
    const current = state.rounds
      .filter(
        (round) =>
          round.phase === 'regular' && round.round_source !== 'organizer' && round.phase_status === 'materialized',
      )
      .sort((left, right) => right.round_number - left.round_number)[0];
    if (!current) return { prepared, reason: 'no_materialized_regular_round' };
    const next = state.rounds.find(
      (round) =>
        round.round_number === current.round_number + 1 &&
        round.phase === 'regular' &&
        round.round_source !== 'organizer',
    );
    if (!next) return { prepared, reason: 'no_next_reserved_regular_round' };
    if (next.phase_status !== 'pending') return { prepared, reason: 'next_round_not_pending' };
    if (!next.reserved_slot_date || !next.reserved_slot_kind) return { prepared, reason: 'next_round_missing_slot' };
    const opensAt = getRoundPreparationOpensAt(next.reserved_slot_date, next.reserved_slot_kind);
    if (!opensAt || opensAt > now) return { prepared, reason: 'not_due', opensAt: opensAt?.toISOString() ?? null };

    let completedPreparation = false;
    for (let retry = 0; retry < 3 && !completedPreparation; retry += 1) {
      const { data: planData, error: planError } = await supabase.rpc('get_length_round_preparation_plan', {
        p_tournament_id: tournamentId,
        p_season_number: seasonNumber,
        p_current_round_id: current.id,
      });
      if (planError) {
        if (planError.code === '40001' && retry < 2) continue;
        throw planError;
      }
      const plan = planData as {
        activeTeamIds?: string[];
        teamIds?: string[];
        departingTeamIds?: string[];
        rosterVersion?: string;
      };
      const activeIds = plan.activeTeamIds || [];
      const enteringIds = plan.teamIds || [];
      const departingIds = plan.departingTeamIds || [];
      const enteringSet = new Set(enteringIds);
      const departingSet = new Set(departingIds);
      const loadedActiveIds = state.teams.map((team) => team.id).sort();
      if (JSON.stringify([...activeIds].sort()) !== JSON.stringify(loadedActiveIds)) {
        if (retry < 2) continue;
        throw new Error('Tournament membership changed while preparing the next round.');
      }
      const enteringTeams = state.pendingTeams.filter((team) => enteringSet.has(team.id));
      if (enteringTeams.length !== enteringIds.length) {
        if (retry < 2) continue;
        throw new Error('Waiting membership changed while preparing the next round.');
      }

      const roundTeamsRows = [...state.teams.filter((team) => !departingSet.has(team.id)), ...enteringTeams];
      const roundState = { ...state, teams: roundTeamsRows };
      const ranks = seasonRanks(roundState);
      const roundTeams = toLengthTeams(roundTeamsRows, ranks);
      const history = buildPairingHistory(
        state.rounds.filter(
          (round) => round.phase === 'regular' && (round.phase_status === 'completed' || round.id === current.id),
        ),
      );
      history.balanceRepeats =
        Boolean(readSchedulePlan(state.season.schedule_plan_json)) ||
        state.assignments.some((assignment) => assignment.admission_request_id) ||
        enteringTeams.length > 0;
      history.boundedCandidates =
        state.assignments.some((assignment) => assignment.admission_request_id) || enteringTeams.length > 0;
      balanceExpandedHistory(history);

      const frozenPairings =
        departingIds.length === 0
          ? reservedPairings({ ...roundState, pendingTeams: enteringTeams }, next.round_number, true)
          : null;
      const matches = buildStoredPairings(
        next,
        frozenPairings ?? generateBalancedRound(roundTeams, history, next.round_number - 1),
        roundTeams,
      );
      const unslottedIds = findUnslottedPairingTeamIds(
        matches,
        state.slots.map((slot) => slot.current_team_id).filter((id): id is string => Boolean(id)),
        enteringIds,
      );
      if (unslottedIds.length > 0) {
        const descriptions = unslottedIds.map((id) => {
          const team = roundTeamsRows.find((candidate) => candidate.id === id);
          return team ? `${team.name} (${id})` : id;
        });
        throw new Error(
          `Round ${next.round_number} includes ${descriptions.join(', ')} without a current-season slot. ` +
            'No fixtures or membership changes were written.',
        );
      }
      if (matches.some((match) => Date.parse(String(match.scheduled_for)) <= now.getTime())) {
        return { prepared, reason: 'reserved_slot_has_started', roundNumber: next.round_number };
      }
      const { data, error } = await supabase.rpc('prepare_due_length_regular_round', {
        p_tournament_id: tournamentId,
        p_season_number: seasonNumber,
        p_current_round_id: current.id,
        p_next_round_id: next.id,
        p_matches: matches,
        p_pending_team_ids: enteringIds,
        p_active_team_ids: activeIds,
        p_roster_version: plan.rosterVersion,
      });
      if (error) {
        if (error.code === '40001' && retry < 2) continue;
        throw error;
      }
      if (data?.prepared === true) {
        prepared.push({ roundId: next.id, roundNumber: next.round_number });
        completedPreparation = true;
      } else {
        lastReason = typeof data?.reason === 'string' ? data.reason : 'not_prepared';
        return { prepared, reason: lastReason, opensAt: opensAt.toISOString() };
      }
    }
    if (!completedPreparation) return { prepared, reason: 'membership_changed' };
  }
  return { prepared, reason: 'preparation_limit_reached' };
}

function balanceExpandedHistory(history: PairingHistory) {
  if (!history.boundedCandidates) return;
  // Late entrants have fewer appearances. Compare home bias per appearance,
  // rather than giving every newcomer home games until older totals catch up.
  const appearances: Record<string, number> = {};
  for (const pair of history.playedPairs || []) for (const id of pair) appearances[id] = (appearances[id] || 0) + 1;
  history.homeCounts = Object.fromEntries(
    Object.entries(appearances).map(([id, count]) => [id, (history.homeCounts?.[id] || 0) - count / 2]),
  );
}

export async function progressLengthSchedule(
  supabase: ServiceSupabase,
  tournamentId: string,
  seasonNumber: number,
  retry = 0,
): Promise<{ advanced: boolean; reason?: string; [key: string]: unknown }> {
  const { data: admission, error: admissionError } = await supabase.rpc('get_waiting_admission_plan', {
    p_tournament_id: tournamentId,
    p_season_number: seasonNumber,
    p_for_transition: true,
  });
  if (admissionError) throw admissionError;
  const plan = admission as {
    teamIds: string[];
    activeTeamIds: string[];
    departingTeamIds?: string[];
    rosterVersion: string;
  };
  let state = await loadLengthSeason(supabase, tournamentId, seasonNumber);
  if (!state) return { advanced: false, reason: 'not_length_schedule' };
  let completedAdditionalRound = false;
  for (const round of state.rounds.filter(
    (round) => round.round_source === 'organizer' && round.phase_status === 'materialized',
  )) {
    const ready = round.matches.every(isResolvedMatch);
    if (!ready) continue;
    const result = await supabase.rpc('apply_length_round_transition', {
      p_tournament_id: tournamentId,
      p_season_number: seasonNumber,
      p_completed_round_id: round.id,
      p_next_round_id: null,
      p_matches: [],
      p_champion_team_id: null,
    });
    if (result.error) throw result.error;
    completedAdditionalRound ||= result.data?.advanced === true;
    if (result.data?.advanced) {
      const warnings = await supabase
        .from('fixture_warnings')
        .update({ active: false })
        .eq('round_id', round.id)
        .eq('active', true);
      if (warnings.error) throw warnings.error;
    }
  }
  if (completedAdditionalRound) {
    const refreshed = await loadLengthSeason(supabase, tournamentId, seasonNumber);
    if (!refreshed) return { advanced: true, reason: 'season_changed' };
    state = refreshed;
  }
  const current = state.rounds.find(
    (round) => round.round_source !== 'organizer' && round.phase_status === 'materialized',
  );
  if (!current) return { advanced: completedAdditionalRound, reason: 'no_materialized_round' };
  if (current.matches.some((match) => !isResolvedMatch(match))) {
    return { advanced: false, reason: 'round_unresolved' };
  }
  const next =
    state.rounds.find(
      (round) => round.round_source !== 'organizer' && round.round_number === current.round_number + 1,
    ) || null;
  if (
    (next?.phase === 'postseason' || !next) &&
    state.rounds.some((round) => round.round_source === 'organizer' && round.phase_status !== 'completed')
  ) {
    return { advanced: completedAdditionalRound, reason: 'additional_regular_round_unresolved' };
  }
  const activeTeamIds = state.teams.map((team) => team.id);
  const roundState =
    next?.phase === 'regular' && plan.departingTeamIds?.length
      ? { ...state, teams: state.teams.filter((team) => !plan.departingTeamIds!.includes(team.id)) }
      : state;
  const ranks = seasonRanks(roundState);
  const lengthTeams = toLengthTeams(roundState.teams, ranks);
  let nextMatches: Array<Record<string, unknown>> = [];
  let championTeamId: string | null = null;

  if (next?.phase === 'regular') {
    const enteringTeams = state.pendingTeams.filter((team) => plan.teamIds.includes(team.id));
    const roundTeams = toLengthTeams([...roundState.teams, ...enteringTeams], ranks);
    const versionTwo = Boolean(readSchedulePlan(state.season.schedule_plan_json));
    const history = buildPairingHistory(
      state.rounds
        .filter((round) => round.id === current.id || round.phase_status === 'completed')
        .map((round) =>
          versionTwo && round.id === current.id ? { ...round, phase_status: 'completed' as const } : round,
        ),
    );
    history.balanceRepeats =
      versionTwo || state.assignments.some((a) => a.admission_request_id) || enteringTeams.length > 0;
    history.boundedCandidates = state.assignments.some((a) => a.admission_request_id) || enteringTeams.length > 0;
    balanceExpandedHistory(history);
    nextMatches = buildStoredPairings(
      next,
      reservedPairings({ ...roundState, pendingTeams: enteringTeams }, next.round_number) ??
        generateBalancedRound(roundTeams, history, next.round_number - 1),
      roundTeams,
    );
  } else if (next?.phase === 'postseason') {
    const plan = readSchedulePlan(state.season.schedule_plan_json);
    if (current.phase === 'postseason') {
      const matches = [...current.matches].sort(
        (a, b) => (a.playoff_match_number || 1) - (b.playoff_match_number || 1),
      );
      const currentPhaseRound =
        current.phase_round_number ||
        state.rounds.filter((round) => round.phase === 'postseason' && round.round_number <= current.round_number)
          .length;
      const expectedMatches = 2 ** ((plan?.postseason_rounds || 1) - currentPhaseRound);
      if (matches.length !== expectedMatches || matches.length < 2)
        throw new Error('The preceding playoff round is incomplete.');
      const winners = matches.map(playoffWinner);
      const pairs = Array.from({ length: winners.length / 2 }, (_, i) => ({
        homeTeamId: winners[i * 2]!,
        awayTeamId: winners[i * 2 + 1]!,
        isBye: false,
      }));
      nextMatches = buildStoredPairings(next, pairs, lengthTeams).map((match, i) => ({
        ...match,
        playoff_match_number: i + 1,
      }));
    } else {
      const regularMatches = state.rounds
        .filter((round) => round.phase === 'regular')
        .flatMap((round) => round.matches)
        .filter((match) => match.schedule_resolution !== 'finalized_unplayed');
      const standings = calculateSeasonSlotStandings(
        state.allTeams.map(
          (team): Team => ({
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
          }),
        ),
        regularMatches.map((match) => ({
          ...match,
          total_minutes: match.total_minutes ?? undefined,
        })),
        state.slots,
        state.tournament.scoring_mode as PersistedScoringMode,
        state.assignments,
        true,
      );
      const activeIds = new Set(state.teams.map((team) => team.id));
      const eligibleStandings = standings.filter((standing) => activeIds.has(standing.teamId));
      const qualifierCount = 2 ** (plan?.postseason_rounds || 1);
      if (eligibleStandings.length < qualifierCount)
        throw new Error('Regular standings do not contain enough active playoff qualifiers.');
      const qualifiers = eligibleStandings.slice(0, qualifierCount).map((standing) => standing.teamId);
      nextMatches = buildStoredPairings(next, seedPlayoffPairings(qualifiers), lengthTeams).map((match, i) => ({
        ...match,
        ...(plan ? { playoff_match_number: i + 1 } : {}),
      }));
    }
  } else if (!next && current.phase === 'postseason') {
    const finalMatch = current.matches.find((match) => match.home_team_id && match.away_team_id && match.completed);
    if (
      !finalMatch?.home_team_id ||
      !finalMatch.away_team_id ||
      finalMatch.home_goals == null ||
      finalMatch.away_goals == null
    ) {
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
    .filter(
      (round) =>
        round.phase_status === 'completed' &&
        round.matches.some((match) => match.schedule_resolution === 'finalized_unplayed'),
    )
    .map((round) => round.id);

  const transitionArgs = {
    p_tournament_id: tournamentId,
    p_season_number: seasonNumber,
    p_completed_round_id: current.id,
    p_next_round_id: next?.id || null,
    p_matches: nextMatches,
    p_champion_team_id: championTeamId,
    p_active_team_ids: activeTeamIds,
    p_roster_version: plan.rosterVersion,
    p_pending_team_ids:
      next?.phase === 'regular'
        ? state.pendingTeams.filter((team) => plan.teamIds.includes(team.id)).map((team) => team.id)
        : [],
  };
  const { data, error } =
    next?.phase_status === 'materialized'
      ? await supabase.rpc('apply_length_round_transition', {
          p_tournament_id: tournamentId,
          p_season_number: seasonNumber,
          p_completed_round_id: current.id,
          p_next_round_id: next.id,
          p_matches: [],
          p_champion_team_id: null,
        })
      : await supabase.rpc('apply_length_round_transition_with_membership', transitionArgs);
  if (error) {
    if (
      ['40001', 'P0001'].includes(error.code || '') &&
      error.message === 'Round is not ready; membership remains unchanged'
    ) {
      return { advanced: false, reason: 'round_not_ready' };
    }
    if (error.code === '40001' && retry < 2)
      return progressLengthSchedule(supabase, tournamentId, seasonNumber, retry + 1);
    throw error;
  }

  // Keep any prior finalized-unplayed warning as history while clearing its
  // active state after the round's legitimate completion transition.
  const warningRoundIds = [...new Set([...finalizedWarningRoundIds])];
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

export async function recoverLengthRoundOne(supabase: ServiceSupabase, tournamentId: string, seasonNumber: number) {
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
  if (state.assignments.some((a) => a.admission_request_id))
    throw new Error('Original Round 1 recovery is unavailable after reserve admission.');
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
  requestedRoundId?: string | null,
) {
  const state = await loadLengthSeason(supabase, tournamentId, seasonNumber);
  if (!state) throw new Error('This tournament does not use staged length scheduling.');
  const current = state.rounds.find(
    (round) =>
      (!requestedRoundId || round.id === requestedRoundId) &&
      round.phase_status === 'materialized' &&
      round.phase === 'regular' &&
      round.round_source !== 'organizer' &&
      !round.is_unscored,
  );
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
  if (
    protectedMatches.some(
      (match) =>
        match.completed ||
        match.status === 'ongoing' ||
        match.status === 'finished' ||
        Boolean(match.finished_at) ||
        Boolean(match.scheduled_for && new Date(match.scheduled_for).getTime() <= Date.now()),
    )
  ) {
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
    (Boolean(match.home_slot_id) && !match.home_team_id) || (Boolean(match.away_slot_id) && !match.away_team_id);
  const unprotectedByes = current.matches.filter(
    (match) => !protectedMatches.includes(match) && Boolean(match.home_team_id) !== Boolean(match.away_team_id),
  );
  const excessByeMatches = unprotectedByes.length > 1 ? unprotectedByes : [];
  if (
    unavailableTeamIds.length === 0 &&
    excessByeMatches.length === 0 &&
    !current.matches.some((match) => !protectedMatches.includes(match) && hasVacantSlot(match))
  ) {
    throw new Error('No booked-elsewhere teams, vacant fixtures, or excess BYEs were detected in this round.');
  }
  const affectedMatches = current.matches.filter(
    (match) =>
      !protectedMatches.includes(match) &&
      (excessByeMatches.includes(match) ||
        hasVacantSlot(match) ||
        Boolean(
          (match.home_team_id && unavailableTeamIds.includes(match.home_team_id)) ||
          (match.away_team_id && unavailableTeamIds.includes(match.away_team_id)),
        )),
  );
  if (affectedMatches.length === 0) throw new Error('No repairable affected fixtures were detected.');
  const untouchedMatches = current.matches.filter((match) => !affectedMatches.includes(match));
  const ranks = seasonRanks(state);
  const lengthTeams = toLengthTeams(state.teams, ranks);
  const history = buildPairingHistory(state.rounds.filter((round) => round.round_number < current.round_number));
  history.balanceRepeats =
    Boolean(readSchedulePlan(state.season.schedule_plan_json)) || state.assignments.some((a) => a.admission_request_id);
  history.boundedCandidates = true;
  balanceExpandedHistory(history);
  const repair = buildRoundRepair({
    teams: lengthTeams,
    lockedPairs: untouchedMatches.flatMap((match) =>
      match.home_team_id && match.away_team_id ? [[match.home_team_id, match.away_team_id] as [string, string]] : [],
    ),
    lockedTeamIds: untouchedMatches.flatMap((match) =>
      [match.home_team_id, match.away_team_id].filter((id): id is string => Boolean(id)),
    ),
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
    roundNumber: current.round_number,
    lockedFixtures: untouchedMatches.filter((match) => match.home_team_id && match.away_team_id).length,
    unavailableTeams: unavailableTeamIds.length,
    repairedPlayableFixtures: repair.repairedPairs.filter((pairing) => !pairing.isBye).length,
    containedUnplayableFixtures: repair.containmentPairs.length,
    byeFixturesCreated: repair.repairedPairs.filter((pairing) => pairing.isBye).length,
  };
}

export interface RoundRepairSelection {
  keepMatchIds: string[];
  lobbyTeamIds: string[];
  shuffleIndex?: number;
}

function repairRoundFromState(state: NonNullable<Awaited<ReturnType<typeof loadLengthSeason>>>, roundId: string) {
  const round = state.rounds.find(
    (item) =>
      item.id === roundId &&
      item.phase === 'regular' &&
      item.phase_status === 'materialized' &&
      item.round_source !== 'organizer' &&
      !item.is_unscored,
  );
  if (!round || !round.reserved_slot_date || !round.reserved_slot_kind)
    throw new Error('Choose an available generated regular round.');
  const closesAt = getRoundManagementClosesAt(round.reserved_slot_date);
  if (!closesAt || Date.now() >= closesAt.getTime()) {
    throw new Error('Round management closed after Monday 23:59 Hattrick time.');
  }
  if (
    round.matches.some(
      (match) =>
        match.completed ||
        match.status === 'ongoing' ||
        match.status === 'finished' ||
        match.finished_at ||
        (match.scheduled_for && new Date(match.scheduled_for).getTime() <= Date.now()),
    )
  ) {
    throw new Error('This round has started and can no longer be changed.');
  }
  return round;
}

async function inspectRoundBookings(
  supabase: ServiceSupabase,
  state: NonNullable<Awaited<ReturnType<typeof loadLengthSeason>>>,
  round: StoredRound,
) {
  const gatewayResult = await supabase
    .from('teams')
    .select('id, oauth_token, oauth_token_secret')
    .eq('tournament_id', state.tournament.id)
    .not('oauth_token', 'is', null)
    .not('oauth_token_secret', 'is', null);
  if (gatewayResult.error) throw gatewayResult.error;
  const gateway = gatewayResult.data?.[0];
  if (
    !gateway?.oauth_token ||
    !gateway.oauth_token_secret ||
    !process.env.CHPP_CONSUMER_KEY ||
    !process.env.CHPP_CONSUMER_SECRET
  ) {
    throw new Error('A connected Hattrick manager is needed to check bookings before repairing this round.');
  }
  const byHtId = new Map(state.teams.filter((team) => team.ht_team_id).map((team) => [team.ht_team_id, team]));
  const credentialsByTeamId = new Map((gatewayResult.data || []).map((team) => [team.id, team]));
  const observations = new Map<
    string,
    { matchId: number; matchType: number; opponentHtId: number; homeHtId: number; date: string }
  >();
  // CHPP is queried only for this explicit repair action, in small batches.
  for (let start = 0; start < state.teams.length; start += 5) {
    const batch = state.teams.slice(start, start + 5);
    const results = await Promise.all(
      batch.map(async (team) => {
        if (!team.ht_team_id) throw new Error(`The Hattrick ID for ${team.name} is missing.`);
        const booking = await fetchTeamBookingStatus(
          process.env.CHPP_CONSUMER_KEY!,
          process.env.CHPP_CONSUMER_SECRET!,
          credentialsByTeamId.get(team.id) || gateway,
          team.ht_team_id,
        );
        if (!booking.scheduledMatches) throw new Error(`Could not verify the Hattrick bookings for ${team.name}.`);
        const inWindow = booking.scheduledMatches.filter((match) => {
          const date = parseChppStockholmDate(match.matchDate);
          return (
            isBookedFriendlyMatch(match) &&
            date &&
            isFriendlyInsideAcceptedWindow(date, new Date(round.reserved_slot_date!), round.reserved_slot_kind!)
          );
        });
        if (inWindow.length > 1) throw new Error(`Multiple bookings were found for ${team.name} in this round.`);
        const match = inWindow[0];
        return { team, match, date: match ? parseChppStockholmDate(match.matchDate) : null };
      }),
    );
    for (const { team, match, date } of results) {
      if (!match) continue;
      if (!date || !match.matchId || ![match.homeTeamId, match.awayTeamId].includes(team.ht_team_id!)) {
        throw new Error(`Could not verify the booking for ${team.name}.`);
      }
      observations.set(team.id, {
        matchId: match.matchId,
        matchType: match.matchType,
        opponentHtId: match.homeTeamId === team.ht_team_id ? match.awayTeamId : match.homeTeamId,
        homeHtId: match.homeTeamId,
        date: date.toISOString(),
      });
    }
  }
  const crossBookings: Array<{
    home_team_id: string;
    away_team_id: string;
    ht_match_id: number;
    match_type: number;
    scheduled_for: string;
  }> = [];
  const externalTeamIds: string[] = [];
  const seen = new Set<number>();
  for (const team of state.teams) {
    const observed = observations.get(team.id);
    if (!observed || seen.has(observed.matchId)) continue;
    const opponent = byHtId.get(observed.opponentHtId);
    const reciprocal = opponent && observations.get(opponent.id);
    if (!opponent) {
      externalTeamIds.push(team.id);
      continue;
    }
    if (!reciprocal || reciprocal.matchId !== observed.matchId || reciprocal.opponentHtId !== team.ht_team_id) {
      throw new Error(`The booking for ${team.name} could not be confirmed from both teams.`);
    }
    seen.add(observed.matchId);
    // CHPP side ordering is not needed for the pairing, but preserving it avoids
    // reversing a booked fixture when it is recorded in the round.
    const booked = state.teams.find((candidate) => candidate.ht_team_id === observed.opponentHtId)!;
    const home = team.ht_team_id === observed.homeHtId ? team.id : booked.id;
    crossBookings.push({
      home_team_id: home,
      away_team_id: home === team.id ? booked.id : team.id,
      ht_match_id: observed.matchId,
      match_type: observed.matchType,
      scheduled_for: observed.date,
    });
  }
  return { crossBookings, externalTeamIds };
}

export async function inspectLengthRoundRepair(
  supabase: ServiceSupabase,
  tournamentId: string,
  seasonNumber: number,
  roundId: string,
) {
  const state = await loadLengthSeason(supabase, tournamentId, seasonNumber);
  if (!state) throw new Error('This tournament does not use staged length scheduling.');
  const round = repairRoundFromState(state, roundId);
  const bookings = await inspectRoundBookings(supabase, state, round);
  const warningResult = await supabase
    .from('fixture_warnings')
    .select('team_id')
    .eq('round_id', roundId)
    .eq('active', true);
  if (warningResult.error) throw warningResult.error;
  const warningTeamIds = [
    ...new Set([...(warningResult.data || []).map((item) => item.team_id), ...bookings.externalTeamIds]),
  ];
  const crossIds = new Set(bookings.crossBookings.flatMap((pair) => [pair.home_team_id, pair.away_team_id]));
  const protectedMatchIds = round.matches
    .filter((match) => match.ht_match_id || match.status === 'arranged')
    .map((match) => match.id);
  const protectedIds = new Set(
    round.matches
      .filter((match) => protectedMatchIds.includes(match.id))
      .flatMap((match) => [match.home_team_id, match.away_team_id].filter((id): id is string => Boolean(id))),
  );
  if (bookings.externalTeamIds.some((id) => protectedIds.has(id))) {
    throw new Error('A Hattrick booking conflicts with a protected fixture. Refresh fixtures and resolve it first.');
  }
  for (const pair of bookings.crossBookings) {
    const existing = round.matches.find((match) => match.ht_match_id === pair.ht_match_id);
    if (
      (protectedIds.has(pair.home_team_id) || protectedIds.has(pair.away_team_id)) &&
      (!existing ||
        ![existing.home_team_id, existing.away_team_id].includes(pair.home_team_id) ||
        ![existing.home_team_id, existing.away_team_id].includes(pair.away_team_id))
    ) {
      throw new Error(
        'A Hattrick booking conflicts with an already protected fixture. Refresh fixtures and resolve it first.',
      );
    }
  }
  const defaultKeepMatchIds = round.matches
    .filter(
      (match) =>
        protectedMatchIds.includes(match.id) ||
        ((!match.home_team_id || !warningTeamIds.includes(match.home_team_id)) &&
          (!match.away_team_id || !warningTeamIds.includes(match.away_team_id)) &&
          (!match.home_team_id || !crossIds.has(match.home_team_id)) &&
          (!match.away_team_id || !crossIds.has(match.away_team_id)) &&
          match.status !== 'misarranged' &&
          Boolean(match.home_team_id || match.away_team_id)),
    )
    .map((match) => match.id);
  return { roundId, defaultKeepMatchIds, protectedMatchIds, warningTeamIds, ...bookings };
}

export async function reviewLengthRoundRepair(
  supabase: ServiceSupabase,
  tournamentId: string,
  seasonNumber: number,
  roundId: string,
  selection: RoundRepairSelection,
) {
  const shuffleIndex = selection.shuffleIndex ?? 0;
  if (!Number.isSafeInteger(shuffleIndex) || shuffleIndex < 0 || shuffleIndex > 100)
    throw new Error('Invalid reshuffle index.');
  const state = await loadLengthSeason(supabase, tournamentId, seasonNumber);
  if (!state) throw new Error('This tournament does not use staged length scheduling.');
  const round = repairRoundFromState(state, roundId);
  const inspected = await inspectLengthRoundRepair(supabase, tournamentId, seasonNumber, roundId);
  const unique = (ids: string[]) => ids.length === new Set(ids).size;
  if (![selection.keepMatchIds, selection.lobbyTeamIds].every((ids) => Array.isArray(ids) && unique(ids))) {
    throw new Error('The round selection contains duplicate or invalid teams.');
  }
  const allowedKeeps = new Set(inspected.defaultKeepMatchIds);
  const keptIds = new Set([...selection.keepMatchIds, ...inspected.protectedMatchIds]);
  if (selection.keepMatchIds.some((id) => !allowedKeeps.has(id))) throw new Error('A selected fixture cannot be kept.');
  const keptMatches = round.matches.filter((match) => keptIds.has(match.id));
  const crossExisting = new Set(inspected.crossBookings.map((pair) => pair.ht_match_id));
  const newCrossBookings = inspected.crossBookings.filter(
    (pair) => !round.matches.some((match) => match.ht_match_id === pair.ht_match_id),
  );
  const taken = new Set(
    keptMatches.flatMap((match) => [match.home_team_id, match.away_team_id].filter((id): id is string => Boolean(id))),
  );
  for (const pair of inspected.crossBookings) {
    taken.add(pair.home_team_id);
    taken.add(pair.away_team_id);
  }
  const eligibleLobby = new Set(state.lobbyTeams.map((team) => team.id));
  if (selection.lobbyTeamIds.some((id) => !eligibleLobby.has(id)))
    throw new Error('A selected Lobby team is no longer available.');
  if (selection.lobbyTeamIds.length) {
    const { checkReserveAdmission } = await import('./reserve-admission.js');
    const admission = await checkReserveAdmission(supabase, tournamentId, selection.lobbyTeamIds, {
      roundId,
      persistRankings: false,
      mixedRoundRepair: true,
    });
    if (!admission.canAdmit)
      throw new Error(
        admission.statuses.find((status) => status.error)?.error || 'A selected Lobby team is unavailable.',
      );
    if (state.tournament && admission.newFieldSize > (Number(state.tournament.max_teams) || Infinity)) {
      throw new Error('Increase the team limit before admitting these Lobby teams.');
    }
  }
  const activeIds = new Set(state.teams.map((team) => team.id));
  const crossBookedIds = new Set(inspected.crossBookings.flatMap((pair) => [pair.home_team_id, pair.away_team_id]));

  const unavailable = new Set(inspected.warningTeamIds.filter((id) => activeIds.has(id) && !crossBookedIds.has(id)));
  const freeTeams = [
    ...state.teams.filter((team) => !taken.has(team.id) && !unavailable.has(team.id)),
    ...state.lobbyTeams.filter((team) => selection.lobbyTeamIds.includes(team.id)),
  ];
  const ranks = seasonRanks(state);
  const history = buildPairingHistory(state.rounds.filter((item) => item.round_number < round.round_number));
  history.balanceRepeats =
    Boolean(readSchedulePlan(state.season.schedule_plan_json)) || state.assignments.some((a) => a.admission_request_id);
  history.boundedCandidates = true;
  balanceExpandedHistory(history);
  const rankedTeams = toLengthTeams([...state.teams, ...state.lobbyTeams], ranks).map((team) => {
    const lobby = state.lobbyTeams.find((item) => item.id === team.id);
    return lobby
      ? { ...team, teamRank: state.tournament.league_category === 'hfi' ? lobby.team_rank : lobby.power_rating }
      : team;
  });
  const pairings = freeTeams.length
    ? generateBalancedRound(
        rankedTeams.filter((team) => freeTeams.some((item) => item.id === team.id)),
        history,
        0,
        shuffleIndex,
      )
    : [];
  const allTeams = rankedTeams;
  const generated = buildStoredPairings(round, pairings, allTeams);
  const byeIds = [...unavailable].filter((id) => !taken.has(id));
  const byes = buildStoredPairings(
    round,
    byeIds.map((id) => ({ homeTeamId: id, awayTeamId: null, isBye: true })),
    allTeams,
  ).map((item) => ({
    ...item,
    schedule_resolution: unavailable.has(item.home_team_id!) ? 'finalized_unplayed' : 'pending',
  }));
  const expectedMatchIds = round.matches.map((match) => match.id).sort();
  const expectedMatches = round.matches
    .map((match) => ({
      id: match.id,
      home_team_id: match.home_team_id,
      away_team_id: match.away_team_id,
      ht_match_id: match.ht_match_id,
      status: match.status,
      schedule_resolution: match.schedule_resolution,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const proposal = {
    roundId,
    keptMatchIds: [...keptIds].sort(),
    expectedMatchIds,
    expectedMatches,
    lobbyTeamIds: [...selection.lobbyTeamIds].sort(),
    shuffleIndex,
    matches: [...generated, ...byes, ...newCrossBookings.map((pair) => ({ ...pair, schedule_resolution: 'pending' }))],
    crossBookingIds: [...crossExisting].sort(),
  };
  const proposalHash = createHash('sha256').update(JSON.stringify(proposal)).digest('hex');
  return { ...proposal, proposalHash, keptFixtures: keptMatches.length, newFixtures: proposal.matches.length };
}

export async function confirmLengthRoundRepair(
  supabase: ServiceSupabase,
  tournamentId: string,
  seasonNumber: number,
  roundId: string,
  selection: RoundRepairSelection,
  proposalHash: string,
) {
  const review = await reviewLengthRoundRepair(supabase, tournamentId, seasonNumber, roundId, selection);
  if (review.proposalHash !== proposalHash) throw new Error('The bookings or round changed. Review the repair again.');
  const { data, error } = await supabase.rpc('apply_reviewed_length_round_repair', {
    p_tournament_id: tournamentId,
    p_season_number: seasonNumber,
    p_round_id: roundId,
    p_expected_match_ids: review.expectedMatchIds,
    p_expected_matches: review.expectedMatches,
    p_kept_match_ids: review.keptMatchIds,
    p_lobby_team_ids: review.lobbyTeamIds,
    p_matches: review.matches,
  });
  if (error) throw error;
  return data;
}
