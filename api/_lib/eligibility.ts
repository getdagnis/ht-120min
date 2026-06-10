import type { ChppTeamOption } from '../_lib/chpp-xml';

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

export function validateTeamEligibility(
  team: Pick<ChppTeamOption, 'leagueName' | 'leagueId' | 'leagueSystemId' | 'genderId' | 'countryName'>,
  options: { category: LeagueCategory; countryLimit?: string | null },
): { eligible: boolean; reason?: string } {
  const { category, countryLimit } = options;
  
  if (!teamMatchesCategory(team, category)) {
    return { eligible: false, reason: `Team is not eligible for ${category === 'hfi' ? 'HFI' : 'Regular male'} category.` };
  }
  
  if (countryLimit && team.countryName && team.countryName !== countryLimit) {
    return { eligible: false, reason: `Team is not from the required league (${countryLimit}).` };
  }
  
  return { eligible: true };
}
