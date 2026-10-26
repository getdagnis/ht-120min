import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase } from './supabase.js';
import { buildCalendarSlots, getScheduledDateForSlot } from '../../../utils/hattrick-calendar.js';
import { serializeOrganizerPairings, validateOrganizerPairings, type OrganizerRoundTeam, type OrganizerRoundSelection, type OrganizerRoundHistory } from '../../../utils/organizer-round.js';
import type { LengthSchedulePairing } from '../../../utils/length-schedule.js';

interface RoundContext {
  rosterVersion: string;
  teams: OrganizerRoundTeam[];
  rounds: Array<{ id: string; phase: string; phase_status: string; reserved_slot_id: string | null; reserved_slot_date: string | null }>;
  history: OrganizerRoundHistory[];
}
export async function handleOrganizerRound(req: VercelRequest, res: VercelResponse, tournamentId: string, canOverride: boolean) {
  const db = getServiceSupabase();
  const { data: tournament, error: tournamentError } = await db.from('tournaments').select('season,schedule_mode,schedule_generated_at').eq('id', tournamentId).maybeSingle();
  if (tournamentError) throw tournamentError;
  if (!tournament || tournament.schedule_mode !== 'length' || !tournament.schedule_generated_at) return res.status(409).json({ error: 'Choose a generated staged season.' });
  const seasonNumber = tournament.season || 1;
  const { data, error } = await db.rpc('get_organizer_round_context', { p_tournament_id: tournamentId, p_season_number: seasonNumber });
  if (error) throw error;
  const context = data as RoundContext;
  const now = new Date();
  const seasonMatch = context.rounds.find(round => round.reserved_slot_id)?.reserved_slot_id?.match(/^S(\d+)-/);
  const htSeason = seasonMatch ? Number(seasonMatch[1]) : null;
  const slots = buildCalendarSlots(now, 32, { includeWeek15WeekendFriendly: true }).filter(slot =>
    slot.selectable && slot.htSeason === htSeason && context.teams.some(team => !team.is_placeholder &&
      (getScheduledDateForSlot(slot, { countryName: team.country_name, leagueLevel: team.league_level })?.getTime() ?? 0) > now.getTime()) &&
    !context.rounds.some(round => round.reserved_slot_id === slot.id) &&
    !context.rounds.some(round => round.phase === 'postseason' && (round.phase_status !== 'pending' || !round.reserved_slot_date || new Date(round.reserved_slot_date).getTime() <= slot.nominalDate.getTime())),
  );
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json({ ...context, slots });
  const { slotId, roster, pairings, rosterVersion } = req.body || {};
  const slot = slots.find(candidate => candidate.id === slotId);
  if (!slot || typeof rosterVersion !== 'string' || !Array.isArray(roster) || !Array.isArray(pairings) || roster.length > context.teams.length || pairings.length > context.teams.length ||
      roster.some(row => !row || typeof row.teamId !== 'string' || typeof row.participation !== 'string') ||
      pairings.some(pair => !pair || ![pair.homeTeamId, pair.awayTeamId].every(value => value === null || typeof value === 'string'))) {
    return res.status(400).json({ error: 'Invalid calendar slot, roster, or pairings.' });
  }
  const selections = roster as OrganizerRoundSelection[];
  const pairs = pairings as LengthSchedulePairing[];
  const validation = validateOrganizerPairings(selections, pairs, context.teams);
  if (validation) return res.status(400).json({ error: validation });
  const selected = selections.map(row => context.teams.find(team => team.id === row.teamId));
  if (selected.some(team => !team || team.is_placeholder)) return res.status(400).json({ error: 'Choose existing tournament teams.' });
  const matches = serializeOrganizerPairings(slot, pairs, selected as OrganizerRoundTeam[]);
  if (matches.some(match => new Date(match.scheduled_for).getTime() <= now.getTime())) return res.status(409).json({ error: 'A selected team’s planned kickoff has already passed.' });
  const saved = await db.rpc('create_organizer_regular_round', {
    p_tournament_id: tournamentId, p_season_number: seasonNumber, p_roster_version: rosterVersion,
    p_slot: { id: slot.id, kind: slot.kind, date: slot.nominalDate.toISOString() }, p_roster: selections,
    p_matches: matches, p_override: canOverride,
  });
  if (saved.error) return res.status(409).json({ error: saved.error.message });
  return res.status(200).json(saved.data);
}
