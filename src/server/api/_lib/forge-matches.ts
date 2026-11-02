import type { ChppChallengeOffer, ChppOutgoingChallenge } from './chpp-challenges.js';
import { getRoundPreparationOpensAt } from '../../../utils/hattrick-calendar.js';

export type ForgeMatchSide = 'home' | 'away';

export interface ForgeFixtureTeam {
  id: string;
  name: string;
  managerName: string | null;
  managerHtId: number | null;
  htTeamId: number | null;
  active: boolean;
  isPlaceholder: boolean;
  autoArrangeEnabled?: boolean | null;
}

export interface ForgeFixtureRecord {
  id: string;
  roundId: string;
  status: string | null;
  completed: boolean;
  home: ForgeFixtureTeam | null;
  away: ForgeFixtureTeam | null;
}

export interface ForgeRoundSelectionRow {
  round_number: number;
  phase_status: string;
  reserved_slot_kind?: string | null;
  reserved_slot_date?: string | null;
  matches?: Array<{
    completed: boolean | null;
    status?: string | null;
    ht_match_id?: number | null;
    scheduled_for?: string | null;
  }> | null;
}

export interface ForgeRoundRefreshOutcome {
  id: string;
  name: string;
  preparedRounds: number[];
  reason: string;
  opensAt?: string | null;
  error?: string;
}

function getPreparationErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'Could not prepare this tournament.';
}

export async function prepareForgeTournamentRoundsIndependently<T extends { id: string; name: string }>(
  tournaments: T[],
  prepare: (tournament: T) => Promise<{
    prepared: Array<{ roundNumber: number }>;
    reason: string;
    opensAt?: string | null;
  }>,
): Promise<ForgeRoundRefreshOutcome[]> {
  const outcomes: ForgeRoundRefreshOutcome[] = [];
  for (const tournament of tournaments) {
    try {
      const result = await prepare(tournament);
      outcomes.push({
        id: tournament.id,
        name: tournament.name,
        preparedRounds: result.prepared.map((round) => round.roundNumber),
        reason: result.reason,
        opensAt: result.opensAt ?? null,
      });
    } catch (error) {
      outcomes.push({
        id: tournament.id,
        name: tournament.name,
        preparedRounds: [],
        reason: 'preparation_failed',
        error: getPreparationErrorMessage(error),
      });
    }
  }
  return outcomes;
}

export function selectCurrentForgeRound<T extends ForgeRoundSelectionRow>(rounds: T[], now = new Date()) {
  const ordered = [...rounds]
    .filter((round) => round.phase_status === 'materialized')
    .sort((left, right) => left.round_number - right.round_number);
  const scheduledRounds = ordered.filter((round) =>
    round.reserved_slot_kind === 'midweek_friendly' || round.reserved_slot_kind === 'weekend_friendly',
  );
  const currentlyBookable = scheduledRounds.filter((round) => {
    if (!round.reserved_slot_kind || !round.reserved_slot_date) return false;
    const opensAt = getRoundPreparationOpensAt(round.reserved_slot_date, round.reserved_slot_kind);
    return Boolean(opensAt && opensAt <= now && round.matches?.some((match) => {
      const kickoff = match.scheduled_for ? Date.parse(match.scheduled_for) : NaN;
      return Number.isFinite(kickoff) && kickoff > now.getTime()
        && match.completed !== true
        && !match.ht_match_id
        && !['arranged', 'ongoing', 'finished', 'misarranged'].includes(match.status || '');
    }));
  }).sort((left, right) => {
    const leftKickoff = Math.min(...(left.matches || []).map((match) => Date.parse(match.scheduled_for || '')).filter(Number.isFinite));
    const rightKickoff = Math.min(...(right.matches || []).map((match) => Date.parse(match.scheduled_for || '')).filter(Number.isFinite));
    return leftKickoff - rightKickoff || left.round_number - right.round_number;
  });
  if (currentlyBookable.length > 0 || scheduledRounds.length > 0) return currentlyBookable[0] || null;
  return ordered.find((round) =>
    round.matches?.some((match) => match.completed !== true && match.status !== 'misarranged'),
  ) || null;
}

export interface ForgeTeamChallengeInspection {
  state: 'ready' | 'credentials_missing' | 'permission_missing' | 'ownership_mismatch' | 'chpp_error';
  reason: string;
  outgoing: ChppOutgoingChallenge[];
  incoming: ChppChallengeOffer[];
}

export interface ForgeTeamActionView {
  chppState: string;
  chppReason: string;
  canChallenge: boolean;
  canAccept: boolean;
  canWithdraw: boolean;
  challengeDisabledReason: string;
  acceptDisabledReason?: string;
  trainingMatchId: number | null;
}

export function resolveForgeFixtureActionTarget(
  fixture: ForgeFixtureRecord,
  actingSide: ForgeMatchSide,
) {
  if (actingSide !== 'home' && actingSide !== 'away') return null;
  const team = actingSide === 'home' ? fixture.home : fixture.away;
  const opponent = actingSide === 'home' ? fixture.away : fixture.home;
  if (!team || !opponent) return null;

  return {
    team,
    opponent,
    matchPlace: actingSide === 'home' ? 0 as const : 1 as const,
  };
}

export function findExactPendingOutgoingChallenge(
  challenges: ChppOutgoingChallenge[],
  opponentHtTeamId: number,
) {
  return challenges.find(
    (challenge) => challenge.opponentTeamId === opponentHtTeamId && !challenge.isAgreed && Boolean(challenge.trainingMatchId),
  ) || null;
}

export function findExactPendingIncomingChallenge(
  offers: ChppChallengeOffer[],
  challengerHtTeamId: number,
) {
  return offers.find(
    (offer) => offer.opponentTeamId === challengerHtTeamId && !offer.isAgreed && Boolean(offer.trainingMatchId),
  ) || null;
}

export function hasExactAgreedChallenge(
  challenges: ChppOutgoingChallenge[],
  offers: ChppChallengeOffer[],
  opponentHtTeamId: number,
) {
  return challenges.some((challenge) => challenge.opponentTeamId === opponentHtTeamId && challenge.isAgreed)
    || offers.some((offer) => offer.opponentTeamId === opponentHtTeamId && offer.isAgreed);
}

export function isForgeFixtureAlreadyBooked(fixture: ForgeFixtureRecord) {
  return fixture.completed || ['arranged', 'finished', 'ongoing'].includes(fixture.status || '');
}

export function isForgeFixtureMisarranged(fixture: ForgeFixtureRecord) {
  return fixture.status === 'misarranged';
}

export function resolveForgeTeamActions(input: {
  fixture: ForgeFixtureRecord;
  side: ForgeMatchSide;
  inspection: ForgeTeamChallengeInspection;
  outgoing: ChppOutgoingChallenge | null;
  incoming: ChppChallengeOffer | null;
  opponentOutgoing: ChppOutgoingChallenge | null;
}): ForgeTeamActionView {
  const derivedIncoming = input.incoming || input.opponentOutgoing;
  const booked = isForgeFixtureAlreadyBooked(input.fixture);
  const misarranged = isForgeFixtureMisarranged(input.fixture);
  const blockedReason = booked
    ? 'This fixture is already booked or linked.'
    : misarranged
      ? 'This fixture is misarranged; pairings are unchanged and actions are paused.'
      : input.inspection.reason;
  const canAct = !booked && !misarranged && input.inspection.state === 'ready';
  const chppState = booked
    ? 'ARRANGED'
    : misarranged
      ? 'MISARRANGED'
      : input.inspection.state === 'credentials_missing'
        ? 'CHPP CREDENTIALS MISSING'
        : input.inspection.state === 'permission_missing'
          ? 'CHPP PERMISSION MISSING'
          : input.inspection.state === 'ownership_mismatch'
            ? 'CHPP OWNERSHIP MISMATCH'
            : input.inspection.state === 'chpp_error'
              ? 'CHPP ERROR'
              : derivedIncoming
                ? 'INCOMING CHALLENGE'
                : input.outgoing
                  ? 'OUTGOING CHALLENGE'
                  : 'NOT ARRANGED';
  return {
    chppState,
    chppReason: derivedIncoming && canAct
      ? 'A matching challenge from the opponent is waiting for acceptance.'
      : input.outgoing && canAct
        ? 'A matching challenge is waiting for the opponent to accept.'
        : blockedReason,
    canChallenge: canAct && !input.outgoing && !derivedIncoming,
    canAccept: canAct && Boolean(derivedIncoming),
    canWithdraw: canAct && Boolean(input.outgoing?.trainingMatchId),
    challengeDisabledReason: input.outgoing
      ? 'A challenge to this opponent is already outgoing.'
      : derivedIncoming
        ? 'Accept the incoming challenge instead.'
        : blockedReason,
    acceptDisabledReason: derivedIncoming ? undefined : blockedReason || 'No matching incoming challenge from the opponent.',
    trainingMatchId: derivedIncoming?.trainingMatchId || input.outgoing?.trainingMatchId || null,
  };
}
