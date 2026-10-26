import { canFlagTeamsPair } from '../../shared/flag-matching.js';
import { createScarcityDraft } from '../../shared/flag-pairing.js';
import { flagRoster, pairIsBooked, pairKey, pairingBenefits, type PlanningMatch, type SlotObservation } from '../../shared/organizer-planning.js';
import type { FlagCollection } from '../../shared/flag-hunters.js';
import { generateOrganizerPairings, type OrganizerRoundTeam, type OrganizerRoundHistory } from './organizer-round.js';
import type { LengthSchedulePairing } from './length-schedule.js';

export function isProtectedPlanningMatch(match: PlanningMatch, now: number) {
  return match.completed || Boolean(match.ht_match_id) || ['arranged', 'ongoing', 'finished'].includes(match.status)
    || Boolean(match.finished_at) || Boolean(match.scheduled_for && Date.parse(match.scheduled_for) <= now);
}

export function proposeOrganizerPairs(input: {
  teams: OrganizerRoundTeam[]; flags: Record<string, FlagCollection>; checks: Record<string, SlotObservation>;
  previous: LengthSchedulePairing[]; protectedPairs: LengthSchedulePairing[];
  history: OrganizerRoundHistory[]; seed: string; repair: boolean; balanced: boolean;
}) {
  const { teams, flags, checks, previous, history } = input;
  const locked = [...input.protectedPairs];
  // An accepted proposal may have become a real booking since the last scan.
  for (const pair of previous) if (pairIsBooked(pair, teams, checks) && !locked.some(row => pairKey(row) === pairKey(pair))) locked.push(pair);
  const lockedIds = new Set(locked.flatMap(pair => [pair.homeTeamId, pair.awayTeamId]));
  const pool = teams.filter(team => !lockedIds.has(team.id) && checks[team.id]?.state === 'free'
    && checks[team.id].challengesKnown && checks[team.id].pendingOpponentIds.length === 0
    && team.hattrick_user_id && Number(team.ht_team_id) > 0);
  const roster = flagRoster(pool), fullRoster = flagRoster(teams);
  const toHtPairs = (pairs: LengthSchedulePairing[]) => pairs.flatMap(pair => {
    const home = teams.find(team => team.id === pair.homeTeamId), away = teams.find(team => team.id === pair.awayTeamId);
    return home?.ht_team_id && away?.ht_team_id ? [{ homeId: home.ht_team_id, awayId: away.ht_team_id }] : [];
  });
  const gainingManagers = locked.flatMap(pair => {
    const benefits = pairingBenefits(pair, teams, flags);
    return [pair.homeTeamId, pair.awayTeamId].flatMap((id, side) => {
      const team = teams.find(team => team.id === id);
      return team?.hattrick_user_id && benefits?.[side ? 'away' : 'home'] === 'gain' ? [team.hattrick_user_id] : [];
    });
  });
  const draft = createScarcityDraft(roster, flags, input.seed, null, { managerFirst: true,
    baseline: input.repair ? toHtPairs(previous) : undefined,
    baselineByes: input.repair ? previous.filter(pair => !pair.homeTeamId || !pair.awayTeamId)
      .map(pair => Number(teams.find(team => team.id === (pair.homeTeamId || pair.awayTeamId))?.ht_team_id)) : undefined,
    gainingManagerIds: gainingManagers,
    previousPairs: toHtPairs(history.filter(match => match.completed || match.status === 'finished').map(match => ({
      homeTeamId: match.home_team_id, awayTeamId: match.away_team_id, isBye: false,
    }))),
  });
  let generated: LengthSchedulePairing[] = draft.pairs.map(pair => ({
    homeTeamId: pool.find(team => team.ht_team_id === pair.homeId)!.id,
    awayTeamId: pool.find(team => team.ht_team_id === pair.awayId)!.id, isBye: false,
  }));
  if (draft.byeId) generated.push({ homeTeamId: pool.find(team => team.ht_team_id === draft.byeId)!.id, awayTeamId: null, isBye: true });
  let balancedFallback = false;
  if (input.balanced && !input.repair) {
    const candidate = generateOrganizerPairings(pool, history);
    // The old balanced engine does not know manager/gender restrictions. Use
    // it only when its entire result satisfies the same compatibility rules.
    if (candidate.every(pair => {
      if (!pair.homeTeamId || !pair.awayTeamId) return true;
      return canFlagTeamsPair(fullRoster.find(team => team.id === pair.homeTeamId)!, fullRoster.find(team => team.id === pair.awayTeamId)!);
    })) generated = candidate;
    else balancedFallback = true;
  }
  return { pairs: [...locked, ...generated], searchLimited: draft.searchLimited, balancedFallback,
    unresolved: draft.unresolvedIds.map(id => pool.find(team => team.ht_team_id === id)!.id),
    byeReason: draft.byeReason };
}
