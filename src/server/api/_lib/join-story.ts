import { getCountryWorldDetails } from '../../../../shared/worlddetails.js';
import type { TournamentJoinStory, TournamentJoinStoryPart } from '../../../types/tournament-activity.js';
import type { ChppTeamOption, ParsedManagerCompendium, ParsedTeamDetails } from './chpp-xml.js';

const HATTRICK_BASE = 'https://www.hattrick.org/goto.ashx?path=';

function text(value: string): TournamentJoinStoryPart {
  return { text: value };
}

function link(value: string, path: string): TournamentJoinStoryPart {
  return { text: value, href: `${HATTRICK_BASE}${path}` };
}

function formatChppDate(value?: string) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : undefined;
}

function appendCountry(parts: TournamentJoinStory, countryName?: string, countryId?: number) {
  if (!countryName) return;
  const countryDetails = getCountryWorldDetails(countryId);
  parts.push(text(countryName));
  if (countryDetails?.emoji) parts.push(text(` ${countryDetails.emoji}`));
}

function appendManagerOrigin(parts: TournamentJoinStory, manager: ParsedManagerCompendium | undefined) {
  const managerTeam = manager?.teams.find((team) => team.isPrimaryClub) ?? manager?.teams[0];
  const regionName = managerTeam?.regionName;
  const countryName = manager?.countryName;
  if (!regionName && !countryName) return;

  parts.push(text(' from '));
  if (regionName && countryName) {
    parts.push(text(`${regionName}, `));
  } else if (regionName) {
    parts.push(text(regionName));
  }
  if (countryName) appendCountry(parts, countryName, manager?.countryId);
}

function isHfiTeam(team: ParsedTeamDetails, fallback: ChppTeamOption) {
  return team.leagueId === 3000 || team.leagueSystemId === 2 || fallback.leagueId === 3000 || fallback.leagueSystemId === 2;
}

function buildSeriesName(team: ParsedTeamDetails, fallback: ChppTeamOption) {
  const seriesName = team.leagueLevelUnitName ?? fallback.leagueLevelUnitName;
  return seriesName || undefined;
}

export function buildTournamentJoinStory(input: {
  manager: ParsedManagerCompendium | undefined;
  managerName: string;
  managerId: number | null;
  team: ChppTeamOption;
  teamDetails?: ParsedTeamDetails;
}): TournamentJoinStory {
  const details = input.teamDetails;
  const story: TournamentJoinStory = [];
  const teamName = details?.teamName ?? input.team.teamName;
  const teamId = details?.teamId ?? input.team.teamId;
  const managerName = input.managerName.trim();

  if (managerName) {
    if (input.managerId) {
      story.push(link(managerName, `/Club/Manager/?userId=${input.managerId}`));
    } else {
      story.push(text(managerName));
    }
    appendManagerOrigin(story, input.manager);
    story.push(text(' joined tournament with '));
  }

  story.push(link(teamName, `/Club/?TeamID=${teamId}`));
  story.push(text(managerName ? '.' : ' joined tournament.'));

  const seriesName = buildSeriesName(details ?? { teamId }, input.team);
  const seriesId = details?.leagueLevelUnitId;
  const teamRank = details?.teamRank;
  const isHfi = isHfiTeam(details ?? { teamId }, input.team);
  if (seriesName) {
    if (teamRank) {
      story.push(text(` ${teamName} is ranked ${teamRank}${isHfi ? ' in HFI' : ''} and playing in `));
    } else {
      story.push(text(` ${teamName} is playing in `));
    }
    if (seriesId) {
      story.push(link(seriesName, `/World/Series/?LeagueLevelUnitID=${seriesId}`));
    } else {
      story.push(text(seriesName));
    }
    story.push(text(' series'));
    story.push(text('.'));
  }

  const foundedDate = formatChppDate(details?.foundedDate);
  const regionName = details?.regionName;
  const regionId = details?.regionId;
  const countryName = details?.countryName ?? input.team.countryName;
  const countryId = details?.countryId ?? input.team.countryId;
  if (foundedDate || regionName || countryName) {
    story.push(text(' The team'));
    if (foundedDate) story.push(text(` was founded in ${foundedDate}`));
    if (regionName || countryName) {
      story.push(text(foundedDate ? ' and is based in ' : ' is based in '));
      if (regionName) {
        if (regionId) {
          story.push(link(regionName, `/World/Regions/Region.aspx?RegionID=${regionId}`));
        } else {
          story.push(text(regionName));
        }
        if (countryName) story.push(text(', '));
      }
      appendCountry(story, countryName, countryId);
    }
  }

  return story;
}
