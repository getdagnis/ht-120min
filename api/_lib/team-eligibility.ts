import type { ChppTeamOption } from './chpp-xml';

export type LeagueCategory = 'male' | 'hfi';

/** HFI teams: LeagueSystemID 2, HFI league 3000, or Femme in league name. */
export function isHfiTeam(
  team: Pick<ChppTeamOption, 'leagueName' | 'leagueId' | 'leagueSystemId' | 'genderId'>,
): boolean {
  if (team.leagueSystemId === 2) return true;
  if (team.leagueId === 3000) return true;
  if (team.leagueName?.toLowerCase().includes('femme')) return true;
  return false;
}

export function teamMatchesCategory(
  team: Pick<ChppTeamOption, 'leagueName' | 'leagueId' | 'leagueSystemId' | 'genderId'>,
  category: LeagueCategory,
): boolean {
  return category === 'hfi' ? isHfiTeam(team) : !isHfiTeam(team);
}

export function filterTeamsForCategory<T extends ChppTeamOption>(
  teams: T[],
  category: LeagueCategory,
  options?: { countryLimit?: string | null; skipCountryCheck?: boolean },
): T[] {
  const { countryLimit, skipCountryCheck } = options ?? {};
  return teams.filter((team) => {
    if (!teamMatchesCategory(team, category)) return false;
    if (!skipCountryCheck && countryLimit && team.countryName && team.countryName !== countryLimit) {
      return false;
    }
    return true;
  });
}
