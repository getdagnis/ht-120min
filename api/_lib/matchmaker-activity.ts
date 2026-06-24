import type { SupabaseClient } from '@supabase/supabase-js';

export type MatchmakerActivityType = 'challenge_sent' | 'interest_shown';

export interface MatchmakerActivityRow {
  id: string;
  created_at: string;
  ad_id: string;
  actor_user_id: number;
  actor_team_id: string | null;
  actor_team_name: string;
  type: MatchmakerActivityType;
  comment: string | null;
  metadata: Record<string, unknown>;
}

export const MATCHMAKER_ACTIVITY_SOURCE = 'ht-120min';

export async function insertMatchmakerActivity(
  supabase: SupabaseClient,
  input: {
    adId: string;
    actorUserId: number;
    actorTeamId?: string | null;
    actorTeamName: string;
    type: MatchmakerActivityType;
    comment?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<MatchmakerActivityRow> {
  const { data, error } = await supabase
    .from('matchmaker_activity')
    .insert({
      ad_id: input.adId,
      actor_user_id: input.actorUserId,
      actor_team_id: input.actorTeamId ?? null,
      actor_team_name: input.actorTeamName,
      type: input.type,
      comment: input.comment?.trim() || null,
      metadata: {
        source: MATCHMAKER_ACTIVITY_SOURCE,
        ...input.metadata,
      },
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Could not record Matchmaker activity.');
  }

  return data as MatchmakerActivityRow;
}

export async function getOpenAdForAction(
  supabase: SupabaseClient,
  adId: string,
): Promise<{
  id: string;
  status: string;
  manager_ht_id: number;
  match_type: string;
  home_away: string;
  is_long_term: boolean;
  team: {
    id: string;
    ht_team_id: number;
    name: string;
    availability_status: string | null;
  } | null;
}> {
  const { data, error } = await supabase
    .from('matchmaker_requests')
    .select(
      `
      id,
      status,
      manager_ht_id,
      match_type,
      home_away,
      is_long_term,
      team:teams!matchmaker_requests_team_id_fkey(id, ht_team_id, name, availability_status)
    `,
    )
    .eq('id', adId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Advertisement not found.');
  if (data.status !== 'open') throw new Error('This advertisement is no longer active.');
  if (!data.team?.ht_team_id) throw new Error('Advertisement team is missing.');

  return {
    ...data,
    team: data.team,
  };
}

export async function ensureActorTeamRow(
  supabase: SupabaseClient,
  input: {
    htTeamId: number;
    teamName: string;
    managerId: number;
    managerName: string;
  },
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('teams')
    .select('id')
    .eq('ht_team_id', input.htTeamId)
    .is('tournament_id', null)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data: inserted, error } = await supabase
    .from('teams')
    .insert({
      ht_team_id: input.htTeamId,
      name: input.teamName,
      ht_team_name: input.teamName,
      hattrick_user_id: input.managerId,
      manager_name: input.managerName,
      tournament_id: null,
      active: true,
    })
    .select('id')
    .single();

  if (error || !inserted) return null;
  return inserted.id;
}
