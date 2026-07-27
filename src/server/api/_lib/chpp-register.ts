import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChppTeamOption } from './chpp-xml.js';

interface TeamTournamentCheck {
  tournament_id: string;
  tournaments:
    | { name: string; status: string; is_test?: boolean | null; registration_type?: string | null }
    | { name: string; status: string; is_test?: boolean | null; registration_type?: string | null }[]
    | null;
}

export async function registerOAuthTeam(
  supabase: SupabaseClient,
  input: {
    tournamentId: string;
    team: ChppTeamOption;
    managerName: string;
    hattrickUserId: number | null;
    accessToken: string;
    accessTokenSecret: string;
    logoUrl?: string;
    countryId?: number | null;
    countryName?: string;
    skipMembershipCheck?: boolean;
  },
) {
  // 1. Check if team is in another active tournament
  if (!input.skipMembershipCheck) {
    const { data: existing } = await supabase
      .from('teams')
      .select('tournament_id, tournaments(name, status, is_test, registration_type)')
      .eq('ht_team_id', input.team.teamId)
      .eq('active', true)
      .neq('tournament_id', input.tournamentId)
      .maybeSingle();

    const existingData = existing as unknown as TeamTournamentCheck | null;
    const tournament = Array.isArray(existingData?.tournaments)
      ? existingData.tournaments[0]
      : existingData?.tournaments;

    if (
      tournament &&
      tournament.status !== 'finished' &&
      tournament.status !== 'stopped' &&
      !tournament.is_test &&
      tournament.registration_type !== 'sandbox'
    ) {
      throw new Error(
        `Team ${input.team.teamName} (${input.team.teamId}) is already active in another tournament: "${tournament.name}". It must leave that tournament first.`,
      );
    }
  }

  // 2. Check if team already exists in THIS tournament
  const { data: existingInThis } = await supabase
    .from('teams')
    .select('id, active')
    .eq('tournament_id', input.tournamentId)
    .eq('ht_team_id', input.team.teamId)
    .maybeSingle();

  if (existingInThis) {
    // Just reactivate and update info
    const { error } = await supabase
      .from('teams')
      .update({
        active: true,
        reapply_season_number: null,
        name: input.team.teamName,
        manager_name: input.managerName,
        logo_url: input.logoUrl ?? null,
        country_id: input.countryId ?? null,
        country_name: input.countryName ?? null,
        league_id: input.team.leagueId ?? null,
        gender_id: input.team.genderId ?? null,
        league_level: input.team.leagueLevel ?? null,
        oauth_token: input.accessToken,
        oauth_token_secret: input.accessTokenSecret,
        hattrick_user_id: input.hattrickUserId,
        joined_via_oauth: true,
        ht_team_name: input.team.teamName,
      })
      .eq('id', existingInThis.id);

    if (error) throw new Error(error.message);
    return existingInThis.id;
  }

  // 3. Capacity check — enforce max_teams if set
  const { data: tournamentMeta } = await supabase
    .from('tournaments')
    .select('max_teams, season')
    .eq('id', input.tournamentId)
    .single();

  if (tournamentMeta?.max_teams) {
    const { count } = await supabase
      .from('teams')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', input.tournamentId)
      .eq('active', true);

    if ((count ?? 0) >= tournamentMeta.max_teams) {
      throw new Error('This tournament is full. No more teams can join.');
    }
  }

  // 4. Check if tournament has started (has rounds).
  const { data: rounds } = await supabase
    .from('rounds')
    .select('id')
    .eq('tournament_id', input.tournamentId)
    .eq('season_number', tournamentMeta?.season || 1);

  const isGenerated = rounds && rounds.length > 0;
  let replacementForId: string | null = null;

  if (isGenerated) {
    // Try to find an inactive spot to fill
    const { data: allTeams } = await supabase
      .from('teams')
      .select('id, active')
      .eq('tournament_id', input.tournamentId);

    // Find teams that are inactive and NOT already replaced by someone else
    const { data: replacements } = await supabase
      .from('teams')
      .select('replacement_for_team_id')
      .eq('tournament_id', input.tournamentId)
      .not('replacement_for_team_id', 'is', null);

    const replacedIds = new Set(replacements?.map((r) => r.replacement_for_team_id));
    const openInactiveTeam = allTeams?.find((t) => !t.active && !replacedIds.has(t.id));

    if (openInactiveTeam) {
      replacementForId = openInactiveTeam.id;
    }
  }

  // 5. Register the team
  const { data: newTeam, error } = await supabase
    .from('teams')
    .insert({
      tournament_id: input.tournamentId,
      ht_team_id: input.team.teamId,
      name: input.team.teamName,
      ht_team_name: input.team.teamName,
      manager_name: input.managerName,
      hattrick_user_id: input.hattrickUserId,
      country_id: input.countryId ?? null,
      country_name: input.countryName ?? null,
      league_id: input.team.leagueId ?? null,
      gender_id: input.team.genderId ?? null,
      league_level: input.team.leagueLevel ?? null,
      logo_url: input.logoUrl ?? null,
      oauth_token: input.accessToken,
      oauth_token_secret: input.accessTokenSecret,
      joined_via_oauth: true,
      active: true,
      reapply_season_number: null,
      replacement_for_team_id: replacementForId,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  // 6. Post-registration logic for ongoing tournaments
  if (isGenerated && newTeam) {
    if (replacementForId) {
      // Fill inactive team spot
      await supabase
        .from('matches')
        .update({ home_team_id: newTeam.id })
        .eq('home_team_id', replacementForId)
        .eq('completed', false);
      await supabase
        .from('matches')
        .update({ away_team_id: newTeam.id })
        .eq('away_team_id', replacementForId)
        .eq('completed', false);
    } else {
      // Try to fill BYE spots (where team_id is null)
      const roundIds = rounds.map((r) => r.id);

      // Find matches with null IDs in any side
      const { data: byeMatches } = await supabase
        .from('matches')
        .select('id, home_team_id, away_team_id')
        .in('round_id', roundIds)
        .or('home_team_id.is.null,away_team_id.is.null')
        .eq('completed', false);

      if (byeMatches && byeMatches.length > 0) {
        for (const match of byeMatches) {
          if (match.home_team_id === null) {
            await supabase.from('matches').update({ home_team_id: newTeam.id }).eq('id', match.id);
          } else if (match.away_team_id === null) {
            await supabase.from('matches').update({ away_team_id: newTeam.id }).eq('id', match.id);
          }
        }
      }
    }
  }

  return newTeam?.id;
}
