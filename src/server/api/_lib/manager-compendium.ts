import { getAuthHeader } from './chpp-auth.js';
import { parseManagerCompendiumXml, parseManagerTeamDetailsXml, type ChppTeamOption, type ParsedManagerCompendium, type ParsedTeamDetails } from './chpp-xml.js';

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
      logoUrl: detail?.logoUrl ?? team.logoUrl ?? previous?.logoUrl,
      foundedDate: detail?.foundedDate ?? team.foundedDate ?? previous?.foundedDate,
      regionName: detail?.regionName ?? team.regionName ?? previous?.regionName,
      leagueId: detail?.leagueId ?? team.leagueId ?? previous?.leagueId,
      leagueSystemId: detail?.leagueSystemId ?? team.leagueSystemId ?? previous?.leagueSystemId,
      leagueName: detail?.leagueName ?? team.leagueName ?? previous?.leagueName,
      leagueLevel: detail?.leagueLevel ?? team.leagueLevel ?? previous?.leagueLevel,
      leagueLevelUnitName: detail?.leagueLevelUnitName ?? team.leagueLevelUnitName ?? previous?.leagueLevelUnitName,
      countryId: detail?.countryId ?? team.countryId ?? previous?.countryId,
      countryName: detail?.countryName ?? team.countryName ?? previous?.countryName,
      powerLeagueRank: detail?.powerLeagueRank ?? previous?.powerLeagueRank,
      youthTeamName: detail?.youthTeamName ?? previous?.youthTeamName,
    };
  });
}

export async function fetchManagerTeamsFromChpp(
  consumerKey: string,
  consumerSecret: string,
  credentials: ManagerCompendiumCredentials,
  managerId?: number | string,
): Promise<ParsedManagerCompendium> {
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

  const parsed = parseManagerCompendiumXml(xml);
  return {
    ...parsed,
    teams: parsed.teams ?? [],
  };
}

export async function fetchManagerTeamDetailsFromChpp(
  consumerKey: string,
  consumerSecret: string,
  credentials: ManagerCompendiumCredentials,
): Promise<ParsedTeamDetails[]> {
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
  return parseManagerTeamDetailsXml(xml);
}
