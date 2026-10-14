import type { SupabaseClient } from '@supabase/supabase-js';
import { managerCountrySizeAllowance, validateCountrySizeEligibility } from '../../../../shared/country-size-eligibility.js';

/** Advisory check; migration 121 enforces the final transaction atomically. */
export async function validateTournamentCountrySizeEligibility(
  supabase: SupabaseClient,
  options: {
    tournamentId: string;
    managerId: number | null | undefined;
    countryId: number | null | undefined;
    maximumActiveTeams: number | null | undefined;
    allowManagerException: boolean;
    hasQualifyingParticipant?: boolean;
    waitingList?: boolean;
    excludeTeamId?: number;
  },
) {
  const { tournamentId, managerId, countryId, maximumActiveTeams, allowManagerException } = options;
  if (maximumActiveTeams == null) return { eligible: true } as const;

  let hasQualifyingParticipant = options.hasQualifyingParticipant ?? false;
  if (options.hasQualifyingParticipant === undefined && allowManagerException && managerId != null) {
    const { data, error } = await supabase
      .from('teams')
      .select('ht_team_id, country_id, is_placeholder, active, reserve_active, hattrick_user_id')
      .eq('tournament_id', tournamentId)
      .eq('hattrick_user_id', managerId)
      .not('ht_team_id', 'is', null);
    if (error) throw error;
    const promotingExistingReserve = !options.waitingList && (data || []).some(team =>
      team.ht_team_id === options.excludeTeamId && team.reserve_active === true);
    const allowance = managerCountrySizeAllowance(
      (data || []).filter(team => team.ht_team_id !== options.excludeTeamId), managerId, maximumActiveTeams, promotingExistingReserve,
    );
    hasQualifyingParticipant = (options.waitingList ? allowance.waiting : allowance.active) > 0;
  }

  return validateCountrySizeEligibility({
    countryId,
    maximumActiveTeams,
    allowManagerException,
    hasQualifyingParticipant,
  });
}
