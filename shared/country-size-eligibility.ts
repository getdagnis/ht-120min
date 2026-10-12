import { getCountryActiveTeamCount } from './country-active-team-counts.js';

export type CountrySizeEligibility = { eligible: true } | { eligible: false; reason: string };

export function managerHasQualifyingCountryParticipant(
  teams: Array<{
    active?: boolean | null;
    reserve_active?: boolean | null;
    is_placeholder?: boolean | null;
    hattrick_user_id?: number | null;
    country_id?: number | null;
  }>,
  managerId: number,
  maximumActiveTeams: number,
): boolean {
  return teams.some((team) => {
    if (team.active !== true || team.reserve_active === true || team.is_placeholder === true ||
      Number(team.hattrick_user_id) !== managerId) return false;
    const count = getCountryActiveTeamCount(team.country_id);
    return count !== null && count <= maximumActiveTeams;
  });
}

export function validateCountrySizeEligibility(options: {
  countryId: number | null | undefined;
  maximumActiveTeams: number | null | undefined;
  allowManagerException: boolean;
  hasQualifyingParticipant: boolean;
}): CountrySizeEligibility {
  const { countryId, maximumActiveTeams, allowManagerException, hasQualifyingParticipant } = options;
  if (maximumActiveTeams == null) return { eligible: true };
  if (allowManagerException && hasQualifyingParticipant) return { eligible: true };

  const count = getCountryActiveTeamCount(countryId);
  if (count === null) {
    return { eligible: false, reason: 'This country’s active-team count could not be verified from the saved league data.' };
  }
  if (count > maximumActiveTeams) {
    return {
      eligible: false,
      reason: `This tournament accepts countries with up to ${maximumActiveTeams} active teams; this country has ${count}.`,
    };
  }
  return { eligible: true };
}
