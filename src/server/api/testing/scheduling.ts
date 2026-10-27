import type { VercelRequest, VercelResponse } from '@vercel/node';
import { rejectIfForgeTestingUnauthorized } from './_lib/guard.js';
import { getServiceSupabase } from '../_lib/supabase.js';
import { checkSlot, PLANNING_BATCH_SIZE } from '../_lib/organizer-planning.js';
import { buildCalendarSlots } from '../../../utils/hattrick-calendar.js';
import type { OrganizerRoundTeam } from '../../../utils/organizer-round.js';

export default async function handleScheduling(req: VercelRequest, res: VercelResponse) {
  if (rejectIfForgeTestingUnauthorized(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  const db = getServiceSupabase();
  const collections = await db.from('tournament_collections').select('id,slug,title').order('title');
  if (collections.error) throw collections.error;
  const collectionId = String(req.method === 'POST' ? req.body?.collectionId || '' : req.query.collectionId || '');
  const selected = collections.data?.find(row => row.id === collectionId) || (!collectionId ? collections.data?.find(row => row.slug === 'exotic-hfi') : null);
  if (!selected) return res.status(400).json({ error: 'Choose a valid collection.' });
  const membership = await db.from('tournament_collection_memberships').select('tournament_id').eq('collection_id', selected.id);
  if (membership.error) throw membership.error;
  const memberIds = (membership.data || []).map(row => row.tournament_id);
  const tournaments = memberIds.length ? await db.from('tournaments').select('id,name,season,status').in('id', memberIds).order('name') : { data: [], error: null };
  if (tournaments.error) throw tournaments.error;
  const visibleTournaments = (tournaments.data || []).filter(tournament => tournament.status !== 'planning');
  const tournamentIds = visibleTournaments.map(tournament => tournament.id);
  const teams: Array<OrganizerRoundTeam & { tournament_id: string; oauth_token?: string | null; oauth_token_secret?: string | null }> = [];
  for (let offset = 0; tournamentIds.length; offset += 500) {
    const page = await db.from('teams').select('id,tournament_id,name,ht_team_id,hattrick_user_id,active,reserve_active,is_placeholder,manager_name,oauth_token,oauth_token_secret').in('tournament_id', tournamentIds).order('id').range(offset, offset + 499);
    if (page.error) throw page.error;
    teams.push(...(page.data || []).filter(row => !row.is_placeholder));
    if ((page.data || []).length < 500) break;
  }
  const slots = buildCalendarSlots(new Date(), 32, { includeWeek15WeekendFriendly: true }).filter(slot => slot.selectable && slot.kind !== 'blocked_cup_week');
  const slotId = String(req.method === 'POST' ? req.body?.slotId || '' : req.query.slotId || '');
  const slot = slots.find(item => item.id === slotId) || (!slotId ? slots.find(item => item.htWeek === 15 && item.kind === 'weekend_friendly') || slots[0] : null);
  if (!slot) return res.status(400).json({ error: 'Choose a valid calendar slot.' });
  if (req.method === 'GET') {
    const observations: Array<{ ht_team_id: number; observation: unknown }> = [];
    for (let offset = 0; ; offset += 500) {
      const page = await db.from('forge_slot_observations').select('ht_team_id,observation').eq('slot_id', slot.id).order('ht_team_id').range(offset, offset + 499);
      if (page.error) throw page.error;
      observations.push(...(page.data || []));
      if ((page.data || []).length < 500) break;
    }
    return res.status(200).json({ collections: collections.data, selectedCollection: selected.id, tournaments: visibleTournaments,
      teams: teams.map(({ oauth_token: _token, oauth_token_secret: _secret, ...team }) => team), slots, selectedSlot: slot.id, observations: observations.filter(row => teams.some(team => team.ht_team_id === row.ht_team_id)), batchSize: PLANNING_BATCH_SIZE });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const ids: unknown = req.body?.teamIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > PLANNING_BATCH_SIZE || new Set(ids).size !== ids.length || ids.some(id => !Number.isSafeInteger(id) || !teams.some(team => team.ht_team_id === id))) return res.status(400).json({ error: 'Choose a valid small batch of teams.' });
  const fallbackTeam = teams.find(team => team.oauth_token && team.oauth_token_secret);
  const fallback = fallbackTeam ? { oauth_token: fallbackTeam.oauth_token!, oauth_token_secret: fallbackTeam.oauth_token_secret! } : null;
  const teamIds = new Set(teams.map(team => Number(team.ht_team_id)).filter(Boolean));
  const results = await Promise.all(ids.map(async (id: number) => {
    const team = teams.find(row => row.ht_team_id === id)!;
    const observation = await checkSlot(db, team, slot, teamIds, { fallback, includeOccupiedChallenges: true });
    const saved = await db.from('forge_slot_observations').upsert({ slot_id: slot.id, ht_team_id: id, checked_at: observation.checkedAt, observation }, { onConflict: 'slot_id,ht_team_id' });
    if (saved.error) throw saved.error;
    return { ht_team_id: id, observation };
  }));
  return res.status(200).json({ results });
}
