import approvedOpening from './approved-around-the-world-opening.json' with { type: 'json' };
import { buildLengthScheduleDraft, type LengthSchedulePairing } from '../../../utils/length-schedule.js';

export interface FlagScheduleParticipant {
  id: string;
  name: string;
  ht_team_id: number | null;
  hattrick_user_id: number | null;
  country_id: number | null;
  country_name: string | null;
  league_id: number | null;
  gender_id: number | null;
}
/** Temporary organizer-approved CSV opener; the existing planner owns settings and dates. */
export function buildFlagHuntersLengthScheduleDraft(
  input: Parameters<typeof buildLengthScheduleDraft>[0],
  participants: FlagScheduleParticipant[],
) {
  const standard = buildLengthScheduleDraft(input);
  if (!standard.valid) return standard;
  const activeIds = new Set(standard.teams.map(team => team.id));
  const roster = participants.filter(team => activeIds.has(team.id));
  const ids = new Map<number, FlagScheduleParticipant>();
  for (const team of roster) {
    if (!Number.isSafeInteger(team.ht_team_id) || Number(team.ht_team_id) <= 0
      || !Number.isSafeInteger(team.hattrick_user_id) || Number(team.hattrick_user_id) <= 0) {
      throw new Error(`Approved opener requires valid Hattrick team and manager IDs: ${team.name} (${team.id}).`);
    }
    if (ids.has(team.ht_team_id!)) throw new Error(`Duplicate Hattrick team ID in current roster: ${team.ht_team_id}.`);
    ids.set(team.ht_team_id!, team);
  }
  if (roster.length !== standard.teamCount || new Set(roster.map(team => team.id)).size !== roster.length) {
    throw new Error('Approved opener requires exactly one current participant record per scheduled team.');
  }
  const approvedIds = new Set<number>();
  if (approvedOpening.length !== 73) throw new Error('Approved opener must contain exactly 73 matches.');
  for (const pair of approvedOpening) for (const id of [pair.homeTeamId, pair.awayTeamId]) {
    if (!Number.isSafeInteger(id) || id <= 0 || approvedIds.has(id)) {
      throw new Error(`Invalid or repeated Hattrick team ID in approved opener: ${id}.`);
    }
    approvedIds.add(id);
  }
  const added = roster.filter(team => !approvedIds.has(team.ht_team_id!)).map(team => `${team.name} (${team.ht_team_id})`);
  const removed = approvedOpening.flatMap(pair => [
    { id: pair.homeTeamId, name: pair.homeTeam }, { id: pair.awayTeamId, name: pair.awayTeam },
  ]).filter(team => !ids.has(team.id)).map(team => `${team.name} (${team.id})`);
  if (added.length || removed.length) {
    throw new Error(`Roster differs from approved opener. Added: ${added.join(', ') || 'none'}. Removed: ${removed.join(', ') || 'none'}.`);
  }
  const openingPairings: LengthSchedulePairing[] = approvedOpening.map(pair => {
    const home = ids.get(pair.homeTeamId)!;
    const away = ids.get(pair.awayTeamId)!;
    if (home.hattrick_user_id === away.hattrick_user_id) {
      throw new Error(`Approved opener has a same-manager match: ${home.name} (${pair.homeTeamId}) vs ${away.name} (${pair.awayTeamId}).`);
    }
    return { homeTeamId: home.id, awayTeamId: away.id, isBye: false };
  });
  return buildLengthScheduleDraft({ ...input, openingPairings });
}
