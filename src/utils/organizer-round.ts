import { generateBalancedRound, type LengthSchedulePairing, type PairingHistory } from './length-schedule.js';
import { getScheduledDateForSlot, type CalendarSlot } from './hattrick-calendar.js';

export type RoundParticipation = 'round_only' | 'admit';
export interface OrganizerRoundTeam {
  id: string; name: string; ht_team_id?: number | null; active: boolean; reserve_active: boolean; is_placeholder?: boolean;
  country_name?: string | null; league_level?: number | null; team_rank?: number | null;
  power_rating?: number | null; lobby_status?: string;
  hattrick_user_id?: number | null; manager_name?: string | null;
  country_id?: number | null; league_id?: number | null; gender_id?: number | null;
}
export interface OrganizerRoundSelection { teamId: string; participation: RoundParticipation }
export interface OrganizerRoundHistory {
  round_id?: string;
  home_team_id: string | null; away_team_id: string | null; completed: boolean;
  status: string | null; schedule_resolution?: string; scheduled_for?: string | null;
}

export function roundPairingHistory(matches: OrganizerRoundHistory[]): PairingHistory {
  const history: Required<Pick<PairingHistory, 'playedPairs' | 'homeCounts' | 'byeCounts'>> = { playedPairs: [], homeCounts: {}, byeCounts: {} };
  for (const match of matches) {
    if (match.schedule_resolution === 'finalized_unplayed' || (!match.completed && match.status !== 'finished')) continue;
    const { home_team_id: home, away_team_id: away } = match;
    if (home && away) {
      history.playedPairs.push([home, away]);
      history.homeCounts[home] = (history.homeCounts[home] || 0) + 1;
    } else if (home || away) {
      const id = (home || away)!;
      history.byeCounts[id] = (history.byeCounts[id] || 0) + 1;
    }
  }
  return { ...history, boundedCandidates: true, balanceRepeats: true };
}

export function generateOrganizerPairings(teams: OrganizerRoundTeam[], history: OrganizerRoundHistory[]) {
  return generateBalancedRound(teams.map(team => ({
    id: team.id, name: team.name, teamRank: team.team_rank ?? null, powerRating: team.power_rating,
    countryName: team.country_name, leagueLevel: team.league_level,
  })), roundPairingHistory(history));
}

export function validateOrganizerPairings(selections: OrganizerRoundSelection[], pairs: LengthSchedulePairing[], teams: OrganizerRoundTeam[] = []) {
  const actualIds = teams.filter(team => selections.some(row => row.teamId === team.id) && Number(team.ht_team_id) > 0).map(team => Number(team.ht_team_id));
  if (new Set(actualIds).size !== actualIds.length) return 'Choose each Hattrick club once; this roster contains multiple registrations of the same club.';
  if (selections.length < 2 || new Set(selections.map(row => row.teamId)).size !== selections.length) return 'Choose at least two distinct teams.';
  if (selections.some(row => !['round_only', 'admit'].includes(row.participation))) return 'Invalid participation choice.';
  const selected = new Set(selections.map(row => row.teamId));
  const seen = new Set<string>();
  for (const pair of pairs) {
    const ids = [pair.homeTeamId, pair.awayTeamId].filter((id): id is string => Boolean(id));
    if (!ids.length) return 'Remove empty fixtures.';
    for (const id of ids) {
      if (!selected.has(id)) return 'Every fixture team must belong to the selected roster.';
      if (seen.has(id)) return 'A team can appear only once in this round.';
      seen.add(id);
    }
  }
  return seen.size === selected.size ? null : 'Every selected team needs a fixture or a BYE.';
}

export function serializeOrganizerPairings(slot: CalendarSlot, pairs: LengthSchedulePairing[], teams: OrganizerRoundTeam[]) {
  return pairs.map(pair => {
    const home = teams.find(team => team.id === (pair.homeTeamId || pair.awayTeamId));
    const kickoff = home && getScheduledDateForSlot(slot, { countryName: home.country_name, leagueLevel: home.league_level });
    if (!kickoff || !Number.isFinite(kickoff.getTime())) {
      throw new Error(`Could not calculate the planned kickoff for ${home?.name || 'an unknown team'}.`);
    }
    return { home_team_id: pair.homeTeamId, away_team_id: pair.awayTeamId, scheduled_for: kickoff.toISOString() };
  });
}

export function additionalRoundParticipantIds(rounds: Array<{ round_source?: string; round_participants?: Array<{ team_id: string }> }>): Set<string> {
  return new Set(rounds.filter(round => round.round_source === 'organizer').flatMap(round => (round.round_participants || []).map(row => row.team_id)));
}

// Reserved round numbers belong to the frozen pairing plan. Display extra rounds
// by calendar date without renumbering that plan or existing fixture identities.
export function orderFixtureRounds<T extends { round_number: number; round_source?: string; reserved_slot_date?: string | null }>(rounds: T[]): T[] {
  if (!rounds.some(round => round.round_source === 'organizer')) return rounds;
  return [...rounds].sort((a, b) => {
    const first = a.reserved_slot_date ? new Date(a.reserved_slot_date).getTime() : NaN;
    const second = b.reserved_slot_date ? new Date(b.reserved_slot_date).getTime() : NaN;
    return Number.isFinite(first) && Number.isFinite(second) ? first - second || a.round_number - b.round_number : a.round_number - b.round_number;
  });
}

export function isExplicitRoundParticipant(round: { round_source?: string; round_participants?: Array<{ team_id: string }> }, teamId: string) {
  return round.round_source === 'organizer' && Boolean(round.round_participants?.some(row => row.team_id === teamId));
}
