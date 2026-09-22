import type {
  MatchCardEvent,
  MatchEventDetails,
  MatchEventSummary,
  MatchGoalEvent,
  MatchInjuryEvent,
  MatchResultDetails,
  MatchScore,
  MatchSideEventDetails,
  MatchSidePerformance,
} from '../../../../shared/match-events.js';

const CARD_EVENT_TYPES = new Set([510, 511, 512, 513, 514]);
const REGULAR_GOAL_EVENT_TYPES = new Set([
  101, 102, 103, 111, 112, 113, 121, 122, 123, 131, 132, 133,
  151, 152, 153, 161, 162, 163, 171, 172, 173, 181, 182, 183,
]);
const GOAL_EVENT_TYPES = new Set([
  ...Array.from({ length: 26 }, (_, index) => 100 + index),
  ...Array.from({ length: 14 }, (_, index) => 130 + index),
  ...Array.from({ length: 5 }, (_, index) => 150 + index),
  ...Array.from({ length: 5 }, (_, index) => 160 + index),
  ...Array.from({ length: 5 }, (_, index) => 170 + index),
  ...Array.from({ length: 8 }, (_, index) => 180 + index),
  190,
]);
const PENALTY_SHOOTOUT_GOAL_EVENT_TYPES = new Set([55, 56, 57]);
const PENALTY_SHOOTOUT_EVENT_TYPES = new Set([55, 56, 57, 58, 59, 71, 73]);
const INJURY_LOCATION_EVENT_MIN = 401;
const INJURY_LOCATION_EVENT_MAX = 422;
const INJURY_BY_FOUL_EVENT = 423;
const INJURY_DURATION_EVENT = 454;

interface ParsedEvent {
  typeId: number;
  minute: number | null;
  matchPart: number | null;
  subjectTeamId: number | null;
  subjectPlayerId: number | null;
  objectPlayerId: number | null;
}

interface ParsedInjury {
  teamId: number;
  playerId: number | null;
  playerName: string | null;
  minute: number | null;
  matchPart: number | null;
  injuryType: number;
}

interface ParsedScorer {
  teamId: number | null;
  playerId: number | null;
  playerName: string | null;
  minute: number | null;
  matchPart: number | null;
  homeGoals: number;
  awayGoals: number;
}

interface ParsedBooking {
  teamId: number | null;
  playerId: number | null;
  playerName: string | null;
  minute: number | null;
  matchPart: number | null;
}

function readNumber(block: string, tag: string): number | null {
  const raw = block.match(new RegExp(`<${tag}>(-?\\d+)<\\/${tag}>`, 'i'))?.[1];
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}

function readText(block: string, tag: string): string | null {
  const value = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1]?.trim();
  return value || null;
}

function getEventTypeId(eventXml: string): number | null {
  const eventTypeId = readNumber(eventXml, 'EventTypeID');
  if (eventTypeId !== null) return eventTypeId;
  const eventKey = eventXml.match(/<EventKey>(\d+)(?:_\d+)?<\/EventKey>/i)?.[1];
  return eventKey ? Number.parseInt(eventKey, 10) : null;
}

function getEventBlocks(xml: string): ParsedEvent[] {
  return (xml.match(/<Event(?:\s[^>]*)?>[\s\S]*?<\/Event>/gi) || [])
    .map((eventXml) => {
      const typeId = getEventTypeId(eventXml);
      if (!typeId) return null;
      return {
        typeId,
        minute: readNumber(eventXml, 'Minute'),
        matchPart: readNumber(eventXml, 'MatchPart'),
        subjectTeamId: readNumber(eventXml, 'SubjectTeamID'),
        subjectPlayerId: readNumber(eventXml, 'SubjectPlayerID'),
        objectPlayerId: readNumber(eventXml, 'ObjectPlayerID'),
      };
    })
    .filter((event): event is ParsedEvent => Boolean(event));
}

function getInjuryBlocks(xml: string): ParsedInjury[] {
  const injuriesBlock = xml.match(/<Injuries>([\s\S]*?)<\/Injuries>/i)?.[1] || '';
  return (injuriesBlock.match(/<Injury(?:\s[^>]*)?>[\s\S]*?<\/Injury>/gi) || [])
    .map((injuryXml) => {
      const teamId = readNumber(injuryXml, 'InjuryTeamID');
      const injuryType = readNumber(injuryXml, 'InjuryType');
      if (!teamId || injuryType === null) return null;
      return {
        teamId,
        playerId: readNumber(injuryXml, 'InjuryPlayerID'),
        playerName: readText(injuryXml, 'InjuryPlayerName'),
        minute: readNumber(injuryXml, 'InjuryMinute'),
        matchPart: readNumber(injuryXml, 'MatchPart'),
        injuryType,
      };
    })
    .filter((injury): injury is ParsedInjury => Boolean(injury));
}

function getBookings(xml: string): ParsedBooking[] {
  const bookingsBlock = xml.match(/<Bookings>([\s\S]*?)<\/Bookings>/i)?.[1] || '';
  return (bookingsBlock.match(/<Booking(?:\s[^>]*)?>[\s\S]*?<\/Booking>/gi) || []).map((bookingXml) => ({
    teamId: readNumber(bookingXml, 'BookingTeamID'),
    playerId: readNumber(bookingXml, 'BookingPlayerID'),
    playerName: readText(bookingXml, 'BookingPlayerName'),
    minute: readNumber(bookingXml, 'BookingMinute'),
    matchPart: readNumber(bookingXml, 'MatchPart'),
  }));
}

function getScorers(xml: string): ParsedScorer[] {
  const scorersBlock = xml.match(/<Scorers>([\s\S]*?)<\/Scorers>/i)?.[1] || '';
  return (scorersBlock.match(/<Goal(?:\s[^>]*)?>[\s\S]*?<\/Goal>/gi) || []).map((goalXml) => ({
    teamId: readNumber(goalXml, 'ScorerTeamID'),
    playerId: readNumber(goalXml, 'ScorerPlayerID'),
    playerName: readText(goalXml, 'ScorerPlayerName'),
    minute: readNumber(goalXml, 'ScorerMinute'),
    matchPart: readNumber(goalXml, 'MatchPart'),
    homeGoals: readNumber(goalXml, 'ScorerHomeGoals') ?? 0,
    awayGoals: readNumber(goalXml, 'ScorerAwayGoals') ?? 0,
  }));
}

const TACTIC_NAMES: Record<number, string> = {
  0: 'Normal',
  1: 'Pressing',
  2: 'Counter-attacks',
  3: 'Attack in the middle',
  4: 'Attack on wings',
  7: 'Play creatively',
  8: 'Long shots',
};

function getTeamBlock(xml: string, side: 'Home' | 'Away') {
  return xml.match(new RegExp(`<${side}Team>[\\s\\S]*?<\\/${side}Team>`, 'i'))?.[0] || '';
}

function sidePerformance(xml: string, side: 'Home' | 'Away'): MatchSidePerformance {
  const team = getTeamBlock(xml, side);
  const possessionSide = side === 'Home' ? 'Home' : 'Away';
  const tacticType = readNumber(team, 'TacticType');
  return {
    formation: readText(team, 'Formation'),
    tacticType,
    tacticName: tacticType === null ? null : TACTIC_NAMES[tacticType] || null,
    tacticSkill: readNumber(team, 'TacticSkill'),
    possessionFirstHalf: readNumber(xml, `PossessionFirstHalf${possessionSide}`),
    possessionSecondHalf: readNumber(xml, `PossessionSecondHalf${possessionSide}`),
    ratings: {
      midfield: readNumber(team, 'RatingMidfield'),
      rightDefence: readNumber(team, 'RatingRightDef'),
      centralDefence: readNumber(team, 'RatingMidDef'),
      leftDefence: readNumber(team, 'RatingLeftDef'),
      rightAttack: readNumber(team, 'RatingRightAtt'),
      centralAttack: readNumber(team, 'RatingMidAtt'),
      leftAttack: readNumber(team, 'RatingLeftAtt'),
    },
    chances: {
      left: readNumber(team, 'NrOfChancesLeft'),
      centre: readNumber(team, 'NrOfChancesCenter'),
      right: readNumber(team, 'NrOfChancesRight'),
      specialEvents: readNumber(team, 'NrOfChancesSpecialEvents'),
      other: readNumber(team, 'NrOfChancesOther'),
    },
  };
}

function resultDetails(
  xml: string,
  scorers: ParsedScorer[],
  actualHomeTeamId: number | null,
  actualAwayTeamId: number | null,
  hasPenaltyShootout: boolean,
  penaltyShootout: MatchScore | null,
): MatchResultDetails {
  const after = (lastPart: number) => {
    const last = [...scorers].reverse().find((goal) => goal.matchPart !== null && goal.matchPart <= lastPart);
    return last ? { home: last.homeGoals, away: last.awayGoals } : { home: 0, away: 0 };
  };
  const scoreAfterRegulation = after(2);
  const scoreAfterExtraTime = after(3);
  const reached120 = scorers.some((goal) => goal.matchPart === 3) || /<MatchPart>[34]<\/MatchPart>/i.test(xml);
  const decisionType = hasPenaltyShootout ? 'penalty_shootout' : reached120 ? 'extra_time' : 'regulation';
  const decidingScore = hasPenaltyShootout && penaltyShootout ? penaltyShootout : scoreAfterExtraTime;
  const winnerTeamId = decidingScore.home === decidingScore.away
    ? null
    : decidingScore.home > decidingScore.away ? actualHomeTeamId : actualAwayTeamId;
  return { scoreAfterRegulation, scoreAfterExtraTime, penaltyShootout, decisionType, winnerTeamId, reached120 };
}

function getActualTeamIds(xml: string) {
  return {
    actualHomeTeamId:
      Number.parseInt(xml.match(/<HomeTeam>[\s\S]*?<HomeTeamID>(\d+)<\/HomeTeamID>/i)?.[1] || '0', 10) || null,
    actualAwayTeamId:
      Number.parseInt(xml.match(/<AwayTeam>[\s\S]*?<AwayTeamID>(\d+)<\/AwayTeamID>/i)?.[1] || '0', 10) || null,
  };
}

function createSide(teamId: number | null): MatchSideEventDetails {
  return { teamId, cards: [], injuries: [], goals: [], penaltyShootoutGoals: 0 };
}

function findInjury(
  injuries: MatchInjuryEvent[],
  playerId: number | null,
  minute: number | null,
): MatchInjuryEvent | null {
  return (
    injuries.find((injury) => injury.playerId === playerId && injury.minute === minute) ||
    injuries.find((injury) => injury.playerId === playerId) ||
    null
  );
}

function findInjuryAtMatchTime(
  injuries: MatchInjuryEvent[],
  minute: number | null,
  matchPart: number | null,
): MatchInjuryEvent | null {
  const matches = injuries.filter(
    (injury) =>
      injury.minute === minute &&
      (matchPart === null || injury.matchPart === null || injury.matchPart === matchPart),
  );
  return matches.length === 1 ? matches[0] : null;
}

function validWeeks(value: number | null): number | null {
  return value !== null && value > 0 && value <= 52 ? value : null;
}

function toCardEvent(event: ParsedEvent): MatchCardEvent | null {
  if (!CARD_EVENT_TYPES.has(event.typeId)) return null;

  if (event.typeId === 510 || event.typeId === 511) {
    return {
      eventTypeId: event.typeId,
      playerId: event.subjectPlayerId,
      minute: event.minute,
      matchPart: event.matchPart,
      type: 'yellow',
      reason: event.typeId === 510 ? 'nasty_play' : 'cheating',
    };
  }

  if (event.typeId === 512 || event.typeId === 513) {
    return {
      eventTypeId: event.typeId,
      playerId: event.subjectPlayerId,
      minute: event.minute,
      matchPart: event.matchPart,
      type: 'second_yellow_red',
      reason: event.typeId === 512 ? 'nasty_play' : 'cheating',
    };
  }

  return {
    eventTypeId: 514,
    playerId: event.subjectPlayerId,
    minute: event.minute,
    matchPart: event.matchPart,
    type: 'straight_red',
    reason: null,
  };
}

function toGoalEvent(event: ParsedEvent): MatchGoalEvent | null {
  if (!GOAL_EVENT_TYPES.has(event.typeId) && !PENALTY_SHOOTOUT_GOAL_EVENT_TYPES.has(event.typeId)) return null;
  return {
    eventTypeId: event.typeId,
    playerId: event.subjectPlayerId,
    minute: event.minute,
    matchPart: event.matchPart,
    category: PENALTY_SHOOTOUT_GOAL_EVENT_TYPES.has(event.typeId)
      ? 'penalty_shootout'
      : REGULAR_GOAL_EVENT_TYPES.has(event.typeId) ? 'regular' : 'other',
  };
}

function attachScorerNames(side: MatchSideEventDetails, scorers: ParsedScorer[]) {
  for (const goal of side.goals || []) {
    const scorer = scorers.find((candidate) =>
      candidate.teamId === side.teamId &&
      candidate.playerId === goal.playerId &&
      candidate.minute === goal.minute &&
      candidate.matchPart === goal.matchPart,
    );
    if (scorer?.playerName) goal.playerName = scorer.playerName;
  }
}

function attachBookingNames(side: MatchSideEventDetails, bookings: ParsedBooking[]) {
  for (const card of side.cards) {
    const booking = bookings.find((candidate) =>
      candidate.teamId === side.teamId &&
      candidate.playerId === card.playerId &&
      candidate.minute === card.minute &&
      candidate.matchPart === card.matchPart,
    );
    if (booking?.playerName) card.playerName = booking.playerName;
  }
}

function sideForTeam(
  home: MatchSideEventDetails,
  away: MatchSideEventDetails,
  teamId: number | null,
): MatchSideEventDetails | null {
  if (!teamId) return null;
  if (teamId === home.teamId) return home;
  if (teamId === away.teamId) return away;
  return null;
}

/**
 * Parses only structured CHPP match event fields. It never interprets localized EventText.
 */
export function parseMatchEventDetails(xml: string): MatchEventDetails {
  const { actualHomeTeamId, actualAwayTeamId } = getActualTeamIds(xml);
  const home = createSide(actualHomeTeamId);
  const away = createSide(actualAwayTeamId);
  const events = getEventBlocks(xml);
  const scorers = getScorers(xml);
  const bookings = getBookings(xml);
  const hasPenaltyShootout = events.some((event) => PENALTY_SHOOTOUT_EVENT_TYPES.has(event.typeId));

  for (const event of events) {
    const side = sideForTeam(home, away, event.subjectTeamId);
    const card = toCardEvent(event);
    if (card && side) side.cards.push(card);

    const goal = toGoalEvent(event);
    if (goal && side) (side.goals ||= []).push(goal);

    if (side && PENALTY_SHOOTOUT_GOAL_EVENT_TYPES.has(event.typeId)) {
      side.penaltyShootoutGoals = (side.penaltyShootoutGoals || 0) + 1;
    }
  }

  attachScorerNames(home, scorers);
  attachScorerNames(away, scorers);
  attachBookingNames(home, bookings);
  attachBookingNames(away, bookings);

  for (const injury of getInjuryBlocks(xml)) {
    const side = sideForTeam(home, away, injury.teamId);
    if (!side) continue;
    side.injuries.push({
      playerId: injury.playerId,
      playerName: injury.playerName,
      minute: injury.minute,
      matchPart: injury.matchPart,
      injuryType: injury.injuryType,
      severity: injury.injuryType === 1 ? 'plaster' : 'injury',
      locationEventTypeId: null,
      weeks: null,
      causedByFoul: false,
      causedByTeamId: null,
    });
  }

  for (const event of events) {
    if (event.typeId < INJURY_LOCATION_EVENT_MIN || event.typeId > INJURY_LOCATION_EVENT_MAX) continue;
    const side = sideForTeam(home, away, event.subjectTeamId);
    const injury = side ? findInjury(side.injuries, event.subjectPlayerId, event.minute) : null;
    if (!injury) continue;
    injury.locationEventTypeId = event.typeId;
    if (injury.severity === 'injury') injury.weeks = validWeeks(event.objectPlayerId);
  }

  for (const event of events) {
    if (event.typeId !== INJURY_DURATION_EVENT) continue;
    const side = sideForTeam(home, away, event.subjectTeamId);
    const timeMatchedInjuries = side
      ? side.injuries
      : [...home.injuries, ...away.injuries];
    const injury = findInjuryAtMatchTime(timeMatchedInjuries, event.minute, event.matchPart);
    // CHPP documents the doctor report duration in SubjectPlayerID. Keep the
    // ObjectPlayerID fallback for older/irregular payloads, but never parse text.
    const weeks = validWeeks(event.subjectPlayerId) ?? validWeeks(event.objectPlayerId);
    if (injury && weeks !== null) injury.weeks = weeks;
  }

  for (const event of events) {
    if (event.typeId !== INJURY_BY_FOUL_EVENT) continue;
    const side = sideForTeam(home, away, event.subjectTeamId);
    const injury = side ? findInjury(side.injuries, event.subjectPlayerId, event.minute) : null;
    if (!injury) continue;
    injury.causedByFoul = true;
    injury.causedByTeamId = event.subjectTeamId === actualHomeTeamId ? actualAwayTeamId : actualHomeTeamId;
  }

  const penaltyShootout = hasPenaltyShootout
    ? { home: home.penaltyShootoutGoals || 0, away: away.penaltyShootoutGoals || 0 }
    : null;

  home.performance = sidePerformance(xml, 'Home');
  away.performance = sidePerformance(xml, 'Away');

  return {
    version: 2,
    source: 'matchdetails-3.1',
    actualHomeTeamId,
    actualAwayTeamId,
    hasPenaltyShootout,
    result: resultDetails(xml, scorers, actualHomeTeamId, actualAwayTeamId, hasPenaltyShootout, penaltyShootout),
    home,
    away,
  };
}

function emptyMappedSide(teamId: number | null): MatchSideEventDetails {
  return { teamId, cards: [], injuries: [], goals: [], penaltyShootoutGoals: 0 };
}

/**
 * Returns event data from the scheduled fixture perspective. A BYE/manual one-team
 * link deliberately keeps the unmatched fixture side empty.
 */
export function mapMatchEventDetailsToFixture(
  details: MatchEventDetails,
  scheduledHomeTeamId: number | null,
  scheduledAwayTeamId: number | null,
): MatchEventDetails {
  const actualSideFor = (teamId: number | null) => {
    if (teamId === details.actualHomeTeamId) return details.home;
    if (teamId === details.actualAwayTeamId) return details.away;
    return null;
  };

  const copySide = (teamId: number | null): MatchSideEventDetails => {
    const source = actualSideFor(teamId);
    return source
      ? {
          teamId,
          cards: source.cards,
          injuries: source.injuries,
          goals: source.goals || [],
          penaltyShootoutGoals: source.penaltyShootoutGoals || 0,
          performance: source.performance,
        }
      : emptyMappedSide(teamId);
  };

  return {
    ...details,
    result: details.result
      ? {
          ...details.result,
          scoreAfterRegulation: mapScoreToFixture(details.result.scoreAfterRegulation, details.actualHomeTeamId, scheduledHomeTeamId),
          scoreAfterExtraTime: mapScoreToFixture(details.result.scoreAfterExtraTime, details.actualHomeTeamId, scheduledHomeTeamId),
          penaltyShootout: details.result.penaltyShootout
            ? mapScoreToFixture(details.result.penaltyShootout, details.actualHomeTeamId, scheduledHomeTeamId)
            : null,
        }
      : undefined,
    home: copySide(scheduledHomeTeamId),
    away: copySide(scheduledAwayTeamId),
  };
}

function mapScoreToFixture(score: MatchScore, actualHomeTeamId: number | null, scheduledHomeTeamId: number | null): MatchScore {
  if (actualHomeTeamId === null || scheduledHomeTeamId === null) return score;
  return actualHomeTeamId === scheduledHomeTeamId
    ? score
    : { home: score.away, away: score.home };
}

export function getPenaltyShootoutScore(details: MatchEventDetails) {
  if (!details.hasPenaltyShootout) {
    return { home: null, away: null };
  }
  return {
    home: details.home.penaltyShootoutGoals ?? 0,
    away: details.away.penaltyShootoutGoals ?? 0,
  };
}

export function getFootballScore(details: MatchEventDetails) {
  return details.result?.scoreAfterExtraTime || null;
}

export function summarizeMatchEventDetails(details: MatchEventDetails): MatchEventSummary {
  const summarize = (side: MatchSideEventDetails) => ({
    yellow: side.cards.filter((card) => card.type === 'yellow').length,
    red: side.cards.filter((card) => card.type !== 'yellow').length,
    injuries: side.injuries.length,
  });
  const home = summarize(details.home);
  const away = summarize(details.away);
  return {
    home_yellow_cards: home.yellow,
    home_red_cards: home.red,
    home_injuries: home.injuries,
    away_yellow_cards: away.yellow,
    away_red_cards: away.red,
    away_injuries: away.injuries,
  };
}
