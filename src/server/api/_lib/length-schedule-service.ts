import {
  buildRoundRepair,
  generateBalancedRound,
  resolveChampionshipTeam,
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
}

interface SlotRow {
  id: string;
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
    supabase.from('tournaments').select('id, schedule_mode, scoring_mode').eq('id', tournamentId).maybeSingle(),
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
          id, round_number, phase, phase_status, reserved_slot_id, reserved_slot_kind, reserved_slot_date,
          matches (
            id, home_team_id, away_team_id, home_slot_id, away_slot_id, status, completed,
            home_goals, away_goals, went_120, total_minutes,
            penalty_shootout_home_goals, penalty_shootout_away_goals, schedule_resolution,
            ht_match_id, scheduled_for, finished_at
          )
        `)
        .eq('tournament_id', tournamentId)
        .eq('season_number', seasonNumber)
        .order('round_number'),
      supabase.from('tournament_season_slots').select('id, current_team_id').eq('tournament_season_id', season.id),
    ]);
  if (roundsError) throw roundsError;
  if (slotsError) throw slotsError;

  const slotRows = (slots || []) as SlotRow[];
  let assignmentRows: SeasonSlotAssignment[] = [];
  if (slotRows.length > 0) {
    const assignmentResult = await supabase
      .from('tournament_season_slot_assignments')
      .select('id, tournament_season_slot_id, team_id, assigned_at, released_at, team_name, ht_team_id, manager_name, hattrick_user_id, logo_url')
      .in('tournament_season_slot_id', slotRows.map((slot) => slot.id));
    if (assignmentResult.error) throw assignmentResult.error;
    assignmentRows = (assignmentResult.data || []) as SeasonSlotAssignment[];
  }

  const teamIds = slotRows.map((slot) => slot.current_team_id).filter((id): id is string => Boolean(id));
  const { data: teams, error: teamsError } = teamIds.length
    ? await supabase
        .from('teams')
        .select('id, name, ht_team_id, hattrick_user_id, active, replacement_for_team_id, country_name, country_id, league_id, league_level, logo_url, manager_name, team_rank, reserve_active')
        .in('id', teamIds)
    : { data: [], error: null };
  if (teamsError) throw teamsError;
  return {
    tournament,
    season,
    rounds: (roundRows || []) as unknown as StoredRound[],
    slots: slotRows,
    assignments: assignmentRows,
    teams: (teams || []) as TeamRow[],
  };
}

function rankingMap(snapshot: unknown) {
  const map = new Map<string, number>();
  if (!Array.isArray(snapshot)) return map;
  for (const row of snapshot) {
    if (!row || typeof row !== 'object') continue;
    const teamId = 'team_id' in row ? String(row.team_id) : '';
    const rank = 'team_rank' in row ? Number(row.team_rank) : NaN;
    if (teamId && Number.isInteger(rank) && rank > 0) map.set(teamId, rank);
  }
  return map;
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

export async function progressLengthSchedule(
  supabase: ServiceSupabase,
  tournamentId: string,
  seasonNumber: number,
) {
  const state = await loadLengthSeason(supabase, tournamentId, seasonNumber);
  if (!state) return { advanced: false, reason: 'not_length_schedule' };
  const current = state.rounds.find((round) => round.phase_status === 'materialized');
  if (!current || current.matches.some((match) => !isResolvedMatch(match))) {
    return { advanced: false, reason: current ? 'round_unresolved' : 'no_materialized_round' };
  }
  const next = state.rounds.find((round) => round.round_number === current.round_number + 1) || null;
  const ranks = rankingMap(state.season.ranking_snapshot_json);
  const lengthTeams = toLengthTeams(state.teams, ranks);
  let nextMatches: Array<Record<string, unknown>> = [];
  let championTeamId: string | null = null;

  if (next?.phase === 'regular') {
    const history = buildPairingHistory(state.rounds.filter((round) => round.round_number <= current.round_number));
    nextMatches = buildStoredPairings(
      next,
      generateBalancedRound(lengthTeams, history, next.round_number - 1),
      lengthTeams,
    );
  } else if (next?.phase === 'postseason') {
    const regularMatches = state.rounds
      .filter((round) => round.phase === 'regular')
      .flatMap((round) => round.matches)
      .filter((match) => match.schedule_resolution !== 'finalized_unplayed');
    const standings = calculateSeasonSlotStandings(
      state.teams.map((team): Team => ({
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
    );
    const occupiedSlots = new Map(
      state.slots.flatMap((slot) => (slot.current_team_id ? [[slot.id, slot.current_team_id] as const] : [])),
    );
    const eligibleStandings = standings.filter((standing) => occupiedSlots.has(standing.teamId));
    if (eligibleStandings.length < 2) throw new Error('Regular standings do not contain two active finalists.');
    nextMatches = buildStoredPairings(next, [{
      homeTeamId: occupiedSlots.get(eligibleStandings[0]!.teamId)!,
      awayTeamId: occupiedSlots.get(eligibleStandings[1]!.teamId)!,
      isBye: false,
    }], lengthTeams);
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

  const { data, error } = await supabase.rpc('apply_length_round_transition', {
    p_tournament_id: tournamentId,
    p_season_number: seasonNumber,
    p_completed_round_id: current.id,
    p_next_round_id: next?.id || null,
    p_matches: nextMatches,
    p_champion_team_id: championTeamId,
  });
  if (error) throw error;
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

  // This deliberately ignores current Round 1 matches. The frozen TeamRank
  // snapshot plus current physical season-slot occupants are the only inputs
  // used to recreate the original deterministic pairing and orientation.
  const originalTeams = toOriginalRoundTeams(state.teams, state.slots, state.season.ranking_snapshot_json);
  const originalPairings = generateBalancedRound(originalTeams, {}, 0);
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
        match.home_team_id &&
          match.away_team_id &&
          (match.ht_match_id ||
            match.status === 'arranged' ||
            match.status === 'ongoing' ||
            match.status === 'finished' ||
            (match.scheduled_for && new Date(match.scheduled_for).getTime() <= Date.now())),
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
  if (unavailableTeamIds.length === 0) throw new Error('No booked-elsewhere teams were detected in this round.');
  const affectedMatches = current.matches.filter(
    (match) =>
      !protectedMatches.includes(match) &&
      Boolean(
        (match.home_team_id && unavailableTeamIds.includes(match.home_team_id)) ||
          (match.away_team_id && unavailableTeamIds.includes(match.away_team_id)),
      ),
  );
  if (affectedMatches.length === 0) throw new Error('No repairable affected fixtures were detected.');
  const untouchedMatches = current.matches.filter((match) => !affectedMatches.includes(match));
  const ranks = rankingMap(state.season.ranking_snapshot_json);
  const lengthTeams = toLengthTeams(state.teams, ranks);
  const history = buildPairingHistory(state.rounds.filter((round) => round.round_number < current.round_number));
  const repair = buildRoundRepair({
    teams: lengthTeams,
    lockedPairs: untouchedMatches.flatMap((match) =>
      match.home_team_id && match.away_team_id ? [[match.home_team_id, match.away_team_id] as [string, string]] : [],
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
    lockedFixtures: untouchedMatches.filter((match) => match.home_team_id && match.away_team_id).length,
    unavailableTeams: unavailableTeamIds.length,
    repairedPlayableFixtures: repair.repairedPairs.filter((pairing) => !pairing.isBye).length,
  };
}
