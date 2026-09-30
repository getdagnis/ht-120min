import {
  buildCalendarSlots,
  formatCalendarDate,
  getDaysUntil,
  getScheduledDateForSlot,
  getSignedDaysUntil,
  type CalendarSlot,
  type HattrickScheduleSlotKind,
  type TeamSchedulingInfo,
} from './hattrick-calendar.js';

export type CompetitionPhase = 'regular' | 'postseason';
export type RoundPhaseStatus = 'pending' | 'materialized' | 'completed';
export type LengthScheduleFormatKind = 'balanced' | 'round_robin' | 'round_robin_plus_final';

export interface LengthScheduleTeam extends TeamSchedulingInfo {
  id: string;
  name: string;
  teamRank: number | null;
  active?: boolean;
  isPlaceholder?: boolean;
}

export interface LengthScheduleFormat {
  id: string;
  kind: LengthScheduleFormatKind;
  totalRounds: number;
  regularRounds: number;
  postseasonRounds: number;
  label: string;
}

export interface PairingHistory {
  playedPairs?: Array<[string, string]>;
  homeCounts?: Record<string, number>;
  byeCounts?: Record<string, number>;
}

export interface LengthSchedulePairing {
  homeTeamId: string | null;
  awayTeamId: string | null;
  isBye: boolean;
}

export interface LengthScheduleRound {
  roundNumber: number;
  phase: CompetitionPhase;
  phaseRoundNumber: number;
  phaseStatus: RoundPhaseStatus;
  slot: CalendarSlot;
  displayDate: Date;
  displayDateLabel: string;
  matches: Array<
    LengthSchedulePairing & {
      homeTeamName: string;
      awayTeamName: string;
      scheduledFor: Date;
      scheduleSlotType: HattrickScheduleSlotKind;
    }
  >;
}

export interface LengthScheduleDraft {
  valid: boolean;
  reason: string | null;
  teams: LengthScheduleTeam[];
  teamCount: number;
  startSlotOptions: CalendarSlot[];
  selectedStartSlot: CalendarSlot | null;
  selectedStartSlotId: string | null;
  daysUntilStart: number | null;
  safeSlots: CalendarSlot[];
  safeRoundCount: number;
  htSeason: number | null;
  formats: LengthScheduleFormat[];
  selectedFormat: LengthScheduleFormat | null;
  rounds: LengthScheduleRound[];
}

export interface SerializedLengthSchedulePayload {
  version: 1;
  mode: 'length';
  team_count: number;
  total_rounds: number;
  regular_rounds: number;
  postseason_rounds: number;
  format: LengthScheduleFormatKind;
  ranking_source: 'team_rank';
  ranking_snapshot: Array<{ team_id: string; team_rank: number }>;
  start_slot_id: string;
  start_slot_kind: HattrickScheduleSlotKind;
  start_slot_date: string;
  rounds: Array<{
    round_number: number;
    phase: CompetitionPhase;
    phase_round_number: number;
    phase_status: RoundPhaseStatus;
    slot_id: string;
    slot_kind: HattrickScheduleSlotKind;
    slot_date: string;
    display_date: string;
    matches: Array<{
      home_team_id: string | null;
      away_team_id: string | null;
      venue_type: 'home_away';
      scheduled_for: string;
      schedule_slot_type: HattrickScheduleSlotKind;
      is_bye: boolean;
    }>;
  }>;
}

const MIN_START_LEAD_DAYS = 3;
const MAX_START_LEAD_DAYS = 8 * 7;
const MAX_START_OPTIONS = 12;

export function getFullRoundRobinRoundCount(teamCount: number) {
  if (teamCount < 2) return 0;
  return teamCount % 2 === 0 ? teamCount - 1 : teamCount;
}

export function getRegularPhaseMatches<T>(
  rounds: Array<{ phase?: CompetitionPhase | null; matches: T[] }>,
): T[] {
  return rounds.filter((round) => round.phase !== 'postseason').flatMap((round) => round.matches);
}

export function deriveTournamentFormats(input: { teamCount: number; safeRoundCount: number }) {
  const { teamCount, safeRoundCount } = input;
  const fullRoundRobinRounds = getFullRoundRobinRoundCount(teamCount);
  if (teamCount < 2 || safeRoundCount < 1) return [] as LengthScheduleFormat[];

  const formats: LengthScheduleFormat[] = [];
  if (fullRoundRobinRounds + 1 <= safeRoundCount) {
    formats.push({
      id: `round-robin-plus-final-${fullRoundRobinRounds + 1}`,
      kind: 'round_robin_plus_final',
      totalRounds: fullRoundRobinRounds + 1,
      regularRounds: fullRoundRobinRounds,
      postseasonRounds: 1,
      label: 'Single round robin + Championship Final',
    });
  }
  if (fullRoundRobinRounds <= safeRoundCount) {
    formats.push({
      id: `round-robin-${fullRoundRobinRounds}`,
      kind: 'round_robin',
      totalRounds: fullRoundRobinRounds,
      regularRounds: fullRoundRobinRounds,
      postseasonRounds: 0,
      label: 'Single round robin',
    });
  } else {
    formats.push({
      id: `balanced-${safeRoundCount}`,
      kind: 'balanced',
      totalRounds: safeRoundCount,
      regularRounds: safeRoundCount,
      postseasonRounds: 0,
      label: `${safeRoundCount} rounds of balanced pairings`,
    });
  }
  return formats;
}

export function createCustomLengthFormat(teamCount: number, totalRounds: number): LengthScheduleFormat {
  const safeTotal = Math.max(1, Math.floor(totalRounds));
  const fullRoundRobinRounds = getFullRoundRobinRoundCount(teamCount);
  return {
    id: `custom-${safeTotal}`,
    kind: safeTotal === fullRoundRobinRounds ? 'round_robin' : 'balanced',
    totalRounds: safeTotal,
    regularRounds: safeTotal,
    postseasonRounds: 0,
    label: safeTotal === fullRoundRobinRounds ? 'Single round robin' : `${safeTotal} rounds of balanced pairings`,
  };
}

export function getSafeFriendlySlotsFromStart(startSlot: CalendarSlot, slots: CalendarSlot[]) {
  return slots.filter(
    (slot) =>
      slot.selectable &&
      slot.kind !== 'blocked_cup_week' &&
      slot.htSeason === startSlot.htSeason &&
      slot.nominalDate.getTime() >= startSlot.nominalDate.getTime() &&
      !(slot.kind === 'weekend_friendly' && slot.htWeek === 15),
  );
}

function normalizeTeams(teams: LengthScheduleTeam[]) {
  return teams
    .filter((team) => team.active !== false && team.isPlaceholder !== true)
    .sort((a, b) => (a.teamRank ?? Number.MAX_SAFE_INTEGER) - (b.teamRank ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id));
}

function pairKey(a: string, b: string) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function enumerateRoundMatchings(
  teamIds: Array<string | null>,
  usedPairs: Set<string>,
): Array<Array<[string | null, string | null]>> {
  if (teamIds.length === 0) return [[]];
  const [first, ...rest] = teamIds;
  const results: Array<Array<[string | null, string | null]>> = [];
  for (let index = 0; index < rest.length; index += 1) {
    const opponent = rest[index] ?? null;
    if (first && opponent && usedPairs.has(pairKey(first, opponent))) continue;
    const remaining = rest.filter((_, restIndex) => restIndex !== index);
    for (const tail of enumerateRoundMatchings(remaining, usedPairs)) {
      results.push([[first ?? null, opponent], ...tail]);
    }
  }
  return results;
}

function scoreMatching(
  pairs: Array<[string | null, string | null]>,
  teamsById: Map<string, LengthScheduleTeam>,
  history: PairingHistory,
) {
  let rankDistance = 0;
  let byePenalty = 0;
  for (const [a, b] of pairs) {
    if (!a || !b) {
      const teamId = a || b;
      byePenalty += ((teamId && history.byeCounts?.[teamId]) || 0) * 1_000_000;
      continue;
    }
    rankDistance += Math.abs((teamsById.get(a)?.teamRank ?? 0) - (teamsById.get(b)?.teamRank ?? 0));
  }
  return byePenalty + rankDistance;
}

function orientPair(
  a: string | null,
  b: string | null,
  homeCounts: Record<string, number>,
  roundIndex: number,
): LengthSchedulePairing {
  if (!a || !b) return { homeTeamId: a || b, awayTeamId: null, isBye: true };
  const aHomes = homeCounts[a] || 0;
  const bHomes = homeCounts[b] || 0;
  const aHome = aHomes < bHomes || (aHomes === bHomes && (roundIndex + a.localeCompare(b)) % 2 === 0);
  if (aHome) homeCounts[a] = aHomes + 1;
  else homeCounts[b] = bHomes + 1;
  return { homeTeamId: aHome ? a : b, awayTeamId: aHome ? b : a, isBye: false };
}

export function generateBalancedRound(
  teams: LengthScheduleTeam[],
  history: PairingHistory = {},
  roundIndex = 0,
): LengthSchedulePairing[] {
  const normalized = normalizeTeams(teams);
  const teamIds: Array<string | null> = normalized.map((team) => team.id);
  if (teamIds.length % 2 !== 0) teamIds.push(null);
  const usedPairs = new Set((history.playedPairs || []).map(([a, b]) => pairKey(a, b)));
  const strictCandidates = enumerateRoundMatchings(teamIds, usedPairs);
  // Real-world missed/repaired rounds can exhaust the perfect no-rematch graph
  // before the planned regular season ends. Prefer zero rematches whenever a
  // complete matching exists; otherwise allow the smallest possible number.
  const candidates = strictCandidates.length > 0
    ? strictCandidates
    : enumerateRoundMatchings(teamIds, new Set());
  const teamsById = new Map(normalized.map((team) => [team.id, team]));
  const countRematches = (pairs: Array<[string | null, string | null]>) =>
    pairs.reduce(
      (count, [a, b]) => count + (a && b && usedPairs.has(pairKey(a, b)) ? 1 : 0),
      0,
    );
  candidates.sort((left, right) => {
    const rematchDelta = countRematches(left) - countRematches(right);
    if (rematchDelta !== 0) return rematchDelta;
    const scoreDelta = scoreMatching(left, teamsById, history) - scoreMatching(right, teamsById, history);
    if (scoreDelta !== 0) return scoreDelta;
    return JSON.stringify(left).localeCompare(JSON.stringify(right));
  });
  const homeCounts = { ...(history.homeCounts || {}) };
  return candidates[0]!.map(([a, b]) => orientPair(a, b, homeCounts, roundIndex));
}

function isStartCandidate(slot: CalendarSlot, now: Date) {
  const days = getSignedDaysUntil(slot.nominalDate, now);
  return slot.selectable && slot.kind !== 'blocked_cup_week' && days >= MIN_START_LEAD_DAYS && days <= MAX_START_LEAD_DAYS;
}

export function buildLengthScheduleDraft(input: {
  teams: LengthScheduleTeam[];
  startSlotId: string | null;
  selectedFormatId?: string | null;
  customRoundCount?: number | null;
  now?: Date;
}): LengthScheduleDraft {
  const now = input.now ?? new Date();
  const teams = normalizeTeams(input.teams);
  const allSlots = buildCalendarSlots(now, 24, { includeWeek15WeekendFriendly: false });
  const startSlotOptions = allSlots.filter((slot) => isStartCandidate(slot, now)).slice(0, MAX_START_OPTIONS);
  const selectedStartSlot =
    startSlotOptions.find((slot) => slot.id === input.startSlotId) || (input.startSlotId ? null : startSlotOptions[0]) || null;
  const safeSlots = selectedStartSlot ? getSafeFriendlySlotsFromStart(selectedStartSlot, allSlots) : [];
  const formats = deriveTournamentFormats({ teamCount: teams.length, safeRoundCount: safeSlots.length });
  let selectedFormat = formats.find((format) => format.id === input.selectedFormatId) || formats[0] || null;
  if (input.selectedFormatId?.startsWith('custom-') && input.customRoundCount) {
    selectedFormat = createCustomLengthFormat(teams.length, Math.min(input.customRoundCount, safeSlots.length));
  }

  let reason: string | null = null;
  if (teams.length < 2) reason = 'At least 2 active teams are required.';
  else if (teams.some((team) => !Number.isInteger(team.teamRank) || Number(team.teamRank) <= 0)) {
    reason = 'Update HFI ranks before generating this schedule.';
  } else if (!selectedStartSlot) reason = 'Choose a valid start date.';
  else if (!selectedFormat || selectedFormat.totalRounds > safeSlots.length) reason = 'The selected length does not fit this Hattrick season.';
  else if (selectedFormat.postseasonRounds === 0 && selectedFormat.regularRounds > getFullRoundRobinRoundCount(teams.length)) {
    reason = 'A regular season cannot exceed the available no-rematch rounds.';
  }

  const rounds: LengthScheduleRound[] = [];
  if (!reason && selectedStartSlot && selectedFormat) {
    const firstPairings = generateBalancedRound(teams, {}, 0);
    const teamLookup = new Map(teams.map((team) => [team.id, team]));
    for (let index = 0; index < selectedFormat.totalRounds; index += 1) {
      const slot = safeSlots[index]!;
      const phase: CompetitionPhase = index < selectedFormat.regularRounds ? 'regular' : 'postseason';
      const phaseRoundNumber = phase === 'regular' ? index + 1 : index - selectedFormat.regularRounds + 1;
      const materialized = index === 0;
      const matches = materialized
        ? firstPairings.map((pairing) => {
            const kickoffTeam = teamLookup.get(pairing.homeTeamId || pairing.awayTeamId || '');
            const scheduledFor = kickoffTeam ? getScheduledDateForSlot(slot, kickoffTeam) : null;
            if (!scheduledFor) throw new Error(`Could not resolve the Round 1 kickoff time for ${kickoffTeam?.name || 'a team'}.`);
            return {
              ...pairing,
              homeTeamName: pairing.homeTeamId ? teamLookup.get(pairing.homeTeamId)?.name || 'Unknown team' : 'BYE',
              awayTeamName: pairing.awayTeamId ? teamLookup.get(pairing.awayTeamId)?.name || 'Unknown team' : 'BYE',
              scheduledFor,
              scheduleSlotType: slot.kind as HattrickScheduleSlotKind,
            };
          })
        : [];
      rounds.push({
        roundNumber: index + 1,
        phase,
        phaseRoundNumber,
        phaseStatus: materialized ? 'materialized' : 'pending',
        slot,
        displayDate: matches[0]?.scheduledFor || slot.nominalDate,
        displayDateLabel: formatCalendarDate(matches[0]?.scheduledFor || slot.nominalDate),
        matches,
      });
    }
  }

  return {
    valid: !reason,
    reason,
    teams,
    teamCount: teams.length,
    startSlotOptions,
    selectedStartSlot,
    selectedStartSlotId: selectedStartSlot?.id || null,
    daysUntilStart: selectedStartSlot ? getDaysUntil(selectedStartSlot.nominalDate, now) : null,
    safeSlots,
    safeRoundCount: safeSlots.length,
    htSeason: selectedStartSlot?.htSeason ?? null,
    formats,
    selectedFormat,
    rounds,
  };
}

export function serializeLengthScheduleDraft(draft: LengthScheduleDraft): SerializedLengthSchedulePayload {
  if (!draft.valid || !draft.selectedStartSlot || !draft.selectedFormat) throw new Error(draft.reason || 'Invalid schedule draft.');
  return {
    version: 1,
    mode: 'length',
    team_count: draft.teamCount,
    total_rounds: draft.selectedFormat.totalRounds,
    regular_rounds: draft.selectedFormat.regularRounds,
    postseason_rounds: draft.selectedFormat.postseasonRounds,
    format: draft.selectedFormat.kind,
    ranking_source: 'team_rank',
    ranking_snapshot: draft.teams.map((team) => ({ team_id: team.id, team_rank: Number(team.teamRank) })),
    start_slot_id: draft.selectedStartSlot.id,
    start_slot_kind: draft.selectedStartSlot.kind as HattrickScheduleSlotKind,
    start_slot_date: draft.selectedStartSlot.nominalDate.toISOString(),
    rounds: draft.rounds.map((round) => ({
      round_number: round.roundNumber,
      phase: round.phase,
      phase_round_number: round.phaseRoundNumber,
      phase_status: round.phaseStatus,
      slot_id: round.slot.id,
      slot_kind: round.slot.kind as HattrickScheduleSlotKind,
      slot_date: round.slot.nominalDate.toISOString(),
      display_date: round.displayDate.toISOString(),
      matches: round.matches.map((match) => ({
        home_team_id: match.homeTeamId,
        away_team_id: match.awayTeamId,
        venue_type: 'home_away',
        scheduled_for: match.scheduledFor.toISOString(),
        schedule_slot_type: match.scheduleSlotType,
        is_bye: match.isBye,
      })),
    })),
  };
}

export function buildRoundRepair(input: {
  teams: LengthScheduleTeam[];
  lockedPairs: Array<[string, string]>;
  unavailableTeamIds: string[];
  history?: PairingHistory;
}) {
  const lockedIds = new Set(input.lockedPairs.flat());
  const unavailable = normalizeTeams(input.teams).filter(
    (team) => !lockedIds.has(team.id) && input.unavailableTeamIds.includes(team.id),
  );
  const free = normalizeTeams(input.teams).filter(
    (team) => !lockedIds.has(team.id) && !input.unavailableTeamIds.includes(team.id),
  );
  const containmentPairs: LengthSchedulePairing[] = [];
  while (unavailable.length >= 2) {
    const first = unavailable.shift()!;
    const second = unavailable.shift()!;
    containmentPairs.push({ homeTeamId: first.id, awayTeamId: second.id, isBye: false });
  }
  if (unavailable.length === 1 && free.length > 0) {
    const unavailableTeam = unavailable.shift()!;
    const nearestIndex = free.reduce((bestIndex, candidate, index) => {
      const best = free[bestIndex]!;
      return Math.abs(Number(candidate.teamRank) - Number(unavailableTeam.teamRank)) <
        Math.abs(Number(best.teamRank) - Number(unavailableTeam.teamRank))
        ? index
        : bestIndex;
    }, 0);
    const affectedFree = free.splice(nearestIndex, 1)[0]!;
    containmentPairs.push({ homeTeamId: unavailableTeam.id, awayTeamId: affectedFree.id, isBye: false });
  }
  const repairedPairs = free.length > 0 ? generateBalancedRound(free, input.history) : [];
  return { lockedPairs: input.lockedPairs, containmentPairs, repairedPairs };
}

export function resolveChampionshipTeam(input: {
  homeTeamId: string;
  awayTeamId: string;
  homeGoals: number;
  awayGoals: number;
  went120: boolean;
  penaltyShootoutHomeGoals?: number | null;
  penaltyShootoutAwayGoals?: number | null;
}) {
  const footballWinner = input.homeGoals === input.awayGoals
    ? null
    : input.homeGoals > input.awayGoals ? input.homeTeamId : input.awayTeamId;
  if (!input.went120 && footballWinner) {
    return footballWinner === input.homeTeamId ? input.awayTeamId : input.homeTeamId;
  }
  if (footballWinner) return footballWinner;
  if (
    typeof input.penaltyShootoutHomeGoals === 'number' &&
    typeof input.penaltyShootoutAwayGoals === 'number' &&
    input.penaltyShootoutHomeGoals !== input.penaltyShootoutAwayGoals
  ) {
    return input.penaltyShootoutHomeGoals > input.penaltyShootoutAwayGoals
      ? input.homeTeamId
      : input.awayTeamId;
  }
  return null;
}
