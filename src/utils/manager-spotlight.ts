import { getCountryIdByName, getCountryWorldDetails, getLeagueWorldDetails, HATTRICK_WORLD_DETAILS } from '../../shared/worlddetails.js';
import { getCanonicalCountryName, getCountryFlagUrl } from './ht-data.js';

export interface ManagerSpotlightAvatar {
  backgroundImage: string;
  layers?: Array<{ x?: number; y?: number; image: string }>;
}

export interface CountryMention {
  kind: 'country';
  countryId: number | null;
  name: string;
}
export type StorySegment = string | CountryMention;
export interface StorySentence {
  candidateId: string;
  segments: StorySegment[];
}

export interface ManagerSpotlightTeam {
  teamId: number;
  teamName: string;
  logoUrl: string | null;
  countryId: number | null;
  countryName: string | null;
  regionName: string | null;
  leagueId: number | null;
  leagueName: string | null;
  leagueSystemId: number | null;
  seriesName: string | null;
  leagueRank: number | null;
  powerRating: number | null;
  powerLeagueRank: number | null;
  foundedDate: string | null;
  youthTeamName: string | null;
  arenaName: string | null;
  fanclubSize: number | null;
  trophies: TrophyFact[];
  isPrimary: boolean;
  isTournamentTeam: boolean;
}

export type OfficialRole = 'hattrick_staff' | 'game_master' | 'moderator' | 'language_assistant';
export type NationalTeamRoleType = 'coach' | 'assistant' | 'scout';
export interface NationalTeamRole {
  type: NationalTeamRoleType;
  nationalTeamId: number;
  nationalTeamName: string;
  countryId: number | null;
  isU21: boolean;
}
export type TrophyKind =
  | 'world_cup_gold' | 'world_cup_silver' | 'world_cup_bronze' | 'masters'
  | 'masters_top_scorer' | 'national_cup' | 'challenger_cup' | 'consolation_cup'
  | 'cup' | 'league' | 'series' | 'tournament' | 'tutorial_tournament' | 'other';
export interface TrophyFact {
  typeId: number;
  kind: TrophyKind;
  season?: number;
  gainedDate?: string;
  leagueLevel?: number;
  leagueLevelUnitName?: string;
  cupLeagueLevel?: number;
  cupLevel?: number;
  cupLevelIndex?: number;
}

export interface ManagerSpotlight {
  managerId: number;
  managerName: string;
  avatar: ManagerSpotlightAvatar | null;
  location: StorySegment[];
  language: string | null;
  currentTeams: ManagerSpotlightTeam[];
  tournamentTeamId: number;
  story: StorySentence[];
}

export interface ManagerSpotlightParticipant {
  id: string;
  ht_team_id?: number | null;
  name?: string | null;
  logo_url?: string | null;
  country_id?: number | null;
  country_name?: string | null;
  league_id?: number | null;
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
  national_team_roles_json?: unknown;
  teams_json?: unknown;
}

export const SPECIAL_LEAGUES: Readonly<Record<number, { shortName: string; name: string }>> = {
  3000: { shortName: 'HFI', name: 'Hattrick Femme International' },
  1003: { shortName: 'Homegrown', name: 'Homegrown League' },
};

export type StoryTopic = 'exceptional-role' | 'tournament' | 'primary-club' | 'achievement' | 'rank' | 'history' | 'footprint' | 'colour';
export interface StoryCandidate {
  id: string;
  topic: StoryTopic;
  tier: 0 | 1 | 2 | 3 | 4 | 5;
  score: number;
  mandatory?: boolean;
  tags: string[];
  segments: StorySegment[];
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const positive = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};
const finiteNonnegative = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
};
const textOrNull = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const countWord = (n: number) => n <= 9 ? ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][n] : String(n);
const countrySegment = (team: Pick<ManagerSpotlightTeam, 'countryId' | 'countryName'>): CountryMention | null => {
  const name = countryLabel(team.countryId, team.countryName);
  return name ? { kind: 'country', countryId: team.countryId, name } : null;
};
const append = (base: StorySegment[], ...parts: Array<StorySegment | null | undefined>) => {
  for (const part of parts) if (part !== null && part !== undefined && part !== '') base.push(part);
  return base;
};
const asSegments = (...parts: Array<StorySegment | null | undefined>) => append([], ...parts);

const stableHash = (value: string) => {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export function getUtcDateKey(date = new Date()) { return date.toISOString().slice(0, 10); }

export function countryLabel(countryId: number | null, countryName: string | null): string | null {
  const byId = getCountryWorldDetails(countryId);
  const canonicalName = getCanonicalCountryName(countryName, countryId);
  const byName = Object.values(HATTRICK_WORLD_DETAILS).find((entry) => entry.countryId !== null && entry.fullName === canonicalName);
  return byId?.fullName ?? byName?.fullName ?? (countryName?.trim() || null);
}

export function countryFlagUrl(countryId: number | null, countryName: string | null): string | null {
  return getCountryFlagUrl(countryId, countryName);
}

export function getClubRankLabel(team: Pick<ManagerSpotlightTeam, 'leagueRank' | 'leagueId'>): string | null {
  if (!team.leagueRank || team.leagueRank <= 0) return null;
  if (team.leagueId && SPECIAL_LEAGUES[team.leagueId]?.shortName === 'HFI') return null;
  return `League rank #${team.leagueRank}`;
}

export function detectOfficialRole(managerName: string): OfficialRole | null {
  const match = managerName.match(/^(HT|GM|Mod|LA)-/i)?.[1]?.toLowerCase();
  if (match === 'ht') return 'hattrick_staff';
  if (match === 'gm') return 'game_master';
  if (match === 'mod') return 'moderator';
  if (match === 'la') return 'language_assistant';
  return null;
}

export function mapNationalTeamStaffType(value: unknown): NationalTeamRoleType | null {
  const type = Number(value);
  if (type === 0) return 'coach';
  if (type === 1) return 'assistant';
  if (type === 2) return 'scout';
  return null;
}

export function normalizeNationalTeamRoles(value: unknown): NationalTeamRole[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    const role = asRecord(item);
    if (!role) return [];
    const type = mapNationalTeamStaffType(role.staffType ?? role.staff_type ?? role.type);
    const nationalTeamId = positive(role.nationalTeamId ?? role.national_team_id);
    const nationalTeamName = textOrNull(role.nationalTeamName ?? role.national_team_name);
    if (!type || !nationalTeamId || !nationalTeamName) return [];
    const key = `${type}:${nationalTeamId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const countryName = nationalTeamName.replace(/^U21\s+/i, '');
    const countryIdFromName = Number(getCountryIdByName(countryName));
    const countryId = positive(role.countryId) ?? (Number.isSafeInteger(countryIdFromName) && countryIdFromName > 0
      ? countryIdFromName
      : getLeagueWorldDetails(nationalTeamId)?.countryId ?? null);
    return [{ type, nationalTeamId, nationalTeamName, countryId, isU21: /^U21\b/i.test(nationalTeamName) }];
  });
}

function normalizeTrophy(raw: unknown): TrophyFact | null {
  const trophy = asRecord(raw);
  if (!trophy) return null;
  const typeId = positive(trophy.typeId ?? trophy.trophyTypeId);
  if (!typeId) return null;
  const cupLeagueLevel = finiteNonnegative(trophy.cupLeagueLevel);
  const cupLevel = finiteNonnegative(trophy.cupLevel);
  return {
    typeId,
    kind: classifyTrophy({ typeId, cupLeagueLevel, cupLevel }),
    ...(positive(trophy.season ?? trophy.trophySeason) ? { season: positive(trophy.season ?? trophy.trophySeason)! } : {}),
    ...(textOrNull(trophy.gainedDate) ? { gainedDate: textOrNull(trophy.gainedDate)! } : {}),
    ...(finiteNonnegative(trophy.leagueLevel) !== null ? { leagueLevel: finiteNonnegative(trophy.leagueLevel)! } : {}),
    ...(textOrNull(trophy.leagueLevelUnitName) ? { leagueLevelUnitName: textOrNull(trophy.leagueLevelUnitName)! } : {}),
    ...(cupLeagueLevel !== null ? { cupLeagueLevel } : {}),
    ...(cupLevel !== null ? { cupLevel } : {}),
    ...(finiteNonnegative(trophy.cupLevelIndex) !== null ? { cupLevelIndex: finiteNonnegative(trophy.cupLevelIndex)! } : {}),
  };
}

export function classifyTrophy(input: { typeId: number; cupLeagueLevel?: number | null; cupLevel?: number | null }): TrophyKind {
  switch (input.typeId) {
    case 16:
      if (input.cupLeagueLevel === 0 && input.cupLevel === 1) return 'national_cup';
      if (input.cupLevel === 2) return 'challenger_cup';
      if (input.cupLevel === 3) return 'consolation_cup';
      return 'cup';
    case 17: return 'series';
    case 18: return 'league';
    case 78: return 'world_cup_gold';
    case 79: return 'world_cup_silver';
    case 80: return 'world_cup_bronze';
    case 91: return 'masters';
    case 93: return 'masters_top_scorer';
    case 103: return 'tournament';
    case 203: return 'tutorial_tournament';
    default: return 'other';
  }
}

function normalizeTeam(raw: Record<string, unknown>): ManagerSpotlightTeam | null {
  const teamId = positive(raw.teamId ?? raw.team_id);
  if (!teamId) return null;
  return {
    teamId,
    teamName: textOrNull(raw.teamName ?? raw.name) ?? `Team ${teamId}`,
    logoUrl: textOrNull(raw.logoUrl ?? raw.logo_url),
    countryId: positive(raw.countryId ?? raw.country_id),
    countryName: textOrNull(raw.countryName ?? raw.country_name),
    regionName: textOrNull(raw.regionName ?? raw.region_name),
    leagueId: positive(raw.leagueId ?? raw.league_id),
    leagueName: textOrNull(raw.leagueName ?? raw.league_name),
    leagueSystemId: positive(raw.leagueSystemId ?? raw.league_system_id),
    seriesName: textOrNull(raw.leagueLevelUnitName ?? raw.league_level_unit_name ?? raw.seriesName),
    leagueRank: positive(raw.teamRank ?? raw.team_rank),
    powerRating: finiteNonnegative(raw.powerRating ?? raw.power_rating),
    powerLeagueRank: finiteNonnegative(raw.powerLeagueRank ?? raw.power_league_rank),
    foundedDate: textOrNull(raw.foundedDate ?? raw.founded_date),
    youthTeamName: textOrNull(raw.youthTeamName ?? raw.youth_team_name),
    arenaName: textOrNull(raw.arenaName ?? raw.arena_name),
    fanclubSize: finiteNonnegative(raw.fanclubSize ?? raw.fanclub_size),
    trophies: Array.isArray(raw.trophies) ? raw.trophies.map(normalizeTrophy).filter((t): t is TrophyFact => t !== null) : [],
    isPrimary: raw.isPrimaryClub === true || raw.isPrimary === true,
    isTournamentTeam: false,
  };
}

export function selectDailySpotlightParticipant<T extends ManagerSpotlightParticipant>(tournamentId: string, participants: T[], dateKey: string) {
  const eligible = participants
    .filter((p) => positive(p.ht_team_id) && positive(p.hattrick_user_id))
    .toSorted((a, b) => Number(a.hattrick_user_id) - Number(b.hattrick_user_id) || Number(a.ht_team_id) - Number(b.ht_team_id) || a.id.localeCompare(b.id));
  if (!eligible.length) return null;
  const day = Date.parse(`${dateKey}T00:00:00Z`);
  const index = ((Number.isFinite(day) ? Math.floor(day / 86_400_000) : 0) + stableHash(tournamentId)) % eligible.length;
  return eligible[index];
}

function locationSegments(profile: ManagerSpotlightProfile | undefined, teams: ManagerSpotlightTeam[]): StorySegment[] {
  const countryId = positive(profile?.country_id);
  const countryName = textOrNull(profile?.country_name);
  const primary = teams.find((team) => team.isPrimary && team.regionName);
  const local = teams.find((team) => team.regionName && countryLabel(team.countryId, team.countryName) === countryLabel(countryId, countryName));
  const region = primary?.regionName ?? local?.regionName;
  const country = countrySegment({ countryId, countryName });
  return country ? asSegments(region ? `${region}, ` : '', country) : [];
}

function roleHeadline(managerName: string, roles: NationalTeamRole[], official: OfficialRole | null): StorySegment[] | null {
  if (!roles.length && !official) return null;
  const roleNames: Record<OfficialRole, string> = {
    hattrick_staff: 'a Hattrick staff member', game_master: 'a Hattrick Game Master',
    moderator: 'a Hattrick moderator', language_assistant: 'a Hattrick Language Assistant',
  };
  const priority = (role: NationalTeamRole) => (role.type === 'coach' ? 30 : role.type === 'assistant' ? 20 : 10) - (role.isU21 ? 1 : 0);
  const ordered = roles.toSorted((a, b) => priority(b) - priority(a) || a.nationalTeamName.localeCompare(b.nationalTeamName));
  const primary = ordered[0];
  const primaryCountry = primary ? countrySegment({ countryId: primary.countryId, countryName: primary.nationalTeamName.replace(/^U21\s+/i, '') }) : null;
  const parts: StorySegment[] = [`${managerName} `];
  if (official) {
    append(parts, `is ${roleNames[official]}`);
    if (primary) append(parts, ' and also ');
  }
  if (primary) {
    if (primary.type === 'coach') {
      append(parts, primaryCountry ? (primary.isU21 ? 'currently coaches the U21 national team of ' : 'currently coaches ') : 'currently coaches a national team', primaryCountry, primaryCountry && !primary.isU21 ? "'s national team" : '');
    } else if (primary.type === 'assistant') {
      append(parts, primaryCountry ? (primary.isU21 ? 'is an assistant coach with the U21 ' : 'is an assistant coach with ') : 'serves on a national team staff', primaryCountry);
    } else {
      append(parts, primaryCountry ? (primary.isU21 ? 'serves as a scout for the U21 national team of ' : 'serves as a scout for ') : 'serves as a national-team scout', primaryCountry, primaryCountry && !primary.isU21 ? "'s national team" : '');
    }
    const additional = ordered.length - 1;
    if (additional > 0) append(parts, ` and holds ${countWord(additional)} additional national-team staff ${additional === 1 ? 'role' : 'roles'}`);
  }
  append(parts, '.');
  return parts;
}

function divisionText(team: ManagerSpotlightTeam) { return team.seriesName ? `division ${team.seriesName}` : null; }
function validDisplayRank(team: ManagerSpotlightTeam) {
  if (!team.leagueRank || team.leagueRank <= 0) return null;
  if (team.leagueId && SPECIAL_LEAGUES[team.leagueId]?.shortName === 'HFI') return null;
  return team.leagueRank;
}

function buildCandidates(input: {
  managerId: number; managerName: string; official: OfficialRole | null; roles: NationalTeamRole[];
  teams: ManagerSpotlightTeam[]; tournamentTeam: ManagerSpotlightTeam; managerCountry: CountryMention | null; dateKey: string;
}): StoryCandidate[] {
  const { managerName, official, roles, teams, tournamentTeam, managerCountry } = input;
  const candidates: StoryCandidate[] = [];
  const role = roleHeadline(managerName, roles, official);
  if (role) candidates.push({ id: 'exceptional-role', topic: 'exceptional-role', tier: 0, score: 100, mandatory: true, tags: ['manager-role'], segments: role });

  const special = tournamentTeam.leagueId ? SPECIAL_LEAGUES[tournamentTeam.leagueId] : null;
  const division = divisionText(tournamentTeam);
  const rank = validDisplayRank(tournamentTeam);
  const tournament: StorySegment[] = [];
  const tournamentClubSubject = `${tournamentTeam.teamName}${tournamentTeam.isPrimary ? ', the main club,' : ''}`;
  if (special?.shortName === 'HFI') {
    append(tournament, `${managerName} is competing here with ${tournamentClubSubject}, currently playing in HFI`, division ? ` series ${tournamentTeam.seriesName}.` : '.');
  } else if (special?.shortName === 'Homegrown') {
    append(tournament, `${tournamentClubSubject} represents ${managerName} here, originally competing in Homegrown`, division ? ` series ${tournamentTeam.seriesName}.` : '.');
  } else {
    append(tournament, `${tournamentClubSubject} represents ${managerName} here`);
    if (division) append(tournament, `, playing in ${tournamentTeam.seriesName}`);
    if (rank) append(tournament, `${division ? ' at' : ', at'} league rank #${rank}`);
    append(tournament, '.');
  }
  candidates.push({ id: `tournament:${tournamentTeam.teamId}`, topic: 'tournament', tier: 1, score: 100, mandatory: true, tags: ['tournament-team', `team:${tournamentTeam.teamId}`], segments: tournament });

  const primary = teams.find((team) => team.isPrimary && team.teamId !== tournamentTeam.teamId);
  if (primary) {
    const year = Number(primary.foundedDate?.slice(0, 4));
    const validYear = Number.isInteger(year) && year > 1800;
    const hasDetails = validYear || primary.seriesName;
    const parts: StorySegment[] = hasDetails
      ? [`The main club, ${primary.teamName},`]
      : [`${primary.teamName} is the manager's current senior club`];
    if (validYear) append(parts, ` was founded in ${year}`);
    if (primary.seriesName) append(parts, `${validYear ? ' and' : ''} currently plays in ${primary.seriesName}`);
    append(parts, '.');
    candidates.push({ id: `primary:${primary.teamId}`, topic: 'primary-club', tier: 2, score: 100, tags: ['primary-club', `team:${primary.teamId}`], segments: parts });
  }

  const trophyScores: Partial<Record<TrophyKind, number>> = {
    world_cup_gold: 120, world_cup_silver: 115, world_cup_bronze: 110, masters: 110,
    national_cup: 100, league: 85, challenger_cup: 75, consolation_cup: 70,
    series: 55, tournament: 45,
  };
  for (const team of teams) {
    const trophy = team.trophies.toSorted((a, b) => (trophyScores[b.kind] ?? 0) - (trophyScores[a.kind] ?? 0))[0];
    const score = trophy ? trophyScores[trophy.kind] : undefined;
    if (!trophy || score === undefined) continue;
    const year = trophy.gainedDate?.slice(0, 4);
    const country = countrySegment(team);
    let segments: StorySegment[];
    if (trophy.kind === 'national_cup') segments = asSegments(`${team.teamName} won `, country ? country : 'the', country ? "'s National Cup" : ' National Cup', year ? ` in ${year}.` : '.');
    else if (trophy.kind === 'world_cup_gold') segments = [`${team.teamName} has a World Cup gold medal${year ? ` from ${year}` : ''}.`];
    else if (trophy.kind === 'world_cup_silver') segments = [`${team.teamName} has a World Cup silver medal${year ? ` from ${year}` : ''}.`];
    else if (trophy.kind === 'world_cup_bronze') segments = [`${team.teamName} has a World Cup bronze medal${year ? ` from ${year}` : ''}.`];
    else if (trophy.kind === 'masters') segments = [`${team.teamName} has won Hattrick Masters${year ? ` in ${year}` : ''}.`];
    else if (trophy.kind === 'league') segments = [`${team.teamName} has a league title${year ? ` from ${year}` : ''}.`];
    else if (trophy.kind === 'series') segments = [`${team.teamName} has won a series title${year ? ` in ${year}` : ''}.`];
    else if (trophy.kind === 'tournament') segments = [`${team.teamName} has won ${trophy.leagueLevelUnitName || 'a tournament'}${year ? ` in ${year}` : ''}.`];
    else segments = [`${team.teamName} has won a cup${year ? ` in ${year}` : ''}.`];
    candidates.push({ id: `trophy:${team.teamId}:${trophy.typeId}:${trophy.season ?? ''}`, topic: 'achievement', tier: 3, score, tags: ['achievement', `team:${team.teamId}`], segments });
    const repeated = team.trophies.filter((item) => item.kind === 'series').length;
    if (repeated > 1) candidates.push({ id: `series-count:${team.teamId}`, topic: 'achievement', tier: 3, score: 60 + Math.min(repeated, 20), tags: ['achievement', `team:${team.teamId}`], segments: [`${team.teamName} has collected ${repeated} series titles.`] });
  }

  for (const team of teams) {
    const teamRank = validDisplayRank(team);
    if (!teamRank || teamRank > 100) continue;
    const parts = [`${team.teamName} holds league rank #${teamRank}.`];
    candidates.push({ id: `rank:${team.teamId}`, topic: 'rank', tier: 3, score: 100 - teamRank, tags: ['rank', `team:${team.teamId}`], segments: parts });
  }

  const oldest = teams.filter((team) => /^\d{4}/.test(team.foundedDate ?? '')).toSorted((a, b) =>
    String(a.foundedDate).localeCompare(String(b.foundedDate)) || a.teamId - b.teamId)[0];
  if (oldest && oldest.foundedDate) {
    const year = Number(oldest.foundedDate.slice(0, 4));
    if (Number.isInteger(year) && year > 1800) {
      const age = Math.max(0, Number(input.dateKey.slice(0, 4)) - year);
      const sentence = teams.length === 1
        ? (age <= 2 ? `${oldest.teamName} was founded in ${year}, making this a relatively recent setup.` : age >= 15 ? `The single current senior club, ${oldest.teamName}, was founded in ${year}.` : `${oldest.teamName} was founded in ${year}.`)
        : age <= 2 ? `The current setup is relatively recent, with ${oldest.teamName} founded in ${year}.`
          : age >= 15 ? `The current club history stretches back to ${year} with ${oldest.teamName}.`
            : `${oldest.teamName} dates from ${year}.`;
      candidates.push({ id: 'history', topic: 'history', tier: 4, score: age >= 20 ? 80 : age >= 8 ? 65 : age <= 2 ? 50 : 40, tags: ['history', `team:${oldest.teamId}`], segments: [sentence] });
    }
  }

  const knownCountries = teams.map((team) => ({ team, country: countrySegment(team) })).filter((entry) => entry.country);
  if (knownCountries.length === teams.length) {
    const countryCounts = new Map<string, { country: CountryMention; count: number }>();
    for (const { country } of knownCountries) {
      const key = `${country!.countryId}:${country!.name}`;
      const previous = countryCounts.get(key);
      countryCounts.set(key, { country: country!, count: (previous?.count ?? 0) + 1 });
    }
    const sortedCountries = Array.from(countryCounts.values()).toSorted((a, b) => a.country.name.localeCompare(b.country.name));
    const allDifferent = countryCounts.size === teams.length;
    if (countryCounts.size === 1 && teams.length >= 3) {
      const onlyCountry = sortedCountries[0]!.country;
      const region = teams[0]?.regionName;
      const allSameRegion = Boolean(region && teams.every((team) => team.regionName === region));
      const segments = allSameRegion
        ? asSegments(`All ${countWord(teams.length)} current clubs are based in the ${region} region of `, onlyCountry, '.')
        : asSegments(`All ${countWord(teams.length)} current clubs are based in `, onlyCountry, '.');
      candidates.push({ id: 'footprint', topic: 'footprint', tier: 4, score: 60, tags: ['footprint'], segments });
    } else if (countryCounts.size > 1) {
      const homeKey = managerCountry ? `${managerCountry.countryId}:${managerCountry.name}` : null;
      const homeCount = homeKey ? countryCounts.get(homeKey)?.count ?? 0 : 0;
      const foreignCounts = sortedCountries.filter((item) => `${item.country.countryId}:${item.country.name}` !== homeKey);
      if (homeCount === 1 && foreignCounts.length === 1 && foreignCounts[0]!.count > 1) {
        candidates.push({
          id: 'footprint', topic: 'footprint', tier: 4, score: 75, tags: ['footprint'],
          segments: asSegments(`The manager has one current club in `, countryCounts.get(homeKey!)!.country,
            ` and ${countWord(foreignCounts[0]!.count)} in `, foreignCounts[0]!.country, '.'),
        });
      } else {
        const parts: StorySegment[] = [`The manager's ${teams.length} current clubs span ${countryCounts.size} countries`];
        if (allDifferent) {
          append(parts, ': ');
          sortedCountries.forEach((item, index, all) => append(parts, item.country, index < all.length - 2 ? ', ' : index === all.length - 2 ? ' and ' : ''));
          append(parts, '.');
        } else {
          const largest = sortedCountries.toSorted((a, b) => b.count - a.count || a.country.name.localeCompare(b.country.name))[0];
          append(parts, `, with ${countWord(largest.count)} based in `, largest.country, '.');
        }
        candidates.push({ id: 'footprint', topic: 'footprint', tier: 4, score: allDifferent ? 65 : 55, tags: ['footprint'], segments: parts });
      }
    }
  }
  const otherSpecial = teams.find((team) => team.teamId !== tournamentTeam.teamId && team.leagueId && SPECIAL_LEAGUES[team.leagueId]);
  if (otherSpecial?.leagueId) {
    const country = countrySegment(otherSpecial);
    const league = SPECIAL_LEAGUES[otherSpecial.leagueId];
    candidates.push({ id: `special:${otherSpecial.teamId}`, topic: 'footprint', tier: 4, score: 70, tags: ['special-league', `team:${otherSpecial.teamId}`], segments: asSegments(`${otherSpecial.teamName} adds a ${league.shortName} side`, country ? ' in ' : '', country, '.') });
  }

  const youth = teams.find((team) => team.youthTeamName);
  if (youth?.youthTeamName) candidates.push({ id: `youth:${youth.teamId}`, topic: 'colour', tier: 5, score: 25, tags: ['youth', `team:${youth.teamId}`], segments: [`${youth.teamName} also has a youth side, ${youth.youthTeamName}.`] });
  const largeFanclub = teams.filter((team) => (team.fanclubSize ?? 0) >= 50_000).toSorted((a, b) => (b.fanclubSize ?? 0) - (a.fanclubSize ?? 0))[0];
  if (largeFanclub) candidates.push({ id: `fanclub:${largeFanclub.teamId}`, topic: 'colour', tier: 5, score: 20, tags: ['fanclub', `team:${largeFanclub.teamId}`], segments: [`${largeFanclub.teamName}'s fan club has ${largeFanclub.fanclubSize!.toLocaleString('en-US')} members.`] });
  const arena = teams.find((team) => team.arenaName);
  if (arena?.arenaName) candidates.push({ id: `arena:${arena.teamId}`, topic: 'colour', tier: 5, score: 10, tags: ['arena', `team:${arena.teamId}`], segments: [`${arena.teamName} plays at ${arena.arenaName}.`] });

  return candidates;
}

function candidateConflicts(candidate: StoryCandidate, selected: StoryCandidate[]) {
  const tags = new Set(candidate.tags);
  return selected.some((item) => item.id === candidate.id || (candidate.topic === 'rank' && item.topic === 'tournament' && candidate.tags.some((tag) => item.tags.includes(tag))) || (candidate.topic === item.topic && candidate.topic === 'footprint') ||
    ((candidate.topic === 'rank' && item.topic === 'achievement') || (candidate.topic === 'achievement' && item.topic === 'rank')) && candidate.tags.some((tag) => item.tags.includes(tag)) ||
    (candidate.topic === 'history' && item.topic === 'primary-club' && candidate.tags.some((tag) => item.tags.includes(tag))) ||
    item.tags.some((tag) => tags.has(tag) && tag.startsWith('team:') && candidate.topic === item.topic));
}

export function selectStoryCandidates(candidates: StoryCandidate[], managerId: number, dateKey: string, targetSentences = 3, maxSentences = 4): StoryCandidate[] {
  const cap = Math.max(2, Math.min(4, Math.floor(maxSentences)));
  const target = Math.max(2, Math.min(cap, Math.floor(targetSentences)));
  const byPriority = (a: StoryCandidate, b: StoryCandidate) => a.tier - b.tier || b.score - a.score ||
    (stableHash(`${managerId}:${dateKey}:${a.id}`) - stableHash(`${managerId}:${dateKey}:${b.id}`)) || a.id.localeCompare(b.id);
  const selected = candidates.filter((item) => item.mandatory).toSorted(byPriority).slice(0, cap);
  const pool = candidates.filter((item) => !item.mandatory).toSorted(byPriority);
  for (const candidate of pool) {
    if (selected.length >= target) break;
    if (!candidateConflicts(candidate, selected)) selected.push(candidate);
  }
  if (selected.length < cap) {
    for (const candidate of pool) {
      if (candidate.tier > 3 || candidate.score < 75 || selected.includes(candidate) || candidateConflicts(candidate, selected)) continue;
      selected.push(candidate);
      if (selected.length >= cap) break;
    }
  }
  return selected.toSorted((a, b) => a.tier - b.tier || byPriority(a, b));
}

export function composeManagerStory(input: {
  managerId: number; managerName: string; nationalTeamRoles: NationalTeamRole[]; teams: ManagerSpotlightTeam[];
  tournamentTeam: ManagerSpotlightTeam; managerCountryId?: number | null; managerCountryName?: string | null;
  dateKey: string; targetSentences?: number; maxSentences?: number;
}): { sentences: StorySentence[]; candidates: StoryCandidate[] } {
  const candidates = buildCandidates({
    managerId: input.managerId,
    managerName: input.managerName,
    official: detectOfficialRole(input.managerName),
    roles: input.nationalTeamRoles,
    teams: input.teams,
    tournamentTeam: input.tournamentTeam,
    managerCountry: countrySegment({ countryId: positive(input.managerCountryId), countryName: textOrNull(input.managerCountryName) }),
    dateKey: input.dateKey,
  });
  const selected = selectStoryCandidates(candidates, input.managerId, input.dateKey, input.targetSentences, input.maxSentences);
  return {
    sentences: selected.map((candidate) => ({ candidateId: candidate.id, segments: candidate.segments })),
    candidates,
  };
}

export function buildManagerSpotlight(input: {
  tournamentId: string; participants: ManagerSpotlightParticipant[]; profiles: ManagerSpotlightProfile[]; dateKey: string;
}): ManagerSpotlight | null {
  const selected = selectDailySpotlightParticipant(input.tournamentId, input.participants, input.dateKey);
  if (!selected?.hattrick_user_id || !selected.ht_team_id) return null;
  const managerId = Number(selected.hattrick_user_id);
  const profile = input.profiles.find((candidate) => Number(candidate.hattrick_user_id) === managerId);
  const participants = input.participants.filter((participant) => Number(participant.hattrick_user_id) === managerId);
  const byId = new Map<number, ManagerSpotlightTeam>();
  if (Array.isArray(profile?.teams_json)) {
    for (const raw of profile.teams_json) {
      const record = asRecord(raw);
      if (!record) continue;
      const team = normalizeTeam(record);
      if (team) byId.set(team.teamId, team);
    }
  }
  const tournamentIds = new Set(participants.map((participant) => positive(participant.ht_team_id)).filter((id): id is number => id !== null));
  for (const participant of participants) {
    const teamId = positive(participant.ht_team_id);
    if (!teamId) continue;
    const existing = byId.get(teamId);
    byId.set(teamId, {
      ...(existing ?? normalizeTeam({ teamId, teamName: participant.name })!),
      teamId,
      teamName: existing?.teamName || participant.name || `Team ${teamId}`,
      logoUrl: existing?.logoUrl || participant.logo_url || null,
      countryId: existing?.countryId || positive(participant.country_id),
      countryName: existing?.countryName || participant.country_name || null,
      leagueId: existing?.leagueId || positive(participant.league_id),
      isTournamentTeam: true,
    });
  }
  const currentTeams = [...byId.values()].map((team) => ({ ...team, isTournamentTeam: tournamentIds.has(team.teamId) }))
    .toSorted((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.teamName.localeCompare(b.teamName));
  const tournamentTeam = currentTeams.find((team) => team.teamId === Number(selected.ht_team_id));
  if (!tournamentTeam) return null;
  const managerName = profile?.manager_name || selected.manager_name || `Manager ${managerId}`;
  const roles = normalizeNationalTeamRoles(profile?.national_team_roles_json);
  const story = composeManagerStory({ managerId, managerName, nationalTeamRoles: roles, teams: currentTeams, tournamentTeam,
    managerCountryId: profile?.country_id, managerCountryName: profile?.country_name, dateKey: input.dateKey });
  return {
    managerId, managerName, avatar: profile?.avatar_json || null,
    location: locationSegments(profile, currentTeams), language: profile?.language_name || null,
    currentTeams, tournamentTeamId: tournamentTeam.teamId,
    story: story.sentences,
  };
}
