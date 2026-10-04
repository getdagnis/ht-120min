import { getCountryWorldDetails, HATTRICK_WORLD_DETAILS } from '../../shared/worlddetails.js';
import { getCanonicalCountryName } from './ht-data.js';

export interface ManagerSpotlightAvatar {
  backgroundImage: string;
  layers?: Array<{ x?: number; y?: number; image: string }>;
}

export interface ManagerSpotlightTeam {
  teamId: number;
  teamName: string;
  logoUrl: string | null;
  countryId: number | null;
  countryName: string | null;
  regionName: string | null;
  leagueId: number | null;
  seriesName: string | null;
  leagueRank: number | null;
  youthTeamName: string | null;
  isPrimary: boolean;
  isTournamentTeam: boolean;
  foundedDate: string | null;
}

export interface ManagerSpotlight {
  managerId: number;
  managerName: string;
  avatar: ManagerSpotlightAvatar | null;
  location: string;
  language: string | null;
  currentTeams: ManagerSpotlightTeam[];
  tournamentTeamId: number;
  oldestKnownClubDate: string | null;
  story: string;
}

export interface ManagerSpotlightParticipant {
  id: string;
  ht_team_id?: number | null;
  name?: string | null;
  logo_url?: string | null;
  country_id?: number | null;
  country_name?: string | null;
  league_id?: number | null;
  league_level?: number | null;
  power_league_rank?: number | null;
  manager_name?: string | null;
  hattrick_user_id?: number | null;
}

export interface ManagerSpotlightProfile {
  hattrick_user_id: number;
  manager_name?: string | null;
  avatar_json?: ManagerSpotlightAvatar | null;
  country_id?: number | null;
  country_name?: string | null;
  language_name?: string | null;
  teams_json?: unknown;
}

interface RawTeam {
  teamId?: unknown; team_id?: unknown; teamName?: unknown; name?: unknown;
  logoUrl?: unknown; logo_url?: unknown; countryId?: unknown; country_id?: unknown;
  countryName?: unknown; country_name?: unknown; regionName?: unknown; region_name?: unknown;
  leagueId?: unknown; league_id?: unknown; leagueLevelUnitName?: unknown;
  seriesName?: unknown; league_level_unit_name?: unknown;
  powerLeagueRank?: unknown; power_league_rank?: unknown;
  youthTeamName?: unknown; youth_team_name?: unknown;
  isPrimaryClub?: unknown; isPrimary?: unknown; foundedDate?: unknown; founded_date?: unknown;
}

export const SPECIAL_LEAGUES: Readonly<Record<number, { shortName: string; name: string }>> = {
  3000: { shortName: 'HFI', name: 'Hattrick Femme International' },
  1003: { shortName: 'Homegrown', name: 'Homegrown League' },
};

const asRecord = (value: unknown): RawTeam | null =>
  value && typeof value === 'object' ? value as RawTeam : null;
const positive = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};
const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;
const yearOf = (value: string | null): number | null => {
  const year = Number(value?.match(/^(\d{4})/)?.[1]);
  return Number.isInteger(year) && year > 1800 ? year : null;
};
const ageInYears = (foundedDate: string, dateKey: string) => {
  const founded = foundedDate.slice(0, 10);
  const today = dateKey.slice(0, 10);
  let age = Number(today.slice(0, 4)) - Number(founded.slice(0, 4));
  if (today.slice(5) < founded.slice(5)) age -= 1;
  return age;
};
const stableHash = (value: string) => {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export function getUtcDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function selectDailySpotlightParticipant<T extends ManagerSpotlightParticipant>(
  tournamentId: string, participants: T[], dateKey: string,
) {
  const eligible = participants
    .filter((participant) => positive(participant.ht_team_id) && positive(participant.hattrick_user_id))
    .toSorted((left, right) =>
      Number(left.hattrick_user_id) - Number(right.hattrick_user_id) ||
      Number(left.ht_team_id) - Number(right.ht_team_id) ||
      left.id.localeCompare(right.id));
  if (!eligible.length) return null;
  const day = Date.parse(`${dateKey}T00:00:00Z`);
  const index = ((Number.isFinite(day) ? Math.floor(day / 86_400_000) : 0) + stableHash(tournamentId)) % eligible.length;
  return eligible[index];
}

export function countryLabel(countryId: number | null, countryName: string | null): string | null {
  const byId = getCountryWorldDetails(countryId);
  const canonicalName = getCanonicalCountryName(countryName, countryId);
  const byName = Object.values(HATTRICK_WORLD_DETAILS).find(
    (entry) => entry.countryId !== null && entry.fullName === canonicalName,
  );
  const country = byId ?? byName;
  return country ? `${country.fullName} ${country.emoji}` : null;
}

function countryKey(team: ManagerSpotlightTeam) {
  return countryLabel(team.countryId, team.countryName)?.toLowerCase() ?? '';
}

function normalizeTeam(raw: RawTeam): ManagerSpotlightTeam | null {
  const teamId = positive(raw.teamId ?? raw.team_id);
  if (!teamId) return null;
  const leagueId = positive(raw.leagueId ?? raw.league_id);
  return {
    teamId,
    teamName: textOrNull(raw.teamName ?? raw.name) || `Team ${teamId}`,
    logoUrl: textOrNull(raw.logoUrl ?? raw.logo_url),
    countryId: positive(raw.countryId ?? raw.country_id),
    countryName: textOrNull(raw.countryName ?? raw.country_name),
    regionName: textOrNull(raw.regionName ?? raw.region_name),
    leagueId,
    seriesName: textOrNull(raw.seriesName ?? raw.leagueLevelUnitName ?? raw.league_level_unit_name),
    leagueRank: positive(raw.powerLeagueRank ?? raw.power_league_rank),
    youthTeamName: textOrNull(raw.youthTeamName ?? raw.youth_team_name),
    isPrimary: raw.isPrimaryClub === true || raw.isPrimary === true,
    isTournamentTeam: false,
    foundedDate: textOrNull(raw.foundedDate ?? raw.founded_date),
  };
}

export function getClubRankLabel(team: ManagerSpotlightTeam): string | null {
  if (team.leagueId === 3000) return null;
  if (team.leagueId && SPECIAL_LEAGUES[team.leagueId]) return null;
  const country = countryLabel(team.countryId, team.countryName);
  return team.leagueRank && country ? `#${team.leagueRank} in ${country}` : null;
}

function list(items: string[]) {
  return items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function count(value: number) {
  return value <= 9 ? ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][value] : String(value);
}

export interface StoryContext {
  managerName: string;
  managerCountryId: number | null;
  managerCountryName: string | null;
  currentTeams: ManagerSpotlightTeam[];
  tournamentTeam: ManagerSpotlightTeam;
  dateKey: string;
}

export function getManagerLocation(context: StoryContext): string {
  const country = countryLabel(context.managerCountryId, context.managerCountryName);
  if (!country) return 'an unlisted location';
  const primary = context.currentTeams.find((team) => team.isPrimary && team.regionName);
  const managerCountryKey = countryLabel(context.managerCountryId, context.managerCountryName)?.toLowerCase();
  const home = context.currentTeams.find((team) =>
    team.regionName && countryKey(team) === managerCountryKey);
  return `${primary?.regionName ?? home?.regionName ? `${primary?.regionName ?? home?.regionName}, ` : ''}${country}`;
}

export function buildIdentityAndClubStructure(context: StoryContext): string {
  const { managerName, currentTeams } = context;
  const based = `${managerName} is based in ${getManagerLocation(context)}`;
  if (currentTeams.length === 1) {
    return `${based} and currently manages just one senior club, ${currentTeams[0].teamName}.`;
  }
  const countries = [...new Map(currentTeams.map((team) =>
    [countryKey(team), countryLabel(team.countryId, team.countryName)] as const)
    .filter(([key, label]) => key && label)).values()];
  const countryCount = countries.length;
  const everyCountryKnown = currentTeams.every((team) => countryLabel(team.countryId, team.countryName));
  if (everyCountryKnown && countryCount === 1 && currentTeams.every((team) => team.regionName &&
    team.regionName === currentTeams[0].regionName)) {
    return `${based} and currently manages ${count(currentTeams.length)} clubs, all based in the ${currentTeams[0].regionName} region.`;
  }
  if (everyCountryKnown && countryCount === 1) {
    return `${based} and currently manages ${count(currentTeams.length)} clubs, all in ${countries[0]}.`;
  }
  if (everyCountryKnown && countryCount > 1) {
    return `${based} and currently manages ${count(currentTeams.length)} clubs across ${count(countryCount)} countries: ${list(countries)}.`;
  }
  return `${based} and currently manages ${count(currentTeams.length)} clubs.`;
}

export function buildTournamentClubSentence(context: StoryContext): string {
  const { managerName, tournamentTeam: team } = context;
  const special = team.leagueId ? SPECIAL_LEAGUES[team.leagueId] : null;
  const division = team.seriesName ? ` currently playing in ${team.seriesName}` : '';
  const rank = getClubRankLabel(team);
  if (special) {
    const country = countryLabel(team.countryId, team.countryName);
    const article = special.shortName === 'HFI' ? 'an' : 'a';
    const detail = rank ? `ranked ${rank}` : `${article} ${special.shortName} side${country ? ` in ${country}` : ''}`;
    return `${managerName} is participating here with ${team.teamName}, ${detail}${division}.`;
  }
  const teamContext = rank
    ? `, ranked ${rank}${division ? ' and' : ''}${division}`
    : division ? `, currently playing in ${team.seriesName}` : '';
  return `${managerName} is participating in this tournament with ${team.teamName}${teamContext}.`;
}

export function buildSpecialLeagueOrDistributionSentence(context: StoryContext): string | null {
  const { currentTeams, tournamentTeam } = context;
  const otherSpecial = currentTeams.find((team) =>
    team.teamId !== tournamentTeam.teamId && team.leagueId && SPECIAL_LEAGUES[team.leagueId]);
  if (otherSpecial?.leagueId) {
    const country = countryLabel(otherSpecial.countryId, otherSpecial.countryName);
    return `${otherSpecial.teamName} adds a ${SPECIAL_LEAGUES[otherSpecial.leagueId].name} side${country ? ` in ${country}` : ''}.`;
  }
  const homeKey = countryLabel(context.managerCountryId, context.managerCountryName)?.toLowerCase();
  const homeCount = currentTeams.filter((team) => countryKey(team) === homeKey).length;
  const foreign = currentTeams.filter((team) => countryKey(team) !== homeKey && countryKey(team));
  if (homeCount === 1 && foreign.length === currentTeams.length - 1 && foreign.length > 1 &&
    foreign.every((team) => countryKey(team) === countryKey(foreign[0]))) {
    const country = countryLabel(foreign[0].countryId, foreign[0].countryName);
    return country ? `${country} is home to ${count(foreign.length)} of the manager's ${count(currentTeams.length)} current clubs.` : null;
  }
  return null;
}

export function buildHistorySentence(context: StoryContext): string | null {
  const dated = context.currentTeams.filter((team) => yearOf(team.foundedDate) !== null)
    .toSorted((left, right) => Number(yearOf(left.foundedDate)) - Number(yearOf(right.foundedDate)));
  const oldest = dated[0];
  const year = oldest && yearOf(oldest.foundedDate);
  if (!year) return null;
  const age = ageInYears(oldest.foundedDate!, context.dateKey);
  if (context.currentTeams.length === 1) {
    return age <= 2
      ? `${oldest.teamName} was founded in ${year}, making this a relatively recent setup.`
      : age >= 15
        ? `The manager has one current club, and it is long established: ${oldest.teamName} was founded in ${year}.`
        : `${oldest.teamName} was founded in ${year}.`;
  }
  if (age <= 2) return `The current setup is relatively recent, with ${oldest.teamName} founded in ${year}.`;
  if (age <= 7) return `${oldest.teamName} dates from ${year}.`;
  if (age <= 14) return `The manager's current club history goes back to ${year} with ${oldest.teamName}.`;
  return `The current club history stretches back to ${year} with ${oldest.teamName}.`;
}

export function buildOptionalStrongestClubSentence(context: StoryContext): string | null {
  const ranked = context.currentTeams.filter((team) =>
    !team.leagueId || !SPECIAL_LEAGUES[team.leagueId])
    .filter((team) => getClubRankLabel(team))
    .toSorted((left, right) => Number(left.leagueRank) - Number(right.leagueRank));
  const best = ranked[0];
  if (!best || best.teamId === context.tournamentTeam.teamId || ranked.length < 2 ||
    ranked.some((team) => countryKey(team) !== countryKey(best))) return null;
  return `${best.teamName} is highest ranked among the manager's current regular clubs, at ${getClubRankLabel(best)}.`;
}

export function buildFallbackDetailSentence(context: StoryContext): string | null {
  const team = context.currentTeams.length === 1 ? context.currentTeams[0] : null;
  return team?.youthTeamName ? `${team.teamName} also has a youth side, ${team.youthTeamName}.` : null;
}

export function composeManagerStory(context: StoryContext): string {
  const identity = buildIdentityAndClubStructure(context);
  const tournament = buildTournamentClubSentence(context);
  const special = buildSpecialLeagueOrDistributionSentence(context);
  const history = buildHistorySentence(context);
  const strongest = buildOptionalStrongestClubSentence(context);
  const fallback = buildFallbackDetailSentence(context);
  const sentences = [identity, tournament, special, history].filter((value): value is string => Boolean(value));
  if (sentences.length < 3 && strongest) sentences.push(strongest);
  if (fallback && (sentences.length < 3 || (context.currentTeams.length === 1 && sentences.length < 4 &&
    !getClubRankLabel(context.tournamentTeam)))) sentences.push(fallback);
  return sentences.slice(0, 4).join(' ');
}

export function buildManagerSpotlight(input: {
  tournamentId: string;
  participants: ManagerSpotlightParticipant[];
  profiles: ManagerSpotlightProfile[];
  dateKey: string;
}): ManagerSpotlight | null {
  const selected = selectDailySpotlightParticipant(input.tournamentId, input.participants, input.dateKey);
  if (!selected?.hattrick_user_id || !selected.ht_team_id) return null;
  const managerId = Number(selected.hattrick_user_id);
  const profile = input.profiles.find((candidate) => Number(candidate.hattrick_user_id) === managerId);
  const participants = input.participants.filter((participant) => Number(participant.hattrick_user_id) === managerId);
  const profileTeams = Array.isArray(profile?.teams_json)
    ? profile.teams_json.map(asRecord).filter((team): team is RawTeam => team !== null) : [];
  const byId = new Map<number, ManagerSpotlightTeam>();
  for (const raw of profileTeams) {
    const team = normalizeTeam(raw);
    if (team) byId.set(team.teamId, team);
  }
  const tournamentIds = new Set(participants.map((participant) => positive(participant.ht_team_id)).filter(Boolean));
  for (const participant of participants) {
    const teamId = positive(participant.ht_team_id);
    if (!teamId) continue;
    const existing = byId.get(teamId);
    byId.set(teamId, {
      teamId,
      teamName: existing?.teamName || participant.name || `Team ${teamId}`,
      logoUrl: existing?.logoUrl || participant.logo_url || null,
      countryId: existing?.countryId || positive(participant.country_id),
      countryName: existing?.countryName || participant.country_name || null,
      regionName: existing?.regionName || null,
      leagueId: existing?.leagueId || positive(participant.league_id),
      seriesName: existing?.seriesName || null,
      leagueRank: existing?.leagueRank || positive(participant.power_league_rank),
      youthTeamName: existing?.youthTeamName || null,
      isPrimary: existing?.isPrimary || false,
      isTournamentTeam: true,
      foundedDate: existing?.foundedDate || null,
    });
  }
  const currentTeams = [...byId.values()]
    .map((team) => ({ ...team, isTournamentTeam: tournamentIds.has(team.teamId) }))
    .toSorted((left, right) =>
      Number(right.isPrimary) - Number(left.isPrimary) || left.teamName.localeCompare(right.teamName));
  const tournamentTeam = byId.get(Number(selected.ht_team_id));
  if (!tournamentTeam) return null;
  const managerName = profile?.manager_name || selected.manager_name || `Manager ${managerId}`;
  const context: StoryContext = {
    managerName, managerCountryId: positive(profile?.country_id),
    managerCountryName: profile?.country_name || null,
    currentTeams, tournamentTeam, dateKey: input.dateKey,
  };
  const oldestKnownClubDate = currentTeams.map((team) => team.foundedDate)
    .filter((date): date is string => Boolean(date))
    .toSorted()[0] || null;
  return {
    managerId, managerName, avatar: profile?.avatar_json || null,
    location: getManagerLocation(context), language: profile?.language_name || null,
    currentTeams, tournamentTeamId: tournamentTeam.teamId, oldestKnownClubDate,
    story: composeManagerStory(context),
  };
}
