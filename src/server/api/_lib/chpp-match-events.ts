import type {
  MatchCardEvent,
  MatchEventDetails,
  MatchEventSummary,
  MatchGoalEvent,
  MatchInjuryEvent,
  MatchNotableEvent,
  MatchResultDetails,
  MatchScore,
  MatchSideEventDetails,
  MatchSidePerformance,
} from '../../../../shared/match-events.js';
import { INJURY_LOCATION_LABELS } from '../../../../shared/match-events.js';

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
const MISSED_CHANCE_EVENT_TYPES = new Set([
  ...Array.from({ length: 26 }, (_, index) => 200 + index),
  ...Array.from({ length: 8 }, (_, index) => 230 + index),
  ...Array.from({ length: 5 }, (_, index) => 239 + index),
  ...Array.from({ length: 5 }, (_, index) => 250 + index),
  ...Array.from({ length: 5 }, (_, index) => 260 + index),
  ...Array.from({ length: 5 }, (_, index) => 270 + index),
  ...Array.from({ length: 11 }, (_, index) => 280 + index),
]);
const INJURY_LOCATION_EVENT_MIN = 401;
const INJURY_LOCATION_EVENT_MAX = 422;
const INJURY_BY_FOUL_EVENT = 423;
const INJURY_DURATION_EVENT = 454;
const NOTABLE_EVENT_TYPES = new Set([
  ...GOAL_EVENT_TYPES,
  ...PENALTY_SHOOTOUT_EVENT_TYPES,
  ...CARD_EVENT_TYPES,
  ...MISSED_CHANCE_EVENT_TYPES,
  61, 64, 65, 68, 69, 70, 72, 75, 76,
  90, 91, 92, 93, 94, 95, 96, 97,
  301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311,
  331, 332, 333, 334, 335, 336, 343, 344,
  350, 351, 352, 360, 361, 362, 370, 371, 372,
  380, 381, 382, 383, 384, 385, 386, 387, 388, 389, 390, 391,
  ...Array.from({ length: 22 }, (_, index) => 401 + index),
  423, 424, 425, 426, 427, 450, 455, 456, 457, 458, 473, 489,
  650, 651, 700, 701, 702, 703, 704, 812, 813, 818, 819, 820, 821, 822,
]);

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

function decodePlayerLinkTitle(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
}

/**
 * Extracts only stable player-link metadata from EventText. The localized
 * commentary itself is never interpreted or passed to downstream consumers.
 */
function getEventPlayerNames(xml: string): Map<number, string> {
  const names = new Map<number, string>();
  const eventBlocks = xml.match(/<Event(?:\s[^>]*)?>[\s\S]*?<\/Event>/gi) || [];
  for (const eventXml of eventBlocks) {
    const eventText = readText(eventXml, 'EventText');
    if (!eventText) continue;
    const links = eventText.match(/(?:&lt;|<)a\b[\s\S]*?(?:&gt;|>)/gi) || [];
    for (const link of links) {
      const playerId = link.match(/playerId=(\d+)/i)?.[1];
      const title = link.match(/title=(?:"|&quot;)(.*?)(?:"|&quot;)/i)?.[1];
      if (!playerId || !title) continue;
      const name = decodePlayerLinkTitle(title);
      if (name) names.set(Number.parseInt(playerId, 10), name);
    }
  }
  return names;
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
    description: getCanonicalEventDescription(event.typeId),
  };
}

const EVENT_DESCRIPTIONS: Record<number, string> = {
  55: 'penalty shootout goal by technical player without nerves',
  56: 'penalty shootout goal without nerves',
  57: 'penalty shootout goal despite nerves',
  58: 'penalty shootout miss because of nerves',
  59: 'penalty shootout miss despite no nerves',
  61: 'organisation break', 64: 'team reorganised', 65: 'nerves in an important match',
  68: 'successful pressing', 69: 'underestimation removed', 70: 'extra time started',
  71: 'penalty shootout after extra time', 72: 'extra time decided', 73: 'penalty shootout decided by coin toss',
  75: 'added time announced', 76: 'no added time announced',
  90: 'injured but continued playing', 91: 'injured and left the field', 92: 'badly injured and left the field',
  93: 'injured with no replacement', 94: 'injured after foul but continued', 95: 'injured after foul and left the field',
  96: 'injured after foul with no replacement', 97: 'keeper injured; field player took goal',
  107: 'long-shot goal', 115: 'quick player scored after a rush', 116: 'quick rush created a goal',
  117: 'tired defender mistake led to a goal', 118: 'corner created a goal', 119: 'corner goal by a head specialist',
  125: 'unpredictable own goal', 135: 'experienced forward scored', 136: 'inexperienced defender caused a goal',
  137: 'winger supplied a head specialist who scored', 138: 'winger supplied a goal', 139: 'technical player beat a head specialist',
  185: 'indirect free-kick goal', 186: 'counter-attack goal from an indirect free kick', 187: 'long-shot goal',
  190: 'powerful forward created an extra-chance goal',
  207: 'long shot missed', 215: 'quick player missed after a rush', 216: 'quick rush failed to produce a goal',
  217: 'tired defender mistake did not produce a goal', 218: 'corner chance missed', 219: 'head-specialist corner chance missed',
  225: 'unpredictable own-goal chance missed', 235: 'experienced forward missed', 236: 'inexperienced defender almost caused a goal',
  237: 'winger-created chance missed', 239: 'technical player failed against a head specialist',
  240: 'counter-attack chance missed from a free kick', 241: 'counter-attack chance missed through the centre',
  242: 'counter-attack chance missed on the left', 243: 'counter-attack chance missed on the right',
  285: 'indirect free-kick chance missed', 286: 'counter-attack chance missed from an indirect free kick',
  287: 'long-shot chance missed', 288: 'long-shot chance saved', 289: 'quick rush stopped by a quick defender',
  290: 'powerful forward extra-chance missed',
  301: 'technical player affected by rain', 302: 'powerful player benefited from rain', 303: 'technical player benefited from sun',
  304: 'powerful player affected by sun', 305: 'quick player affected by rain', 306: 'quick player affected by sun',
  307: 'support-player boost succeeded', 308: 'support-player boost failed and organisation dropped', 309: 'support-player boost failed',
  310: 'powerful defensive player pressed a chance', 311: 'counter-attack triggered by a technical defender',
  331: 'pressing tactic used', 332: 'counter-attacking tactic used', 333: 'attack through the middle used',
  334: 'attack on the wings used', 335: 'play creatively tactic used', 336: 'long-shot tactic used',
  343: 'attack through the middle used', 344: 'attack on the wings used',
  350: 'substitution while team was behind', 351: 'substitution while team was ahead', 352: 'substitution',
  360: 'tactical change while team was behind', 361: 'tactical change while team was ahead', 362: 'tactical change',
  370: 'position swap while team was behind', 371: 'position swap while team was ahead', 372: 'position swap',
  380: 'successful short-distance man marking', 381: 'successful long-distance man marking',
  382: 'man marking changed from short to long distance', 383: 'man marking changed from long to short distance',
  384: 'man-marking penalty: no opponent was marked', 385: 'man marker changed from short to long distance',
  386: 'man marker changed from long to short distance', 387: 'man-marking penalty: opponent was out of position',
  388: 'man-marking penalty: marker was out of position', 389: 'man-marking penalty: no opponent was available',
  390: 'rain affected many players', 391: 'sun affected many players',
  450: 'third yellow card caused a suspension', 455: 'new star player', 473: 'career-ending injury', 489: 'comeback after a long injury',
  456: 'player reached a career-goal milestone', 457: 'player reached a league-goal milestone', 458: 'player reached a cup-goal milestone',
  650: 'Hattrick anniversary', 651: 'team anniversary', 700: 'manager taunted the opponent', 701: 'manager praised the opponent',
  702: 'manager asked fans for support', 703: 'manager expected a great show', 704: 'manager honoured club legacy',
  812: 'player birthday', 813: 'new match kit', 818: 'brothers played together', 819: 'parent and child played together',
  820: 'family members faced each other', 821: 'family members combined for a goal', 822: 'family members faced each other in a penalty',
};

export function getCanonicalEventDescription(typeId: number): string {
  if (EVENT_DESCRIPTIONS[typeId]) return EVENT_DESCRIPTIONS[typeId];
  if (typeId >= 100 && typeId <= 190) {
    const location = typeId % 10;
    if (location === 0) return 'free-kick goal';
    if (location === 1) return 'goal through the centre';
    if (location === 2) return 'goal on the left';
    if (location === 3) return 'goal on the right';
    if (location === 4) return 'penalty goal';
    return 'goal';
  }
  if (MISSED_CHANCE_EVENT_TYPES.has(typeId)) {
    const location = typeId % 10;
    if (location === 0) return 'free-kick chance missed';
    if (location === 1) return 'chance missed through the centre';
    if (location === 2) return 'chance missed on the left';
    if (location === 3) return 'chance missed on the right';
    if (location === 4) return 'penalty chance missed';
    return 'chance missed';
  }
  if (typeId >= 401 && typeId <= 422) return `${INJURY_LOCATION_LABELS[typeId] || 'body part'} injury`;
  if (typeId === 423) return 'injured after a foul';
  if (typeId === 424) return 'injured player replaced';
  if (typeId === 425) return 'injured player had no replacement';
  if (typeId === 426) return 'field player replaced an injured keeper';
  if (typeId === 427) return 'injured regainer was bruised';
  if (CARD_EVENT_TYPES.has(typeId)) return getCardDescription(typeId);
  return `structured event ${typeId}`;
}

function getCardDescription(typeId: number): string {
  if (typeId === 510) return 'yellow card for nasty play';
  if (typeId === 511) return 'yellow card for cheating';
  if (typeId === 512) return 'second-yellow red card for nasty play';
  if (typeId === 513) return 'second-yellow red card for cheating';
  return 'straight red card';
}

function attachScorerNames(side: MatchSideEventDetails, scorers: ParsedScorer[], eventPlayerNames: Map<number, string>) {
  for (const goal of side.goals || []) {
    const scorer = scorers.find((candidate) =>
      candidate.teamId === side.teamId &&
      candidate.playerId === goal.playerId &&
      candidate.minute === goal.minute &&
      candidate.matchPart === goal.matchPart,
    );
    if (scorer?.playerName || goal.playerId !== null) {
      goal.playerName = scorer?.playerName || eventPlayerNames.get(goal.playerId as number) || null;
    }
  }
}

function attachBookingNames(side: MatchSideEventDetails, bookings: ParsedBooking[], eventPlayerNames: Map<number, string>) {
  for (const card of side.cards) {
    const booking = bookings.find((candidate) =>
      candidate.teamId === side.teamId &&
      candidate.playerId === card.playerId &&
      candidate.minute === card.minute &&
      candidate.matchPart === card.matchPart,
    );
    if (booking?.playerName || card.playerId !== null) {
      card.playerName = booking?.playerName || eventPlayerNames.get(card.playerId as number) || null;
    }
  }
}

function eventCategory(typeId: number): string {
  if (GOAL_EVENT_TYPES.has(typeId)) return 'goal';
  if (PENALTY_SHOOTOUT_EVENT_TYPES.has(typeId)) return 'penalty_shootout';
  if (CARD_EVENT_TYPES.has(typeId)) return 'card';
  if (typeId >= 90 && typeId <= 97 || typeId >= 401 && typeId <= 427 || typeId === 473) return 'injury';
  if (MISSED_CHANCE_EVENT_TYPES.has(typeId)) return 'missed_chance';
  if (typeId === 68 || typeId >= 331 && typeId <= 389) return 'tactical';
  if (typeId >= 301 && typeId <= 311 || typeId >= 390 && typeId <= 391) return 'conditions';
  return 'story';
}

function eventPlayerName(
  event: ParsedEvent,
  scorers: ParsedScorer[],
  bookings: ParsedBooking[],
  injuries: ParsedInjury[],
  eventPlayerNames: Map<number, string>,
): string | null {
  const playerId = event.subjectPlayerId;
  if (!playerId) return null;
  return (
    scorers.find((item) => item.playerId === playerId)?.playerName ||
    bookings.find((item) => item.playerId === playerId)?.playerName ||
    injuries.find((item) => item.playerId === playerId)?.playerName ||
    eventPlayerNames.get(playerId) ||
    null
  );
}

function notableEvents(
  events: ParsedEvent[],
  scorers: ParsedScorer[],
  bookings: ParsedBooking[],
  injuries: ParsedInjury[],
  eventPlayerNames: Map<number, string>,
): MatchNotableEvent[] {
  return events
    .filter((event) => NOTABLE_EVENT_TYPES.has(event.typeId))
    .map((event) => ({
      eventTypeId: event.typeId,
      minute: event.minute,
      matchPart: event.matchPart,
      teamId: event.subjectTeamId,
      playerId: event.subjectPlayerId,
      playerName: eventPlayerName(event, scorers, bookings, injuries, eventPlayerNames),
      category: eventCategory(event.typeId),
    description: getCanonicalEventDescription(event.typeId),
    }));
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
 * Parses structured CHPP match event fields. Localized EventText prose is not
 * interpreted; only stable player-link metadata is extracted for name lookup.
 */
export function parseMatchEventDetails(xml: string): MatchEventDetails {
  const { actualHomeTeamId, actualAwayTeamId } = getActualTeamIds(xml);
  const home = createSide(actualHomeTeamId);
  const away = createSide(actualAwayTeamId);
  const events = getEventBlocks(xml);
  const eventPlayerNames = getEventPlayerNames(xml);
  const scorers = getScorers(xml);
  const bookings = getBookings(xml);
  const parsedInjuries = getInjuryBlocks(xml);
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

  attachScorerNames(home, scorers, eventPlayerNames);
  attachScorerNames(away, scorers, eventPlayerNames);
  attachBookingNames(home, bookings, eventPlayerNames);
  attachBookingNames(away, bookings, eventPlayerNames);

  for (const injury of parsedInjuries) {
    const side = sideForTeam(home, away, injury.teamId);
    if (!side) continue;
    side.injuries.push({
      playerId: injury.playerId,
      playerName: injury.playerName || (injury.playerId === null ? null : eventPlayerNames.get(injury.playerId) || null),
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
    notableEvents: notableEvents(events, scorers, bookings, parsedInjuries, eventPlayerNames),
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
          // Team IDs identify clubs, not fixture sides. Keep nested event
          // attribution unchanged when actual Hattrick home/away is reversed.
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
    // `teamId` is stable team identity; moving the event to the scheduled
    // home/away side must never rewrite it to the opponent's ID.
    notableEvents: details.notableEvents || [],
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
