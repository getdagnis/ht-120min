import { getStockholmOffsetMinutes, getStockholmWallClock } from '../../../utils/hattrick-calendar.js';

export interface ReserveFriendlyCandidate {
  homeId: number;
  awayId: number;
  date: Date;
  matchId: number;
  matchType: number;
}

export interface ReserveCandidateTeam {
  id: string;
  ht_team_id: number;
}

export type ReserveFixtureMatch<Reserve extends ReserveCandidateTeam = ReserveCandidateTeam> =
  | { kind: 'original'; fixture: ReserveFriendlyCandidate }
  | { kind: 'reserve'; fixture: ReserveFriendlyCandidate; reserve: Reserve; replaces: 'home' | 'away' }
  | { kind: 'both-reserves' }
  | null;

function isPair(fixture: ReserveFriendlyCandidate, first: number, second: number) {
  return (
    (fixture.homeId === first && fixture.awayId === second) ||
    (fixture.homeId === second && fixture.awayId === first)
  );
}

function isSingleOriginalAndReserve<Reserve extends ReserveCandidateTeam>(
  fixture: ReserveFriendlyCandidate,
  homeHtTeamId: number,
  awayHtTeamId: number,
  reserveByHtTeamId: Map<number, Reserve>,
) {
  const originalHome = fixture.homeId === homeHtTeamId || fixture.awayId === homeHtTeamId;
  const originalAway = fixture.homeId === awayHtTeamId || fixture.awayId === awayHtTeamId;
  if (originalHome === originalAway) return null;

  const originalId = originalHome ? homeHtTeamId : awayHtTeamId;
  const reserveHtTeamId = fixture.homeId === originalId ? fixture.awayId : fixture.homeId;
  const reserve = reserveByHtTeamId.get(reserveHtTeamId);
  if (!reserve) return null;

  return {
    fixture,
    reserve,
    replaces: originalHome ? ('away' as const) : ('home' as const),
  };
}

/**
 * Resolve a friendly booking without allowing refresh order to decide between
 * two independent reserve replacements.
 */
export function findReserveFixtureMatch<Reserve extends ReserveCandidateTeam>(input: {
  homeHtTeamId: number;
  awayHtTeamId: number;
  homeFriendlies: ReserveFriendlyCandidate[];
  awayFriendlies: ReserveFriendlyCandidate[];
  reserveTeams: Reserve[];
  targetDate: Date;
  isInsideWindow: (friendlyDate: Date, targetDate: Date) => boolean;
  reserveAllowed: boolean;
}): ReserveFixtureMatch<Reserve> {
  const candidates = Array.from(
    new Map(
      [...input.homeFriendlies, ...input.awayFriendlies]
        .filter((fixture) => input.isInsideWindow(fixture.date, input.targetDate))
        .map((fixture) => [fixture.matchId, fixture]),
    ).values(),
  );

  const original = candidates.find((fixture) =>
    isPair(fixture, input.homeHtTeamId, input.awayHtTeamId),
  );
  if (original) return { kind: 'original', fixture: original };
  if (!input.reserveAllowed) return null;

  const reserveByHtTeamId = new Map(input.reserveTeams.map((team) => [team.ht_team_id, team]));
  const reserveMatches = candidates
    .map((fixture) =>
      isSingleOriginalAndReserve(fixture, input.homeHtTeamId, input.awayHtTeamId, reserveByHtTeamId),
    )
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));

  const originalHomeMatches = reserveMatches.filter((candidate) => candidate.replaces === 'away');
  const originalAwayMatches = reserveMatches.filter((candidate) => candidate.replaces === 'home');
  if (originalHomeMatches.length > 0 && originalAwayMatches.length > 0) return { kind: 'both-reserves' };
  if (reserveMatches.length !== 1) return null;

  const candidate = reserveMatches[0];
  return {
    kind: 'reserve',
    fixture: candidate.fixture,
    reserve: candidate.reserve,
    replaces: candidate.replaces,
  };
}

function localStockholmDateAt(date: Date, hours: number, minutes: number) {
  const wallClock = getStockholmWallClock(date);
  const day = wallClock.getUTCDay();
  const daysBackToFriday = (day + 2) % 7;
  const wallClockDeadline = Date.UTC(
    wallClock.getUTCFullYear(),
    wallClock.getUTCMonth(),
    wallClock.getUTCDate() - daysBackToFriday,
    hours,
    minutes,
    0,
    0,
  );
  const offset = getStockholmOffsetMinutes(new Date(wallClockDeadline));
  return new Date(wallClockDeadline - offset * 60_000);
}

export function getReserveEligibilityDeadline(targetDate: Date) {
  return localStockholmDateAt(targetDate, 17, 0);
}

export function isReserveUseAllowed(input: {
  status: string | null | undefined;
  targetDate: Date;
  now?: Date;
}) {
  if (input.status === 'misarranged') return true;
  return (input.now ?? new Date()) >= getReserveEligibilityDeadline(input.targetDate);
}
