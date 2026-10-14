import { getCountryActiveTeamCount } from './country-active-team-counts.js';

export type CountrySizeEligibility = { eligible: true } | { eligible: false; reason: string };

export function managerHasQualifyingCountryParticipant(
  teams: Array<{
    ht_team_id?: number | null;
    active?: boolean | null;
    reserve_active?: boolean | null;
    is_placeholder?: boolean | null;
    hattrick_user_id?: number | null;
    country_id?: number | null;
  }>,
  managerId: number,
  maximumActiveTeams: number,
): boolean {
  return teams.some(team => {
    if (team.ht_team_id === null || team.active !== true || team.reserve_active === true ||
      team.is_placeholder === true || Number(team.hattrick_user_id) !== managerId) return false;
    const count = getCountryActiveTeamCount(team.country_id);
    return count !== null && count <= maximumActiveTeams;
  });
}

/** Entries consume one allowance each; waiting teams only unlock waiting entries.
 * Promotion checks active counts only: it does not add a new total entry.
 */
export function managerCountrySizeAllowance(
  teams: Parameters<typeof managerHasQualifyingCountryParticipant>[0],
  managerId: number,
  maximumActiveTeams: number,
  admissionOnly = false,
): { active: number; waiting: number } {
  let smallActive = 0, largeActive = 0, smallWaiting = 0, largeWaiting = 0;
  for (const team of teams) {
    if (team.ht_team_id === null || team.is_placeholder === true || Number(team.hattrick_user_id) !== managerId) continue;
    const active = team.active === true && team.reserve_active !== true;
    const waiting = team.reserve_active === true;
    if (!active && !waiting) continue;
    const count = getCountryActiveTeamCount(team.country_id);
    const small = count !== null && count <= maximumActiveTeams;
    if (active) { if (small) smallActive++; else largeActive++; }
    else { if (small) smallWaiting++; else largeWaiting++; }
  }
  const total = smallActive + smallWaiting - largeActive - largeWaiting;
  return { active: admissionOnly ? smallActive - largeActive : Math.min(smallActive - largeActive, total), waiting: total };
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
