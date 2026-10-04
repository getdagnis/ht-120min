import { getLeagueNameById } from '../../../../shared/worlddetails.js';
import { normalizeChppCountryName } from '../../../../shared/chpp-country.js';
import { decodeXmlEntities } from '../../../../shared/xml-entities.js';
import { toLargeMatchKitUrl } from '../../../../shared/match-kits.js';

export interface ChppTeamOption {
  teamId: number;
  teamName: string;
  isPrimaryClub?: boolean;
  logoUrl?: string;
  genderId?: number;
  leagueSystemId?: number;
  leagueName?: string;
  leagueId?: number;
  leagueLevel?: number;
  leagueLevelUnitName?: string;
  regionName?: string;
  countryId?: number;
  countryName?: string;
  foundedDate?: string;
  activeTournament?: {
    name: string;
    slug: string;
  };
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
  languageId?: number;
  languageName?: string;
  countryId?: number;
  countryName?: string;
  leagueId?: number;
  avatar?: Avatar;
  teams: ChppTeamOption[];
}

export function readChppTag(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
  const value = match?.[1] ? decodeXmlEntities(match[1].trim()) : undefined;
  return value || undefined;
}

export function normalizeChppAssetUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed && !trimmed.startsWith('http'))
    return `https://www.hattrick.org${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
  return trimmed;
}

export function matchKitUrlFromChpp(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const url = normalizeChppAssetUrl(raw);
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' &&
        (parsed.hostname === 'hattrick.org' || parsed.hostname.endsWith('.hattrick.org'))) {
      return toLargeMatchKitUrl(url);
    }
  } catch { /* Ignore malformed CHPP asset URLs. */ }
  return undefined;
}

export interface ParsedTeamDetails {
  teamId: number;
  teamName?: string;
  leagueId?: number;
  leagueSystemId?: number;
  leagueName?: string;
  leagueLevel?: number;
  leagueLevelUnitId?: number;
  leagueLevelUnitName?: string;
  countryId?: number;
  countryName?: string;
  regionId?: number;
  regionName?: string;
  foundedDate?: string;
  teamRank?: number;
  powerRating?: number;
  powerGlobalRank?: number;
  powerLeagueRank?: number;
  powerRegionRank?: number;
  logoUrl?: string;
  matchKitUrl?: string;
  alternateMatchKitUrl?: string;
  genderId?: number;
  arenaId?: number;
  arenaName?: string;
  fanclubSize?: number;
  friendlyTeamId?: number | null;
  stillInCup?: boolean;
  possibleToChallengeMidweek?: boolean;
  possibleToChallengeWeekend?: boolean;
  errorCode?: number;
}

export function teamDetailsKitForMatchSide(
  details: ParsedTeamDetails | null,
  actualHomeTeamId: number | null,
  actualAwayTeamId: number | null,
): string | null {
  if (!details) return null;
  if (details.teamId === actualHomeTeamId) {
    const homeKit = details.matchKitUrl;
    if (details.genderId === 2 && homeKit === 'https://res.hattrick.org/kits/1/1/1/1/matchKitLarge.png') {
      return 'https://res.hattrick.org/kits/1/1/1/6/matchKitLarge.png';
    }
    return homeKit ?? null;
  }
  if (details.teamId === actualAwayTeamId) {
    const awayKit = details.alternateMatchKitUrl;
    if (details.genderId === 2 && awayKit === 'https://res.hattrick.org/kits/1/1/1/2/matchKitLarge.png') {
      return 'https://res.hattrick.org/kits/1/1/1/7/matchKitLarge.png';
    }
    return awayKit ?? null;
  }
  return null;
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
    const logoUrl = logoRaw ? normalizeChppAssetUrl(logoRaw) : dressRaw ? normalizeChppAssetUrl(dressRaw) : '/matchKitLarge.png';

    const arenaIdRaw = block.match(/<Arena>[\s\S]*?<ArenaID>(\d+)<\/ArenaID>/i)?.[1];
    const fanclubSizeRaw = block.match(/<Fanclub>[\s\S]*?<FanclubSize>(\d+)<\/FanclubSize>/i)?.[1];
    const genderIdRaw = block.match(/<GenderID>(\d+)<\/GenderID>/i)?.[1];
    const leagueIdRaw = block.match(/<League>[\s\S]*?<LeagueID>(\d+)<\/LeagueID>/i)?.[1];
    const leagueSystemIdRaw = block.match(/<LeagueSystemID>(\d+)<\/LeagueSystemID>/i)?.[1];
    const leagueLevelUnitIdRaw = block.match(/<LeagueLevelUnit>[\s\S]*?<LeagueLevelUnitID>(\d+)<\/LeagueLevelUnitID>/i)?.[1];
    const leagueLevelRaw = block.match(/<LeagueLevelUnit>[\s\S]*?<LeagueLevel>(\d+)<\/LeagueLevel>/i)?.[1];
    const leagueName = readChppTag(block, 'LeagueName');
    const countryIdRaw = block.match(/<Country>[\s\S]*?<CountryID>(\d+)<\/CountryID>/i)?.[1];
    const regionIdRaw = block.match(/<Region>[\s\S]*?<RegionID>(\d+)<\/RegionID>/i)?.[1];
    const teamRankRaw = readChppTag(block, 'TeamRank');
    const powerRatingRaw =
      block.match(/<PowerRating>[\s\S]*?<PowerRating>\s*(\d+)\s*<\/PowerRating>/i)?.[1] ??
      block.match(/<PowerRating>\s*(\d+)\s*<\/PowerRating>/i)?.[1];
    const powerGlobalRankRaw = readChppTag(block, 'GlobalRanking') ?? readChppTag(block, 'PowerGlobalRank');
    const powerLeagueRankRaw = readChppTag(block, 'LeagueRanking') ?? readChppTag(block, 'PowerLeagueRank');
    const powerRegionRankRaw = readChppTag(block, 'RegionRanking') ?? readChppTag(block, 'PowerRegionRank');
    const countryId = countryIdRaw ? parseInt(countryIdRaw, 10) : undefined;
    const leagueId = leagueIdRaw ? parseInt(leagueIdRaw, 10) : undefined;
    const friendlyTeamIdRaw = block.match(/<FriendlyTeamID>(\d+)<\/FriendlyTeamID>/i)?.[1];
    const stillInCupRaw = readChppTag(block, 'StillInCup');
    const possibleToChallengeMidweekRaw = readChppTag(block, 'PossibleToChallengeMidweek');
    const possibleToChallengeWeekendRaw = readChppTag(block, 'PossibleToChallengeWeekend');

    return {
      teamId,
      teamName: readChppTag(block, 'TeamName'),
      leagueId,
      leagueSystemId: leagueSystemIdRaw ? parseInt(leagueSystemIdRaw, 10) : undefined,
      leagueName: getLeagueNameById(leagueId) ?? leagueName,
      leagueLevel: leagueLevelRaw ? parseInt(leagueLevelRaw, 10) : undefined,
      leagueLevelUnitId: leagueLevelUnitIdRaw ? parseInt(leagueLevelUnitIdRaw, 10) : undefined,
      leagueLevelUnitName: readChppTag(block, 'LeagueLevelUnitName'),
      countryId,
      countryName: normalizeChppCountryName(readChppTag(block, 'CountryName'), countryId),
      regionId: regionIdRaw ? parseInt(regionIdRaw, 10) : undefined,
      regionName: readChppTag(block, 'RegionName'),
      foundedDate: readChppTag(block, 'FoundedDate'),
      teamRank: teamRankRaw ? parseInt(teamRankRaw, 10) : undefined,
      powerRating: powerRatingRaw ? parseInt(powerRatingRaw, 10) : undefined,
      powerGlobalRank: powerGlobalRankRaw ? parseInt(powerGlobalRankRaw, 10) : undefined,
      powerLeagueRank: powerLeagueRankRaw ? parseInt(powerLeagueRankRaw, 10) : undefined,
      powerRegionRank: powerRegionRankRaw ? parseInt(powerRegionRankRaw, 10) : undefined,
      logoUrl,
      matchKitUrl: matchKitUrlFromChpp(dressRaw),
      alternateMatchKitUrl: matchKitUrlFromChpp(readChppTag(block, 'DressAlternateURI')),
      arenaId: arenaIdRaw ? parseInt(arenaIdRaw, 10) : undefined,
      arenaName: readChppTag(block, 'ArenaName'),
      fanclubSize: fanclubSizeRaw ? parseInt(fanclubSizeRaw, 10) : undefined,
      genderId: genderIdRaw ? parseInt(genderIdRaw, 10) : undefined,
      friendlyTeamId: friendlyTeamIdRaw ? parseInt(friendlyTeamIdRaw, 10) : 0,
      stillInCup:
        stillInCupRaw === undefined ? undefined : stillInCupRaw.toLowerCase() === 'true',
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
  const languageIdRaw = xml.match(/<Language>[\s\S]*?<LanguageId>(\d+)<\/LanguageId>/i)?.[1]
    ?? xml.match(/<Language>[\s\S]*?<LanguageID>(\d+)<\/LanguageID>/i)?.[1];
  const languageId = languageIdRaw ? parseInt(languageIdRaw, 10) : undefined;
  const languageName = readChppTag(xml, 'LanguageName');

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
      isPrimaryClub: readChppTag(block, 'IsPrimaryClub')?.toLowerCase() === 'true',
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
    languageId,
    languageName,
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
