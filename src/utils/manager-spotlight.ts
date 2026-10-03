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
  leagueName: string | null;
  seriesName: string | null;
  isPrimary: boolean;
  isTournamentTeam: boolean;
  foundedDate: string | null;
}

export interface ManagerSpotlight {
  managerId: number;
  managerName: string;
  avatar: ManagerSpotlightAvatar | null;
  countryId: number | null;
  countryName: string | null;
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
  teamId?: unknown;
  team_id?: unknown;
  teamName?: unknown;
  name?: unknown;
  logoUrl?: unknown;
  logo_url?: unknown;
  countryId?: unknown;
  country_id?: unknown;
  countryName?: unknown;
  country_name?: unknown;
  leagueName?: unknown;
  league_name?: unknown;
  leagueLevelUnitName?: unknown;
  seriesName?: unknown;
  league_level_unit_name?: unknown;
  isPrimaryClub?: unknown;
  isPrimary?: unknown;
  foundedDate?: unknown;
  founded_date?: unknown;
}

function asRecord(value: unknown): RawTeam | null {
  return value && typeof value === 'object' ? (value as RawTeam) : null;
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function textOrNull(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function dateValue(value: string | null) {
  if (!value) return Number.POSITIVE_INFINITY;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const timestamp = Date.parse(normalized.endsWith('Z') ? normalized : `${normalized}Z`);
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

function yearOf(value: string | null) {
  const match = value?.match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function dayNumber(dateKey: string) {
  const timestamp = Date.parse(`${dateKey}T00:00:00Z`);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 86_400_000) : 0;
}

export function getUtcDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function selectDailySpotlightParticipant<T extends ManagerSpotlightParticipant>(
  tournamentId: string,
  participants: T[],
  dateKey: string,
) {
  const eligible = participants
    .filter((participant) => Number(participant.ht_team_id) > 0 && Number(participant.hattrick_user_id) > 0)
    .toSorted((left, right) => {
      const managerDelta = Number(left.hattrick_user_id) - Number(right.hattrick_user_id);
      if (managerDelta !== 0) return managerDelta;
      const teamDelta = Number(left.ht_team_id) - Number(right.ht_team_id);
      return teamDelta || left.id.localeCompare(right.id);
    });

  if (!eligible.length) return null;
  const index = (dayNumber(dateKey) + stableHash(tournamentId)) % eligible.length;
  return eligible[index];
}

function normalizeTeam(raw: RawTeam): ManagerSpotlightTeam | null {
  const teamId = numberOrNull(raw.teamId ?? raw.team_id);
  if (!teamId) return null;

  return {
    teamId,
    teamName: textOrNull(raw.teamName ?? raw.name) || `Team ${teamId}`,
    logoUrl: textOrNull(raw.logoUrl ?? raw.logo_url),
    countryId: numberOrNull(raw.countryId ?? raw.country_id),
    countryName: textOrNull(raw.countryName ?? raw.country_name),
    leagueName: textOrNull(raw.leagueName ?? raw.league_name),
    seriesName: textOrNull(raw.seriesName ?? raw.leagueLevelUnitName ?? raw.league_level_unit_name),
    isPrimary: Boolean(raw.isPrimaryClub ?? raw.isPrimary),
    isTournamentTeam: false,
    foundedDate: textOrNull(raw.foundedDate ?? raw.founded_date),
  };
}

function buildStory(
  managerName: string,
  currentTeams: ManagerSpotlightTeam[],
  tournamentTeam: ManagerSpotlightTeam,
  oldestKnownClubDate: string | null,
) {
  const sentences: string[] = [];
  const oldestYear = yearOf(oldestKnownClubDate);
  if (oldestYear) sentences.push(`${managerName} has been around Hattrick since at least ${oldestYear}.`);

  const countries = new Set(currentTeams.map((team) => team.countryId || team.countryName).filter(Boolean));
  const leagues = new Set(currentTeams.map((team) => team.leagueName || team.seriesName).filter(Boolean));
  if (currentTeams.length === 1) {
    const country = tournamentTeam.countryName ? ` in ${tournamentTeam.countryName}` : '';
    sentences.push(`Today ${managerName} manages ${tournamentTeam.teamName}${country}.`);
  } else if (countries.size > 1) {
    sentences.push(`Today ${managerName} manages ${currentTeams.length} clubs across ${countries.size} countries.`);
  } else if (leagues.size > 1) {
    sentences.push(`Today ${managerName} manages ${currentTeams.length} clubs across ${leagues.size} leagues.`);
  } else {
    sentences.push(`Today ${managerName} manages ${currentTeams.length} clubs.`);
  }

  const datedTeams = currentTeams.filter((team) => yearOf(team.foundedDate) !== null);
  const newestDate = datedTeams.toSorted((left, right) => dateValue(right.foundedDate) - dateValue(left.foundedDate))[0];
  if (newestDate?.teamId === tournamentTeam.teamId) {
    sentences.push(`${tournamentTeam.teamName} is the newest side and brings ${managerName} into this tournament.`);
  } else if (currentTeams.length > 1) {
    sentences.push(`${tournamentTeam.teamName} is the club representing ${managerName} here.`);
  }

  return sentences.slice(0, 3).join(' ');
}

export function buildManagerSpotlight(input: {
  tournamentId: string;
  participants: ManagerSpotlightParticipant[];
  profiles: ManagerSpotlightProfile[];
  dateKey: string;
}) {
  const selected = selectDailySpotlightParticipant(input.tournamentId, input.participants, input.dateKey);
  if (!selected?.hattrick_user_id || !selected.ht_team_id) return null;

  const managerId = Number(selected.hattrick_user_id);
  const profile = input.profiles.find((candidate) => Number(candidate.hattrick_user_id) === managerId);
  const selectedManagerParticipants = input.participants.filter(
    (participant) => Number(participant.hattrick_user_id) === managerId,
  );
  const tournamentTeamIds = new Set(
    selectedManagerParticipants.map((participant) => Number(participant.ht_team_id)).filter(Boolean),
  );
  const profileTeams = Array.isArray(profile?.teams_json)
    ? profile.teams_json.map(asRecord).filter((team): team is RawTeam => team !== null)
    : [];
  const currentTeamsById = new Map<number, ManagerSpotlightTeam>();

  for (const rawTeam of profileTeams) {
    const team = normalizeTeam(rawTeam);
    if (team) currentTeamsById.set(team.teamId, team);
  }
  for (const participant of selectedManagerParticipants) {
    const teamId = Number(participant.ht_team_id);
    if (!teamId) continue;
    const existing = currentTeamsById.get(teamId);
    currentTeamsById.set(teamId, {
      teamId,
      teamName: existing?.teamName || participant.name || `Team ${teamId}`,
      logoUrl: existing?.logoUrl || participant.logo_url || null,
      countryId: existing?.countryId || participant.country_id || null,
      countryName: existing?.countryName || participant.country_name || null,
      leagueName: existing?.leagueName || null,
      seriesName: existing?.seriesName || (participant.league_level ? `Level ${participant.league_level}` : null),
      isPrimary: existing?.isPrimary || false,
      isTournamentTeam: true,
      foundedDate: existing?.foundedDate || null,
    });
  }

  const currentTeams = Array.from(currentTeamsById.values())
    .map((team) => ({ ...team, isTournamentTeam: tournamentTeamIds.has(team.teamId) }))
    .toSorted((left, right) => {
      if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
      return left.teamName.localeCompare(right.teamName);
    });
  const tournamentTeam = currentTeams.find((team) => team.teamId === Number(selected.ht_team_id)) || currentTeams[0];
  if (!tournamentTeam) return null;

  const oldestKnownClubDate = currentTeams
    .map((team) => team.foundedDate)
    .filter((date): date is string => Boolean(date))
    .toSorted((left, right) => dateValue(left) - dateValue(right))[0] || null;

  return {
    managerId,
    managerName: profile?.manager_name || selected.manager_name || `Manager ${managerId}`,
    avatar: profile?.avatar_json || null,
    countryId: profile?.country_id || selected.country_id || null,
    countryName: profile?.country_name || selected.country_name || null,
    language: profile?.language_name || null,
    currentTeams,
    tournamentTeamId: tournamentTeam.teamId,
    oldestKnownClubDate,
    story: buildStory(
      profile?.manager_name || selected.manager_name || `Manager ${managerId}`,
      currentTeams,
      tournamentTeam,
      oldestKnownClubDate,
    ),
  } satisfies ManagerSpotlight;
}
