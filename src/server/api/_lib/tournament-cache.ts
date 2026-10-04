import { revalidateTag } from 'next/cache';
import { getServiceSupabase } from './supabase.js';

export const tournamentCacheTag = (id: string) => `public-tournament:${id}`;
export const tournamentSlugCacheTag = (slug: string) => `public-tournament-slug:${slug}`;
export const TOURNAMENT_CACHE_SECONDS = 60;

// Call only after an authorized mutation. Expire immediately rather than serving
// stale data to the person who just saved. All seasons belong to this tournament.
export async function invalidatePublicTournament(id: string) {
  revalidateTag(tournamentCacheTag(id), { expire: 0 });
  const { data, error } = await getServiceSupabase(5_000).from('tournaments').select('slug').eq('id', id).maybeSingle();
  if (error) throw error;
  if (data?.slug) revalidateTag(tournamentSlugCacheTag(data.slug), { expire: 0 });
  console.info('[public-tournament] invalidated', { tournamentId: id });
}
