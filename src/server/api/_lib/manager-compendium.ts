import { getAuthHeader } from './chpp-auth.js';
import { parseManagerCompendiumXml, type ParsedManagerCompendium } from './chpp-xml.js';

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
