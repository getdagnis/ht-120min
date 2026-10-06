import type { SupabaseClient } from '@supabase/supabase-js';

const TOURNAMENT_BATCH_SIZE = 100;
const NEWS_PAGE_SIZE = 1000;

export interface TournamentListingSignals {
  hasNewsArticle: Set<string>;
  updatedAt: Map<string, string>;
}

// One bounded set of public reads per directory, never one query per card.
// The timestamp lookup tolerates the rollout period before migration 100.
export async function loadTournamentListingSignals(
  supabase: SupabaseClient, tournamentIds: readonly string[],
): Promise<TournamentListingSignals> {
  const signals: TournamentListingSignals = { hasNewsArticle: new Set(), updatedAt: new Map() };
  for (let start = 0; start < tournamentIds.length; start += TOURNAMENT_BATCH_SIZE) {
    const ids = tournamentIds.slice(start, start + TOURNAMENT_BATCH_SIZE);
    for (let offset = 0; ; offset += NEWS_PAGE_SIZE) {
      const { data, error } = await supabase.from('news_posts').select('tournament_id')
        .in('tournament_id', ids)
        .or('is_round_report.is.null,is_round_report.eq.false')
        .order('id').range(offset, offset + NEWS_PAGE_SIZE - 1);
      if (error) throw new Error('Tournament news presence read failed.');
      for (const row of data || []) signals.hasNewsArticle.add(row.tournament_id);
      if ((data || []).length < NEWS_PAGE_SIZE) break;
    }
    const { data, error } = await supabase.from('tournaments').select('id,updated_at').in('id', ids);
    if (error && !['42703', 'PGRST204'].includes(error.code)) {
      throw new Error('Tournament modification time read failed.');
    }
    for (const row of data || []) {
      if (row.updated_at) signals.updatedAt.set(row.id, row.updated_at);
    }
  }
  return signals;
}
