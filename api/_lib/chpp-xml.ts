import { getLeagueNameById } from '../../shared/worlddetails.js';
import { normalizeChppCountryName } from '../../shared/chpp-country.js';

export interface ChppTeamOption {
  teamId: number;
  teamName: string;
  genderId?: number;
  leagueSystemId?: number;
  leagueName?: string;
  leagueId?: number;
  leagueLevel?: number;
  leagueLevelUnitName?: string;
  regionName?: string;
  countryId?: number;
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
  leagueId?: number;
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
  if (trimmed && !trimmed.startsWith('http'))
    return `https://www.hattrick.org${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
  return trimmed;
}

export interface ParsedTeamDetails {
  teamId: number;
  teamName?: string;
  leagueId?: number;
  leagueSystemId?: number;
  leagueName?: string;
  leagueLevel?: number;
  countryId?: number;
  countryName?: string;
  logoUrl?: string;
  genderId?: number;
  arenaId?: number;
  fanclubSize?: number;
  friendlyTeamId?: number | null;
  possibleToChallengeMidweek?: boolean;
  possibleToChallengeWeekend?: boolean;
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
    const logoUrl = logoRaw ? normalizeChppAssetUrl(logoRaw) : dressRaw ? normalizeChppAssetUrl(dressRaw) : undefined;

    const arenaIdRaw = block.match(/<Arena>[\s\S]*?<ArenaID>(\d+)<\/ArenaID>/i)?.[1];
    const fanclubSizeRaw = block.match(/<Fanclub>[\s\S]*?<FanclubSize>(\d+)<\/FanclubSize>/i)?.[1];
    const genderIdRaw = block.match(/<GenderID>(\d+)<\/GenderID>/i)?.[1];
    const leagueIdRaw = block.match(/<League>[\s\S]*?<LeagueID>(\d+)<\/LeagueID>/i)?.[1];
    const leagueSystemIdRaw = block.match(/<LeagueSystemID>(\d+)<\/LeagueSystemID>/i)?.[1];
    const leagueLevelRaw = block.match(/<LeagueLevelUnit>[\s\S]*?<LeagueLevel>(\d+)<\/LeagueLevel>/i)?.[1];
    const leagueName = readChppTag(block, 'LeagueName');
    const countryIdRaw = block.match(/<Country>[\s\S]*?<CountryID>(\d+)<\/CountryID>/i)?.[1];
    const countryId = countryIdRaw ? parseInt(countryIdRaw, 10) : undefined;
    const leagueId = leagueIdRaw ? parseInt(leagueIdRaw, 10) : undefined;
    const friendlyTeamIdRaw = block.match(/<FriendlyTeamID>(\d+)<\/FriendlyTeamID>/i)?.[1];
    const possibleToChallengeMidweekRaw = readChppTag(block, 'PossibleToChallengeMidweek');
    const possibleToChallengeWeekendRaw = readChppTag(block, 'PossibleToChallengeWeekend');

    return {
      teamId,
      teamName: readChppTag(block, 'TeamName'),
      leagueId,
      leagueSystemId: leagueSystemIdRaw ? parseInt(leagueSystemIdRaw, 10) : undefined,
      leagueName: getLeagueNameById(leagueId) ?? leagueName,
      leagueLevel: leagueLevelRaw ? parseInt(leagueLevelRaw, 10) : undefined,
      countryId,
      countryName: normalizeChppCountryName(readChppTag(block, 'CountryName'), countryId),
      logoUrl,
      arenaId: arenaIdRaw ? parseInt(arenaIdRaw, 10) : undefined,
      fanclubSize: fanclubSizeRaw ? parseInt(fanclubSizeRaw, 10) : undefined,
      genderId: genderIdRaw ? parseInt(genderIdRaw, 10) : undefined,
      friendlyTeamId: friendlyTeamIdRaw ? parseInt(friendlyTeamIdRaw, 10) : 0,
      possibleToChallengeMidweek:
        possibleToChallengeMidweekRaw === undefined
          ? undefined
          : possibleToChallengeMidweekRaw.toLowerCase() === 'true',
      possibleToChallengeWeekend:
        possibleToChallengeWeekendRaw === undefined
          ? undefined
          : possibleToChallengeWeekendRaw.toLowerCase() === 'true',
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

export interface ParsedArenaDetails {
  arenaId: number;
  arenaName?: string;
  capacity?: number;
  arenaImageUrl?: string;
  arenaFallbackImageUrl?: string;
  errorCode?: number;
}

export function parseArenaDetailsXml(xml: string): ParsedArenaDetails {
  const errorCodeRaw = xml.match(/<ErrorCode>(\d+)<\/ErrorCode>/i)?.[1];
  if (errorCodeRaw) {
    const errorCode = parseInt(errorCodeRaw, 10);
    if (errorCode !== 0) {
      return { arenaId: 0, errorCode };
    }
  }

  const arenaIdRaw = xml.match(/<ArenaID>(\d+)<\/ArenaID>/i)?.[1];
  const capacityRaw = xml.match(/<Capacity>(\d+)<\/Capacity>/i)?.[1];
  const arenaImageUrl = readChppTag(xml, 'ArenaImage');
  const arenaFallbackImageUrl = readChppTag(xml, 'ArenaFallbackImage');

  return {
    arenaId: arenaIdRaw ? parseInt(arenaIdRaw, 10) : 0,
    arenaName: readChppTag(xml, 'ArenaName'),
    capacity: capacityRaw ? parseInt(capacityRaw, 10) : undefined,
    arenaImageUrl: arenaImageUrl ? normalizeChppAssetUrl(arenaImageUrl) : undefined,
    arenaFallbackImageUrl: arenaFallbackImageUrl ? normalizeChppAssetUrl(arenaFallbackImageUrl) : undefined,
  };
}

export function parseManagerCompendiumXml(xml: string): ParsedManagerCompendium {
  const userIdRaw = xml.match(/<UserId>(\d+)<\/UserId>/i)?.[1] ?? xml.match(/<UserID>(\d+)<\/UserID>/i)?.[1];
  const managerName = readChppTag(xml, 'Loginname') ?? 'Unknown';

  const countryIdRaw = xml.match(/<Country>[\s\S]*?<CountryId>(\d+)<\/CountryId>/i)?.[1];
  const countryId = countryIdRaw ? parseInt(countryIdRaw, 10) : undefined;
  const countryName = normalizeChppCountryName(
    xml.match(/<Country>[\s\S]*?<CountryName>([\s\S]*?)<\/CountryName>/i)?.[1]?.trim(),
    countryId,
  );

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
    const countryIdRaw = block.match(/<CountryID>(\d+)<\/CountryID>/i)?.[1];
    const countryId = countryIdRaw ? parseInt(countryIdRaw, 10) : undefined;
    const leagueId = leagueIdRaw ? parseInt(leagueIdRaw, 10) : undefined;

    teams.push({
      teamId: parseInt(teamIdRaw, 10),
      teamName: readChppTag(block, 'TeamName') ?? 'Unknown',
      genderId: genderIdRaw ? parseInt(genderIdRaw, 10) : undefined,
      leagueSystemId: leagueSystemIdRaw ? parseInt(leagueSystemIdRaw, 10) : undefined,
      leagueName: getLeagueNameById(leagueId) ?? readChppTag(block, 'LeagueName'),
      leagueId,
      leagueLevelUnitName: readChppTag(block, 'LeagueLevelUnitName'),
      regionName: readChppTag(block, 'RegionName'),
      countryId,
      countryName: normalizeChppCountryName(readChppTag(block, 'CountryName'), countryId),
    });
  }

  return {
    hattrickUserId: userIdRaw ? parseInt(userIdRaw, 10) : null,
    managerName,
    countryId,
    countryName,
    leagueId: teams[0]?.leagueId,
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
