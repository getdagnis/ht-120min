import type { VercelRequest } from '@vercel/node';
import { getManagerChppCredentials } from '../../_lib/matchmaker.js';
import { getSupabase } from '../../_lib/supabase.js';

export interface TestingManagerContext {
  managerId: number;
  credentials: NonNullable<Awaited<ReturnType<typeof getManagerChppCredentials>>>;
  consumerKey: string;
  consumerSecret: string;
}

export async function resolveTestingManager(req: VercelRequest): Promise<TestingManagerContext | { error: string }> {
  const rawManagerId = req.query.managerId ?? req.body?.managerId;
  const managerId = Number(Array.isArray(rawManagerId) ? rawManagerId[0] : rawManagerId);

  if (!Number.isFinite(managerId)) {
    return { error: 'Missing managerId query parameter (your hattrick_user_id from profiles).' };
  }

  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) {
    return { error: 'CHPP_CONSUMER_KEY / CHPP_CONSUMER_SECRET missing.' };
  }

  const supabase = getSupabase();
  const credentials = await getManagerChppCredentials(supabase, managerId);
  if (!credentials) {
    return {
      error: `No OAuth tokens for manager ${managerId}. Log in via /api/auth/init first.`,
    };
  }

  return { managerId, credentials, consumerKey, consumerSecret };
}
