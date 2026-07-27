import type { ChppTeamOption } from '../_lib/chpp-xml.js';

export type LeagueCategory = 'male' | 'hfi';

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
