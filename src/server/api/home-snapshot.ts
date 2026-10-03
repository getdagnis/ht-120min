import { timingSafeEqual } from 'node:crypto';
import { revalidateTag } from 'next/cache';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase } from './_lib/supabase.js';
import { HOME_SNAPSHOT_TAG } from './_lib/home-snapshot-contract.js';
import { runHomeSnapshotWorker } from './_lib/home-snapshot-worker.js';

export function isHomeWorkerAuthorized(header: unknown, secret: string | undefined): boolean {
  if (!secret || secret.length < 32 || typeof header !== 'string') return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (!isHomeWorkerAuthorized(req.headers.authorization, process.env.PUBLIC_HOME_WORKER_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  try {
    const result = await runHomeSnapshotWorker(getServiceSupabase(5_000), async () => {
      revalidateTag(HOME_SNAPSHOT_TAG, { expire: 0 });
    });
    return res.status(200).json(result);
  } catch {
    return res.status(503).json({ error: 'Home publication temporarily unavailable.' });
  }
}
