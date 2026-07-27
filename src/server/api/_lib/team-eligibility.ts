import type { ChppTeamOption } from './chpp-xml.js';

export type LeagueCategory = 'male' | 'hfi';

/** HFI teams are identified by the CHPP league system or HFI league ID. */
export function isHfiTeam(
  team: Pick<ChppTeamOption, 'leagueName' | 'leagueId' | 'leagueSystemId' | 'genderId'>,
): boolean {
  if (team.leagueSystemId === 2) return true;
  if (team.leagueId === 3000) return true;
  return false;
}

export function teamMatchesCategory(
  team: Pick<ChppTeamOption, 'leagueName' | 'leagueId' | 'leagueSystemId' | 'genderId'>,
  category: LeagueCategory,
): boolean {
  return category === 'hfi' ? isHfiTeam(team) : !isHfiTeam(team);
}

function countryLimitMatches(
  team: Pick<ChppTeamOption, 'leagueId' | 'countryId' | 'countryName'>,
  countryLimit?: string | null,
): boolean {
  if (!countryLimit) return true;

  const countryLimitId = Number(countryLimit);
  if (Number.isFinite(countryLimitId) && `${countryLimitId}` === countryLimit) {
    return team.leagueId === countryLimitId || team.countryId === countryLimitId;
  }

  return team.countryName === countryLimit;
}

export function filterTeamsForCategory<T extends ChppTeamOption>(
  teams: T[],
  category: LeagueCategory,
  options?: { countryLimit?: string | null; skipCountryCheck?: boolean },
): T[] {
  const { countryLimit, skipCountryCheck } = options ?? {};
  return teams.filter((team) => {
    if (!teamMatchesCategory(team, category)) return false;
    if (!skipCountryCheck && !countryLimitMatches(team, countryLimit)) {
      return false;
    }
    return true;
  });
}
