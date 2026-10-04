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

export type StoryTopic = 'exceptional-role' | 'tournament' | 'primary-club' | 'achievement' | 'footprint' | 'colour';
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

export function getSpecialLeagueLabel(leagueId: number | null): string | null {
  const league = getLeagueWorldDetails(leagueId);
  return league && league.countryId === null ? league.suffix ?? league.leagueName : null;
}

export function getClubRankLabel(team: Pick<ManagerSpotlightTeam, 'leagueRank' | 'leagueId'>): string | null {
  if (!team.leagueRank || team.leagueRank <= 0) return null;
  const special = getSpecialLeagueLabel(team.leagueId);
  if (special) return `#${team.leagueRank} in ${special}`;
  return `League rank #${team.leagueRank}`;
}

export function getFoundedYearLabel(team: Pick<ManagerSpotlightTeam, 'foundedDate'>): string | null {
  const year = Number(team.foundedDate?.slice(0, 4));
  return Number.isInteger(year) && year > 1800 ? `Founded ${year}` : null;
}

export function getVisibleClubTeams(spotlight: Pick<ManagerSpotlight, 'currentTeams' | 'tournamentTeamId'>): ManagerSpotlightTeam[] {
  const tournament = spotlight.currentTeams.find((team) => team.teamId === spotlight.tournamentTeamId);
  const primary = spotlight.currentTeams.find((team) => team.isPrimary);
  return [tournament, primary].filter((team, index, teams): team is ManagerSpotlightTeam =>
    Boolean(team) && teams.findIndex((item) => item?.teamId === team?.teamId) === index);
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
      append(parts, primaryCountry ? (primary.isU21 ? 'currently coaches the U21 national team of ' : 'currently coaches the national team of ') : 'currently coaches a national team', primaryCountry);
    } else if (primary.type === 'assistant') {
      append(parts, primaryCountry ? (primary.isU21 ? 'is an assistant coach with the U21 ' : 'is an assistant coach with ') : 'serves on a national team staff', primaryCountry);
    } else {
      append(parts, primaryCountry ? (primary.isU21 ? 'serves as a scout for the U21 national team of ' : 'serves as a scout for the national team of ') : 'serves as a national-team scout', primaryCountry);
    }
    const additional = ordered.length - 1;
    if (additional > 0) append(parts, ` and holds ${countWord(additional)} additional national-team staff ${additional === 1 ? 'role' : 'roles'}`);
  }
  append(parts, '.');
  return parts;
}

function validDisplayRank(team: ManagerSpotlightTeam) {
  if (!team.leagueRank || team.leagueRank <= 0) return null;
  return team.leagueRank;
}

function regularRankCountry(team: ManagerSpotlightTeam): CountryMention | null {
  const league = getLeagueWorldDetails(team.leagueId);
  return league?.countryId ? countrySegment({ countryId: league.countryId, countryName: league.fullName }) : null;
}

function buildCandidates(input: {
  managerId: number; managerName: string; official: OfficialRole | null; roles: NationalTeamRole[];
  teams: ManagerSpotlightTeam[]; tournamentTeam: ManagerSpotlightTeam;
}): StoryCandidate[] {
  const { managerName, official, roles, teams, tournamentTeam } = input;
  const candidates: StoryCandidate[] = [];
  const role = roleHeadline(managerName, roles, official);
  if (role) candidates.push({ id: 'exceptional-role', topic: 'exceptional-role', tier: 0, score: 100, mandatory: true, tags: ['manager-role'], segments: role });

  const special = getSpecialLeagueLabel(tournamentTeam.leagueId);
  const rank = validDisplayRank(tournamentTeam);
  const rankCountry = rank ? regularRankCountry(tournamentTeam) : null;
  const tournament: StorySegment[] = [`${managerName} is competing here with ${tournamentTeam.teamName}`];
  const tournamentCountry = countrySegment(tournamentTeam);
  if (special) {
    if (tournamentCountry) append(tournament, ', based in ', tournamentCountry);
    if (rank) append(tournament, ', currently ranked #', String(rank), ` in ${special}`);
    if (tournamentTeam.seriesName) append(tournament, rank ? ' and playing in ' : tournamentCountry ? ' and currently playing in ' : ', currently playing in ', rank ? '' : `${special} `, `series ${tournamentTeam.seriesName}`);
  } else {
    if (tournamentCountry && !rankCountry) append(tournament, ' in ', tournamentCountry);
    if (rank || tournamentTeam.seriesName) {
      if (rankCountry) append(tournament, `, currently ranked #${rank} in `, rankCountry);
      else append(tournament, rank ? `, currently at league rank #${rank}` : ', currently');
      if (tournamentTeam.seriesName) append(tournament, `${rank ? ' and' : ''} playing in series ${tournamentTeam.seriesName}`);
    }
  }
  append(tournament, '.');
  candidates.push({ id: `tournament:${tournamentTeam.teamId}`, topic: 'tournament', tier: 1, score: 100, mandatory: true, tags: ['tournament-team', `team:${tournamentTeam.teamId}`], segments: tournament });

  const primary = teams.find((team) => team.isPrimary);
  if (primary) {
    const year = Number(primary.foundedDate?.slice(0, 4));
    const validYear = Number.isInteger(year) && year > 1800;
    const sameAsTournament = primary.teamId === tournamentTeam.teamId;
    const primaryRank = sameAsTournament ? null : validDisplayRank(primary);
    const primaryCountry = countrySegment(primary);
    const region = primary.regionName;
    const parts: StorySegment[] = asSegments(`The main club, ${primary.teamName}`, region ? ` in ${region}` : '', primaryCountry ? region ? ', ' : ' in ' : '', primaryCountry, ',');
    const details: StorySegment[][] = [];
    if (validYear) details.push([`was founded in ${year}`]);
    if (primaryRank) {
      const specialRank = getSpecialLeagueLabel(primary.leagueId);
      const rankCountry = primaryCountry ? null : regularRankCountry(primary);
      details.push(specialRank ? [`is ranked #${primaryRank} in ${specialRank}`]
        : rankCountry ? asSegments(`is ranked #${primaryRank} in `, rankCountry)
          : [`holds league rank #${primaryRank}`]);
    }
    if (primary.seriesName && !sameAsTournament) details.push([`plays in series ${primary.seriesName}`]);
    if (details.length) details.forEach((detail, index) => append(parts, index === 0 ? ' ' : index === details.length - 1 ? ' and ' : ', ', ...detail));
    else {
      parts.length = 0;
      append(parts, `${primary.teamName} is the manager's main club`, region ? ` in ${region}` : '', primaryCountry ? region ? ', ' : ' in ' : '', primaryCountry);
    }
    append(parts, '.');
    if (!sameAsTournament || details.length) candidates.push({ id: `primary:${primary.teamId}`, topic: 'primary-club', tier: 2, score: 100, tags: ['primary-club', `team:${primary.teamId}`], segments: parts });
  }

  const trophyScores: Partial<Record<TrophyKind, number>> = {
    world_cup_gold: 120, world_cup_silver: 115, world_cup_bronze: 110, masters: 110,
    national_cup: 100, league: 85, challenger_cup: 80, consolation_cup: 75,
  };
  for (const team of teams) {
    const repeated = team.trophies.filter((item) => item.kind === 'series').length;
    if (repeated >= 5) candidates.push({ id: `series-count:${team.teamId}`, topic: 'achievement', tier: 3, score: 60 + Math.min(repeated, 10), tags: ['achievement', `team:${team.teamId}`], segments: [`${team.teamName} has collected ${repeated} series titles.`] });
    const trophy = team.trophies.toSorted((a, b) => (trophyScores[b.kind] ?? 0) - (trophyScores[a.kind] ?? 0))[0];
    const score = trophy ? trophyScores[trophy.kind] : undefined;
    if (!trophy || score === undefined) continue;
    const year = trophy.gainedDate?.slice(0, 4);
    const country = countrySegment(team);
    let segments: StorySegment[];
    if (trophy.kind === 'national_cup') segments = asSegments(`${team.teamName} won the National Cup`, country ? ' in ' : '', country, year ? ` in ${year}.` : '.');
    else if (trophy.kind === 'world_cup_gold') segments = [`${team.teamName} has a World Cup gold medal${year ? ` from ${year}` : ''}.`];
    else if (trophy.kind === 'world_cup_silver') segments = [`${team.teamName} has a World Cup silver medal${year ? ` from ${year}` : ''}.`];
    else if (trophy.kind === 'world_cup_bronze') segments = [`${team.teamName} has a World Cup bronze medal${year ? ` from ${year}` : ''}.`];
    else if (trophy.kind === 'masters') segments = [`${team.teamName} has won Hattrick Masters${year ? ` in ${year}` : ''}.`];
    else if (trophy.kind === 'league') segments = [`${team.teamName} has a league title${year ? ` from ${year}` : ''}.`];
    else segments = [`${team.teamName} has won a cup${year ? ` in ${year}` : ''}.`];
    candidates.push({ id: `trophy:${team.teamId}:${trophy.typeId}:${trophy.season ?? ''}`, topic: 'achievement', tier: 3, score, tags: ['achievement', `team:${team.teamId}`], segments });
  }

  const primaryId = primary?.teamId;
  const shownCountries = new Set(
    teams.filter((team) => team.teamId === tournamentTeam.teamId || team.teamId === primaryId)
      .map((team) => countrySegment(team)?.name).filter(Boolean),
  );
  const otherTeams = teams.filter((team) => team.teamId !== tournamentTeam.teamId && team.teamId !== primaryId);
  const otherCountries = new Map<string, CountryMention>();
  for (const team of otherTeams) {
    const country = countrySegment(team);
    if (country && !shownCountries.has(country.name)) otherCountries.set(country.name, country);
  }
  const countries = [...otherCountries.values()];
  if (countries.length) {
    const parts: StorySegment[] = [`${managerName} also runs ${otherTeams.length === 1 ? 'a club' : 'clubs'} in `];
    countries.forEach((country, index) => append(parts, country.name === 'Faroe Islands' ? 'the ' : '', country, index < countries.length - 2 ? ', ' : index === countries.length - 2 ? ' and ' : ''));
    append(parts, '.');
    candidates.push({ id: 'footprint', topic: 'footprint', tier: 4, score: 50, tags: ['footprint'], segments: parts });
  }

  if (!otherTeams.length) {
    const youth = teams.find((team) => team.youthTeamName);
    if (youth?.youthTeamName) candidates.push({ id: `youth:${youth.teamId}`, topic: 'colour', tier: 5, score: 25, tags: ['youth', `team:${youth.teamId}`], segments: [`${youth.teamName} also has a youth side, ${youth.youthTeamName}.`] });
  }

  return candidates;
}

function candidateConflicts(candidate: StoryCandidate, selected: StoryCandidate[]) {
  return selected.some((item) => item.id === candidate.id || (candidate.topic === item.topic &&
    (candidate.topic === 'footprint' || candidate.tags.some((tag) => tag.startsWith('team:') && item.tags.includes(tag)))));
}

export function selectStoryCandidates(candidates: StoryCandidate[], managerId: number, dateKey: string, targetSentences = 3, maxSentences = 4): StoryCandidate[] {
  const cap = Math.max(2, Math.min(4, Math.floor(maxSentences)));
  const target = Math.max(2, Math.min(cap, Math.floor(targetSentences)));
  const byPriority = (a: StoryCandidate, b: StoryCandidate) => a.tier - b.tier || b.score - a.score ||
    (stableHash(`${managerId}:${dateKey}:${a.id}`) - stableHash(`${managerId}:${dateKey}:${b.id}`)) || a.id.localeCompare(b.id);
  const selected = candidates.filter((item) => item.mandatory).toSorted(byPriority).slice(0, cap);
  const pool = candidates.filter((item) => !item.mandatory).toSorted(byPriority);
  const primary = pool.find((candidate) => candidate.topic === 'primary-club' && !candidateConflicts(candidate, selected));
  if (primary && selected.length < cap) selected.push(primary);
  const exceptional = selected.some((candidate) => candidate.topic === 'exceptional-role');
  const canUseSupportingFact = selected.length < target || (exceptional && selected.length < cap);
  if (canUseSupportingFact) {
    const supporting = pool.find((candidate) => candidate !== primary && candidate.topic !== 'primary-club'
      && (!exceptional || selected.length < target || (candidate.topic === 'achievement' && candidate.score >= 65))
      && !candidateConflicts(candidate, selected));
    if (supporting) selected.push(supporting);
  }
  return selected.toSorted((a, b) => a.tier - b.tier || byPriority(a, b));
}

export function composeManagerStory(input: {
  managerId: number; managerName: string; nationalTeamRoles: NationalTeamRole[]; teams: ManagerSpotlightTeam[];
  tournamentTeam: ManagerSpotlightTeam;
  dateKey: string; targetSentences?: number; maxSentences?: number;
}): { sentences: StorySentence[]; candidates: StoryCandidate[] } {
  const candidates = buildCandidates({
    managerId: input.managerId,
    managerName: input.managerName,
    official: detectOfficialRole(input.managerName),
    roles: input.nationalTeamRoles,
    teams: input.teams,
    tournamentTeam: input.tournamentTeam,
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
    dateKey: input.dateKey });
  return {
    managerId, managerName, avatar: profile?.avatar_json || null,
    location: locationSegments(profile, currentTeams), language: profile?.language_name || null,
    currentTeams, tournamentTeamId: tournamentTeam.teamId,
    story: story.sentences,
  };
}
