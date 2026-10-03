import { createClient } from '@supabase/supabase-js';

export function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(`Supabase configuration missing. URL: ${!!url}, Key: ${!!key}`);
  }
  return createClient(url, key);
}

export function getServiceSupabase(timeoutMs?: number) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Server-side Supabase service configuration is missing.');
  }

  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 1)) throw new Error('Invalid database timeout.');
  return createClient(url, key, timeoutMs === undefined ? undefined : {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) }) },
  });
}
