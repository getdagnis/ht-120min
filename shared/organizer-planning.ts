import { parseChppStockholmDate } from './chpp-dates.js';
import { getStockholmWallClock, type CalendarSlot } from '../src/utils/hattrick-calendar.js';
import { flagBenefit, resolveFlagCountryId, type FlagCollection, type FlagHunterTeam } from './flag-hunters.js';
import type { OrganizerRoundTeam } from '../src/utils/organizer-round.js';
import type { LengthSchedulePairing } from '../src/utils/length-schedule.js';

export interface SlotObservation {
  teamId: string;
  state: 'free' | 'booked' | 'blocked' | 'unknown';
  checkedAt: string;
  reason: string;
  booking?: { matchId: number; homeId: number; awayId: number; kickoff: string };
  /** Only pending challenges sent by this manager can block a new pairing. */
  pendingOpponentIds: number[];
  incomingOfferOpponentIds?: number[];
  offersDirectionKnown?: boolean;
  challengesKnown: boolean;
  flagsOngoing?: boolean;
}
export interface PlanningMatch {
  id: string; home_team_id: string | null; away_team_id: string | null;
  completed: boolean; status: string; ht_match_id: number | null;
  scheduled_for: string | null; chpp_match_date?: string | null; finished_at?: string | null;
}
export interface PlanningRound {
  id: string; round_number: number; phase_status: string; round_source: string;
  reserved_slot_id: string; reserved_slot_kind: string; reserved_slot_date: string;
  matches: PlanningMatch[];
  round_participants: Array<{ team_id: string; participation: 'round_only' | 'admit' }>;
}

/** Compare Stockholm wall clocks, including the exclusive end, across DST. */
export function slotWallWindow(slot: Pick<CalendarSlot, 'nominalDate' | 'kind'>) {
  const start = getStockholmWallClock(slot.nominalDate);
  const weekday = start.getUTCDay();
  const weekend = slot.kind === 'weekend_friendly';
  start.setUTCDate(start.getUTCDate() - ((weekday - (weekend ? 6 : 2) + 7) % 7));
  start.setUTCHours(weekend ? 0 : 12, 0, 0, 0);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 2);
  return { start: start.getTime(), end: end.getTime() };
}
export function insideSlot(date: Date, slot: Pick<CalendarSlot, 'nominalDate' | 'kind'>) {
  const wall = getStockholmWallClock(date).getTime(), window = slotWallWindow(slot);
  return wall >= window.start && wall < window.end;
}
export function previousFriendlyWindowEnd(slot: Pick<CalendarSlot, 'nominalDate' | 'kind'>): number {
  const wall = new Date(slotWallWindow(slot).start);
  // Before a weekend: Thursday noon. Before midweek: Monday midnight.
  wall.setUTCDate(wall.getUTCDate() - (slot.kind === 'weekend_friendly' ? 2 : 1));
  wall.setUTCHours(slot.kind === 'weekend_friendly' ? 12 : 0, 0, 0, 0);
  return parseChppStockholmDate(wall.toISOString().slice(0, 19))!.getTime();
}
export function latestCompletedFriendlyWindowEnd(slot: Pick<CalendarSlot, 'nominalDate' | 'kind'>, now: number): number {
  let end = previousFriendlyWindowEnd(slot);
  while (end > now) {
    const wall = getStockholmWallClock(new Date(end));
    wall.setUTCDate(wall.getUTCDate() - 7);
    end = parseChppStockholmDate(wall.toISOString().slice(0, 19))!.getTime();
  }
  return end;
}
export function flagRoster(teams: OrganizerRoundTeam[]): FlagHunterTeam[] {
  return teams.map(team => ({ id: team.id, htTeamId: Number(team.ht_team_id), name: team.name,
    managerId: team.hattrick_user_id || null, managerName: team.manager_name || null,
    countryName: team.country_name || null, countryId: team.country_id || null,
    flagCountryId: resolveFlagCountryId(team.country_id || null), leagueId: team.league_id || null,
    genderId: team.gender_id, managerCountryId: null }));
}
export function pairIsBooked(pair: LengthSchedulePairing, teams: OrganizerRoundTeam[], checks: Record<string, SlotObservation>) {
  const home = teams.find(team => team.id === pair.homeTeamId), away = teams.find(team => team.id === pair.awayTeamId);
  if (!home || !away) return false;
  return [checks[home.id], checks[away.id]].some(check => check?.state === 'booked'
    && check.booking?.homeId === home.ht_team_id && check.booking?.awayId === away.ht_team_id);
}
export function pairKey(pair: LengthSchedulePairing) { return `${pair.homeTeamId || ''}:${pair.awayTeamId || ''}`; }
export function validateFinalObservations(pairs: LengthSchedulePairing[], teams: OrganizerRoundTeam[],
  checks: Record<string, SlotObservation>, protectedPairs: LengthSchedulePairing[], savedRound: boolean,
  unchangedPairs: LengthSchedulePairing[] = []): string | null {
  for (const pair of pairs) {
    const ids = [pair.homeTeamId, pair.awayTeamId].filter((id): id is string => Boolean(id));
    if (ids.some(id => !checks[id])) return 'Final verification is incomplete. Retry the missing batches.';
    if (protectedPairs.some(row => pairKey(row) === pairKey(pair))) continue;
    const homeHt = teams.find(team => team.id === pair.homeTeamId)?.ht_team_id;
    const awayHt = teams.find(team => team.id === pair.awayTeamId)?.ht_team_id;
    for (const id of ids) {
      const check = checks[id];
      if (check.state === 'booked' && check.booking?.homeId === homeHt && check.booking?.awayId === awayHt) {
        if (savedRound) return 'A new booking was found. Refresh tournament fixtures, then reload this round.';
      } else if (check.state !== 'free') return 'Availability changed or is unknown. Review and repair the proposal.';
      else if (!check.challengesKnown || (check.pendingOpponentIds.length &&
          !(unchangedPairs.some(row => pairKey(row) === pairKey(pair)) && check.pendingOpponentIds.every(opponent => opponent === (id === pair.homeTeamId ? awayHt : homeHt))))) {
        return 'Resolve outgoing challenges or retry failed challenge checks before saving changed or new fixtures.';
      }
    }
  }
  return null;
}
export function pairingBenefits(pair: LengthSchedulePairing, teams: OrganizerRoundTeam[], flags: Record<string, FlagCollection>) {
  const roster = flagRoster(teams), home = roster.find(team => team.id === pair.homeTeamId), away = roster.find(team => team.id === pair.awayTeamId);
  return home && away ? {
    home: flagBenefit(home, away, 'home', flags), away: flagBenefit(away, home, 'away', flags),
    homeCountry: away.countryName, awayCountry: home.countryName,
  } : null;
}

export function exportPairingCsv(pairs: LengthSchedulePairing[], teams: OrganizerRoundTeam[], details: {
  flags?: Record<string, FlagCollection>;
  checks?: Record<string, SlotObservation>;
  kickoffs?: Array<string | null | undefined>;
} = {}) {
  const sideColumns = (side: 'home' | 'away') => [
    `${side}_team_id`, `${side}_team_name`, `${side}_country_id`, `${side}_country_name`, `${side}_flag_country_id`,
    `${side}_manager_ht_id`, `${side}_manager_name`, `${side}_team_rank`, `${side}_power_rating`,
    `${side}_saved_home_flag_country_ids`, `${side}_saved_away_flag_country_ids`, `${side}_flags_fetched_at`,
    `${side}_home_flags_unknown`, `${side}_away_flags_unknown`, `${side}_availability_state`,
    `${side}_availability_checked_at`, `${side}_availability_reason`,
    `${side}_outgoing_challenge_opponent_ids`, `${side}_incoming_offer_opponent_ids`, `${side}_expected_flag_gain`,
  ];
  const columns = ['home_ht_team_id', 'away_ht_team_id', 'scheduled_for', ...sideColumns('home'), ...sideColumns('away')];
  const cell = (value: string | number | boolean | null | undefined) => {
    if (value === null || value === undefined) return '';
    const plain = String(value).replace(/[\r\n]+/g, ' ');
    const safe = typeof value === 'string' && /^[=+\-@\t]/.test(plain) ? `'${plain}` : plain;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const sideValues = (id: string | null, gain: string | undefined) => {
    const team = teams.find(row => row.id === id);
    if (!team) return Array(sideColumns('home').length).fill(null) as Array<string | number | boolean | null>;
    const flags = details.flags?.[String(team.ht_team_id)], check = details.checks?.[team.id];
    return [team.id, team.name, team.country_id, team.country_name, resolveFlagCountryId(team.country_id || null),
      team.hattrick_user_id, team.manager_name,
      team.team_rank, team.power_rating, flags?.home.join(';'), flags?.away.join(';'), flags?.fetchedAt,
      flags?.homeUnknown, flags?.awayUnknown, check?.state, check?.checkedAt, check?.reason,
      check?.pendingOpponentIds.join(';'), check?.incomingOfferOpponentIds?.join(';'), gain];
  };
  const rows = pairs.map((pair, index) => {
    const home = teams.find(team => team.id === pair.homeTeamId), away = teams.find(team => team.id === pair.awayTeamId);
    const benefits = pairingBenefits(pair, teams, details.flags || {});
    return [String(home?.ht_team_id || ''), String(away?.ht_team_id || ''),
      ...[details.kickoffs?.[index], ...sideValues(pair.homeTeamId, benefits?.home),
        ...sideValues(pair.awayTeamId, benefits?.away)].map(cell)].join(',');
  });
  return `\uFEFF${[columns.join(','), ...rows].join('\r\n')}\r\n`;
}
export function importPairingCsv(csv: string, teams: OrganizerRoundTeam[]): LengthSchedulePairing[] {
  if (csv.length > 1_000_000) throw new Error('CSV is too large.');
  const lines = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const header = lines.shift()?.trim();
  if (header !== 'home_ht_team_id,away_ht_team_id' && !header?.startsWith('home_ht_team_id,away_ht_team_id,')) {
    throw new Error('Start with home_ht_team_id,away_ht_team_id columns. Empty cells mean BYE.');
  }
  return lines.filter(line => line.trim()).map(line => {
    const cells = line.split(',', 3).slice(0, 2).map(value => value.trim().replace(/^"(\d*)"$/, '$1'));
    if (cells.length !== 2 || cells.some(value => !/^\d*$/.test(value))) throw new Error('Each row needs two Hattrick team ID columns.');
    const resolve = (value: string) => {
      if (!value) return null;
      const team = /^\d+$/.test(value) && teams.find(team => team.ht_team_id === Number(value));
      if (!team) throw new Error(`Unknown or unselected Hattrick team: ${value}.`);
      return team.id;
    };
    const homeTeamId = resolve(cells[0]), awayTeamId = resolve(cells[1]);
    return { homeTeamId, awayTeamId, isBye: !homeTeamId || !awayTeamId };
  });
}
