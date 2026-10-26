import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { getServiceSupabase } from './supabase.js';
import { getAppSessionSecret } from './app-session.js';
import { getManagerChppCredentials } from './matchmaker.js';
import { getAuthHeader } from './chpp-auth.js';
import { parseMatchesXml, type ChppTeamOption } from './chpp-xml.js';
import { parseChppChallengeOffers, parseChppOutgoingChallenges } from './chpp-challenges.js';
import { parseChppStockholmDate } from '../../../../shared/chpp-dates.js';
import { insideSlot, type SlotObservation } from '../../../../shared/organizer-planning.js';
import { normalizeFlagCountries, type FlagCollection } from '../../../../shared/flag-hunters.js';
import type { OrganizerRoundTeam } from '../../../utils/organizer-round.js';
import type { CalendarSlot } from '../../../utils/hattrick-calendar.js';
import { parseFlagHunterDetails, persistTeamFlagSnapshot } from './flag-collections.js';

type Db = ReturnType<typeof getServiceSupabase>;
const CHPP_URL = 'https://chpp.hattrick.org/chppxml.ashx';
export const PLANNING_BATCH_SIZE = 2;

export function proposalHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
interface VerificationRun { id: string; hash: string; actor: number; tournamentId: string; slotId: string; startedAt: number }
export function startVerification(hash: string, actor: number, tournamentId: string, slotId: string) {
  const payload = Buffer.from(JSON.stringify({ id: randomUUID(), hash, actor, tournamentId, slotId, startedAt: Date.now() })).toString('base64url');
  const secret = getAppSessionSecret(); if (!secret) throw new Error('Session configuration unavailable.');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
export function readVerification(token: unknown, hash: string, actor: number, tournamentId: string, slotId: string): VerificationRun {
  if (typeof token !== 'string' || token.length > 2000) throw new Error('Start a new final verification.');
  const [payload, signature, extra] = token.split('.'), secret = getAppSessionSecret();
  if (!payload || !signature || extra || !secret) throw new Error('Start a new final verification.');
  const expected = createHmac('sha256', secret).update(payload).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('Invalid verification.');
  const run = JSON.parse(Buffer.from(payload, 'base64url').toString()) as VerificationRun;
  if (run.hash !== hash || run.actor !== actor || run.tournamentId !== tournamentId || run.slotId !== slotId ||
      !Number.isFinite(run.startedAt) || Date.now() - run.startedAt > 60 * 60_000 || run.startedAt > Date.now()) {
    throw new Error('Verification expired or the proposal changed. Start a new final verification.');
  }
  return run;
}

async function chpp(db: Db, team: OrganizerRoundTeam, params: Record<string, string>) {
  if (!team.hattrick_user_id || !team.ht_team_id) throw new Error('Team identity or saved Hattrick access is missing.');
  const credentials = await getManagerChppCredentials(db, team.hattrick_user_id);
  const key = process.env.CHPP_CONSUMER_KEY, secret = process.env.CHPP_CONSUMER_SECRET;
  if (!credentials || !key || !secret) throw new Error('Saved Hattrick access is unavailable.');
  const query = { ...params, [params.file === 'challenges' ? 'teamId' : 'teamID']: String(team.ht_team_id) };
  const response = await fetch(`${CHPP_URL}?${new URLSearchParams(query)}`, { cache: 'no-store',
    headers: { Authorization: getAuthHeader('GET', CHPP_URL, query, key, secret, credentials.oauth_token, credentials.oauth_token_secret) },
    signal: AbortSignal.timeout(10_000) });
  const xml = await response.text();
  if (!response.ok || /<ErrorCode>\s*[1-9]\d*\s*<\/ErrorCode>/i.test(xml)) throw new Error('Hattrick check failed. Retry this team.');
  return xml;
}

export async function checkSlot(db: Db, team: OrganizerRoundTeam, slot: CalendarSlot,
  tournamentTeamIds: ReadonlySet<number> = new Set()): Promise<SlotObservation> {
  const result: SlotObservation = { teamId: team.id, state: 'unknown', checkedAt: new Date().toISOString(),
    reason: 'Availability is unknown.', pendingOpponentIds: [], challengesKnown: false };
  try {
    const xml = await chpp(db, team, { file: 'matches', version: '2.9' });
    if (Number(xml.match(/<Team>[\s\S]*?<TeamID>\s*(\d+)\s*<\/TeamID>/i)?.[1]) !== team.ht_team_id ||
        !/<MatchList(?:\s*\/\s*>|>[\s\S]*?<\/MatchList>)/i.test(xml)) throw new Error('Hattrick did not return an identified complete match list.');
    const matches = parseMatchesXml(xml);
    if ((xml.match(/<Match>/gi) || []).length !== matches.length) throw new Error('Hattrick returned an incomplete match list.');
    result.flagsOngoing = matches.some(match => [4, 5, 8, 9].includes(match.matchType) &&
      !['FINISHED', 'COMPLETED', 'CANCELLED', 'CANCELED'].includes(match.status.toUpperCase()) &&
      (parseChppStockholmDate(match.matchDate)?.getTime() ?? Infinity) <= Date.now());
    const inSlot = matches.filter(match => {
      const date = parseChppStockholmDate(match.matchDate);
      if (!date || !match.homeTeamId || !match.awayTeamId || !match.matchType ||
          ![match.homeTeamId, match.awayTeamId].includes(Number(team.ht_team_id))) throw new Error('A match could not be identified or dated.');
      return !['CANCELLED', 'CANCELED'].includes(match.status.toUpperCase()) && insideSlot(date, slot);
    });
    const friendly = inSlot.find(match => [4, 5, 8, 9].includes(match.matchType));
    if (friendly) {
      result.state = 'booked'; result.reason = 'Friendly already booked in this slot.';
      result.booking = { matchId: friendly.matchId, homeId: friendly.homeTeamId, awayId: friendly.awayTeamId,
        kickoff: parseChppStockholmDate(friendly.matchDate)!.toISOString() };
    } else if (inSlot.length) {
      const opponentId = inSlot[0].homeTeamId === Number(team.ht_team_id) ? inSlot[0].awayTeamId : inSlot[0].homeTeamId;
      result.state = 'blocked';
      result.reason = tournamentTeamIds.has(opponentId)
        ? 'Has a booked match with another tournament team.'
        : 'Has a booked match with a team outside the tournament.';
    } else { result.state = 'free'; result.reason = 'No booked match found in the selected slot.'; }
    if (result.state !== 'free') { result.checkedAt = new Date().toISOString(); return result; }
    // Outgoing challenges are separate from booked matches. If their direction or
    // date cannot be established, a changed pairing cannot be verified.
    try {
      const offers = await chpp(db, team, { file: 'challenges', version: '1.6', actionType: 'view',
        isWeekendFriendly: slot.kind === 'weekend_friendly' ? '1' : '0' });
      if (Number(offers.match(/<Team>[\s\S]*?<TeamID>\s*(\d+)\s*<\/TeamID>/i)?.[1]) !== team.ht_team_id)
        throw new Error('Challenge response is for another team.');
      const outgoingSection = offers.match(/<ChallengesByMe>([\s\S]*?)<\/ChallengesByMe>/i)?.[1];
      if (outgoingSection === undefined && !/<ChallengesByMe\s*\/>/i.test(offers))
        throw new Error('Outgoing challenge list unavailable.');
      const outgoingBlocks = [...(outgoingSection || '').matchAll(/<Challenge>([\s\S]*?)<\/Challenge>/gi)].map(match => match[1]);
      const outgoingOffers = parseChppOutgoingChallenges(offers);
      if (outgoingOffers.length !== outgoingBlocks.length || outgoingOffers.some(offer => !offer.trainingMatchId))
        throw new Error('Outgoing challenge list is incomplete.');
      const incomingSection = offers.match(/<OffersByOthers>([\s\S]*?)<\/OffersByOthers>/i)?.[1] || '';
      const incomingBlocks = [...incomingSection.matchAll(/<Offer>([\s\S]*?)<\/Offer>/gi)].map(match => match[1]);
      const inSelectedSlot = (offer: { trainingMatchId?: number }, blocks: string[]) => {
        const block = blocks.find(block => Number(block.match(/<TrainingMatchID>(\d+)<\/TrainingMatchID>/i)?.[1]) === offer.trainingMatchId);
        const date = parseChppStockholmDate(block?.match(/<MatchTime>([^<]+)<\/MatchTime>/i)?.[1]);
        if (!date) throw new Error('An offer could not be dated.');
        return insideSlot(date, slot);
      };
      const outgoing = outgoingOffers.filter(offer => inSelectedSlot(offer, outgoingBlocks));
      const incoming = parseChppChallengeOffers(offers).filter(offer => {
        try { return inSelectedSlot(offer, incomingBlocks); }
        catch { return false; } // Incomplete incoming offers are informational only.
      });
      const selectedOffers = [...incoming, ...outgoing];
      if (result.state === 'free' && selectedOffers.some(offer => offer.isAgreed)) {
        result.state = 'unknown'; result.reason = 'An accepted challenge is not yet present in the match list. Recheck.';
      }
      result.pendingOpponentIds = [...new Set(outgoing.filter(offer => !offer.isAgreed).map(offer => offer.opponentTeamId))];
      result.incomingOfferOpponentIds = [...new Set(incoming.filter(offer => !offer.isAgreed).map(offer => offer.opponentTeamId))];
      result.offersDirectionKnown = true;
      result.challengesKnown = true;
    } catch { result.reason += ' Outgoing challenges could not be checked.'; }
  } catch (cause) { result.state = 'unknown'; result.reason = cause instanceof Error ? cause.message : 'Availability check failed.'; }
  result.checkedAt = new Date().toISOString();
  return result;
}

export function cachedCollection(team: OrganizerRoundTeam, cached: ChppTeamOption | undefined): FlagCollection | undefined {
  if (!cached?.flagsFetchedAt || !Array.isArray(cached.homeFlagLeagueIds) || !Array.isArray(cached.awayFlagLeagueIds) ||
      cached.leagueId !== team.league_id || cached.countryId !== team.country_id) return undefined;
  const home = normalizeFlagCountries(cached.homeFlagLeagueIds), away = normalizeFlagCountries(cached.awayFlagLeagueIds);
  return { htTeamId: Number(team.ht_team_id), managerId: team.hattrick_user_id || null, leagueId: team.league_id || null,
    home: home.ids, away: away.ids, homeUnknown: home.unknown || cached.homeFlagsUnknown !== false,
    awayUnknown: away.unknown || cached.awayFlagsUnknown !== false, fetchedAt: cached.flagsFetchedAt };
}

export async function refreshCollection(db: Db, team: OrganizerRoundTeam): Promise<FlagCollection> {
  const xml = await chpp(db, team, { file: 'teamdetails', version: '3.9', includeFlags: 'true' });
  const details = parseFlagHunterDetails(xml, Number(team.ht_team_id));
  if (details.leagueId !== team.league_id || details.countryId !== team.country_id) throw new Error('Team country or league changed. Reload the roster.');
  const fetchedAt = new Date().toISOString();
  const patch = { homeFlagLeagueIds: details.home, awayFlagLeagueIds: details.away,
    homeFlagsUnknown: details.homeUnknown, awayFlagsUnknown: details.awayUnknown, flagsFetchedAt: fetchedAt };
  await persistTeamFlagSnapshot(db, team.hattrick_user_id!, Number(team.ht_team_id), patch);
  return { htTeamId: Number(team.ht_team_id), managerId: team.hattrick_user_id || null,
    leagueId: details.leagueId, home: details.home, away: details.away,
    homeUnknown: details.homeUnknown, awayUnknown: details.awayUnknown, fetchedAt };
}

