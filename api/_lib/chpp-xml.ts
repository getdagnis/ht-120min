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

export interface AvatarLayer {
  x?: number;
  y?: number;
  image: string;
}

export interface Avatar {
  backgroundImage: string;
  layers: AvatarLayer[];
}

export interface ParsedManagerCompendium {
  hattrickUserId: number | null;
  managerName: string;
  countryId?: number;
  countryName?: string;
  avatar?: Avatar;
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
  if (trimmed && !trimmed.startsWith('http')) return `https://www.hattrick.org${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
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

  const countryIdRaw = xml.match(/<Country>[\s\S]*?<CountryId>(\d+)<\/CountryId>/i)?.[1];
  const countryName = xml.match(/<Country>[\s\S]*?<CountryName>([\s\S]*?)<\/CountryName>/i)?.[1];

  // Avatar parsing
  let avatar: Avatar | undefined;
  const avatarMatch = xml.match(/<Avatar>([\s\S]*?)<\/Avatar>/i);
  if (avatarMatch) {
    const avatarBlock = avatarMatch[1];
    const backgroundImage = normalizeChppAssetUrl(readChppTag(avatarBlock, 'BackgroundImage') ?? '');
    const layers: AvatarLayer[] = [];

    for (const lMatch of avatarBlock.matchAll(/<Layer\s+x="(\d+)"\s+y="(\d+)">([\s\S]*?)<\/Layer>/gi)) {
      const x = parseInt(lMatch[1], 10);
      const y = parseInt(lMatch[2], 10);
      const image = normalizeChppAssetUrl(readChppTag(lMatch[3], 'Image') ?? '');
      if (image) layers.push({ x, y, image });
    }

    // Some layers might not have x/y attributes or different format
    if (layers.length === 0) {
      for (const lMatch of avatarBlock.matchAll(/<Layer>([\s\S]*?)<\/Layer>/gi)) {
        const image = normalizeChppAssetUrl(readChppTag(lMatch[1], 'Image') ?? '');
        if (image) layers.push({ image });
      }
    }

    avatar = { backgroundImage, layers };
  }

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
    countryId: countryIdRaw ? parseInt(countryIdRaw, 10) : undefined,
    countryName,
    avatar,
    teams,
  };
}

export interface ParsedMatch {
  matchId: number;
  matchDate: string;
  matchType: number;
  homeTeamId: number;
  awayTeamId: number;
  status: string;
}

export function parseMatchesXml(xml: string): ParsedMatch[] {
  const matches: ParsedMatch[] = [];
  for (const match of xml.matchAll(/<Match>([\s\S]*?)<\/Match>/gi)) {
    const block = match[1];
    const matchId = parseInt(block.match(/<MatchID>(\d+)<\/MatchID>/i)?.[1] || '0', 10);
    const matchDate = readChppTag(block, 'MatchDate') || '';
    const matchType = parseInt(block.match(/<MatchType>(\d+)<\/MatchType>/i)?.[1] || '0', 10);
    const homeTeamId =
      parseInt(block.match(/<HomeTeamID>(\d+)<\/HomeTeamID>/i)?.[1] || '0', 10) ||
      parseInt(block.match(/<HomeTeam>[\s\S]*?<TeamID>(\d+)<\/TeamID>/i)?.[1] || '0', 10);
    const awayTeamId =
      parseInt(block.match(/<AwayTeamID>(\d+)<\/AwayTeamID>/i)?.[1] || '0', 10) ||
      parseInt(block.match(/<AwayTeam>[\s\S]*?<TeamID>(\d+)<\/TeamID>/i)?.[1] || '0', 10);
    const status = readChppTag(block, 'Status') || '';

    if (matchId > 0) {
      matches.push({ matchId, matchDate, matchType, homeTeamId, awayTeamId, status });
    }
  }
  return matches;
}
