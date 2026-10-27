import 'server-only';
import { createClient } from '@supabase/supabase-js';

import { unstable_cache } from 'next/cache';
import { getServiceSupabase } from '../../server/api/_lib/supabase.js';
import { tournamentCacheTag, TOURNAMENT_CACHE_SECONDS } from '../../server/api/_lib/tournament-cache.js';
import { buildManagerSpotlight, getUtcDateKey, selectDailySpotlightParticipant,
  type ManagerSpotlightParticipant, type ManagerSpotlightProfile } from '../../utils/manager-spotlight.js';
import { isCurrentParticipantTeam } from '../../utils/team-state.js';

function publicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Public database configuration missing.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: AbortSignal.timeout(8000) }) } });
}

async function readProfile(managerId: number) {
  const { data, error } = await publicClient().from('profiles')
    .select('hattrick_user_id,manager_name,avatar_json,country_id,country_name,language_name,national_team_roles_json,teams_json')
    .eq('hattrick_user_id', managerId).maybeSingle();
  if (error) throw error;
  return data as ManagerSpotlightProfile | null;
}
async function model(tournamentId: string, participant: ManagerSpotlightParticipant, dateKey: string, fresh: boolean, participants: ManagerSpotlightParticipant[]) {
  const managerId = Number(participant.hattrick_user_id);
  const profile = fresh ? await readProfile(managerId) : await unstable_cache(
    () => readProfile(managerId), ['spotlight-profile-v1', tournamentId, String(managerId)],
    { revalidate: TOURNAMENT_CACHE_SECONDS, tags: [tournamentCacheTag(tournamentId)] })();
  if (!profile) return null;
  return buildManagerSpotlight({ tournamentId, participants: [...participants.filter(p => p.id !== participant.id), participant], selectedParticipant: participant, profiles: [profile], dateKey });
}
async function initialSpotlights(tournamentId: string, participants: ManagerSpotlightParticipant[], fresh = false) {
  const dateKey = getUtcDateKey();
  const candidate = selectDailySpotlightParticipant(tournamentId, participants, dateKey);
  // Only explicitly public participant fields cross the persistence boundary.
  const participant = candidate ? Object.fromEntries(['id','ht_team_id','name','logo_url','country_id','country_name','league_id','manager_name','hattrick_user_id']
    .map(key => [key, candidate[key as keyof ManagerSpotlightParticipant] ?? null])) : null;
  const { data, error } = await getServiceSupabase(8_000).rpc('resolve_daily_manager_spotlight', {
    p_tournament_id: tournamentId, p_utc_date: dateKey, p_participant: participant,
  });
  if (error) throw error;
  const daily = data as ManagerSpotlightParticipant | null;
  if (!daily) return { managerSpotlight: null, managerSpotlightsHasMore: false, managerSpotlights: [] };
  const next = selectDailySpotlightParticipant(tournamentId, participants.filter(p => Number(p.hattrick_user_id) !== Number(daily.hattrick_user_id)), dateKey);
  const [managerSpotlight, prefetched] = await Promise.all([
    model(tournamentId, daily, dateKey, fresh, participants), next ? model(tournamentId, next, dateKey, fresh, participants).catch(() => null) : null,
  ]);
  return { managerSpotlight, managerSpotlightsHasMore: Boolean(next), managerSpotlights: [managerSpotlight, prefetched].filter((p): p is NonNullable<typeof p> => p !== null) };
}
export async function loadRemainingTournamentSpotlights(tournamentId: string) {
  const db = publicClient();
  const { data: tournament, error: tournamentError } = await db.from('tournaments').select('id').eq('id', tournamentId).maybeSingle();
  if (tournamentError) throw tournamentError;
  if (!tournament) return [];
  const participants: ManagerSpotlightParticipant[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from('teams')
      .select('id,ht_team_id,name,logo_url,country_id,country_name,league_id,manager_name,hattrick_user_id,active,reserve_active,is_placeholder')
      .eq('tournament_id', tournamentId).order('id').range(offset, offset + 499);
    if (error) throw error;
    participants.push(...(data || []).filter(isCurrentParticipantTeam));
    if (!data || data.length < 500) break;
  }
  const unique = [...new Map(participants.filter(p => Number(p.ht_team_id) > 0 && Number(p.hattrick_user_id) > 0)
    .map(p => [Number(p.hattrick_user_id), p])).values()];
  const results = [];
  // Bound query concurrency on the rare browse-all action.
  for (let i = 0; i < unique.length; i += 8) results.push(...await Promise.all(unique.slice(i, i + 8).map(p => model(tournamentId, p, getUtcDateKey(), false, participants))));
  return results.filter((p): p is NonNullable<typeof p> => p !== null);
}

export async function loadInitialTournamentSpotlights(tournamentId: string, participants: ManagerSpotlightParticipant[], fresh = false) {
  try { return await initialSpotlights(tournamentId, participants, fresh); }
  catch {
    console.warn('[spotlight] Initial selection unavailable.');
    return { managerSpotlight: null, managerSpotlightsHasMore: false, managerSpotlights: [] };
  }
}
