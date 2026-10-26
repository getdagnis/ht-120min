import { parseTeamDetailsXml, type ChppTeamOption } from './chpp-xml.js';
import type { getServiceSupabase } from './supabase.js';
import { normalizeFlagCountries, resolveFlagCountryId } from '../../../../shared/flag-hunters.js';

const positiveId = (value: unknown) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

/** Reuse parsed LeagueIDs but do not mistake an omitted Flags element for an empty collection. */
export function parseFlagHunterDetails(xml: string, htTeamId: number) {
  if (/<ErrorCode>\s*[1-9]\d*\s*<\/ErrorCode>/i.test(xml)) throw new Error('Hattrick returned an error while retrieving flags.');
  const blocks = [...xml.matchAll(/<Team>([\s\S]*?)<\/Team>/gi)].map(match => match[1]);
  const block = blocks.find(item => Number(item.match(/<TeamID>\s*(\d+)\s*<\/TeamID>/i)?.[1]) === htTeamId);
  if (!block) throw new Error('Hattrick did not return the requested team.');
  const flags = block.match(/<Flags>([\s\S]*?)<\/Flags>/i)?.[1];
  if (flags === undefined || !/<HomeFlags(?:\s*\/\s*>|>[\s\S]*?<\/HomeFlags>)/i.test(flags)
    || !/<AwayFlags(?:\s*\/\s*>|>[\s\S]*?<\/AwayFlags>)/i.test(flags)) {
    throw new Error('Hattrick omitted the flag collections; they remain unknown.');
  }
  const parsed = parseTeamDetailsXml(xml, htTeamId);
  const leagueId = positiveId(parsed.leagueId);
  if (!leagueId) throw new Error('Hattrick omitted the team LeagueID.');
  const countryId = positiveId(parsed.countryId);
  const home = normalizeFlagCountries(parsed.homeFlagLeagueIds), away = normalizeFlagCountries(parsed.awayFlagLeagueIds);
  return { leagueId, countryId, genderId: positiveId(parsed.genderId), flagCountryId: resolveFlagCountryId(countryId),
    home: home.ids, away: away.ids, homeUnknown: home.unknown, awayUnknown: away.unknown };
}

/** Merge only this team's flag fields without losing another club's update. */
export async function persistTeamFlagSnapshot(db: ReturnType<typeof getServiceSupabase>, managerId: number, teamId: number,
  patch: { homeFlagLeagueIds: number[]; awayFlagLeagueIds: number[]; homeFlagsUnknown: boolean; awayFlagsUnknown: boolean;
    flagsFetchedAt: string; leagueId?: number; countryId?: number | null }, missingTeam?: ChppTeamOption) {
  const { data, error } = await db.rpc('save_team_flag_snapshot', {
    p_manager_id: managerId, p_team_id: teamId, p_patch: patch, p_missing_team: missingTeam || null,
  });
  if (error || data !== true) throw new Error('Could not save flag data. Reload and retry this team.');
}

