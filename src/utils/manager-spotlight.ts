import { getCountryIdByName, getCountryWorldDetails, getLeagueWorldDetails, HATTRICK_WORLD_DETAILS, resolveCountryRestriction, type CountryRestrictionFormat } from '../../shared/worlddetails.js';
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
export interface StrongMention { kind: 'strong'; text: string }
export type StorySegment = string | CountryMention | StrongMention;
export interface StorySentence {
  candidateId: string;
  segments: StorySegment[];
  paragraphId?: string;
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
  numberOfVictories?: number | null;
  homeFlagLeagueIds?: number[];
  awayFlagLeagueIds?: number[];
  genderId?: number | null;
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

export type StoryTopic = 'exceptional-role' | 'tournament' | 'primary-club' | 'other-club' | 'club-facts' | 'footprint' | 'history' | 'colour';
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
const positiveIds = (value: unknown): number[] => Array.isArray(value)
  ? [...new Set(value.map(positive).filter((id): id is number => id !== null))].sort((a, b) => a - b)
  : [];
const textOrNull = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const countWord = (n: number) => n <= 9 ? ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][n] : String(n);
const countrySegment = (team: Pick<ManagerSpotlightTeam, 'countryId' | 'countryName'>): CountryMention | null => {
  const name = countryLabel(team.countryId, team.countryName);
  return name ? { kind: 'country', countryId: team.countryId, name } : null;
};
const strong = (text: string): StrongMention => ({ kind: 'strong', text });
type StoryValue = StorySegment | StorySegment[] | number | null | undefined;
function story(strings: TemplateStringsArray, ...values: StoryValue[]): StorySegment[] {
  const segments: StorySegment[] = [];
  const add = (value: StoryValue): void => {
    if (Array.isArray(value)) { value.forEach(add); return; }
    if (value === null || value === undefined || value === '') return;
    const segment = typeof value === 'number' ? String(value) : value;
    if (typeof segment === 'string' && typeof segments.at(-1) === 'string') segments[segments.length - 1] += segment;
    else segments.push(segment);
  };
  strings.forEach((part, index) => { add(part); if (index < values.length) add(values[index]); });
  return segments;
}

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

export function getSpotlightTournamentLabel(context: {
  name: string;
  countryLimit?: string | null;
  countryLimitFormat?: CountryRestrictionFormat | null;
}): StorySegment[] {
  const country = resolveCountryRestriction(context.countryLimit, context.countryLimitFormat);
  const name = context.name.trim();
  if (!country?.countryId) return [name || 'this tournament'];

  const title = name.replace(` ${country.emoji}`, '');
  const countryName = [country.fullName, country.leagueName].find((value) => title.includes(value));
  const mention: CountryMention = { kind: 'country', countryId: country.countryId, name: countryName || country.fullName };
  if (!countryName) return [title || 'this tournament', ' — ', mention];
  const countryIndex = title.lastIndexOf(countryName);
  return [title.slice(0, countryIndex), mention, title.slice(countryIndex + countryName.length)];
}

export function getSpecialLeagueLabel(leagueId: number | null): string | null {
  const league = getLeagueWorldDetails(leagueId);
  return league && league.countryId === null ? league.suffix ?? league.leagueName : null;
}

export function getClubRankLabel(team: Pick<ManagerSpotlightTeam, 'leagueRank' | 'leagueId'>): string | null {
  if (!team.leagueRank || team.leagueRank <= 0) return null;
  const special = getSpecialLeagueLabel(team.leagueId);
  if (special) return `Ranked #${team.leagueRank} in ${special}`;
  return `Ranked #${team.leagueRank}`;
}

export function getFoundedYearLabel(team: Pick<ManagerSpotlightTeam, 'foundedDate'>): string | null {
  const year = Number(team.foundedDate?.slice(0, 4));
  return Number.isInteger(year) && year > 1800 ? `Founded ${year}` : null;
}

export function getVisibleClubTeams(spotlight: Pick<ManagerSpotlight, 'currentTeams' | 'tournamentTeamId'>): ManagerSpotlightTeam[] {
  return spotlight.currentTeams.toSorted((a, b) => {
    const aTournament = a.teamId === spotlight.tournamentTeamId;
    const bTournament = b.teamId === spotlight.tournamentTeamId;
    if (aTournament !== bTournament) return aTournament ? -1 : 1;
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    const aFounded = Date.parse(a.foundedDate?.slice(0, 10) ?? '');
    const bFounded = Date.parse(b.foundedDate?.slice(0, 10) ?? '');
    if (Number.isFinite(aFounded) && Number.isFinite(bFounded) && aFounded !== bFounded) return aFounded - bFounded;
    if (Number.isFinite(aFounded) !== Number.isFinite(bFounded)) return Number.isFinite(aFounded) ? -1 : 1;
    return a.teamName.localeCompare(b.teamName) || a.teamId - b.teamId;
  });
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
    numberOfVictories: positive(raw.numberOfVictories ?? raw.number_of_victories),
    homeFlagLeagueIds: positiveIds(raw.homeFlagLeagueIds ?? raw.home_flag_league_ids),
    awayFlagLeagueIds: positiveIds(raw.awayFlagLeagueIds ?? raw.away_flag_league_ids),
    genderId: positive(raw.genderId ?? raw.gender_id),
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
  return country ? story`${region ? `${region}, ` : ''}${country}` : [];
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
  let duty: StorySegment[] = [];
  if (primary?.type === 'coach') duty = primaryCountry
    ? story`currently coaches the ${primary.isU21 ? 'U21 national team' : 'national team'} of ${primaryCountry}`
    : story`currently coaches a national team`;
  if (primary?.type === 'assistant') duty = primaryCountry
    ? story`is an assistant coach with ${primary.isU21 ? 'the U21 ' : ''}${primaryCountry}`
    : story`serves on a national team staff`;
  if (primary?.type === 'scout') duty = primaryCountry
    ? story`serves as a scout for the ${primary.isU21 ? 'U21 national team' : 'national team'} of ${primaryCountry}`
    : story`serves as a national-team scout`;
  const additional = ordered.length - 1;
  const extra = additional > 0 ? story` and holds ${countWord(additional)} additional national-team staff ${additional === 1 ? 'role' : 'roles'}` : [];
  if (official) return story`As the title already suggests, ${strong(managerName)} is ${roleNames[official]}${primary ? story` and also ${duty}${extra}` : ''}.`;
  return story`${strong(managerName)} ${duty}${extra}.`;
}

function validDisplayRank(team: ManagerSpotlightTeam) {
  if (!team.leagueRank || team.leagueRank <= 0) return null;
  return team.leagueRank;
}

function joinFactPhrases(phrases: StorySegment[][]): StorySegment[] {
  return phrases.flatMap((phrase, index) => story`${index === 0 ? '' : index === phrases.length - 1 ? phrases.length > 2 ? ', and ' : ' and ' : ', '}${phrase}`);
}

function buildClubFacts(team: ManagerSpotlightTeam): StoryCandidate | null {
  const trophyScores: Partial<Record<TrophyKind, number>> = {
    world_cup_gold: 120, world_cup_silver: 115, world_cup_bronze: 110, masters: 110,
    national_cup: 125, league: 85, challenger_cup: 80, consolation_cup: 75,
  };
  const trophies = team.trophies.toSorted((a, b) => (trophyScores[b.kind] ?? 0) - (trophyScores[a.kind] ?? 0));
  const nationalCup = trophies.find((item) => item.kind === 'national_cup');
  const otherTrophy = trophies.find((item) => item.kind !== 'national_cup' && trophyScores[item.kind]);
  const facts: Array<{ score: number; phrase: StorySegment[] }> = [];

  if (nationalCup) {
    const year = nationalCup.gainedDate?.slice(0, 4);
    const country = countrySegment(team);
    facts.push({ score: 125, phrase: story`National Cup victory${country ? story` in ${country}` : ''}${year ? ` in ${year}` : ''}` });
  }
  if (otherTrophy) {
    const year = otherTrophy.gainedDate?.slice(0, 4);
    const names: Partial<Record<TrophyKind, string>> = {
      world_cup_gold: 'World Cup gold medal', world_cup_silver: 'World Cup silver medal',
      world_cup_bronze: 'World Cup bronze medal', masters: 'Hattrick Masters title',
      league: 'league title', challenger_cup: 'Challenger Cup win', consolation_cup: 'Consolation Cup win',
    };
    facts.push({ score: trophyScores[otherTrophy.kind]!, phrase: story`a ${names[otherTrophy.kind]}${year ? ` in ${year}` : ''}` });
  }
  const rating = team.powerRating ?? 0;
  if (rating >= 850) facts.push({ score: 68 + Math.min(Math.floor((rating - 850) / 50), 15), phrase: story`a Power Rating of ${rating}` });
  const streak = team.numberOfVictories ?? 0;
  if (streak >= 3) facts.push({ score: 61 + Math.min(streak, 20), phrase: story`a ${streak}-match winning streak` });
  const seriesTitles = team.trophies.filter((item) => item.kind === 'series').length;
  if (seriesTitles >= 1) facts.push({ score: 58 + Math.min(seriesTitles * 2, 22), phrase: story`${countWord(seriesTitles)} series ${seriesTitles === 1 ? 'title' : 'titles'}` });
  const collectedCountries = new Set([...(team.homeFlagLeagueIds ?? []), ...(team.awayFlagLeagueIds ?? [])]
    .map((leagueId) => getLeagueWorldDetails(leagueId)?.countryId)
    .filter((countryId): countryId is number => typeof countryId === 'number' && countryId > 0));
  if (collectedCountries.size > 100) facts.push({
    score: 65 + Math.min(Math.floor((collectedCountries.size - 100) / 5), 25),
    phrase: story`flags from ${collectedCountries.size} countries`,
  });
  if (!facts.length) return null;

  // Four distinct facts are enough for a short profile; ordinary titles survive dense profiles before flag counts.
  const displayed = facts.slice(0, 4);
  const segments = nationalCup
    ? story`${strong(team.teamName)}'s ${displayed[0]!.phrase} stands out as a major Hattrick honour${displayed.length > 1 ? story`; the club also has ${joinFactPhrases(displayed.slice(1).map((fact) => fact.phrase))}` : ''}.`
    : story`${strong(team.teamName)} has ${joinFactPhrases(displayed.map((fact) => fact.phrase))}.`;
  return {
    id: `club-facts:${team.teamId}`, topic: 'club-facts', tier: 3,
    score: Math.max(...facts.map((fact) => fact.score)), tags: [`team:${team.teamId}`], segments,
  };
}

function buildCandidates(input: {
  managerId: number; managerName: string; official: OfficialRole | null; roles: NationalTeamRole[];
  teams: ManagerSpotlightTeam[]; tournamentTeam: ManagerSpotlightTeam; dateKey: string;
}): StoryCandidate[] {
  const { managerId, managerName, official, roles, teams, tournamentTeam, dateKey } = input;
  const candidates: StoryCandidate[] = [];
  const role = roleHeadline(managerName, roles, official);
  if (role) candidates.push({ id: 'exceptional-role', topic: 'exceptional-role', tier: 0, score: 100, mandatory: true, tags: ['manager-role'], segments: role });

  const special = getSpecialLeagueLabel(tournamentTeam.leagueId);
  const rank = validDisplayRank(tournamentTeam);
  const tournamentStyle = stableHash(`${managerId}:${dateKey}:tournament-wording`) % 3;
  const tournamentLead = tournamentStyle === 0
    ? story`${strong(managerName)} is competing here with ${strong(tournamentTeam.teamName)}`
    : tournamentStyle === 1
      ? story`${strong(managerName)} enters this tournament with ${strong(tournamentTeam.teamName)}`
      : story`${strong(tournamentTeam.teamName)} is ${strong(managerName)}'s side in this tournament`;
  const tournamentCountry = countrySegment(tournamentTeam);
  const location = tournamentCountry ? story`, based in ${tournamentCountry}` : [];
  const ranking = rank ? story`, ranked #${rank}${special ? ` in ${special}` : ''}` : [];
  const series = tournamentTeam.seriesName
    ? story`${rank ? ' and playing in ' : tournamentCountry ? ' and currently playing in ' : ', currently playing in '}series ${tournamentTeam.seriesName}`
    : [];
  const tournament = story`${tournamentLead}${location}${ranking}${series}.`;
  candidates.push({ id: `tournament:${tournamentTeam.teamId}`, topic: 'tournament', tier: 1, score: 100, mandatory: true, tags: ['tournament-team', `team:${tournamentTeam.teamId}`], segments: tournament });

  const primary = teams.find((team) => team.isPrimary);
  if (primary && primary.teamId !== tournamentTeam.teamId) {
    const year = Number(primary.foundedDate?.slice(0, 4));
    const validYear = Number.isInteger(year) && year > 1800;
    const primaryRank = validDisplayRank(primary);
    const primaryCountry = countrySegment(primary);
    const region = primary.regionName;
    const primaryStyle = stableHash(`${managerId}:${dateKey}:primary-wording`) % 3;
    const lead = primaryStyle === 0 ? story`Their main club, ${strong(primary.teamName)}`
      : primaryStyle === 1 ? story`The main club, ${strong(primary.teamName)}`
        : story`Their main club ${strong(primary.teamName)}`;
    const location = region ? story` is based in ${strong(region)}${primaryCountry ? story`, ${primaryCountry}` : ''}`
      : primaryCountry ? story` is based in ${primaryCountry}` : [];
    const details = [validYear ? `was founded in ${year}` : null,
      primaryRank ? `is ranked #${primaryRank}${getSpecialLeagueLabel(primary.leagueId) ? ` in ${getSpecialLeagueLabel(primary.leagueId)}` : ''}` : null,
      primary.seriesName ? `plays in series ${primary.seriesName}` : null].filter((detail): detail is string => !!detail);
    const detailText = details.map((detail, index) => `${index === 0 ? ', ' : index === details.length - 1 ? ' and ' : ', '}${detail}`).join('');
    const sentence = details.length
      ? story`${lead}${location}${detailText}.`
      : story`${strong(primary.teamName)} is ${strong(managerName)}'s main club${region ? story` in ${strong(region)}` : ''}${primaryCountry ? story`${region ? ', ' : ' in '}${primaryCountry}` : ''}.`;
    const contextScore = details.length > 1 ? 75 : details.length ? 65 : 50;
    candidates.push({ id: `primary:${primary.teamId}`, topic: 'primary-club', tier: 2, score: contextScore, tags: ['primary-club', `team:${primary.teamId}`], segments: sentence });
  }

  for (const team of teams) {
    const facts = buildClubFacts(team);
    if (facts) candidates.push(facts);
  }

  const primaryId = primary?.teamId;
  if (primaryId === tournamentTeam.teamId) {
    for (const team of teams.filter((item) => item.teamId !== tournamentTeam.teamId)) {
      const country = countrySegment(team);
      const rank = validDisplayRank(team);
      const year = Number(team.foundedDate?.slice(0, 4));
      const facts = candidates.filter((item) => item.tier === 3 && item.tags.includes(`team:${team.teamId}`));
      if (!country && !rank && !team.seriesName && !(year > 1800) && !facts.length) continue;
      const league = getSpecialLeagueLabel(team.leagueId);
      const location = country ? story` in ${country}` : [];
      const ranking = rank ? story`, ranked #${rank}${league ? ` in ${league}` : ''}` : [];
      const series = team.seriesName ? story`${rank ? ' and playing in ' : country ? ', playing in ' : ', currently playing in '}series ${team.seriesName}` : [];
      const founded = year > 1800 ? story`, founded in ${year}` : [];
      candidates.push({
        id: `other:${team.teamId}`, topic: 'other-club', tier: 2,
        score: Math.max(45 + (country ? 5 : 0) + (rank ? 5 : 0) + (team.seriesName ? 5 : 0) + (year > 1800 ? 5 : 0),
          ...facts.map((item) => item.score)),
        tags: ['other-club', `team:${team.teamId}`],
        segments: story`They also run ${strong(team.teamName)}${location}${ranking}${series}${founded}.`,
      });
    }
  }
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
  if (countries.length && primaryId !== tournamentTeam.teamId) {
    const places = countries.flatMap((country, index): StorySegment[] => story`${country.name === 'Faroe Islands' ? 'the ' : ''}${country}${index < countries.length - 2 ? ', ' : index === countries.length - 2 ? ' and ' : ''}`);
    candidates.push({ id: 'footprint', topic: 'footprint', tier: 3, score: 48 + Math.min(countries.length * 3, 12), tags: ['footprint'], segments: story`${strong(managerName)} also runs ${otherTeams.length === 1 ? 'a club' : 'clubs'} in ${places}.` });
  }

  if (!otherTeams.length) {
    const year = Number(tournamentTeam.foundedDate?.slice(0, 4));
    const currentYear = Number(dateKey.slice(0, 4));
    if (year > 1800 && currentYear - year >= 10) candidates.push({
      id: `history:${tournamentTeam.teamId}`, topic: 'history', tier: 3, score: 42,
      tags: ['club-history', `team:${tournamentTeam.teamId}`],
      segments: story`${strong(tournamentTeam.teamName)} has been part of Hattrick since ${year}.`,
    });
    const youth = teams.find((team) => team.youthTeamName);
    if (youth?.youthTeamName) candidates.push({ id: `youth:${youth.teamId}`, topic: 'colour', tier: 3, score: 25, tags: ['youth', `team:${youth.teamId}`], segments: story`${strong(youth.teamName)} also has a youth side, ${strong(youth.youthTeamName)}.` });
  }

  return candidates;
}

function candidateConflicts(candidate: StoryCandidate, selected: StoryCandidate[]) {
  return selected.some((item) => item.id === candidate.id || (candidate.topic === 'club-facts' && item.topic === 'club-facts'
    && candidate.tags.some((tag) => tag.startsWith('team:') && item.tags.includes(tag))));
}

function exceedsNamedClubLimit(candidate: StoryCandidate, selected: StoryCandidate[]) {
  const teamIds = new Set(
    [...selected, candidate].flatMap((item) => item.tags.filter((tag) => tag.startsWith('team:'))),
  );
  return teamIds.size > 2;
}

export function selectStoryCandidates(candidates: StoryCandidate[], managerId: number, dateKey: string, targetSentences = 3, maxSentences = 4): StoryCandidate[] {
  const cap = Math.max(2, Math.min(4, Math.floor(maxSentences)));
  const target = Math.max(2, Math.min(cap, Math.floor(targetSentences)));
  const byPriority = (a: StoryCandidate, b: StoryCandidate) => a.tier - b.tier || b.score - a.score ||
    (stableHash(`${managerId}:${dateKey}:${a.id}`) - stableHash(`${managerId}:${dateKey}:${b.id}`)) || a.id.localeCompare(b.id);
  const selected = candidates.filter((item) => item.mandatory).toSorted(byPriority).slice(0, cap);
  const pool = candidates.filter((item) => !item.mandatory).toSorted(byPriority);
  const identity = pool.find((candidate) => (candidate.topic === 'primary-club' || candidate.topic === 'other-club')
    && !exceedsNamedClubLimit(candidate, selected));
  const strongerOtherFact = identity?.topic === 'primary-club'
    ? pool.find((candidate) => candidate.tier === 3 && candidate.score > identity.score
      && candidate.tags.some((tag) => tag.startsWith('team:') && !selected.some((item) => item.tags.includes(tag)) && !identity.tags.includes(tag)))
    : null;
  if (strongerOtherFact && !exceedsNamedClubLimit(strongerOtherFact, selected)) selected.push(strongerOtherFact);
  else if (identity && selected.length < cap) selected.push(identity);
  const namedTeams = new Set(selected.flatMap((item) => item.tags.filter((tag) => tag.startsWith('team:'))));
  const namedClubFacts = pool.filter((candidate) => candidate.topic === 'club-facts'
    && candidate.tags.some((tag) => namedTeams.has(tag))).toSorted(byPriority);
  for (const candidate of namedClubFacts) {
    if (selected.length < cap && !candidateConflicts(candidate, selected)) selected.push(candidate);
  }
  const exceptional = selected.some((candidate) => candidate.topic === 'exceptional-role');
  while (selected.length < target || (exceptional && selected.length < cap)) {
    const supporting = pool.find((candidate) => candidate.tier === 3
      && (!exceptional || selected.length < target || candidate.score >= 80)
      && !(candidate.topic === 'footprint' && selected.some((item) => item.tier === 3 && item.tags.some((tag) => tag.startsWith('team:'))))
      && !candidateConflicts(candidate, selected)
      && !exceedsNamedClubLimit(candidate, selected));
    if (!supporting) break;
    selected.push(supporting);
  }
  const tournamentTeamTag = candidates.find((candidate) => candidate.topic === 'tournament')?.tags.find((tag) => tag.startsWith('team:'));
  const storyOrder = (candidate: StoryCandidate) => candidate.topic === 'exceptional-role' ? 0
    : candidate.topic === 'tournament' ? 1
      : candidate.topic === 'club-facts' && candidate.tags.includes(tournamentTeamTag ?? '') ? 1.5
        : candidate.topic === 'primary-club' || candidate.topic === 'other-club' ? 2
          : candidate.topic === 'club-facts' ? 2.5 : 3;
  return selected.toSorted((a, b) => storyOrder(a) - storyOrder(b) || byPriority(a, b));
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
    dateKey: input.dateKey,
  });
  const selected = selectStoryCandidates(candidates, input.managerId, input.dateKey, input.targetSentences, input.maxSentences);
  return {
    sentences: selected.map((candidate) => ({
      candidateId: candidate.id, segments: candidate.segments,
      paragraphId: candidate.topic === 'tournament' || candidate.topic === 'primary-club'
        || candidate.topic === 'other-club' || candidate.topic === 'club-facts'
        ? candidate.tags.find((tag) => tag.startsWith('team:')) : candidate.id,
    })),
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
