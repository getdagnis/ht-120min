export interface ChppTeamOption {
  teamId: number;
  teamName: string;
  genderId?: number;
  leagueSystemId?: number;
  leagueName?: string;
  leagueId?: number;
  leagueLevelUnitName?: string;
  regionName?: string;
  countryName?: string;
}

export interface ParsedManagerCompendium {
  hattrickUserId: number | null;
  managerName: string;
  teams: ChppTeamOption[];
}

export function readChppTag(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
  const value = match?.[1]?.trim();
  return value || undefined;
}

export function normalizeChppAssetUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return trimmed;
}

export interface ParsedTeamDetails {
  teamId: number;
  teamName?: string;
  countryName?: string;
  logoUrl?: string;
  errorCode?: number;
}

export function parseTeamDetailsXml(xml: string, teamId: number): ParsedTeamDetails {
  const errorCodeRaw = xml.match(/<ErrorCode>(\d+)<\/ErrorCode>/i)?.[1];
  if (errorCodeRaw) {
    const errorCode = parseInt(errorCodeRaw, 10);
    if (errorCode !== 0) {
      return { teamId, errorCode };
    }
  }

  const extract = (block: string): ParsedTeamDetails => {
    const logoRaw = readChppTag(block, 'LogoURL') ?? readChppTag(block, 'LogoUri');
    const dressRaw = readChppTag(block, 'DressURI');
    const logoUrl = logoRaw
      ? normalizeChppAssetUrl(logoRaw)
      : dressRaw
        ? normalizeChppAssetUrl(dressRaw)
        : undefined;

    return {
      teamId,
      teamName: readChppTag(block, 'TeamName'),
      countryName: readChppTag(block, 'CountryName'),
      logoUrl,
    };
  };

  for (const match of xml.matchAll(/<Team>([\s\S]*?)<\/Team>/gi)) {
    const block = match[1];
    const idRaw = block.match(/<TeamID>(\d+)<\/TeamID>/i)?.[1];
    if (idRaw && parseInt(idRaw, 10) === teamId) {
      return extract(block);
    }
  }

  const rootId = xml.match(/<TeamID>(\d+)<\/TeamID>/i)?.[1];
  if (rootId && parseInt(rootId, 10) === teamId) {
    return extract(xml);
  }

  return { teamId };
}

export function parseManagerCompendiumXml(xml: string): ParsedManagerCompendium {
  const userIdRaw =
    xml.match(/<UserId>(\d+)<\/UserId>/i)?.[1] ?? xml.match(/<UserID>(\d+)<\/UserID>/i)?.[1];
  const managerName = readChppTag(xml, 'Loginname') ?? 'Unknown';

  const teams: ChppTeamOption[] = [];
  for (const match of xml.matchAll(/<Team>([\s\S]*?)<\/Team>/gi)) {
    const block = match[1];
    const teamIdRaw = block.match(/<TeamId>(\d+)<\/TeamId>/i)?.[1] ?? block.match(/<TeamID>(\d+)<\/TeamID>/i)?.[1];
    if (!teamIdRaw) continue;

    const leagueIdRaw = block.match(/<LeagueId>(\d+)<\/LeagueId>/i)?.[1];
    const genderIdRaw = block.match(/<GenderID>(\d+)<\/GenderID>/i)?.[1];
    const leagueSystemIdRaw = block.match(/<LeagueSystemID>(\d+)<\/LeagueSystemID>/i)?.[1];

    teams.push({
      teamId: parseInt(teamIdRaw, 10),
      teamName: readChppTag(block, 'TeamName') ?? 'Unknown',
      genderId: genderIdRaw ? parseInt(genderIdRaw, 10) : undefined,
      leagueSystemId: leagueSystemIdRaw ? parseInt(leagueSystemIdRaw, 10) : undefined,
      leagueName: readChppTag(block, 'LeagueName'),
      leagueId: leagueIdRaw ? parseInt(leagueIdRaw, 10) : undefined,
      leagueLevelUnitName: readChppTag(block, 'LeagueLevelUnitName'),
      regionName: readChppTag(block, 'RegionName'),
      countryName: readChppTag(block, 'CountryName'),
    });
  }

  return {
    hattrickUserId: userIdRaw ? parseInt(userIdRaw, 10) : null,
    managerName,
    teams,
  };
}
