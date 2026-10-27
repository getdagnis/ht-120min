import { canFlagTeamsPair, maximumFlagMatching } from '../../shared/flag-matching.js';
import type { FlagHunterTeam } from '../../shared/flag-hunters.js';
import type { SlotObservation } from '../../shared/organizer-planning.js';

export interface WeekendTeam {
  id: string; name: string; ht_team_id: number | null; hattrick_user_id: number | null;
  active: boolean; reserve_active: boolean; gender_id?: number | null;
}
export interface WeekendMissedFixture { id: string; roundNumber: number; homeTeamId: string | null; awayTeamId: string | null }
export interface WeekendPair { homeTeamId: string; awayTeamId: string; originalFixtureId?: string }

export function createWeekendPreview(teams: WeekendTeam[], checks: ReadonlyMap<number, SlotObservation>, fixtures: WeekendMissedFixture[]) {
  const roster: FlagHunterTeam[] = teams.filter(team => team.active && !team.reserve_active && team.ht_team_id && team.hattrick_user_id &&
    checks.get(team.ht_team_id)?.state === 'free' && checks.get(team.ht_team_id)?.challengesKnown && !checks.get(team.ht_team_id)?.pendingOpponentIds.length)
    .map(team => ({ id: team.id, name: team.name, htTeamId: team.ht_team_id!, managerId: team.hattrick_user_id,
      managerName: null, countryName: null, countryId: null, managerCountryId: null, flagCountryId: null, leagueId: null, genderId: team.gender_id }));
  const unique = roster.filter((team, index) => roster.findIndex(other => other.htTeamId === team.htTeamId) === index);
  const used = new Set<string>();
  const pairs: WeekendPair[] = [];
  for (const fixture of [...fixtures].sort((a, b) => a.roundNumber - b.roundNumber || a.id.localeCompare(b.id))) {
    const home = unique.find(team => team.id === fixture.homeTeamId), away = unique.find(team => team.id === fixture.awayTeamId);
    if (!home || !away || used.has(home.id) || used.has(away.id) || !canFlagTeamsPair(home, away)) continue;
    pairs.push({ homeTeamId: home.id, awayTeamId: away.id, originalFixtureId: fixture.id });
    used.add(home.id); used.add(away.id);
  }
  const remaining = unique.filter(team => !used.has(team.id));
  const matching = maximumFlagMatching(remaining, 'forge-weekend');
  for (const pair of matching.pairs) pairs.push({ homeTeamId: remaining.find(team => team.htTeamId === pair.homeId)!.id,
    awayTeamId: remaining.find(team => team.htTeamId === pair.awayId)!.id });
  return { pairs, unmatched: [...matching.unresolvedIds, ...(matching.byeId ? [matching.byeId] : [])].map(id => remaining.find(team => team.htTeamId === id)!.id) };
}

/** Exchange away opponents while preserving roster and compatibility. */
export function swapWeekendOpponents(pairs: WeekendPair[], firstIndex: number, secondIndex: number, teams: WeekendTeam[]): WeekendPair[] | null {
  if (firstIndex === secondIndex || !pairs[firstIndex] || !pairs[secondIndex]) return null;
  const first = pairs[firstIndex], second = pairs[secondIndex];
  const canPair = (homeId: string, awayId: string) => {
    const home = teams.find(team => team.id === homeId), away = teams.find(team => team.id === awayId);
    return Boolean(home && away && home.ht_team_id && away.ht_team_id && home.ht_team_id !== away.ht_team_id &&
      home.hattrick_user_id && away.hattrick_user_id && home.hattrick_user_id !== away.hattrick_user_id &&
      !(home.gender_id && away.gender_id && home.gender_id !== away.gender_id));
  };
  if (!canPair(first.homeTeamId, second.awayTeamId) || !canPair(second.homeTeamId, first.awayTeamId)) return null;
  return pairs.map((pair, index) => index === firstIndex ? { homeTeamId: first.homeTeamId, awayTeamId: second.awayTeamId }
    : index === secondIndex ? { homeTeamId: second.homeTeamId, awayTeamId: first.awayTeamId } : pair);
}
