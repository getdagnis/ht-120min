import 'server-only';
import { unstable_cache } from 'next/cache';
import { createPublicSnapshotStore } from '../../server/api/_lib/public-snapshot-store.js';
import { getServiceSupabase } from '../../server/api/_lib/supabase.js';
import { homeSnapshotContract, HOME_SNAPSHOT_TAG, normalizeHomeSnapshot } from '../../server/api/_lib/home-snapshot-contract.js';

// Cookies/authorization and normalized sources never enter this shared callback.
const readCachedHomeSnapshotPayload = unstable_cache(async () => {
  const published = await createPublicSnapshotStore(getServiceSupabase(5_000), homeSnapshotContract).readPublished();
  if (!published) throw new Error('Home publication unavailable.');
  return published.payload;
}, ['public-home', 'contract-1'], { revalidate: false, tags: [HOME_SNAPSHOT_TAG] });

export async function readCachedHomeSnapshot() {
  // Next may return a value cached by the previous deployment without running
  // the current publication decoder.
  return normalizeHomeSnapshot(await readCachedHomeSnapshotPayload());
}
