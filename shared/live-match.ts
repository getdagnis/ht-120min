export type LiveMatchPhase = 'first_half' | 'half_time' | 'second_half' | 'extra_time' | 'penalties';

export interface LiveMatchClock {
  phase: LiveMatchPhase | null;
  matchPart: number | null;
  lastEventMinute: number | null;
  nextEventMinute: number | null;
  nextEventMatchPart: number | null;
  announcedAddedMinutes: number | null;
  fetchedAt: string | null;
}

export interface LiveClockDisplayInput {
  kickoffMs?: number | null;
  nowMs: number;
  phase?: LiveMatchPhase | null;
  announcedAddedMinutes?: number | null;
}

const HALF_TIME_BREAK_MINUTES = 10;
// Hattrick pauses briefly after regulation before MatchPart 3. This remains
// part of the shared kickoff timeline, never a browser-observation timestamp.
const EXTRA_TIME_BREAK_MINUTES = 5;

export function getLiveMatchMinute(input: LiveClockDisplayInput): number | null {
  const { kickoffMs, phase } = input;
  if (kickoffMs == null || !Number.isFinite(kickoffMs) || !phase || phase === 'half_time' || phase === 'penalties') {
    return null;
  }

  const elapsedMinutes = Math.max(0, Math.floor((input.nowMs - kickoffMs) / 60000));
  if (phase === 'first_half') return Math.min(45, elapsedMinutes + 1);

  if (phase === 'extra_time') {
    const addedMinutes = Math.max(0, input.announcedAddedMinutes ?? 0);
    const extraTimeStart = 45 + HALF_TIME_BREAK_MINUTES + 45 + addedMinutes + EXTRA_TIME_BREAK_MINUTES;
    return Math.min(120, Math.max(91, 91 + elapsedMinutes - extraTimeStart));
  }

  const regulationMinute = Math.min(90, Math.max(46, elapsedMinutes - HALF_TIME_BREAK_MINUTES - 45 + 46));
  if (regulationMinute < 90) return regulationMinute;
  const announced = input.announcedAddedMinutes;
  if (announced == null || announced <= 0) return 90;
  return Math.min(90 + announced, 90 + Math.max(0, elapsedMinutes - (45 + HALF_TIME_BREAK_MINUTES + 45 - 1)));
}

export function getLiveClockDisplay(input: LiveClockDisplayInput): string {
  const phase = input.phase;
  if (!phase) return 'ONGOING';
  if (phase === 'penalties') return 'PENALTIES';

  const kickoffMs = input.kickoffMs;
  if (kickoffMs == null || !Number.isFinite(kickoffMs)) {
    return phase === 'half_time' ? 'HALF-TIME' : phaseLabel(phase);
  }

  const elapsedMinutes = Math.max(0, Math.floor((input.nowMs - kickoffMs) / 60000));
  if (phase === 'half_time' || (phase === 'first_half' && elapsedMinutes >= 45 && elapsedMinutes < 55)) {
    return 'HALF-TIME';
  }
  const minute = getLiveMatchMinute(input);
  if (minute == null) return phaseLabel(phase);
  if (phase === 'first_half' || phase === 'extra_time') return `${phaseLabel(phase)} · ${minute}′`;
  if (minute < 90) return `${phaseLabel(phase)} · ${minute}′`;
  const announced = input.announcedAddedMinutes;
  if (announced == null || announced <= 0) return `${phaseLabel(phase)} · 90′`;
  const added = Math.max(0, minute - 90);
  return added > 0 ? `${phaseLabel(phase)} · 90+${added}′` : `${phaseLabel(phase)} · 90′ (+${announced})`;
}

export interface LivePollCandidate extends Pick<LiveMatchClock, 'phase' | 'lastEventMinute'> {
  kickoffMs?: number | null;
}

export function getLivePollDelay(matches: LivePollCandidate[], nowMs = Date.now()): number {
  if (matches.some((match) => match.phase === 'penalties')) return 4000;
  if (matches.some((match) => {
    const minute = getLiveMatchMinute({ kickoffMs: match.kickoffMs, nowMs, phase: match.phase });
    return match.phase === 'extra_time' && (minute ?? match.lastEventMinute ?? 0) >= 115;
  })) return 5000;
  if (matches.some((match) => {
    const minute = getLiveMatchMinute({ kickoffMs: match.kickoffMs, nowMs, phase: match.phase });
    return match.phase === 'second_half' && (minute ?? match.lastEventMinute ?? 0) >= 85;
  })) return 5000;
  if (matches.some((match) => match.phase === 'extra_time')) return 15000;
  if (matches.some((match) => {
    const minute = getLiveMatchMinute({ kickoffMs: match.kickoffMs, nowMs, phase: match.phase });
    return match.phase === 'half_time' || (match.phase === 'first_half' && (minute ?? match.lastEventMinute ?? 0) >= 40);
  })) return 10000;
  return 30000;
}

function phaseLabel(phase: LiveMatchPhase): string {
  return {
    first_half: 'FIRST HALF',
    half_time: 'HALF-TIME',
    second_half: 'SECOND HALF',
    extra_time: 'EXTRA TIME',
    penalties: 'PENALTIES',
  }[phase];
}

export function formatLiveMatchStatus(clock?: Partial<LiveMatchClock>): string {
  if (!clock?.phase) return 'ONGOING';
  return phaseLabel(clock.phase);
}
