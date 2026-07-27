import {
  buildCalendarSlots,
  formatCalendarDate,
  formatCalendarDateWithWeek,
  getDaysUntil,
  getHattrickWeekFromDate,
  getScheduledDateForSlot,
  getSignedDaysUntil,
  type CalendarSlot,
  type CalendarSlotKind,
  type HattrickScheduleSlotKind,
  type TeamSchedulingInfo,
} from './hattrick-calendar';
import type { ScheduledMatch } from './scheduler';
import type { ScheduleTeamDraft } from './schedule-draft';

export type RescheduleMatchStatus = 'not_arranged' | 'arranged' | 'ongoing' | 'misarranged' | 'finished';

export interface RescheduleExistingMatch {
  id: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  status: RescheduleMatchStatus | null;
  completed: boolean;
  htMatchId: number | null;
  scheduledFor?: string | null;
  matchDate?: Date | null;
  scheduleSlotType?: HattrickScheduleSlotKind | 'week15_weekend_friendly' | null;
  venueType?: ScheduledMatch['venueType'] | null;
}

export interface RescheduleExistingRound {
  id: string;
  roundNumber: number;
  matches: RescheduleExistingMatch[];
}

export interface RescheduleRoundChoice {
  roundNumber: number;
  label: string;
  available: boolean;
  reason: string | null;
}

export interface RescheduleDraftMatch {
  matchId: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeTeamName: string;
  awayTeamName: string;
  venueType: ScheduledMatch['venueType'];
  scheduledFor: Date;
  scheduleSlotType: HattrickScheduleSlotKind;
  isBye: boolean;
}

export interface RescheduleDraftRound {
  roundId: string;
  roundNumber: number;
  segmentRoundNumber: number;
  slot: CalendarSlot;
  displayDate: Date;
  displayDateLabel: string;
  matches: RescheduleDraftMatch[];
}

export interface ReschedulePreviousRound {
  roundId: string;
  roundNumber: number;
  displayDate: Date | null;
  displayDateLabel: string | null;
  slot: CalendarSlot | null;
}

export interface RescheduleDraftPreview {
  valid: boolean;
  reason: string | null;
  requestedFromRoundNumber: number | null;
  selectedFromRoundNumber: number | null;
  requestedStartSlotId: string | null;
  selectedStartSlotId: string | null;
  selectedStartSlot: CalendarSlot | null;
  currentStartSlotId: string | null;
  currentRoundDate: Date | null;
  currentRoundDateLabel: string | null;
  roundChoices: RescheduleRoundChoice[];
  startSlotOptions: CalendarSlot[];
  allSlotOptions: CalendarSlot[];
  previousRounds: ReschedulePreviousRound[];
  rounds: RescheduleDraftRound[];
  daysUntilStart: number | null;
  blockingReasons: string[];
  warnings: string[];
  canIncludeWeek15WeekendFriendly: boolean;
  consumesWeek15WeekendFriendly: boolean;
}

export interface SerializedRescheduleMatch {
  match_id: string;
  home_team_id: string | null;
  away_team_id: string | null;
  venue_type: ScheduledMatch['venueType'];
  scheduled_for: string;
  schedule_slot_type: HattrickScheduleSlotKind;
  is_bye: boolean;
}

export interface SerializedRescheduleRound {
  round_id: string;
  round_number: number;
  segment_round_number: number;
  slot_id: string;
  slot_kind: CalendarSlotKind;
  slot_date: string;
  display_date: string;
  matches: SerializedRescheduleMatch[];
}

export interface SerializedReschedulePayload {
  from_round_number: number;
  start_slot_id: string;
  start_slot_kind: HattrickScheduleSlotKind;
  start_slot_date: string;
  include_week15_weekend_friendly: boolean;
  rounds: SerializedRescheduleRound[];
}

export interface BuildRescheduleDraftInput {
  teams: ScheduleTeamDraft[];
  rounds: RescheduleExistingRound[];
  fromRoundNumber: number | null;
  startSlotId: string | null;
  includeWeek15WeekendFriendly?: boolean;
  now?: Date;
  horizonWeeks?: number;
}

const MAX_START_OPTIONS = 12;
const DEFAULT_HORIZON_WEEKS = 80;
const MIN_START_LEAD_DAYS = 3;
const MAX_START_LEAD_DAYS = 8 * 7;

function normalizeTeams(teams: ScheduleTeamDraft[]) {
  return teams.filter((team) => team.active !== false && team.isPlaceholder !== true);
}

function createTeamLookup(teams: ScheduleTeamDraft[]) {
  return new Map(teams.map((team) => [team.id, team]));
}

function isSelectableStartCandidate(slot: CalendarSlot, now: Date) {
  const daysUntil = getSignedDaysUntil(slot.nominalDate, now);
  return slot.selectable && daysUntil >= MIN_START_LEAD_DAYS && daysUntil <= MAX_START_LEAD_DAYS;
}

function isDisplayStartCandidate(slot: CalendarSlot, now: Date) {
  const daysUntil = getSignedDaysUntil(slot.nominalDate, now);
  return daysUntil >= MIN_START_LEAD_DAYS && daysUntil <= MAX_START_LEAD_DAYS;
}

function getEffectiveMatchDate(match: RescheduleExistingMatch) {
  if (match.scheduledFor) return new Date(match.scheduledFor);
  return match.matchDate ?? null;
}

function getRoundAnchorMatch(round: RescheduleExistingRound) {
  return round.matches.find((match) => getEffectiveMatchDate(match)) ?? null;
}

function getRoundDisplayDate(round: RescheduleExistingRound) {
  const anchorMatch = getRoundAnchorMatch(round);
  return anchorMatch ? getEffectiveMatchDate(anchorMatch) : null;
}

function normalizeScheduleSlotType(
  scheduleSlotType: RescheduleExistingMatch['scheduleSlotType'],
  matchDate: Date,
): HattrickScheduleSlotKind {
  if (scheduleSlotType === 'midweek_friendly') return 'midweek_friendly';
  if (scheduleSlotType === 'week15_weekend_friendly' || scheduleSlotType === 'weekend_friendly') {
    return 'weekend_friendly';
  }

  const weekday = matchDate.getUTCDay();
  return weekday === 0 || weekday === 6 ? 'weekend_friendly' : 'midweek_friendly';
}

function getCurrentSlot(round: RescheduleExistingRound, orderedSlots: CalendarSlot[]) {
  const anchorMatch = getRoundAnchorMatch(round);
  const anchorDate = anchorMatch ? getEffectiveMatchDate(anchorMatch) : null;
  if (!anchorMatch || !anchorDate) return null;

  const week = getHattrickWeekFromDate(anchorDate);
  const kind = normalizeScheduleSlotType(anchorMatch.scheduleSlotType ?? null, anchorDate);
  return (
    orderedSlots.find((slot) => slot.htSeason === week.htSeason && slot.htWeek === week.htWeek && slot.kind === kind) ??
    null
  );
}

function getCurrentStartSlotId(round: RescheduleExistingRound, orderedSlots: CalendarSlot[]) {
  return getCurrentSlot(round, orderedSlots)?.id ?? null;
}

function buildPreviousRounds(
  rounds: RescheduleExistingRound[],
  beforeRoundNumber: number | null,
  orderedSlots: CalendarSlot[],
): ReschedulePreviousRound[] {
  if (!beforeRoundNumber) return [];

  return rounds
    .filter((round) => round.roundNumber < beforeRoundNumber)
    .map((round) => {
      const displayDate = getRoundDisplayDate(round);

      return {
        roundId: round.id,
        roundNumber: round.roundNumber,
        displayDate,
        displayDateLabel: displayDate ? formatCalendarDate(displayDate) : null,
        slot: getCurrentSlot(round, orderedSlots),
      };
    });
}

function getLatestPinnedSlotIndex(
  rounds: RescheduleExistingRound[],
  beforeRoundNumber: number,
  orderedSlots: CalendarSlot[],
) {
  const pinnedSlotIndexes = rounds
    .filter((round) => round.roundNumber < beforeRoundNumber)
    .map((round) => {
      const slotId = getCurrentStartSlotId(round, orderedSlots);
      return slotId ? orderedSlots.findIndex((slot) => slot.id === slotId) : -1;
    })
    .filter((index) => index >= 0);

  if (pinnedSlotIndexes.length === 0) return null;

  return Math.max(...pinnedSlotIndexes);
}

function getLockedReason(match: RescheduleExistingMatch, now: Date) {
  const status = match.status ?? 'not_arranged';

  if (match.completed) return 'has a recorded result';
  if (match.htMatchId) return 'is linked to a Hattrick match';
  if (status !== 'not_arranged') return `is ${status.replace('_', ' ')}`;

  const matchDate = getEffectiveMatchDate(match);
  if (matchDate && matchDate.getTime() <= now.getTime()) return 'has already reached kickoff time';

  return null;
}

function getRoundLockedReason(round: RescheduleExistingRound, now: Date) {
  for (const match of round.matches) {
    const reason = getLockedReason(match, now);
    if (reason) return `Round ${round.roundNumber} cannot move because one match ${reason}.`;
  }
  return null;
}

function getRoundChoices(rounds: RescheduleExistingRound[], now: Date): RescheduleRoundChoice[] {
  return rounds.map((round, index) => {
    const suffix = rounds.slice(index);
    const suffixLockedReason = suffix.map((item) => getRoundLockedReason(item, now)).find(Boolean) ?? null;

    return {
      roundNumber: round.roundNumber,
      label: `Round ${round.roundNumber}`,
      available: !suffixLockedReason,
      reason: suffixLockedReason,
    };
  });
}

function collectSlotsForRounds(
  startSlot: CalendarSlot,
  orderedSlots: CalendarSlot[],
  roundCount: number,
): { slots: CalendarSlot[]; reason: string | null; blockingReasons: string[] } {
  if (!startSlot.selectable) {
    const reason = startSlot.blockedReason || 'Selected start slot is blocked.';
    return { slots: [], reason, blockingReasons: [reason] };
  }

  const startIndex = orderedSlots.findIndex((slot) => slot.id === startSlot.id);
  if (startIndex < 0) {
    const reason = 'Selected start slot is not available in the current calendar horizon.';
    return { slots: [], reason, blockingReasons: [reason] };
  }

  const slots: CalendarSlot[] = [];
  for (let index = startIndex; index < orderedSlots.length && slots.length < roundCount; index += 1) {
    const slot = orderedSlots[index];
    if (slot.kind === 'blocked_cup_week') {
      const reason = `Regenerated round ${slots.length + 1} would fall in blocked cup week W${slot.htWeek}.`;
      return { slots: [], reason, blockingReasons: [reason] };
    }

    if (slot.selectable) {
      slots.push(slot);
    }
  }

  if (slots.length < roundCount) {
    const reason = `Not enough allowed calendar slots remain after HT S${startSlot.htSeason} W${startSlot.htWeek}.`;
    return { slots: [], reason, blockingReasons: [reason] };
  }

  return { slots, reason: null, blockingReasons: [] };
}

function buildRescheduledRound(
  round: RescheduleExistingRound,
  slot: CalendarSlot,
  segmentRoundNumber: number,
  teamLookup: Map<string, ScheduleTeamDraft>,
  now: Date,
) {
  const matches: RescheduleDraftMatch[] = [];

  for (const match of round.matches) {
    const homeTeam = match.homeTeamId ? teamLookup.get(match.homeTeamId) : null;
    const awayTeam = match.awayTeamId ? teamLookup.get(match.awayTeamId) : null;
    const kickoffTeam = homeTeam || awayTeam;
    const isBye = !match.homeTeamId || !match.awayTeamId;

    if (!kickoffTeam || (match.homeTeamId && !homeTeam) || (match.awayTeamId && !awayTeam)) {
      return {
        round: null,
        reason: `Round ${round.roundNumber} contains a team that is no longer active in the tournament.`,
      };
    }

    const scheduledFor = getScheduledDateForSlot(slot, kickoffTeam as TeamSchedulingInfo);
    if (!scheduledFor) {
      return {
        round: null,
        reason:
          slot.kind === 'weekend_friendly'
            ? `Weekend kickoff time is ambiguous for ${kickoffTeam.name}. Add or fix its league level.`
            : `Could not resolve kickoff time for ${kickoffTeam.name}.`,
      };
    }

    if (scheduledFor.getTime() <= now.getTime()) {
      return {
        round: null,
        reason: `Round ${round.roundNumber} kickoff for ${kickoffTeam.name} has already passed.`,
      };
    }

    matches.push({
      matchId: match.id,
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      homeTeamName: homeTeam?.name ?? 'BYE',
      awayTeamName: awayTeam?.name ?? 'BYE',
      venueType: match.venueType || 'home_away',
      scheduledFor,
      scheduleSlotType: slot.kind as HattrickScheduleSlotKind,
      isBye,
    });
  }

  const displayDate = matches[0]?.scheduledFor ?? slot.nominalDate;
  return {
    round: {
      roundId: round.id,
      roundNumber: round.roundNumber,
      segmentRoundNumber,
      slot,
      displayDate,
      displayDateLabel: formatCalendarDate(displayDate),
      matches,
    } satisfies RescheduleDraftRound,
    reason: null,
  };
}

function evaluateReschedule(
  teams: ScheduleTeamDraft[],
  rounds: RescheduleExistingRound[],
  startSlot: CalendarSlot,
  orderedSlots: CalendarSlot[],
  now: Date,
  latestPinnedSlotIndex: number | null,
) {
  const startSlotIndex = orderedSlots.findIndex((slot) => slot.id === startSlot.id);
  if (latestPinnedSlotIndex !== null && startSlotIndex <= latestPinnedSlotIndex) {
    const reason = 'The new start must be after the latest unchanged round.';
    return {
      valid: false,
      reason,
      rounds: [] as RescheduleDraftRound[],
      blockingReasons: [reason],
      warnings: [] as string[],
      consumesWeek15WeekendFriendly: false,
    };
  }

  const collected = collectSlotsForRounds(startSlot, orderedSlots, rounds.length);
  if (collected.reason) {
    return {
      valid: false,
      reason: collected.reason,
      rounds: [] as RescheduleDraftRound[],
      blockingReasons: collected.blockingReasons,
      warnings: [] as string[],
      consumesWeek15WeekendFriendly: false,
    };
  }

  const teamLookup = createTeamLookup(normalizeTeams(teams));
  const draftRounds: RescheduleDraftRound[] = [];
  const warnings = startSlot.warning ? [startSlot.warning] : [];
  let consumesWeek15WeekendFriendly = false;

  for (let index = 0; index < rounds.length; index += 1) {
    const slot = collected.slots[index];
    if (slot.kind === 'weekend_friendly' && slot.htWeek === 15) consumesWeek15WeekendFriendly = true;
    if (slot.warning && !warnings.includes(slot.warning)) warnings.push(slot.warning);

    const built = buildRescheduledRound(rounds[index]!, slot, index + 1, teamLookup, now);
    if (!built.round) {
      return {
        valid: false,
        reason: built.reason,
        rounds: [] as RescheduleDraftRound[],
        blockingReasons: [built.reason],
        warnings,
        consumesWeek15WeekendFriendly,
      };
    }

    draftRounds.push(built.round);
  }

  return {
    valid: true,
    reason: null,
    rounds: draftRounds,
    blockingReasons: [] as string[],
    warnings,
    consumesWeek15WeekendFriendly,
  };
}

function chooseStartSlot(
  teams: ScheduleTeamDraft[],
  rounds: RescheduleExistingRound[],
  orderedSlots: CalendarSlot[],
  now: Date,
  requestedStartSlotId: string | null,
  latestPinnedSlotIndex: number | null,
  currentStartSlotId: string | null,
) {
  const candidateSlots = orderedSlots.filter((slot) => {
    if (!isSelectableStartCandidate(slot, now)) return false;
    if (currentStartSlotId && slot.id === currentStartSlotId) return false;
    if (latestPinnedSlotIndex === null) return true;
    return orderedSlots.findIndex((item) => item.id === slot.id) > latestPinnedSlotIndex;
  });
  const validSlots: CalendarSlot[] = [];

  for (const slot of candidateSlots) {
    const result = evaluateReschedule(teams, rounds, slot, orderedSlots, now, latestPinnedSlotIndex);
    if (result.valid) {
      validSlots.push(slot);
      if (validSlots.length >= MAX_START_OPTIONS) break;
    }
  }

  const requestedStartSlot = requestedStartSlotId
    ? validSlots.find((slot) => slot.id === requestedStartSlotId) || null
    : null;

  return {
    startSlotOptions: validSlots,
    selectedStartSlot: requestedStartSlot || validSlots[0] || null,
  };
}

function canDraftIncludeWeek15WeekendFriendly(
  teams: ScheduleTeamDraft[],
  rounds: RescheduleExistingRound[],
  orderedSlotsWithWeek15: CalendarSlot[],
  now: Date,
  latestPinnedSlotIndex: number | null,
  currentStartSlotId: string | null,
) {
  if (rounds.length === 0) return false;

  const candidateSlots = orderedSlotsWithWeek15.filter((slot) => {
    if (!isSelectableStartCandidate(slot, now)) return false;
    if (currentStartSlotId && slot.id === currentStartSlotId) return false;
    if (latestPinnedSlotIndex === null) return true;
    return orderedSlotsWithWeek15.findIndex((item) => item.id === slot.id) > latestPinnedSlotIndex;
  });

  return candidateSlots.some((slot) => {
    const result = evaluateReschedule(teams, rounds, slot, orderedSlotsWithWeek15, now, latestPinnedSlotIndex);
    return result.valid && result.consumesWeek15WeekendFriendly;
  });
}

export function buildRescheduleDraft(input: BuildRescheduleDraftInput): RescheduleDraftPreview {
  const now = input.now ?? new Date();
  const horizonWeeks = input.horizonWeeks ?? DEFAULT_HORIZON_WEEKS;
  const orderedSlots = buildCalendarSlots(now, horizonWeeks, {
    includeWeek15WeekendFriendly: input.includeWeek15WeekendFriendly ?? false,
  });
  const orderedSlotsWithWeek15 = input.includeWeek15WeekendFriendly
    ? orderedSlots
    : buildCalendarSlots(now, horizonWeeks, { includeWeek15WeekendFriendly: true });
  const orderedRounds = [...input.rounds].sort((a, b) => a.roundNumber - b.roundNumber);
  const roundChoices = getRoundChoices(orderedRounds, now);
  const requestedChoice = input.fromRoundNumber
    ? roundChoices.find((choice) => choice.roundNumber === input.fromRoundNumber)
    : null;
  const selectedChoice =
    requestedChoice?.available ? requestedChoice : roundChoices.find((choice) => choice.available) || null;
  const effectiveChoice = requestedChoice?.available ? requestedChoice : null;
  const affectedRounds = effectiveChoice
    ? orderedRounds.filter((round) => round.roundNumber >= effectiveChoice.roundNumber)
    : [];
  const previousRounds = buildPreviousRounds(orderedRounds, effectiveChoice?.roundNumber ?? null, orderedSlots);
  const latestPinnedSlotIndex = effectiveChoice
    ? getLatestPinnedSlotIndex(orderedRounds, effectiveChoice.roundNumber, orderedSlots)
    : null;
  const currentStartSlotId = affectedRounds[0] ? getCurrentStartSlotId(affectedRounds[0], orderedSlots) : null;
  const currentRoundDate = affectedRounds[0] ? getRoundDisplayDate(affectedRounds[0]) : null;
  const currentRoundDateLabel = currentRoundDate ? formatCalendarDateWithWeek(currentRoundDate) : null;
  const displayableSlots = orderedSlots
    .filter((slot) => {
      if (!isDisplayStartCandidate(slot, now)) return false;
      if (currentStartSlotId && slot.id === currentStartSlotId) return true;
      if (latestPinnedSlotIndex === null) return true;
      return orderedSlots.findIndex((item) => item.id === slot.id) > latestPinnedSlotIndex;
    })
    .slice(0, MAX_START_OPTIONS + 8);

  if (!effectiveChoice || affectedRounds.length === 0) {
    const reason = roundChoices.length
      ? selectedChoice
        ? 'Select a round to regenerate from.'
        : 'No future unarranged round suffix can be moved.'
      : 'This tournament has no generated rounds.';
    return {
      valid: false,
      reason,
      requestedFromRoundNumber: input.fromRoundNumber,
      selectedFromRoundNumber: null,
      requestedStartSlotId: input.startSlotId,
      selectedStartSlotId: null,
      selectedStartSlot: null,
      currentStartSlotId: null,
      currentRoundDate: null,
      currentRoundDateLabel: null,
      roundChoices,
      startSlotOptions: [],
      allSlotOptions: displayableSlots,
      previousRounds: [],
      rounds: [],
      daysUntilStart: null,
      blockingReasons: selectedChoice ? [] : [reason],
      warnings: [],
      canIncludeWeek15WeekendFriendly: false,
      consumesWeek15WeekendFriendly: false,
    };
  }

  const { startSlotOptions, selectedStartSlot } = chooseStartSlot(
    input.teams,
    affectedRounds,
    orderedSlots,
    now,
    input.startSlotId,
    latestPinnedSlotIndex,
    currentStartSlotId,
  );

  if (!input.startSlotId || !selectedStartSlot) {
    const reason = selectedStartSlot
      ? 'Select a new start date.'
      : 'No valid start window found for the remaining rounds.';
    return {
      valid: false,
      reason,
      requestedFromRoundNumber: input.fromRoundNumber,
      selectedFromRoundNumber: effectiveChoice.roundNumber,
      requestedStartSlotId: input.startSlotId,
      selectedStartSlotId: null,
      selectedStartSlot: null,
      currentStartSlotId,
      currentRoundDate,
      currentRoundDateLabel,
      roundChoices,
      startSlotOptions,
      allSlotOptions: displayableSlots,
      previousRounds,
      rounds: [],
      daysUntilStart: null,
      blockingReasons: selectedStartSlot ? [] : [reason],
      warnings: [],
      canIncludeWeek15WeekendFriendly: canDraftIncludeWeek15WeekendFriendly(
        input.teams,
        affectedRounds,
        orderedSlotsWithWeek15,
        now,
        latestPinnedSlotIndex,
        currentStartSlotId,
      ),
      consumesWeek15WeekendFriendly: false,
    };
  }

  const evaluation = evaluateReschedule(
    input.teams,
    affectedRounds,
    selectedStartSlot,
    orderedSlots,
    now,
    latestPinnedSlotIndex,
  );
  const canIncludeWeek15WeekendFriendly = canDraftIncludeWeek15WeekendFriendly(
    input.teams,
    affectedRounds,
    orderedSlotsWithWeek15,
    now,
    latestPinnedSlotIndex,
    currentStartSlotId,
  );

  return {
    valid: evaluation.valid,
    reason: evaluation.reason,
    requestedFromRoundNumber: input.fromRoundNumber,
    selectedFromRoundNumber: effectiveChoice.roundNumber,
    requestedStartSlotId: input.startSlotId,
    selectedStartSlotId: selectedStartSlot.id,
    selectedStartSlot,
    currentStartSlotId,
    currentRoundDate,
    currentRoundDateLabel,
    roundChoices,
    startSlotOptions,
    allSlotOptions: displayableSlots,
    previousRounds,
    rounds: evaluation.rounds,
    daysUntilStart: getDaysUntil(selectedStartSlot.nominalDate, now),
    blockingReasons: evaluation.blockingReasons,
    warnings: evaluation.warnings,
    canIncludeWeek15WeekendFriendly,
    consumesWeek15WeekendFriendly: evaluation.consumesWeek15WeekendFriendly,
  };
}

export function serializeRescheduleDraftForRpc(draft: RescheduleDraftPreview): SerializedReschedulePayload {
  if (!draft.selectedFromRoundNumber || !draft.selectedStartSlot) {
    throw new Error('Reschedule draft is missing a start round or start slot.');
  }

  return {
    from_round_number: draft.selectedFromRoundNumber,
    start_slot_id: draft.selectedStartSlot.id,
    start_slot_kind: draft.selectedStartSlot.kind as HattrickScheduleSlotKind,
    start_slot_date: draft.selectedStartSlot.nominalDate.toISOString(),
    include_week15_weekend_friendly: draft.consumesWeek15WeekendFriendly,
    rounds: draft.rounds.map((round) => ({
      round_id: round.roundId,
      round_number: round.roundNumber,
      segment_round_number: round.segmentRoundNumber,
      slot_id: round.slot.id,
      slot_kind: round.slot.kind,
      slot_date: round.slot.nominalDate.toISOString(),
      display_date: round.displayDate.toISOString(),
      matches: round.matches.map((match) => ({
        match_id: match.matchId,
        home_team_id: match.homeTeamId,
        away_team_id: match.awayTeamId,
        venue_type: match.venueType,
        scheduled_for: match.scheduledFor.toISOString(),
        schedule_slot_type: match.scheduleSlotType,
        is_bye: match.isBye,
      })),
    })),
  };
}
