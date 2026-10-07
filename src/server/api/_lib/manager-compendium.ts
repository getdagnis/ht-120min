import { getAuthHeader } from './chpp-auth.js';
import {
  parseManagerCompendiumXml,
  parseTeamPlayerSpecialtiesXml,
  parseManagerNationalTeamRolesXml,
  parseManagerTeamDetailsXml,
  type ChppTeamOption,
  type ParsedManagerCompendium,
  type ParsedNationalTeamStaffRole,
  type ParsedTeamDetails,
} from './chpp-xml.js';

export const MANAGER_COMPENDIUM_VERSION = '1.7';

export interface ManagerCompendiumCredentials {
  oauth_token: string;
  oauth_token_secret: string;
}

export class ManagerCompendiumRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseBody: string,
  ) {
    super(`CHPP managercompendium failed (${status})`);
    this.name = 'ManagerCompendiumRequestError';
  }
}

export function mergeManagerTeamSnapshot(
  currentTeams: ChppTeamOption[],
  details: ParsedTeamDetails[],
  previousTeams: ChppTeamOption[] = [],
): ChppTeamOption[] {
  const detailsById = new Map(details.map((team) => [team.teamId, team]));
  const previousById = new Map(previousTeams.map((team) => [team.teamId, team]));
  return currentTeams.map((team) => {
    const detail = detailsById.get(team.teamId);
    const previous = previousById.get(team.teamId);
    return {
      ...previous,
      ...team,
      isPrimaryClub: detail?.isPrimaryClub ?? team.isPrimaryClub ?? previous?.isPrimaryClub,
      genderId: detail?.genderId ?? team.genderId ?? previous?.genderId,
      logoUrl: detail?.logoUrl ?? team.logoUrl ?? previous?.logoUrl,
      foundedDate: detail?.foundedDate ?? team.foundedDate ?? previous?.foundedDate,
      regionId: detail?.regionId ?? previous?.regionId,
      regionName: detail?.regionName ?? team.regionName ?? previous?.regionName,
      leagueId: detail?.leagueId ?? team.leagueId ?? previous?.leagueId,
      leagueSystemId: detail?.leagueSystemId ?? team.leagueSystemId ?? previous?.leagueSystemId,
      leagueName: detail?.leagueName ?? team.leagueName ?? previous?.leagueName,
      leagueLevel: detail?.leagueLevel ?? team.leagueLevel ?? previous?.leagueLevel,
      leagueLevelUnitId: detail?.leagueLevelUnitId ?? previous?.leagueLevelUnitId,
      leagueLevelUnitName: detail?.leagueLevelUnitName ?? team.leagueLevelUnitName ?? previous?.leagueLevelUnitName,
      countryId: detail?.countryId ?? team.countryId ?? previous?.countryId,
      countryName: detail?.countryName ?? team.countryName ?? previous?.countryName,
      powerLeagueRank: detail?.powerLeagueRank ?? previous?.powerLeagueRank,
      teamRank: detail?.teamRank ?? previous?.teamRank,
      numberOfVictories: detail?.numberOfVictories ?? null,
      homeFlagLeagueIds: detail?.homeFlagLeagueIds ?? [],
      awayFlagLeagueIds: detail?.awayFlagLeagueIds ?? [],
      powerRating: detail?.powerRating ?? previous?.powerRating,
      powerGlobalRank: detail?.powerGlobalRank ?? previous?.powerGlobalRank,
      powerRegionRank: detail?.powerRegionRank ?? previous?.powerRegionRank,
      youthTeamName: detail?.youthTeamName ?? previous?.youthTeamName,
      arenaId: detail?.arenaId ?? previous?.arenaId,
      arenaName: detail?.arenaName ?? previous?.arenaName,
      fanclubSize: detail?.fanclubSize ?? previous?.fanclubSize,
      trophies: detail?.trophies ?? previous?.trophies ?? [],
    };
  });
}

export const MAX_SPOTLIGHT_REFRESH_MANAGERS = 25;
export const MAX_SPOTLIGHT_REFRESH_CHPP_CALLS = MAX_SPOTLIGHT_REFRESH_MANAGERS * 2;

export function getEligibleSpotlightManagerIds(participants: ReadonlyArray<{
  hattrick_user_id: number | null;
  active: boolean | null;
  reserve_active: boolean | null;
  is_placeholder: boolean | null;
}>): number[] {
  return Array.from(new Set(participants
    .filter((row) => row.active === true && row.reserve_active !== true && row.is_placeholder !== true)
    .map((row) => Number(row.hattrick_user_id))
    .filter((id) => Number.isSafeInteger(id) && id > 0))).sort((a, b) => a - b);
}

export function getSpotlightRefreshLimitError(managerCount: number): string | null {
  return managerCount > MAX_SPOTLIGHT_REFRESH_MANAGERS
    ? `This tournament has ${managerCount} eligible managers and exceeds the ${MAX_SPOTLIGHT_REFRESH_MANAGERS}-manager / ${MAX_SPOTLIGHT_REFRESH_CHPP_CALLS}-CHPP-call limit. No profiles were refreshed.`
    : null;
}

export interface ManagerTeamDetailsSnapshot {
  teams: ParsedTeamDetails[];
  nationalTeamRoles: ParsedNationalTeamStaffRole[];
}

export async function fetchManagerTeamsFromChpp(
  consumerKey: string,
  consumerSecret: string,
  credentials: ManagerCompendiumCredentials,
  managerId?: number | string,
): Promise<ParsedManagerCompendium> {
  const xml = await fetchManagerCompendiumXml(consumerKey, consumerSecret, credentials, managerId);
  const parsed = parseManagerCompendiumXml(xml);
  return {
    ...parsed,
    teams: parsed.teams ?? [],
  };
}

export async function fetchOwnedTeamPlayerSpecialtiesFromChpp(
  consumerKey: string,
  consumerSecret: string,
  credentials: ManagerCompendiumCredentials,
  teamId: number,
): Promise<Map<number, number>> {
  const url = 'https://chpp.hattrick.org/chppxml.ashx';
  const params = { file: 'players', version: '2.8', actionType: 'view', teamID: String(teamId) };
  const authHeader = getAuthHeader(
    'GET', url, params, consumerKey, consumerSecret,
    credentials.oauth_token, credentials.oauth_token_secret,
  );
  const response = await fetch(`${url}?${new URLSearchParams(params)}`, { headers: { Authorization: authHeader } });
  const xml = await response.text();
  const errorCode = Number(xml.match(/<ErrorCode>\s*(\d+)\s*<\/ErrorCode>/i)?.[1] ?? 0);
  if (!response.ok || errorCode > 0) throw new Error(`CHPP players failed (${response.status}, ${errorCode}).`);
  const specialties = parseTeamPlayerSpecialtiesXml(xml, teamId);
  if (specialties.size === 0) throw new Error('CHPP players returned no roster for the requested team.');
  return specialties;
}

async function fetchManagerCompendiumXml(
  consumerKey: string,
  consumerSecret: string,
  credentials: ManagerCompendiumCredentials,
  managerId?: number | string,
): Promise<string> {
  const url = 'https://chpp.hattrick.org/chppxml.ashx';
  const params: Record<string, string> = {
    file: 'managercompendium',
    version: MANAGER_COMPENDIUM_VERSION,
  };
  if (managerId) {
    params.userID = String(managerId);
  }

  const authHeader = getAuthHeader(
    'GET',
    url,
    params,
    consumerKey,
    consumerSecret,
    credentials.oauth_token,
    credentials.oauth_token_secret,
  );

  const query = new URLSearchParams(params);
  const response = await fetch(`${url}?${query.toString()}`, {
    headers: { Authorization: authHeader },
  });
  const xml = await response.text();

  if (!response.ok) {
    throw new ManagerCompendiumRequestError(response.status, xml);
  }
  return xml;
}

export async function fetchManagerTeamDetailsFromChpp(
  consumerKey: string,
  consumerSecret: string,
  credentials: ManagerCompendiumCredentials,
): Promise<ManagerTeamDetailsSnapshot> {
  const url = 'https://chpp.hattrick.org/chppxml.ashx';
  const params = { file: 'teamdetails', version: '3.9' };
  const authHeader = getAuthHeader(
    'GET', url, params, consumerKey, consumerSecret,
    credentials.oauth_token, credentials.oauth_token_secret,
  );
  const response = await fetch(`${url}?${new URLSearchParams(params)}`, {
    headers: { Authorization: authHeader },
  });
  const xml = await response.text();
  if (!response.ok) throw new Error(`CHPP teamdetails failed (${response.status})`);
  const errorCode = Number(xml.match(/<ErrorCode>\s*(\d+)\s*<\/ErrorCode>/i)?.[1] ?? 0);
  if (errorCode > 0) throw new Error(`CHPP teamdetails returned error code ${errorCode}`);
  const teams = parseManagerTeamDetailsXml(xml);
  if (teams.length === 0) throw new Error('CHPP manager-wide teamdetails returned no team records.');
  return {
    teams,
    nationalTeamRoles: parseManagerNationalTeamRolesXml(xml),
  };
}
