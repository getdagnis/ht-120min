import 'server-only';
import { unstable_cache } from 'next/cache';
import { createPublicSnapshotStore } from '../../server/api/_lib/public-snapshot-store.js';
import { getServiceSupabase } from '../../server/api/_lib/supabase.js';
import { homeSnapshotContract, HOME_SNAPSHOT_TAG, normalizeHomeSnapshot } from '../../server/api/_lib/home-snapshot-contract.js';
import { PUBLIC_DATA_READ_TIMEOUT_MS } from '../../utils/public-data-config.js';

// No cookies or authorization enter this shared callback. Timeout changes only
// how long an uncached read waits, so retries share the same cache entry.
function readCachedHomeSnapshotPayload(timeoutMs: number) {
  return unstable_cache(async () => {
    const published = await createPublicSnapshotStore(getServiceSupabase(timeoutMs), homeSnapshotContract).readPublished();
    if (!published) throw new Error('Home publication unavailable.');
    return published.payload;
  }, ['public-home', 'contract-1'], { revalidate: false, tags: [HOME_SNAPSHOT_TAG] });
}

export async function readCachedHomeSnapshot(timeoutMs = PUBLIC_DATA_READ_TIMEOUT_MS) {
  // Next may return a value cached by the previous deployment without running
  // the current publication decoder.
  return normalizeHomeSnapshot(await readCachedHomeSnapshotPayload(timeoutMs)());
}
