import { readChppTag } from './chpp-xml.js';

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
  if (!block || !/<MatchPart>[1-4]<\/MatchPart>/i.test(block)) return null;

  const homeGoals = Number(readChppTag(block, 'HomeGoals'));
  const awayGoals = Number(readChppTag(block, 'AwayGoals'));
  if (!Number.isInteger(homeGoals) || homeGoals < 0 ||
      !Number.isInteger(awayGoals) || awayGoals < 0) return null;
  return { xml: block, homeGoals, awayGoals };
}

export function advanceMatchStatus(previous: MatchLifecycle, observed: MatchObservation): MatchLifecycle {
  if (previous === 'finished' || observed === 'unknown') return previous;
  if (observed === 'finished') return 'finished';
  if (previous === 'ongoing') return 'ongoing';
  return observed;
}
