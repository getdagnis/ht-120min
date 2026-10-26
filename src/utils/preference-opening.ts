import { interest120m, type PairingPreference } from '../../shared/pairing-preferences.js';
import type { LengthSchedulePairing, LengthScheduleTeam } from './length-schedule.js';

/** Reassign only the opening opponents; the round-robin builder relabels its complete cycle. */
export function preferenceOpening(teams: LengthScheduleTeam[], preferences: Record<string, PairingPreference>, htIds: Record<string, number>): LengthSchedulePairing[] | null {
  const interest = (id: string) => Math.max(0, interest120m(preferences[String(htIds[id])]) - 1);
  if (!teams.some(team => interest(team.id))) return null;
  // The normal ranked opener remains the starting point and wins every quality tie.
  const pairs: LengthSchedulePairing[] = [];
  for (let i = 0; i < teams.length; i += 2) pairs.push({ homeTeamId: teams[i].id,
    awayTeamId: teams[i + 1]?.id || null, isBye: !teams[i + 1] });
  const rank = new Map(teams.map((team, index) => [team.id, index]));
  const value = (candidate: LengthSchedulePairing[]) => candidate.reduce((score, pair) => {
    if (!pair.awayTeamId) return score;
    const a = interest(pair.homeTeamId!), b = interest(pair.awayTeamId);
    // Mutual interest leads; rank proximity settles equal preference outcomes.
    return score + (a > 1 && b > 1 ? 100 + Math.min(a, b) * 10 : Math.max(a, b) * 2);
  }, 0);
  let current = value(pairs);
  // Bounded pair swaps are enough for the small HFI fields; stop at the first local optimum.
  for (let pass = 0; pass < Math.min(12, teams.length); pass++) {
    let best = current, bestPairs: LengthSchedulePairing[] | null = null, bestDistance = Infinity;
    for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
      for (const swapAway of [false, true]) {
        const next = pairs.map(pair => ({ ...pair }));
        const left = swapAway ? 'awayTeamId' : 'homeTeamId';
        const right = 'homeTeamId';
        const moved = next[i][left], other = next[j][right];
        next[i][left] = other; next[j][right] = moved;
        next[i].isBye = !next[i].awayTeamId; next[j].isBye = !next[j].awayTeamId;
        if (!next[i].homeTeamId || !next[j].homeTeamId) continue;
        const score = value(next);
        if (score < best || score <= current) continue;
        const distance = next.reduce((sum, pair) => sum + (pair.awayTeamId ? Math.abs(rank.get(pair.homeTeamId!)! - rank.get(pair.awayTeamId)!) : 0), 0);
        if (score > best || score === best && distance < bestDistance) {
          best = score; bestDistance = distance; bestPairs = next;
        }
      }
    }
    if (!bestPairs || best <= current) break;
    pairs.splice(0, pairs.length, ...bestPairs); current = best;
  }
  return pairs;
}
