import type { ChppTeamOption } from './chpp-xml';
import { HATTRICK_WORLD_DETAILS } from '../../shared/worlddetails';

export type LeagueCategory = 'male' | 'hfi';

export interface LeagueRestrictionOption {
  value: string;
  label: string;
}

/** HFI teams are identified by the CHPP league system or HFI league ID. */
export function isHfiTeam(
  team: Pick<ChppTeamOption, 'leagueName' | 'leagueId' | 'leagueSystemId' | 'genderId'>,
): boolean {
  if (team.leagueSystemId === 2) return true;
  if (team.leagueId === 3000) return true;
  return false;
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
    if (!skipCountryCheck && !countryLimitMatches(team, countryLimit)) {
      return false;
    }
    return true;
  });
}

export function validateTeamEligibility(
  team: Pick<ChppTeamOption, 'leagueName' | 'leagueId' | 'leagueSystemId' | 'genderId' | 'countryId' | 'countryName'>,
  options: { category: LeagueCategory; countryLimit?: string | null },
): { eligible: boolean; reason?: string } {
  const { category, countryLimit } = options;
  
  if (!teamMatchesCategory(team, category)) {
    return { eligible: false, reason: `Team is not eligible for ${category === 'hfi' ? 'HFI' : 'Regular male'} category.` };
  }
  
  if (!countryLimitMatches(team, countryLimit)) {
    return { eligible: false, reason: `Team is not from the required league (${countryLimit}).` };
  }
  
  return { eligible: true };
}

/**
 * Restriction choices that make sense for a tournament category and remain
 * compatible with every team already registered. HFI teams are based in a
 * country but compete in the countryless HFI league, so HFI restrictions use
 * country IDs; regular tournaments use league IDs and may include other
 * countryless Hattrick leagues.
 */
export function getCompatibleLeagueRestrictionOptions<
  T extends Pick<ChppTeamOption, 'leagueName' | 'leagueId' | 'leagueSystemId' | 'genderId' | 'countryId' | 'countryName'>,
>(teams: T[], category: LeagueCategory): LeagueRestrictionOption[] {
  const options = Object.values(HATTRICK_WORLD_DETAILS)
    .filter((league) => (category === 'hfi' ? league.countryId !== null : league.leagueId !== 3000))
    .map((league) => ({
      value: String(category === 'hfi' ? league.countryId : league.leagueId),
      label: league.leagueName,
    }));

  const uniqueOptions = Array.from(new Map(options.map((option) => [option.value, option])).values());
  if (teams.length === 0) return uniqueOptions;

  return uniqueOptions.filter((option) =>
    teams.every((team) => validateTeamEligibility(team, { category, countryLimit: option.value }).eligible),
  );
}
