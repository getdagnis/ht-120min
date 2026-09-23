import { readChppTag } from './chpp-xml.js';
import type { LiveMatchClock, LiveMatchPhase } from '../../../../shared/live-match.js';

export type MatchLifecycle = 'arranged' | 'ongoing' | 'finished';
export type MatchObservation = MatchLifecycle | 'unknown';

export function readMatchDetailsState(xml: string, matchId: number): MatchObservation {
  if (readChppTag(xml, 'FileName') !== 'matchdetails.xml' ||
      Number(readChppTag(xml, 'MatchID')) !== matchId ||
      /<Error(?:\s|>)/i.test(xml) ||
      /<ActionResult\b[^>]*Success=["']0["']/i.test(xml)) return 'unknown';

  const status = readChppTag(xml, 'MatchStatus');
  const finishedDate = readChppTag(xml, 'FinishedDate');
  if (status === '2' || (finishedDate && finishedDate !== '0001-01-01 00:00:00')) {
    const homeGoals = Number(readChppTag(xml, 'HomeGoals'));
    const awayGoals = Number(readChppTag(xml, 'AwayGoals'));
    return Number.isInteger(homeGoals) && homeGoals >= 0 &&
      Number.isInteger(awayGoals) && awayGoals >= 0 ? 'finished' : 'unknown';
  }
  if (status === '1') return 'ongoing';
  if (status === '0') return 'arranged';
  return 'unknown';
}

export function readLiveMatch(xml: string, matchId: number) {
  if (readChppTag(xml, 'FileName') !== 'live.xml' ||
      /<Error(?:\s|>)/i.test(xml) ||
      /<ActionResult\b[^>]*Success=["']0["']/i.test(xml)) return null;

  const block = [...xml.matchAll(/<Match(?:\s[^>]*)?>([\s\S]*?)<\/Match>/gi)]
    .map((match) => match[1])
    .find((match) => Number(readChppTag(match, 'MatchID')) === matchId);
  if (!block || !/<MatchPart>\s*[1-4]\s*<\/MatchPart>/i.test(block)) return null;

  const homeGoals = Number(readChppTag(block, 'HomeGoals'));
  const awayGoals = Number(readChppTag(block, 'AwayGoals'));
  if (!Number.isInteger(homeGoals) || homeGoals < 0 ||
      !Number.isInteger(awayGoals) || awayGoals < 0) return null;

  const events = [...block.matchAll(/<Event(?:\s[^>]*)?>([\s\S]*?)<\/Event>/gi)];
  const latestEvent = events.map((event) => ({
    minute: readChppTag(event[1], 'Minute'),
    part: Number(readChppTag(event[1], 'MatchPart')),
  })).filter((event) => event.minute !== undefined && Number.isInteger(Number(event.minute)) && Number(event.minute) >= 0 &&
    Number.isInteger(event.part) && event.part >= 1 && event.part <= 4).at(-1);
  const rawNextMinute = readChppTag(block, 'NextEventMinute');
  const rawNextPart = readChppTag(block, 'NextEventMatchPart');
  const nextMinute = Number(rawNextMinute);
  const nextPart = Number(rawNextPart);
  const nextEventMinute = rawNextMinute !== undefined && Number.isInteger(nextMinute) && nextMinute >= 0 ? nextMinute : null;
  const nextEventMatchPart = rawNextPart !== undefined && Number.isInteger(nextPart) && nextPart >= 1 && nextPart <= 4 ? nextPart : null;
  const rawEventKey75 = events.map((event) => event[1]).find((event) => {
    const key = readChppTag(event, 'EventKey');
    return key ? Number(key.split('_', 1)[0]) === 75 && readChppTag(event, 'MatchPart') === '2' : false;
  });
  const eventText75 = rawEventKey75 ? readChppTag(rawEventKey75, 'EventText') : undefined;
  const announcedAddedMinutes = eventText75
    ? Number(eventText75.match(/(?:circa|about|approximately|aprox(?:imadamente)?)?\s*(\d{1,2})\s*(?:min(?:ute|utes|uti|uto)?|m\b)/i)?.[1] || 0) || null
    : null;
  const matchPart = (latestEvent?.part ?? Number(readChppTag(block, 'MatchPart'))) || null;
  let phase: LiveMatchPhase | null = null;
  if (matchPart === 1) {
    phase = latestEvent && Number(latestEvent.minute) >= 45 && nextEventMatchPart === 2 ? 'half_time' : 'first_half';
  } else if (matchPart === 2) {
    phase = 'second_half';
  } else if (matchPart === 3) {
    phase = 'extra_time';
  } else if (matchPart === 4) {
    phase = 'penalties';
  }
  const clock: LiveMatchClock = {
    phase,
    matchPart,
    lastEventMinute: latestEvent ? Number(latestEvent.minute) : null,
    nextEventMinute,
    nextEventMatchPart,
    announcedAddedMinutes,
    fetchedAt: readChppTag(xml, 'FetchedDate') || null,
  };
  return { xml: block, homeGoals, awayGoals, ...clock };
}

export function advanceMatchStatus(previous: MatchLifecycle, observed: MatchObservation): MatchLifecycle {
  if (previous === 'finished' || observed === 'unknown') return previous;
  if (observed === 'finished') return 'finished';
  if (previous === 'ongoing') return 'ongoing';
  return observed;
}
