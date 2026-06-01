import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChppTeamOption } from '../../src/utils/chpp-xml';

export async function registerOAuthTeam(
  supabase: SupabaseClient,
  input: {
    tournamentId: string;
    team: ChppTeamOption;
    managerName: string;
    hattrickUserId: number | null;
    accessToken: string;
    accessTokenSecret: string;
    countryName?: string;
  },
) {
  const { error } = await supabase.from('teams').upsert(
    {
      tournament_id: input.tournamentId,
      ht_team_id: input.team.teamId,
      name: input.team.teamName,
      ht_team_name: input.team.teamName,
      manager_name: input.managerName,
      hattrick_user_id: input.hattrickUserId,
      country_name: input.countryName ?? null,
      oauth_token: input.accessToken,
      oauth_token_secret: input.accessTokenSecret,
      joined_via_oauth: true,
      active: true,
    },
    { onConflict: 'tournament_id, ht_team_id' },
  );

  if (error) {
    throw new Error(error.message);
  }
}
