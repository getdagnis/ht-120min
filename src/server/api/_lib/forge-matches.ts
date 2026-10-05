import type { ChppChallengeOffer, ChppOutgoingChallenge } from './chpp-challenges.js';

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
  matches?: Array<{ completed: boolean | null }> | null;
}

export function selectCurrentForgeRound<T extends ForgeRoundSelectionRow>(rounds: T[]) {
  return [...rounds]
    .filter((round) => round.phase_status === 'materialized')
    .sort((left, right) => left.round_number - right.round_number)
    .find((round) => round.matches?.some((match) => match.completed !== true)) || null;
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
    challengeDisabledReason: input.outgoing
      ? 'A challenge to this opponent is already outgoing.'
      : derivedIncoming
        ? 'Accept the incoming challenge instead.'
        : blockedReason,
    acceptDisabledReason: derivedIncoming ? undefined : blockedReason || 'No matching incoming challenge from the opponent.',
    trainingMatchId: derivedIncoming?.trainingMatchId || input.outgoing?.trainingMatchId || null,
  };
}
