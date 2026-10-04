'use server';

import { headers } from 'next/headers';
import { getAppSessionSecret, verifyAppSessionCookie } from '../../server/api/_lib/app-session.js';
import { loadTournamentAccess } from '../../server/api/_lib/tournament-access.js';
import { getServiceSupabase } from '../../server/api/_lib/supabase.js';
import { invalidatePublicTournament } from '../../server/api/_lib/tournament-cache.js';
import { hasSuperAdminBypassCookie } from '../../server/api/_lib/superadmin-bypass.js';
import { getForgeSuperadminId } from '../../server/api/_lib/forge-session.js';
import { loadTournamentInitialData } from './public-data.js';

// Explicit refreshes and cold client fallbacks share the same anonymous payload
// as SSR. This callback never receives cookies, credentials or viewer state.
export async function readTournamentPublicData(slug: string) {
  if (typeof slug !== 'string' || !slug || slug.length > 200) throw new Error('Invalid tournament.');
  return loadTournamentInitialData(slug);
}

async function viewer(tournamentId: string, password: string) {
  if (typeof tournamentId !== 'string' || !tournamentId || tournamentId.length > 100 ||
    typeof password !== 'string' || password.length > 256) throw new Error('Invalid tournament request.');
  const cookie = (await headers()).get('cookie') || '';
  const secret = getAppSessionSecret();
  const session = secret ? verifyAppSessionCookie(cookie, secret) : null;
  const bypass = hasSuperAdminBypassCookie(cookie);
  const userId = session?.userId || (bypass ? getForgeSuperadminId() : null);
  const supabase = getServiceSupabase(5_000);
  const access = userId ? await loadTournamentAccess(supabase, tournamentId, userId, bypass) : null;
  let legacyAdmin = false;
  if (password) {
    const { data, error } = await supabase.from('tournaments').select('admin_password').eq('id', tournamentId).maybeSingle();
    if (error) throw error;
    legacyAdmin = Boolean(data?.admin_password && password === data.admin_password);
  }
  return {
    supabase, userId, legacyAdmin, admin: legacyAdmin || Boolean(access?.canViewAdmin),
    canManageOperations: legacyAdmin || Boolean(access?.canManageOperations),
  };
}

// Private reads deliberately bypass the Data Cache. Identity comes from the
// signed server session, never from the browser's remembered Hattrick ID.
export async function loadTournamentPrivateData(tournamentId: string, password = '') {
  const { supabase, userId, admin, legacyAdmin, canManageOperations } = await viewer(tournamentId, password);
  if (!admin && !userId) return { admin: false, passwordVerified: false, settings: null, announcements: [], dismissals: [] };
  const announcementsQuery = supabase.from('tournament_announcements')
    .select('id,tournament_id,content,template_key,visibility,source,audience_ht_user_ids,is_active,created_by_name,created_by_ht_user_id,created_at,hidden_at')
    .eq('tournament_id', tournamentId).order('created_at', { ascending: false });
  const [settings, announcements, dismissals] = await Promise.all([
    canManageOperations ? supabase.from('tournaments').select('admin_password,admin_email').eq('id', tournamentId).single() : Promise.resolve({ data: null, error: null }),
    admin ? announcementsQuery : announcementsQuery.eq('visibility', 'participants').contains('audience_ht_user_ids', [userId!]),
    userId ? supabase.from('tournament_announcement_dismissals').select('id,tournament_id,announcement_id,notice_key,hattrick_user_id,dismissed_at').eq('tournament_id', tournamentId).eq('hattrick_user_id', userId) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [settings, announcements, dismissals]) if (result.error) throw result.error;
  return { admin, passwordVerified: legacyAdmin, settings: settings.data, announcements: announcements.data || [], dismissals: dismissals.data || [] };
}

// Legacy browser writes still exist. Their actor requests a narrowly scoped
// purge after success; this does not authorize or perform any database write.
export async function invalidateTournamentData(tournamentId: string, password = '') {
  const { supabase, userId, admin } = await viewer(tournamentId, password);
  if (!admin) {
    if (!userId) throw new Error('Please sign in first.');
    const { data, error } = await supabase.from('teams').select('id').eq('tournament_id', tournamentId).eq('hattrick_user_id', userId).limit(1);
    if (error) throw error;
    if (!data?.length) throw new Error('Tournament access required.');
  }
  await invalidatePublicTournament(tournamentId);
}
