import type { SupabaseClient } from '@supabase/supabase-js';
import { createScarcityDraft } from '../../../../shared/flag-pairing.js';
import { flagRoster, latestCompletedFriendlyWindowEnd } from '../../../../shared/organizer-planning.js';
import type { PairingPreference } from '../../../../shared/pairing-preferences.js';
import type { LengthScheduleDraft, LengthSchedulePairing } from '../../../utils/length-schedule.js';
import type { OrganizerRoundTeam } from '../../../utils/organizer-round.js';
import type { ChppTeamOption } from './chpp-xml.js';
import { cachedCollection } from './organizer-planning.js';

/** Uses saved, current snapshots only; schedule generation never fetches CHPP flags. */
export async function futureFlagOpening(db: SupabaseClient, tournamentId: string, draft: LengthScheduleDraft,
  teams: OrganizerRoundTeam[], preferences: Record<string, PairingPreference>): Promise<LengthSchedulePairing[] | null> {
  if (!draft.valid || !draft.selectedStartSlot) return null;
  const included = teams.filter(team => draft.teams.some(row => row.id === team.id));
  const managers = [...new Set(included.map(team => team.hattrick_user_id).filter((id): id is number => Boolean(id)))];
  if (!managers.length) return null;
  const profiles = await db.from('profiles').select('hattrick_user_id,teams_json').in('hattrick_user_id', managers);
  if (profiles.error) throw profiles.error;
  const boundary = latestCompletedFriendlyWindowEnd(draft.selectedStartSlot, Date.now());
  const flags = Object.fromEntries(included.flatMap(team => {
    const profile = profiles.data?.find(row => row.hattrick_user_id === team.hattrick_user_id);
    const cached = (Array.isArray(profile?.teams_json) ? profile.teams_json as ChppTeamOption[] : [])
      .find(row => row.teamId === team.ht_team_id);
    const collection = cachedCollection(team, cached);
    return collection && Date.parse(collection.fetchedAt) >= boundary ? [[String(team.ht_team_id), collection]] : [];
  }));
  if (!Object.keys(flags).length) return null;
  let proposal;
  try {
    proposal = createScarcityDraft(flagRoster(included), flags,
      `${tournamentId}:${draft.selectedStartSlotId}:${draft.selectedFormat?.id}`, null, { managerFirst: true, preferences });
  } catch {
    // A partial cache or incompatible roster must not prevent ordinary generation.
    return null;
  }
  if (!proposal.analysis.priorities.some(row => row.status === 'collecting') || proposal.unresolvedIds.length) return null;
  const byHt = new Map(included.map(team => [team.ht_team_id, team.id]));
  const pairs: LengthSchedulePairing[] = proposal.pairs.map(pair => ({ homeTeamId: byHt.get(pair.homeId)!,
    awayTeamId: byHt.get(pair.awayId)!, isBye: false }));
  if (proposal.byeId) pairs.push({ homeTeamId: byHt.get(proposal.byeId)!, awayTeamId: null, isBye: true });
  return pairs.length === Math.ceil(included.length / 2) ? pairs : null;
}
