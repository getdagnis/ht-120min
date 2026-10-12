import { readChppTag } from '../../_lib/chpp-xml.js';
import { FORGE_LEAGUE_TEAM_LIMIT } from '../../../../utils/forge-leagues.js';
import type { ForgeLeagueOption, ForgeLeagueTeam } from '../../../../utils/forge-leagues.js';

export function xmlBlocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'gi'))].map(match => match[1]);
}

function positive(value: string | undefined): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function parseSmallLeagues(xml: string): ForgeLeagueOption[] {
  const result: ForgeLeagueOption[] = [];
  for (const block of xmlBlocks(xml, 'League')) {
    const leagueId = positive(readChppTag(block, 'LeagueID'));
    const raw = readChppTag(block, 'ActiveTeams');
    const activeTeams = Number(raw);
    const name = readChppTag(block, 'EnglishName') || readChppTag(block, 'LeagueName');
    if (leagueId && name && raw && Number.isSafeInteger(activeTeams) && activeTeams > 0 && activeTeams <= FORGE_LEAGUE_TEAM_LIMIT) {
      result.push({ leagueId, name, activeTeams });
    }
  }
  if (!result.length) throw new Error('CHPP did not return a league catalogue with active-team counts.');
  return result.sort((a, b) => a.activeTeams - b.activeTeams || a.name.localeCompare(b.name));
}

export function parseLeagueSeries(xml: string, leagueId: number): number[] {
  if (Number(readChppTag(xml, 'LeagueID')) !== leagueId) throw new Error('CHPP returned another league.');
  const ids = xmlBlocks(xml, 'LeagueLevelItem').flatMap(block =>
    (readChppTag(block, 'LeagueLevelUnitIdList') || '').split(',').map(value => positive(value.trim())).filter((id): id is number => id !== null));
  if (!ids.length) throw new Error('CHPP did not return the league series list.');
  return [...new Set(ids)];
}

export function parseSeriesHumanTeams(xml: string, leagueId: number, seriesId: number): number[] {
  if (Number(readChppTag(xml, 'LeagueID')) !== leagueId || Number(readChppTag(xml, 'LeagueLevelUnitID')) !== seriesId) {
    throw new Error('CHPP returned another series.');
  }
  const blocks = xmlBlocks(xml, 'Team');
  if (!blocks.length) throw new Error('CHPP did not return the series teams.');
  const ids: number[] = [];
  for (const block of blocks) {
    const owner = readChppTag(block, 'UserId');
    const id = positive(readChppTag(block, 'TeamID'));
    if (owner === undefined || !id) throw new Error('CHPP did not identify the series team owners.');
    if (positive(owner)) ids.push(id);
  }
  return ids;
}

export function parseLeagueTeam(xml: string, leagueId: number, teamId: number): ForgeLeagueTeam | null {
  const team = xmlBlocks(xml, 'Team').find(block => Number(readChppTag(block, 'TeamID')) === teamId);
  if (!team) throw new Error('CHPP did not return the requested team.');
  const bot = readChppTag(team, 'IsBot')?.toLowerCase();
  const deactivated = readChppTag(team, 'IsDeactivated')?.toLowerCase();
  if (bot === 'true' || deactivated === 'true') return null;
  if (bot !== 'false' || deactivated !== 'false') throw new Error('CHPP did not confirm an active human team.');
  if (Number(readChppTag(team, 'LeagueID')) !== leagueId) return null;
  const user = xmlBlocks(xml, 'User')[0] || '';
  const primaryTeam = xmlBlocks(xml, 'Team').find(block => readChppTag(block, 'IsPrimaryClub')?.toLowerCase() === 'true');
  const managerId = positive(readChppTag(user, 'UserID'));
  const managerName = readChppTag(user, 'Loginname');
  const supporterTier = readChppTag(user, 'SupporterTier')?.toLowerCase() || null;
  const lastLoginDate = readChppTag(user, 'LastLoginDate') || null;
  const teamName = readChppTag(team, 'TeamName');
  if (!managerId || !managerName || !teamName) throw new Error('CHPP did not identify the team manager.');
  return { teamId, teamName, managerId, managerName,
    managerCountryId: primaryTeam ? positive(readChppTag(primaryTeam, 'CountryID')) : null,
    supporterTier, lastLoginDate,
    countryId: positive(readChppTag(team, 'CountryID')),
    booked: null, inCup: null, checkedAt: null, error: null };
}

/** Empty/missing values are unknown; only an explicit zero means unbooked. */
export function parseLeagueAvailability(xml: string, teamId: number): { booked: boolean | null; inCup: boolean | null } {
  const team = xmlBlocks(xml, 'Team').find(block => Number(readChppTag(block, 'TeamID')) === teamId);
  if (!team) throw new Error('CHPP did not return the requested team.');
  const friendly = readChppTag(team, 'FriendlyTeamID');
  const cup = readChppTag(team, 'StillInCup')?.toLowerCase();
  return {
    booked: friendly !== undefined && /^\d+$/.test(friendly) && Number.isSafeInteger(Number(friendly)) ? Number(friendly) > 0 : null,
    inCup: cup === 'true' ? true : cup === 'false' ? false : null,
  };
}
