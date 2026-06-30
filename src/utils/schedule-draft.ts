import {
  buildCalendarSlots,
  formatCalendarDate,
  getDaysUntil,
  getSignedDaysUntil,
  getHattrickCalendarContext,
  getScheduledDateForSlot,
  type CalendarSlot,
  type CalendarSlotKind,
  type HattrickCalendarContext,
  type HattrickScheduleSlotKind,
  type TeamSchedulingInfo,
} from './hattrick-calendar';
import { generateRecurring, generateRoundRobin, type ScheduledMatch, type ScheduledRound } from './scheduler';

export type ScheduleMode = 'single' | 'double' | 'recurring';

export interface ScheduleTeamDraft extends TeamSchedulingInfo {
  id: string;
  name: string;
  active?: boolean;
  isPlaceholder?: boolean;
}

export interface ScheduleModeAvailability {
  mode: ScheduleMode;
  available: boolean;
  reason: string | null;
  startSlotId: string | null;
  startSlot: CalendarSlot | null;
}

export interface ScheduleDraftMatch {
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeTeamName: string;
  awayTeamName: string;
  venueType: ScheduledMatch['venueType'];
  scheduledFor: Date;
  scheduleSlotType: HattrickScheduleSlotKind;
  isBye: boolean;
}

export interface ScheduleDraftRound {
  roundNumber: number;
  slot: CalendarSlot;
  displayDate: Date;
  displayDateLabel: string;
  slotLabel: string;
  matches: ScheduleDraftMatch[];
}

export interface ScheduleDraftPreview {
  valid: boolean;
  reason: string | null;
  teamCount: number;
  requestedMode: ScheduleMode;
  mode: ScheduleMode;
  requestedStartSlotId: string | null;
  selectedStartSlotId: string | null;
  selectedStartSlot: CalendarSlot | null;
  roundCount: number;
  rounds: ScheduleDraftRound[];
  availableModes: ScheduleModeAvailability[];
  startSlotOptions: CalendarSlot[];
  allSlotOptions: CalendarSlot[];
  closestAvailableStartSlot: CalendarSlot | null;
  daysUntilStart: number | null;
  calendarContext: HattrickCalendarContext;
  blockingReasons: string[];
  warnings: string[];
  consumesWeek15WeekendFriendly: boolean;
}

export interface SerializedScheduleMatch {
  home_team_id: string | null;
  away_team_id: string | null;
  venue_type: ScheduledMatch['venueType'];
  scheduled_for: string;
  schedule_slot_type: HattrickScheduleSlotKind;
  is_bye: boolean;
}

export interface SerializedScheduleRound {
  round_number: number;
  slot_id: string;
  slot_kind: CalendarSlotKind;
  slot_date: string;
  display_date: string;
  matches: SerializedScheduleMatch[];
}

export interface SerializedSchedulePayload {
  mode: ScheduleMode;
  team_count: number;
  start_slot_id: string;
  start_slot_kind: HattrickScheduleSlotKind;
  start_slot_date: string;
  include_week15_weekend_friendly: boolean;
  rounds: SerializedScheduleRound[];
}

export interface BuildScheduleDraftInput {
  teams: ScheduleTeamDraft[];
  mode: ScheduleMode;
  startSlotId: string | null;
  now?: Date;
  horizonWeeks?: number;
}

const MODE_PRIORITY: ScheduleMode[] = ['single', 'double', 'recurring'];
const MAX_START_OPTIONS = 12;
const DEFAULT_HORIZON_WEEKS = 80;
const MIN_START_LEAD_DAYS = 3;
const MAX_START_LEAD_DAYS = 8 * 7;

function getRoundCount(mode: ScheduleMode, teamCount: number) {
  if (teamCount < 2) return 0;

  const baseRoundCount = teamCount % 2 === 0 ? teamCount - 1 : teamCount;
  if (mode === 'single') return baseRoundCount;
  if (mode === 'double') return baseRoundCount * 2;
  return 4;
}

export function getScheduleRoundCount(mode: ScheduleMode, activeTeamCount: number) {
  return getRoundCount(mode, activeTeamCount);
}

function normalizeTeams(teams: ScheduleTeamDraft[]) {
  return teams.filter((team) => team.active !== false && team.isPlaceholder !== true);
}

function getPairings(mode: ScheduleMode, teamIds: string[]) {
  if (mode === 'double') return generateRoundRobin(teamIds, { mode: 'double' });
  if (mode === 'recurring') return generateRecurring(teamIds, 1, 4);
  return generateRoundRobin(teamIds, { mode: 'single' });
}

function isSelectableStartCandidate(slot: CalendarSlot, now: Date) {
  const daysUntil = getSignedDaysUntil(slot.nominalDate, now);
  return slot.selectable && daysUntil >= MIN_START_LEAD_DAYS && daysUntil <= MAX_START_LEAD_DAYS;
}

function isDisplayStartCandidate(slot: CalendarSlot, now: Date) {
  const daysUntil = getSignedDaysUntil(slot.nominalDate, now);
  return daysUntil >= MIN_START_LEAD_DAYS && daysUntil <= MAX_START_LEAD_DAYS;
}

function getSlotLabel(slot: CalendarSlot) {
  if (slot.kind === 'blocked_cup_week') return `HT S${slot.htSeason} W${slot.htWeek}`;
  if (slot.kind === 'week15_weekend_friendly') return `Week 15 weekend friendly`;
  return `Midweek friendly`;
}

function createTeamLookup(teams: ScheduleTeamDraft[]) {
  return new Map(teams.map((team) => [team.id, team]));
}

function buildRoundFromPairings(
  round: ScheduledRound,
  slot: CalendarSlot,
  teamLookup: Map<string, ScheduleTeamDraft>,
  now: Date,
): { matches: ScheduleDraftMatch[]; blockingReason: string | null } {
  const matches: ScheduleDraftMatch[] = [];

  for (const pairing of round.matches) {
    if (!pairing.home && !pairing.away) continue;

    const homeTeam = pairing.home ? teamLookup.get(pairing.home) : null;
    const awayTeam = pairing.away ? teamLookup.get(pairing.away) : null;
    const kickoffTeam = homeTeam || awayTeam;
    if (!kickoffTeam || (pairing.home && !homeTeam) || (pairing.away && !awayTeam)) {
      return {
        matches: [],
        blockingReason: `Unknown team in round ${round.roundNumber}.`,
      };
    }

    const scheduledFor = getScheduledDateForSlot(slot, kickoffTeam);
    if (!scheduledFor) {
      return {
        matches: [],
        blockingReason:
          slot.kind === 'week15_weekend_friendly'
            ? `Weekend kickoff time is ambiguous for ${kickoffTeam.name}. Add or fix its league level.`
            : `Could not resolve kickoff time for ${kickoffTeam.name}.`,
      };
    }

    if (scheduledFor.getTime() <= now.getTime()) {
      return {
        matches: [],
        blockingReason: `Round ${round.roundNumber} kickoff for ${kickoffTeam.name} has already passed.`,
      };
    }

    matches.push({
      homeTeamId: homeTeam?.id ?? null,
      awayTeamId: awayTeam?.id ?? null,
      homeTeamName: homeTeam?.name ?? 'BYE',
      awayTeamName: awayTeam?.name ?? 'BYE',
      venueType: pairing.venueType,
      scheduledFor,
      scheduleSlotType: slot.kind as HattrickScheduleSlotKind,
      isBye: pairing.isBye,
    });
  }

  return { matches, blockingReason: null };
}

function evaluateDraftFromStartSlot(
  teams: ScheduleTeamDraft[],
  mode: ScheduleMode,
  startSlot: CalendarSlot,
  orderedSlots: CalendarSlot[],
  now: Date,
) {
  const activeTeams = normalizeTeams(teams);
  const teamCount = activeTeams.length;
  const roundCount = getRoundCount(mode, teamCount);

  if (teamCount < 2) {
    return {
      valid: false,
      reason: 'At least 2 active teams are required.',
      roundCount,
      rounds: [] as ScheduleDraftRound[],
      blockingReasons: ['At least 2 active teams are required.'],
      warnings: [] as string[],
      consumesWeek15WeekendFriendly: false,
    };
  }

  if (!startSlot.selectable) {
    return {
      valid: false,
      reason: startSlot.blockedReason || 'Selected start slot is blocked.',
      roundCount,
      rounds: [] as ScheduleDraftRound[],
      blockingReasons: [startSlot.blockedReason || 'Selected start slot is blocked.'],
      warnings: [] as string[],
      consumesWeek15WeekendFriendly: false,
    };
  }

  const startIndex = orderedSlots.findIndex((slot) => slot.id === startSlot.id);
  if (startIndex < 0) {
    return {
      valid: false,
      reason: 'Selected start slot is not available in the current calendar horizon.',
      roundCount,
      rounds: [] as ScheduleDraftRound[],
      blockingReasons: ['Selected start slot is not available in the current calendar horizon.'],
      warnings: [] as string[],
      consumesWeek15WeekendFriendly: false,
    };
  }

  const collectedSlots: CalendarSlot[] = [];
  const blockingReasons: string[] = [];
  for (let index = startIndex; index < orderedSlots.length && collectedSlots.length < roundCount; index += 1) {
    const slot = orderedSlots[index];
    if (slot.kind === 'blocked_cup_week') {
      const reason = `Round ${collectedSlots.length + 1} would fall in blocked cup week W${slot.htWeek}.`;
      blockingReasons.push(reason);
      return {
        valid: false,
        reason,
        roundCount,
        rounds: [] as ScheduleDraftRound[],
        blockingReasons,
        warnings: [] as string[],
        consumesWeek15WeekendFriendly: false,
      };
    }

    if (slot.selectable) {
      if ((slot.htWeek === 3 || slot.htWeek === 4) && collectedSlots.length >= 2) {
        const reason = `Round ${collectedSlots.length + 1} would fall in cup-likely week W${slot.htWeek}; W3-W4 are only allowed for rounds 1 and 2.`;
        blockingReasons.push(reason);
        return {
          valid: false,
          reason,
          roundCount,
          rounds: [] as ScheduleDraftRound[],
          blockingReasons,
          warnings: [] as string[],
          consumesWeek15WeekendFriendly: false,
        };
      }
      collectedSlots.push(slot);
    }
  }

  if (collectedSlots.length < roundCount) {
    const reason = `Not enough allowed calendar slots remain after HT S${startSlot.htSeason} W${startSlot.htWeek}.`;
    return {
      valid: false,
      reason,
      roundCount,
      rounds: [] as ScheduleDraftRound[],
      blockingReasons: [reason],
      warnings: [] as string[],
      consumesWeek15WeekendFriendly: false,
    };
  }

  const pairings = getPairings(mode, activeTeams.map((team) => team.id));
  const teamLookup = createTeamLookup(activeTeams);
  const rounds: ScheduleDraftRound[] = [];
  const warnings = startSlot.warning ? [startSlot.warning] : [];
  let consumesWeek15WeekendFriendly = false;

  for (let index = 0; index < roundCount; index += 1) {
    const slot = collectedSlots[index];
    if (slot.kind === 'week15_weekend_friendly') consumesWeek15WeekendFriendly = true;

    const round = pairings[index];
    if (!round) {
      const reason = `Missing pairings for round ${index + 1}.`;
      return {
        valid: false,
        reason,
        roundCount,
        rounds: [] as ScheduleDraftRound[],
        blockingReasons: [reason],
        warnings,
        consumesWeek15WeekendFriendly,
      };
    }

    const built = buildRoundFromPairings(round, slot, teamLookup, now);
    if (built.blockingReason) {
      return {
        valid: false,
        reason: built.blockingReason,
        roundCount,
        rounds: [] as ScheduleDraftRound[],
        blockingReasons: [built.blockingReason],
        warnings,
        consumesWeek15WeekendFriendly,
      };
    }

    if (slot.warning && !warnings.includes(slot.warning)) {
      warnings.push(slot.warning);
    }

    const displayDate = built.matches[0]?.scheduledFor ?? slot.nominalDate;
    rounds.push({
      roundNumber: index + 1,
      slot,
      displayDate,
      displayDateLabel: formatCalendarDate(displayDate),
      slotLabel: getSlotLabel(slot),
      matches: built.matches,
    });
  }

  const daysUntilStart = getDaysUntil(startSlot.nominalDate, now);
  if (daysUntilStart <= 7) {
    warnings.push(
      daysUntilStart === 0
        ? 'Short notice: the selected start is today. Generate only if teams can still arrange their friendlies.'
        : `Short notice: the selected start is only ${daysUntilStart} day${daysUntilStart === 1 ? '' : 's'} away.`,
    );
  }

  return {
    valid: true,
    reason: null,
    roundCount,
    rounds,
    blockingReasons: [] as string[],
    warnings,
    consumesWeek15WeekendFriendly,
  };
}

function getModeAvailability(
  teams: ScheduleTeamDraft[],
  mode: ScheduleMode,
  orderedSlots: CalendarSlot[],
  now: Date,
) {
  const activeTeams = normalizeTeams(teams);
  if (activeTeams.length < 2) {
    return {
      mode,
      available: false,
      reason: 'At least 2 active teams are required.',
      startSlotId: null,
      startSlot: null,
    };
  }

  const candidateSlots = orderedSlots.filter((slot) => isSelectableStartCandidate(slot, now));
  let firstReason: string | null = null;
  for (const slot of candidateSlots) {
    const result = evaluateDraftFromStartSlot(activeTeams, mode, slot, orderedSlots, now);
    if (result.valid) {
      return {
        mode,
        available: true,
        reason: null,
        startSlotId: slot.id,
        startSlot: slot,
      };
    }
    if (!firstReason && result.reason) {
      firstReason = result.reason;
    }
  }

  return {
    mode,
    available: false,
    reason: firstReason || 'No valid start window found.',
    startSlotId: null,
    startSlot: null,
  };
}

function chooseMode(
  requestedMode: ScheduleMode,
  availabilities: ScheduleModeAvailability[],
): ScheduleMode {
  const requested = availabilities.find((item) => item.mode === requestedMode);
  if (requested?.available) return requestedMode;

  for (const mode of MODE_PRIORITY) {
    const availability = availabilities.find((item) => item.mode === mode);
    if (availability?.available) return mode;
  }

  return MODE_PRIORITY[0];
}

function chooseStartSlot(
  mode: ScheduleMode,
  teams: ScheduleTeamDraft[],
  orderedSlots: CalendarSlot[],
  now: Date,
  requestedStartSlotId: string | null,
) {
  const activeTeams = normalizeTeams(teams);
  const candidateSlots = orderedSlots.filter((slot) => isSelectableStartCandidate(slot, now));
  const validSlots: CalendarSlot[] = [];

  for (const slot of candidateSlots) {
    const result = evaluateDraftFromStartSlot(activeTeams, mode, slot, orderedSlots, now);
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

export function buildScheduleDraft(input: BuildScheduleDraftInput): ScheduleDraftPreview {
  const now = input.now ?? new Date();
  const orderedSlots = buildCalendarSlots(now, input.horizonWeeks ?? DEFAULT_HORIZON_WEEKS);
  const calendarContext = getHattrickCalendarContext(now);
  const activeTeams = normalizeTeams(input.teams);
  const teamCount = activeTeams.length;

  const availableModes = MODE_PRIORITY.map((mode) => getModeAvailability(activeTeams, mode, orderedSlots, now));
  const mode = chooseMode(input.mode, availableModes);
  const chosenModeAvailability = availableModes.find((item) => item.mode === mode);
  const { startSlotOptions, selectedStartSlot } = chooseStartSlot(
    mode,
    activeTeams,
    orderedSlots,
    now,
    input.startSlotId,
  );

  const closestAvailableStartSlot = startSlotOptions[0] || chosenModeAvailability?.startSlot || null;
  const selectedStartSlotResolved = selectedStartSlot || closestAvailableStartSlot;
  const roundCount = getRoundCount(mode, teamCount);

  if (!selectedStartSlotResolved) {
    return {
      valid: false,
      reason: chosenModeAvailability?.reason || 'No valid start window found.',
      teamCount,
      requestedMode: input.mode,
      mode,
      requestedStartSlotId: input.startSlotId,
      selectedStartSlotId: null,
      selectedStartSlot: null,
      roundCount,
      rounds: [],
      availableModes,
      startSlotOptions,
      allSlotOptions: orderedSlots
        .filter((slot) => isDisplayStartCandidate(slot, now))
        .slice(0, MAX_START_OPTIONS + 8),
      closestAvailableStartSlot,
      daysUntilStart: null,
      calendarContext,
      blockingReasons: [chosenModeAvailability?.reason || 'No valid start window found.'],
      warnings: [],
      consumesWeek15WeekendFriendly: false,
    };
  }

  const evaluation = evaluateDraftFromStartSlot(activeTeams, mode, selectedStartSlotResolved, orderedSlots, now);
  const daysUntilStart = getDaysUntil(selectedStartSlotResolved.nominalDate, now);

  return {
    valid: evaluation.valid,
    reason: evaluation.reason,
    teamCount,
    requestedMode: input.mode,
    mode,
    requestedStartSlotId: input.startSlotId,
    selectedStartSlotId: selectedStartSlotResolved.id,
    selectedStartSlot: selectedStartSlotResolved,
    roundCount: evaluation.roundCount,
    rounds: evaluation.rounds,
    availableModes,
    startSlotOptions,
    allSlotOptions: orderedSlots
      .filter((slot) => isDisplayStartCandidate(slot, now))
      .slice(0, MAX_START_OPTIONS + 8),
    closestAvailableStartSlot,
    daysUntilStart,
    calendarContext,
    blockingReasons: evaluation.blockingReasons,
    warnings: evaluation.warnings,
    consumesWeek15WeekendFriendly: evaluation.consumesWeek15WeekendFriendly,
  };
}

export function serializeScheduleDraftForRpc(draft: ScheduleDraftPreview): SerializedSchedulePayload {
  if (!draft.selectedStartSlot) {
    throw new Error('Schedule draft is missing a start slot.');
  }

  return {
    mode: draft.mode,
    team_count: draft.teamCount,
    start_slot_id: draft.selectedStartSlot.id,
    start_slot_kind: draft.selectedStartSlot.kind as HattrickScheduleSlotKind,
    start_slot_date: draft.selectedStartSlot.nominalDate.toISOString(),
    include_week15_weekend_friendly: draft.consumesWeek15WeekendFriendly,
    rounds: draft.rounds.map((round) => ({
      round_number: round.roundNumber,
      slot_id: round.slot.id,
      slot_kind: round.slot.kind,
      slot_date: round.slot.nominalDate.toISOString(),
      display_date: round.displayDate.toISOString(),
      matches: round.matches.map((match) => ({
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

export function getUpcomingScheduleStartSlots(now = new Date(), count = 12) {
  return buildCalendarSlots(now, Math.max(count * 8, DEFAULT_HORIZON_WEEKS))
    .filter((slot) => isSelectableStartCandidate(slot, now))
    .slice(0, count);
}
