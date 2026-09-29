import { getCountryWorldDetails } from '../../shared/worlddetails.js';
import type { TournamentActivityStory, TournamentActivityStoryPart } from '../types/tournament-activity.js';

const HATTRICK_BASE = 'https://www.hattrick.org/goto.ashx?path=';

export interface FixtureStoryTeam {
  name: string;
  htTeamId: number;
  countryName?: string | null;
  countryId?: number | null;
  regionName?: string | null;
  regionId?: number | null;
}

export interface FixtureStoryVenue {
  arenaName?: string | null;
  capacity?: number | null;
  fanclubSize?: number | null;
}

function text(value: string): TournamentActivityStoryPart {
  return { text: value };
}

function link(value: string, path: string): TournamentActivityStoryPart {
  return { text: value, href: `${HATTRICK_BASE}${path}` };
}

function teamLink(team: FixtureStoryTeam) {
  return link(team.name, `/Club/?TeamID=${team.htTeamId}`);
}

function appendCountry(story: TournamentActivityStory, countryName?: string | null, countryId?: number | null) {
  if (!countryName) return;
  const countryDetails = getCountryWorldDetails(countryId ?? undefined);
  story.push(
    countryId
      ? link(countryName, `/World/Leagues/League.aspx?LeagueID=${countryId}`)
      : text(countryName),
  );
  if (countryDetails?.emoji) story.push(text(` ${countryDetails.emoji}`));
}

function appendRegionAndCountry(story: TournamentActivityStory, team: FixtureStoryTeam) {
  if (!team.regionName && !team.countryName) return;
  story.push(text(' in '));
  if (team.regionName) {
    if (team.regionId) {
      story.push(link(team.regionName, `/World/Regions/Region.aspx?RegionID=${team.regionId}`));
    } else {
      story.push(text(team.regionName));
    }
    if (team.countryName) story.push(text(', '));
  }
  appendCountry(story, team.countryName, team.countryId);
}

function formatConfirmedMatchDate(value: Date) {
  const date = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(value);
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(value);
  return { date, time };
}

export function buildArrangedFixtureStory(input: {
  roundNumber: number;
  matchDate: Date;
  homeTeam: FixtureStoryTeam;
  awayTeam: FixtureStoryTeam;
  venue?: FixtureStoryVenue;
}): TournamentActivityStory {
  const story: TournamentActivityStory = [
    teamLink(input.homeTeam),
    text(' and '),
    teamLink(input.awayTeam),
    text(` have successfully arranged their Round ${input.roundNumber} match. The teams will meet on `),
  ];
  const matchDate = formatConfirmedMatchDate(input.matchDate);
  story.push(text(`${matchDate.date} at ${matchDate.time}`));
  appendRegionAndCountry(story, input.homeTeam);
  story.push(text('.'));

  const venue = input.venue;
  const hasVenue = Boolean(venue?.arenaName || venue?.capacity);
  if (hasVenue) {
    story.push(text(` The match will be played at ${input.homeTeam.name}’s`));
    if (venue?.arenaName) story.push(text(` ${venue.arenaName}`));
    if (venue?.capacity) {
      story.push(text(`${venue.arenaName ? ', a' : ''} ${venue.capacity.toLocaleString('en-US')}-seat stadium`));
    } else if (!venue?.arenaName) {
      story.push(text(' stadium'));
    }
    if (venue?.fanclubSize) {
      story.push(text(`; the club currently has a fan club of ${venue.fanclubSize.toLocaleString('en-US')} supporters`));
    }
    story.push(text('.'));
  } else if (venue?.fanclubSize) {
    story.push(text(` ${input.homeTeam.name} currently has a fan club of ${venue.fanclubSize.toLocaleString('en-US')} supporters.`));
  }

  return story;
}

function appendTeamList(story: TournamentActivityStory, teams: FixtureStoryTeam[]) {
  teams.forEach((team, index) => {
    if (index > 0) story.push(text(index === teams.length - 1 ? ' and ' : ', '));
    story.push(teamLink(team));
  });
}

export function buildMisarrangedFixtureStory(input: {
  roundNumber: number;
  offendingTeams: FixtureStoryTeam[];
  opponentTeams: FixtureStoryTeam[];
}): TournamentActivityStory {
  const story: TournamentActivityStory = [text('⚠️ Oh no! ')];
  appendTeamList(story, input.offendingTeams);
  story.push(
    text(
      input.offendingTeams.length === 1
        ? ' has been detected arranging a friendly outside the tournament. Its'
        : ' have been detected arranging friendlies outside the tournament. Their',
    ),
    text(` Round ${input.roundNumber} fixture can no longer be played as scheduled.`),
  );

  if (input.opponentTeams.length > 0) {
    story.push(text(' '));
    appendTeamList(story, input.opponentTeams);
    story.push(
      text(
        input.opponentTeams.length === 1
          ? ' is now left without their tournament training partner for next week.'
          : ' are now left without their tournament training partners for next week.',
      ),
    );
  }

  return story;
}

export function buildReserveFixtureStory(input: {
  roundNumber: number;
  reserveTeam: FixtureStoryTeam;
  replacedTeam: FixtureStoryTeam;
  opponentTeam: FixtureStoryTeam;
}): TournamentActivityStory {
  return [
    text('✅💪 A reserve team has stepped in for the rescue! '),
    teamLink(input.reserveTeam),
    text(' have replaced '),
    teamLink(input.replacedTeam),
    text(` and arranged the Round ${input.roundNumber} match against `),
    teamLink(input.opponentTeam),
    text('.'),
  ];
}
