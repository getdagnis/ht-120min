import { normalizeFlagCountries, resolveFlagCountryId, type FlagCollection, type FlagHunterTeam } from '../../../../shared/flag-hunters.js';
import { createScarcityDraft } from '../../../../shared/flag-pairing.js';
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
export interface FlagScheduleProfile {
  hattrick_user_id: number;
  teams_json: unknown;
}

/** The existing planner owns every setting and validation; only its opener is supplied. */
export function buildFlagHuntersLengthScheduleDraft(
  input: Parameters<typeof buildLengthScheduleDraft>[0],
  participants: FlagScheduleParticipant[],
  profiles: FlagScheduleProfile[],
) {
  const standard = buildLengthScheduleDraft(input);
  if (!standard.valid) return standard;
  const activeIds = new Set(standard.teams.map(team => team.id));
  const roster: FlagHunterTeam[] = participants.filter(team => activeIds.has(team.id)).map(team => ({
    id: team.id, name: team.name, htTeamId: Number(team.ht_team_id),
    managerId: team.hattrick_user_id, managerName: null, managerCountryId: null,
    countryId: team.country_id, countryName: team.country_name,
    leagueId: team.league_id, genderId: team.gender_id,
    flagCountryId: resolveFlagCountryId(team.country_id),
  }));
  if (roster.length !== standard.teamCount || roster.some(team => !Number.isSafeInteger(team.htTeamId) || team.htTeamId <= 0)) {
    throw new Error('Flag Hunters requires a Hattrick identity for every active participant.');
  }
  const byManager = new Map(profiles.map(profile => [profile.hattrick_user_id, profile.teams_json]));
  const flags: Record<string, FlagCollection> = {};
  for (const team of roster) {
    const records = byManager.get(team.managerId!);
    const record = Array.isArray(records) ? records.find(value => Number(value?.teamId) === team.htTeamId) : null;
    if (!record || record.leagueId !== team.leagueId || record.countryId !== team.countryId
      || !Number.isFinite(Date.parse(record.flagsFetchedAt))
      || !Array.isArray(record.homeFlagLeagueIds) || !Array.isArray(record.awayFlagLeagueIds)
      || !record.homeFlagLeagueIds.every(Number.isSafeInteger) || !record.awayFlagLeagueIds.every(Number.isSafeInteger)) continue;
    const home = normalizeFlagCountries(record.homeFlagLeagueIds);
    const away = normalizeFlagCountries(record.awayFlagLeagueIds);
    flags[String(team.htTeamId)] = { htTeamId: team.htTeamId, managerId: team.managerId,
      leagueId: team.leagueId, home: home.ids, away: away.ids,
      homeUnknown: home.unknown, awayUnknown: away.unknown, fetchedAt: record.flagsFetchedAt };
  }
  const selected = createScarcityDraft(roster, flags, 'round-one');
  if (selected.unresolvedIds.length) throw new Error('The active roster cannot be fully paired without same-manager or eligibility conflicts.');
  const ids = new Map(roster.map(team => [team.htTeamId, team.id]));
  const openingPairings: LengthSchedulePairing[] = selected.pairs.map(pair => ({
    homeTeamId: ids.get(pair.homeId)!, awayTeamId: ids.get(pair.awayId)!, isBye: false,
  }));
  if (selected.byeId !== null) openingPairings.push({ homeTeamId: ids.get(selected.byeId)!, awayTeamId: null, isBye: true });
  return buildLengthScheduleDraft({ ...input, openingPairings });
}
