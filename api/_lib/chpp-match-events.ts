import type {
  MatchCardEvent,
  MatchEventDetails,
  MatchEventSummary,
  MatchInjuryEvent,
  MatchSideEventDetails,
} from '../../shared/match-events.js';

const CARD_EVENT_TYPES = new Set([510, 511, 512, 513, 514]);
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
  minute: number | null;
  matchPart: number | null;
  injuryType: number;
}

function readNumber(block: string, tag: string): number | null {
  const raw = block.match(new RegExp(`<${tag}>(-?\\d+)<\\/${tag}>`, 'i'))?.[1];
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
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
        minute: readNumber(injuryXml, 'InjuryMinute'),
        matchPart: readNumber(injuryXml, 'MatchPart'),
        injuryType,
      };
    })
    .filter((injury): injury is ParsedInjury => Boolean(injury));
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
  return { teamId, cards: [], injuries: [] };
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

  for (const event of events) {
    const card = toCardEvent(event);
    if (!card) continue;
    sideForTeam(home, away, event.subjectTeamId)?.cards.push(card);
  }

  for (const injury of getInjuryBlocks(xml)) {
    const side = sideForTeam(home, away, injury.teamId);
    if (!side) continue;
    side.injuries.push({
      playerId: injury.playerId,
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

  return {
    version: 1,
    source: 'matchdetails-3.1',
    actualHomeTeamId,
    actualAwayTeamId,
    home,
    away,
  };
}

function emptyMappedSide(teamId: number | null): MatchSideEventDetails {
  return { teamId, cards: [], injuries: [] };
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
    return source ? { teamId, cards: source.cards, injuries: source.injuries } : emptyMappedSide(teamId);
  };

  return {
    ...details,
    home: copySide(scheduledHomeTeamId),
    away: copySide(scheduledAwayTeamId),
  };
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
