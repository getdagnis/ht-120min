import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase } from './supabase.js';
import { buildCalendarSlots, getScheduledDateForSlot } from '../../../utils/hattrick-calendar.js';
import { serializeOrganizerPairings, validateOrganizerPairings, type OrganizerRoundTeam, type OrganizerRoundSelection, type OrganizerRoundHistory } from '../../../utils/organizer-round.js';
import type { LengthSchedulePairing } from '../../../utils/length-schedule.js';
import { proposalHash, startVerification, readVerification, checkSlot, cachedCollection, refreshCollection, PLANNING_BATCH_SIZE } from './organizer-planning.js';
import { validateFinalObservations, flagRoster, type SlotObservation, type PlanningRound } from '../../../../shared/organizer-planning.js';
import { canFlagTeamsPair } from '../../../../shared/flag-matching.js';
import type { ChppTeamOption } from './chpp-xml.js';

interface RoundContext {
  rosterVersion: string;
  teams: OrganizerRoundTeam[];
  rounds: Array<{ id: string; phase: string; phase_status: string; reserved_slot_id: string | null; reserved_slot_date: string | null }>;
  history: OrganizerRoundHistory[];
}
export async function handleOrganizerRound(req: VercelRequest, res: VercelResponse, tournamentId: string, canOverride: boolean, actorId: number) {
  const db = getServiceSupabase();
  const { data: tournament, error: tournamentError } = await db.from('tournaments').select('season,schedule_mode,schedule_generated_at').eq('id', tournamentId).maybeSingle();
  if (tournamentError) throw tournamentError;
  if (!tournament || tournament.schedule_mode !== 'length' || !tournament.schedule_generated_at) return res.status(409).json({ error: 'Choose a generated staged season.' });
  const seasonNumber = tournament.season || 1;
  const { data, error } = await db.rpc('get_organizer_round_context', { p_tournament_id: tournamentId, p_season_number: seasonNumber });
  if (error) throw error;
  const context = data as RoundContext;
  const existingResult = await db.from('rounds').select('id,round_number,phase_status,round_source,reserved_slot_id,reserved_slot_kind,reserved_slot_date,round_participants(team_id,participation),matches(id,home_team_id,away_team_id,completed,status,ht_match_id,scheduled_for,chpp_match_date,finished_at)')
    .eq('tournament_id', tournamentId).eq('season_number', seasonNumber).eq('round_source', 'organizer').eq('phase', 'regular');
  if (existingResult.error) throw existingResult.error;
  const existingRounds = existingResult.data as PlanningRound[];
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
  if (req.method === 'GET') {
    const repairCapability = await db.rpc('organizer_saved_repair_enabled');
    if (repairCapability.error) throw repairCapability.error;
    const managers = [...new Set(context.teams.map(team => team.hattrick_user_id).filter((id): id is number => Boolean(id)))];
    const profiles = managers.length ? await db.from('profiles').select('hattrick_user_id,teams_json').in('hattrick_user_id', managers) : { data: [], error: null };
    if (profiles.error) throw profiles.error;
    const flags = Object.fromEntries(context.teams.flatMap(team => {
      const profile = profiles.data?.find(row => row.hattrick_user_id === team.hattrick_user_id);
      const cached = (Array.isArray(profile?.teams_json) ? profile.teams_json as ChppTeamOption[] : []).find(row => row.teamId === team.ht_team_id);
      const collection = cachedCollection(team, cached);
      return collection ? [[String(team.ht_team_id), collection]] : [];
    }));
    const observations: Array<{ slot_id: string; team_id: string; observation: SlotObservation }> = [];
    for (let offset = 0; ; offset += 500) {
      const page = await db.from('tournament_slot_checks').select('slot_id,team_id,observation')
        .eq('tournament_id', tournamentId).eq('season_number', seasonNumber)
        .order('slot_id').order('team_id').range(offset, offset + 499);
      if (page.error) throw page.error;
      observations.push(...(page.data || []) as typeof observations);
      if ((page.data?.length || 0) < 500) break;
    }
    return res.status(200).json({ ...context, slots, flags, observations, existingRounds, canRepairSavedRounds: repairCapability.data === true,
      storageKey: `organizer-draft:${actorId}:${tournamentId}:${seasonNumber}`, batchSize: PLANNING_BATCH_SIZE });
  }
  const { slotId, roster, pairings, rosterVersion, action, roundId, teamIds, verification } = req.body || {};
  const target = roundId ? existingRounds.find(round => round.id === roundId && round.phase_status === 'materialized') : null;
  if (roundId && !target) return res.status(409).json({ error: 'Choose a materialized organizer-added round.' });
  const slot = target && target.reserved_slot_id === slotId ? { id: slotId, kind: target.reserved_slot_kind,
    nominalDate: new Date(target.reserved_slot_date), selectable: true } as ReturnType<typeof buildCalendarSlots>[number]
    : slots.find(candidate => candidate.id === slotId);
  if (!slot) return res.status(400).json({ error: 'Choose an available slot.' });
  const protectedPairs = target?.matches.filter(match => match.completed || match.ht_match_id ||
    ['arranged', 'ongoing', 'finished'].includes(match.status) || Boolean(match.finished_at) ||
    (match.scheduled_for && Date.parse(match.scheduled_for) <= Date.now())) || [];
  const protectedIds = new Set(protectedPairs.flatMap(match => [match.home_team_id, match.away_team_id].filter(Boolean)));
  if (action === 'check' || action === 'flags') {
    if (!Array.isArray(teamIds) || !teamIds.length || teamIds.length > PLANNING_BATCH_SIZE ||
        new Set(teamIds).size !== teamIds.length || teamIds.some(id => typeof id !== 'string' || !context.teams.some(team => team.id === id && !team.is_placeholder))) {
      return res.status(400).json({ error: 'Choose a small batch of existing teams.' });
    }
    if (action === 'flags') {
      const results = await Promise.all(teamIds.map(async (id: string) => {
        const team = context.teams.find(team => team.id === id)!;
        try { return { teamId: id, flags: await refreshCollection(db, team) }; }
        catch (cause) { return { teamId: id, error: cause instanceof Error ? cause.message : 'Flag refresh failed.' }; }
      }));
      return res.status(200).json({ results });
    }
  }
  const hash = proposalHash({ tournamentId, seasonNumber, roundId: roundId || null, slotId, rosterVersion, roster, pairings });
  let run: ReturnType<typeof readVerification> | null = null;
  if (verification) {
    try { run = readVerification(verification, hash, actorId, tournamentId, slotId); }
    catch (cause) { return res.status(409).json({ error: cause instanceof Error ? cause.message : 'Start verification again.' }); }
  }
  if (action === 'check') {
    if (run && (rosterVersion !== context.rosterVersion || !Array.isArray(roster) ||
        (teamIds as string[]).some(id => !roster.some(row => row?.teamId === id)))) {
      return res.status(409).json({ error: 'The proposal context changed. Reload and start verification again.' });
    }
    const tournamentTeamIds = new Set(context.teams.filter(team => !team.is_placeholder && team.ht_team_id).map(team => Number(team.ht_team_id)));
    const results = await Promise.all((teamIds as string[]).map(async id => {
      const team = context.teams.find(team => team.id === id)!;
      const observation = await checkSlot(db, team, slot, tournamentTeamIds);
      const saved = await db.from('tournament_slot_checks').upsert({ tournament_id: tournamentId, season_number: seasonNumber,
        slot_id: slotId, team_id: id, observation, checked_at: observation.checkedAt,
        verification_id: run?.id || null, proposal_hash: run?.hash || null, actor_id: actorId },
        { onConflict: 'tournament_id,season_number,slot_id,team_id' });
      if (saved.error) throw saved.error;
      return observation;
    }));
    return res.status(200).json({ results });
  }
  if (!slot || typeof rosterVersion !== 'string' || !Array.isArray(roster) || !Array.isArray(pairings) || roster.length > context.teams.length || pairings.length > context.teams.length ||
      roster.some(row => !row || typeof row.teamId !== 'string' || typeof row.participation !== 'string') ||
      pairings.some(pair => !pair || ![pair.homeTeamId, pair.awayTeamId].every(value => value === null || typeof value === 'string'))) {
    return res.status(400).json({ error: 'Invalid calendar slot, roster, or pairings.' });
  }
  const selections = roster as OrganizerRoundSelection[];
  const pairs = pairings as LengthSchedulePairing[];
  const validation = validateOrganizerPairings(selections, pairs, context.teams);
  if (validation) return res.status(400).json({ error: validation });
  if (rosterVersion !== context.rosterVersion) return res.status(409).json({ error: 'The roster or fixtures changed. Reload and review.' });
  if (protectedPairs.some(match => !pairs.some(pair => pair.homeTeamId === match.home_team_id && pair.awayTeamId === match.away_team_id))) {
    return res.status(409).json({ error: 'A protected fixture changed. Reload the round.' });
  }
  if (target && selections.some(row => !target.round_participants.some(previous => previous.team_id === row.teamId && previous.participation === row.participation))) {
    return res.status(400).json({ error: 'Saved-round repair cannot add participants or change admission choices.' });
  }
  const selected = selections.map(row => context.teams.find(team => team.id === row.teamId));
  if (selected.some(team => !team || team.is_placeholder)) return res.status(400).json({ error: 'Choose existing tournament teams.' });
  const rosterTeams = flagRoster(selected as OrganizerRoundTeam[]);
  if (pairs.some(pair => pair.homeTeamId && pair.awayTeamId &&
      !protectedPairs.some(match => match.home_team_id === pair.homeTeamId && match.away_team_id === pair.awayTeamId) &&
      !canFlagTeamsPair(rosterTeams.find(team => team.id === pair.homeTeamId)!, rosterTeams.find(team => team.id === pair.awayTeamId)!))) {
    return res.status(400).json({ error: 'Resolve unknown ownership, same-manager or incompatible-gender pairings.' });
  }
  if (action === 'begin-verification') return res.status(200).json({ verification: startVerification(hash, actorId, tournamentId, slotId) });
  if (action !== 'save' || !run) return res.status(400).json({ error: 'Complete final verification before saving.' });
  const observations = await db.from('tournament_slot_checks').select('team_id,observation').eq('tournament_id', tournamentId)
    .eq('season_number', seasonNumber).eq('slot_id', slotId).eq('verification_id', run.id).eq('proposal_hash', hash).eq('actor_id', actorId);
  if (observations.error) throw observations.error;
  const checks = Object.fromEntries((observations.data || []).map(row => [row.team_id, row.observation as SlotObservation]));
  const observationError = validateFinalObservations(pairs, context.teams, checks,
    protectedPairs.map(match => ({ homeTeamId: match.home_team_id, awayTeamId: match.away_team_id, isBye: !match.home_team_id || !match.away_team_id })), Boolean(target),
    target?.matches.map(match => ({ homeTeamId: match.home_team_id, awayTeamId: match.away_team_id, isBye: !match.home_team_id || !match.away_team_id })));
  if (observationError) return res.status(409).json({ error: observationError });
  const matches = pairs.map(pair => {
    const protectedMatch = protectedPairs.find(match => match.home_team_id === pair.homeTeamId && match.away_team_id === pair.awayTeamId);
    if (protectedMatch) return { home_team_id: pair.homeTeamId, away_team_id: pair.awayTeamId, scheduled_for: protectedMatch.scheduled_for };
    const [match] = serializeOrganizerPairings(slot, [pair], selected as OrganizerRoundTeam[]);
    return match;
  });
  if (matches.some(match => !protectedIds.has(match.home_team_id) && !protectedIds.has(match.away_team_id) && Date.parse(match.scheduled_for || '') <= now.getTime())) return res.status(409).json({ error: 'A selected team’s planned kickoff has already passed.' });
  const saved = await db.rpc('save_verified_organizer_round', {
    p_tournament_id: tournamentId, p_season_number: seasonNumber, p_roster_version: rosterVersion,
    p_slot: { id: slot.id, kind: slot.kind, date: slot.nominalDate.toISOString() }, p_roster: selections,
    p_matches: matches, p_override: canOverride,
    p_round_id: target?.id || null, p_verification_id: run.id, p_proposal_hash: hash, p_actor_id: actorId,
  });
  if (saved.error) return res.status(409).json({ error: saved.error.message });
  return res.status(200).json(saved.data);
}
