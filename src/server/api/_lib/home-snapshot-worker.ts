import type { SupabaseClient } from '@supabase/supabase-js';
import { buildHomeSnapshot } from './home-snapshot-builder.js';
import { homeSnapshotContract, HOME_SNAPSHOT_TARGET, HOME_SNAPSHOT_VERSION } from './home-snapshot-contract.js';
import { createPublicSnapshotStore } from './public-snapshot-store.js';

/** Scheduler-only. Never approves/reapproves a target or fetches CHPP. */
export async function runHomeSnapshotWorker(supabase: SupabaseClient, invalidate: () => Promise<void>) {
  const store = createPublicSnapshotStore(supabase, homeSnapshotContract);
  const { error } = await supabase.rpc('dirty_home_snapshot_time_boundary');
  if (error) throw new Error('Home boundary check failed.');
  const { data: admission, error: admissionError } = await supabase.from('public_snapshots')
    .select('exposure, published_generation').eq('target_key', HOME_SNAPSHOT_TARGET)
    .eq('contract_version', HOME_SNAPSHOT_VERSION).maybeSingle();
  if (admissionError) throw new Error('Home admission state read failed.');
  if (admission?.exposure === 'approved' && admission.published_generation > 0) await invalidate();
  const lease = await store.claimBuild();
  let built = false;
  if (lease) {
    try {
      const candidate = await buildHomeSnapshot(supabase);
      built = await store.publish(lease, candidate);
    } catch {
      await store.failBuild(lease);
      throw new Error('Home publication build failed.');
    }
  }
  // Repair an invalidation failure on a later invocation even when no new build is due.
  const { data, error: deliveryError } = await supabase.from('public_snapshots')
    .select('exposure, source_generation, published_generation, cache_invalidated_generation')
    .eq('target_key', HOME_SNAPSHOT_TARGET).eq('contract_version', HOME_SNAPSHOT_VERSION).maybeSingle();
  if (deliveryError) throw new Error('Home delivery state read failed.');
  if (!data) return { built, invalidated: false };
  const generation = data.exposure === 'withdrawn' ? data.source_generation : data.published_generation;
  // Re-purge pending withdrawals each invocation to drain old in-flight cache fills.
  if ((data.exposure === 'public' && generation > data.cache_invalidated_generation) || data.exposure === 'withdrawn') {
    try {
      await invalidate();
    } catch {
      if (data.exposure === 'withdrawn') await store.failWithdrawal(generation, 'purge_failed');
      throw new Error('Home cache invalidation failed.');
    }
    const invalidated = await store.acknowledgeInvalidation(generation);
    // No verification claim: regional probe coverage is still required.
    return { built, invalidated };
  }
  return { built, invalidated: false };
}
