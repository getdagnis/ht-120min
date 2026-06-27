import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from './_lib/supabase.js';
import { getAppSessionSecret, verifyAppSessionCookie } from './_lib/app-session.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const secret = getAppSessionSecret();
  if (!secret) return res.status(500).json({ error: 'Server misconfigured' });

  const session = verifyAppSessionCookie(req.headers.cookie, secret);
  const devFallbackUserId =
    process.env.NODE_ENV !== 'production' ? Number(req.headers['x-ht-user-id'] || '0') || null : null;

  if (!session && !devFallbackUserId) {
    return res.status(401).json({ error: 'Unauthorized', details: 'Missing or invalid application session.' });
  }

  const supabase = getSupabase();
  const now = new Date();
  const rateLimitWindowMs = 2 * 60 * 1000;
  const userId = session?.userId || devFallbackUserId;

  const { data: profile, error: readError } = await supabase
    .from('profiles')
    .select('last_seen_at')
    .eq('hattrick_user_id', userId)
    .maybeSingle();

  if (readError) {
    return res.status(500).json({ error: 'Failed to read presence state', details: readError.message });
  }

  if (!profile) {
    return res.status(404).json({ error: 'Profile not found', details: 'No profile exists for this Hattrick user.' });
  }

  const currentSeenAt = profile.last_seen_at ? new Date(profile.last_seen_at) : null;
  if (currentSeenAt && Number.isFinite(currentSeenAt.getTime()) && now.getTime() - currentSeenAt.getTime() < rateLimitWindowMs) {
    return res.status(200).json({ last_seen_at: profile.last_seen_at, updated: false });
  }

  const nextSeenAt = now.toISOString();
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ last_seen_at: nextSeenAt })
    .eq('hattrick_user_id', userId);

  if (updateError) {
    return res.status(500).json({ error: 'Failed to update presence', details: updateError.message });
  }

  return res.status(200).json({ last_seen_at: nextSeenAt, updated: true });
}
