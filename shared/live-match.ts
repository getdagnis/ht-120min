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
  extraTimeAnchorMs?: number | null;
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
  if (phase === 'first_half') return `${phaseLabel(phase)} · ${Math.min(45, elapsedMinutes + 1)}′`;

  if (phase === 'extra_time') {
    const anchor = input.extraTimeAnchorMs ?? input.nowMs;
    const minute = Math.min(120, 91 + Math.max(0, Math.floor((input.nowMs - anchor) / 60000)));
    return `${phaseLabel(phase)} · ${minute}′`;
  }

  const regulationElapsed = Math.max(0, elapsedMinutes - 55);
  const footballMinute = Math.min(90, 45 + regulationElapsed + 1);
  if (footballMinute < 90) return `${phaseLabel(phase)} · ${footballMinute}′`;
  const announced = input.announcedAddedMinutes;
  if (announced == null || announced <= 0) return `${phaseLabel(phase)} · 90′`;
  const added = Math.min(announced, Math.max(0, elapsedMinutes - 99));
  return added > 0 ? `${phaseLabel(phase)} · 90+${added}′` : `${phaseLabel(phase)} · 90′ (+${announced})`;
}

export interface LivePollCandidate extends Pick<LiveMatchClock, 'phase' | 'lastEventMinute'> {
  kickoffMs?: number | null;
}

export function getLivePollDelay(matches: LivePollCandidate[], nowMs = Date.now()): number {
  if (matches.some((match) => match.phase === 'penalties')) return 4000;
  if (matches.some((match) => match.phase === 'extra_time' && (match.lastEventMinute ?? 0) >= 115)) return 5000;
  if (matches.some((match) => match.phase === 'second_half' && (
    (match.lastEventMinute ?? 0) >= 85 ||
    (match.kickoffMs != null && nowMs - match.kickoffMs >= 95 * 60000)
  ))) return 5000;
  if (matches.some((match) => match.phase === 'extra_time')) return 15000;
  if (matches.some((match) => match.phase === 'half_time' || (match.phase === 'first_half' && (match.lastEventMinute ?? 0) >= 40))) return 10000;
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
