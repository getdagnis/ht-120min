import type { SupabaseClient } from '@supabase/supabase-js';
import { managerHasQualifyingCountryParticipant, validateCountrySizeEligibility } from '../../../../shared/country-size-eligibility.js';

/** Checks only existing, admitted participants; reserve rows never unlock this exception. */
export async function validateTournamentCountrySizeEligibility(
  supabase: SupabaseClient,
  options: {
    tournamentId: string;
    managerId: number | null | undefined;
    countryId: number | null | undefined;
    maximumActiveTeams: number | null | undefined;
    allowManagerException: boolean;
    hasQualifyingParticipant?: boolean;
  },
) {
  const { tournamentId, managerId, countryId, maximumActiveTeams, allowManagerException } = options;
  if (maximumActiveTeams == null) return { eligible: true } as const;

  let hasQualifyingParticipant = options.hasQualifyingParticipant ?? false;
  if (options.hasQualifyingParticipant === undefined && allowManagerException && managerId != null) {
    const { data, error } = await supabase
      .from('teams')
      .select('country_id, is_placeholder, active, reserve_active, hattrick_user_id')
      .eq('tournament_id', tournamentId)
      .eq('hattrick_user_id', managerId)
      .eq('active', true)
      .eq('reserve_active', false)
      .not('ht_team_id', 'is', null)
      .not('country_id', 'is', null);
    if (error) throw error;
    hasQualifyingParticipant = managerHasQualifyingCountryParticipant(data || [], managerId, maximumActiveTeams);
  }

  return validateCountrySizeEligibility({
    countryId,
    maximumActiveTeams,
    allowManagerException,
    hasQualifyingParticipant,
  });
}
