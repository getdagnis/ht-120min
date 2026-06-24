import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { adId, adIds } = req.query;

  let ids: string[] = [];
  if (typeof adId === 'string') {
    ids = [adId];
  } else if (typeof adIds === 'string') {
    ids = adIds.split(',').map((id) => id.trim()).filter(Boolean);
  }

  if (ids.length === 0) {
    return res.status(400).json({ error: 'Missing adId or adIds' });
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('matchmaker_activity')
      .select('*')
      .in('ad_id', ids)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.status(200).json({ activity: data ?? [] });
  } catch (error) {
    console.error('Matchmaker activity fetch error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Could not load activity.',
    });
  }
}
