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
    skipMembershipCheck?: boolean;
  },
) {
  // Check if team is in another active tournament
  if (!input.skipMembershipCheck) {
    const { data: existing } = await supabase
      .from('teams')
      .select('tournament_id, tournaments(name)')
      .eq('ht_team_id', input.team.teamId)
      .eq('active', true)
      .neq('tournament_id', input.tournamentId)
      .maybeSingle();

    if (existing && (existing as any).tournaments?.status !== 'finished') {
      throw new Error(
        `Team ${input.team.teamName} is already active in another tournament: "${
          (existing as any).tournaments?.name
        }". You must leave that tournament before joining a new one.`,
      );
    }
  }

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
