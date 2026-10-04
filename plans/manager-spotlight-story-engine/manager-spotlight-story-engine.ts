/**
 * Manager Spotlight story engine — reference implementation/spec.
 *
 * Purpose:
 * - deterministic, static story composition from normalized CHPP data
 * - 3 sentences normally, 4 max
 * - select strongest facts instead of narrating every field
 * - keep public rendering snapshot-only; no fetching here
 *
 * This is intentionally framework-agnostic. Adapt types to the repo's canonical models.
 */

export type OfficialRole =
  | 'hattrick_staff'
  | 'game_master'
  | 'moderator'
  | 'language_assistant';

export type NationalTeamRoleType = 'coach' | 'assistant' | 'scout';

export interface CountryRef {
  id?: number | null;
  name: string;
  /** Optional UI hint. Prefer CDN/image flags in React, not emoji in story text. */
  flagUrl?: string | null;
}

export interface NationalTeamRole {
  type: NationalTeamRoleType;
  nationalTeamId: number;
  nationalTeamName: string;
  isU21: boolean;
}

export type TrophyKind =
  | 'world_cup_gold'
  | 'world_cup_silver'
  | 'world_cup_bronze'
  | 'masters'
  | 'national_cup'
  | 'league'
  | 'challenger_cup'
  | 'consolation_cup'
  | 'series'
  | 'tournament'
  | 'other';

export interface TrophyFact {
  kind: TrophyKind;
  season?: number | null;
  gainedDate?: string | null;
  leagueLevel?: number | null;
  leagueLevelUnitName?: string | null;
}

export interface ClubSnapshot {
  teamId: number;
  teamName: string;

  isPrimaryClub: boolean;
  isTournamentTeam: boolean;

  country?: CountryRef | null;
  regionName?: string | null;

  leagueId?: number | null;
  leagueName?: string | null;
  specialLeague?: 'HFI' | 'Homegrown' | null;
  division?: string | null;

  foundedDate?: string | null;

  /**
   * CHPP <TeamRank>.
   * This is the ordinary league rank described by CHPP, NOT PowerRating.LeagueRanking.
   */
  teamRank?: number | null;

  powerRating?: number | null;
  powerLeagueRank?: number | null;

  youthTeamName?: string | null;
  arenaName?: string | null;
  fanclubSize?: number | null;

  trophies?: TrophyFact[];

  /** Optional/transient; do not surface unless snapshot freshness policy explicitly allows it. */
  currentCupName?: string | null;
  winningStreak?: number | null;
  undefeatedStreak?: number | null;
}

export interface ManagerSnapshot {
  managerId: number;
  managerName: string;
  managerCountry?: CountryRef | null;
  managerRegion?: string | null;
  language?: string | null;

  /**
   * If omitted, derive from managerName using detectOfficialRole().
   * Prefixes are treated as reserved Hattrick roles:
   * HT- / GM- / Mod- / LA-
   */
  officialRole?: OfficialRole | null;

  nationalTeamRoles?: NationalTeamRole[];
  currentTeams: ClubSnapshot[];

  /**
   * Used only as deterministic tie-breaker for equal-priority optional facts.
   * YYYY-MM-DD is ideal.
   */
  spotlightDateKey: string;
}

export type StoryTopic =
  | 'exceptional-role'
  | 'tournament'
  | 'primary-club'
  | 'achievement'
  | 'rank'
  | 'history'
  | 'footprint'
  | 'colour';

export interface StoryCandidate {
  id: string;
  topic: StoryTopic;

  /**
   * Lower = stronger.
   * 0 exceptional role
   * 1 tournament context (mandatory)
   * 2 primary club identity
   * 3 achievement / notable rank
   * 4 history / footprint
   * 5 colour / fallback
   */
  tier: 0 | 1 | 2 | 3 | 4 | 5;

  /** Tie-break inside a tier. Higher = stronger. */
  score: number;

  /** Candidate must survive selection when present. */
  mandatory?: boolean;

  /** Used to suppress near-duplicate facts. */
  tags: string[];

  text: string;
}

export interface StoryResult {
  text: string;
  sentences: string[];
  selected: StoryCandidate[];
  /**
   * Useful while implementing/debugging:
   * shows every eligible fact considered by the selector.
   */
  candidates: StoryCandidate[];
}

const OFFICIAL_ROLE_COPY: Record<OfficialRole, string> = {
  hattrick_staff: 'Hattrick staff member',
  game_master: 'Hattrick Game Master',
  moderator: 'Hattrick moderator',
  language_assistant: 'Hattrick Language Assistant',
};

const NT_ROLE_PRIORITY: Record<NationalTeamRoleType, number> = {
  coach: 30,
  assistant: 20,
  scout: 10,
};

const TROPHY_SCORE: Record<TrophyKind, number> = {
  world_cup_gold: 100,
  world_cup_silver: 95,
  world_cup_bronze: 90,
  masters: 90,
  national_cup: 80,
  league: 70,
  challenger_cup: 60,
  consolation_cup: 55,
  series: 30,
  tournament: 20,
  other: 5,
};

const numberWord = (n: number) =>
  n >= 0 && n <= 9
    ? ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][n]
    : String(n);

const plural = (n: number, singular: string, pluralForm = `${singular}s`) =>
  n === 1 ? singular : pluralForm;

const yearOf = (value?: string | null): number | null => {
  const match = value?.match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
};

const ageInYears = (foundedDate: string, dateKey: string): number => {
  const founded = foundedDate.slice(0, 10);
  const today = dateKey.slice(0, 10);
  let age = Number(today.slice(0, 4)) - Number(founded.slice(0, 4));
  if (today.slice(5) < founded.slice(5)) age -= 1;
  return age;
};

const stableHash = (value: string): number => {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const stableTie = (manager: ManagerSnapshot, candidate: StoryCandidate) =>
  stableHash(`${manager.managerId}|${manager.spotlightDateKey}|${candidate.id}`);

const countryName = (team?: ClubSnapshot | null) => team?.country?.name ?? null;

const distinctCountries = (teams: ClubSnapshot[]) =>
  [...new Set(teams.map((team) => team.country?.name).filter((v): v is string => Boolean(v)))];

const primaryClub = (manager: ManagerSnapshot) =>
  manager.currentTeams.find((team) => team.isPrimaryClub) ?? null;

const tournamentClub = (manager: ManagerSnapshot) =>
  manager.currentTeams.find((team) => team.isTournamentTeam) ?? null;

const validRank = (value?: number | null) =>
  Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;

/**
 * Reserved Hattrick role prefixes supplied by product requirements.
 * Keep prefix semantics centralized.
 */
export function detectOfficialRole(managerName: string): OfficialRole | null {
  const match = managerName.match(/^(HT|GM|MOD|LA)-/i);
  if (!match) return null;

  switch (match[1].toUpperCase()) {
    case 'HT': return 'hattrick_staff';
    case 'GM': return 'game_master';
    case 'MOD': return 'moderator';
    case 'LA': return 'language_assistant';
    default: return null;
  }
}

export function normalizeNationalTeamName(name: string) {
  return name.replace(/\s+/g, ' ').trim();
}

function ntRoleStrength(role: NationalTeamRole) {
  // Senior role outranks the equivalent U21 role.
  return NT_ROLE_PRIORITY[role.type] + (role.isU21 ? 0 : 5);
}

function ntRolePhrase(role: NationalTeamRole): string {
  const team = normalizeNationalTeamName(role.nationalTeamName);

  if (role.type === 'coach') {
    return role.isU21
      ? `coaches ${team}`
      : `coaches ${team}'s national team`;
  }
  if (role.type === 'assistant') {
    return `is an assistant coach with ${team}`;
  }
  return `serves as a scout for ${team}`;
}

/**
 * P0 — highest-priority identity fact.
 * Combines official role + strongest NT role when both exist.
 */
export function buildExceptionalRoleCandidate(manager: ManagerSnapshot): StoryCandidate | null {
  const official = manager.officialRole ?? detectOfficialRole(manager.managerName);
  const roles = [...(manager.nationalTeamRoles ?? [])]
    .sort((a, b) => ntRoleStrength(b) - ntRoleStrength(a));

  if (!official && roles.length === 0) return null;

  const officialText = official ? OFFICIAL_ROLE_COPY[official] : null;
  const strongest = roles[0] ?? null;
  const additional = Math.max(0, roles.length - 1);

  let text: string;

  if (officialText && strongest) {
    text = `${manager.managerName} is a ${officialText} and ${ntRolePhrase(strongest)}`;
    if (additional > 0) {
      text += `, with ${numberWord(additional)} additional national-team staff ${plural(additional, 'role')}`;
    }
    text += '.';
  } else if (officialText) {
    text = `${manager.managerName} is a ${officialText}.`;
  } else {
    text = `${manager.managerName} currently ${ntRolePhrase(strongest!)}`;
    if (additional > 0) {
      const remaining = roles.slice(1);
      const sameType = remaining.every((role) => role.type === remaining[0]?.type);

      if (sameType && remaining.length >= 2) {
        const roleLabel =
          remaining[0].type === 'coach' ? 'coaching roles'
          : remaining[0].type === 'assistant' ? 'assistant-coach roles'
          : 'scouting roles';
        text += ` and holds ${numberWord(additional)} additional ${roleLabel}`;
      } else {
        text += ` and holds ${numberWord(additional)} additional national-team staff ${plural(additional, 'role')}`;
      }
    }
    text += '.';
  }

  return {
    id: 'exceptional-role',
    topic: 'exceptional-role',
    tier: 0,
    score: 1000,
    mandatory: true,
    tags: ['manager-role', ...roles.map((role) => `nt:${role.nationalTeamId}`)],
    text,
  };
}

/**
 * P1 — mandatory tournament relevance.
 */
export function buildTournamentCandidate(manager: ManagerSnapshot): StoryCandidate | null {
  const team = tournamentClub(manager);
  if (!team) return null;

  const rank = validRank(team.teamRank);
  const division = team.division;
  const isPrimary = team.isPrimaryClub;

  let detail = '';

  if (team.specialLeague === 'HFI') {
    detail = division ? `competing in HFI division ${division}` : 'competing in HFI';
  } else if (team.specialLeague === 'Homegrown') {
    detail = division ? `competing in Homegrown division ${division}` : 'competing in the Homegrown League';
  } else if (division) {
    detail = `currently playing in ${division}`;
  }

  if (rank && rank <= 100) {
    detail += `${detail ? ' at' : 'at'} league rank #${rank}`;
  }

  const subject = isPrimary
    ? `Their main club, ${team.teamName}, represents ${manager.managerName} here`
    : `${team.teamName} represents ${manager.managerName} here`;

  return {
    id: `tournament:${team.teamId}`,
    topic: 'tournament',
    tier: 1,
    score: 1000,
    mandatory: true,
    tags: [
      'tournament-team',
      `team:${team.teamId}`,
      ...(team.country?.name ? [`country:${team.country.name}`] : []),
    ],
    text: `${subject}${detail ? `, ${detail}` : ''}.`,
  };
}

/**
 * P2 — registered/main club.
 * Intentionally keeps primary club visible; PR #14 had effectively lost this.
 */
export function buildPrimaryClubCandidate(manager: ManagerSnapshot): StoryCandidate | null {
  const team = primaryClub(manager);
  if (!team || team.isTournamentTeam) return null;

  const year = yearOf(team.foundedDate);
  const division = team.division;
  const rank = validRank(team.teamRank);

  const pieces: string[] = [];

  if (year) pieces.push(`dates back to ${year}`);
  if (division) pieces.push(`currently plays in ${division}`);
  if (rank && rank <= 100) pieces.push(`holds league rank #${rank}`);

  const location =
    team.regionName && team.country?.name
      ? ` in ${team.regionName}, ${team.country.name}`
      : team.country?.name
        ? ` in ${team.country.name}`
        : '';

  const tail = pieces.length ? ` and ${pieces.join(', ').replace(/, ([^,]*)$/, ' and $1')}` : '';

  return {
    id: `primary:${team.teamId}`,
    topic: 'primary-club',
    tier: 2,
    score: 800 + (year ? Math.min(200, Math.max(0, ageInYears(team.foundedDate!, manager.spotlightDateKey) * 5)) : 0),
    tags: ['primary-team', `team:${team.teamId}`, 'history'],
    text: `Their main club, ${team.teamName}${location},${tail || ' is their registered primary club'}.`
      .replace(',,', ','),
  };
}

function classifyAchievementText(team: ClubSnapshot, trophy: TrophyFact): string | null {
  switch (trophy.kind) {
    case 'world_cup_gold':
      return `${team.teamName} has a World Cup gold among its honours.`;
    case 'world_cup_silver':
      return `${team.teamName} has a World Cup silver among its honours.`;
    case 'world_cup_bronze':
      return `${team.teamName} has a World Cup bronze among its honours.`;
    case 'masters':
      return `${team.teamName} has won the Hattrick Masters.`;
    case 'national_cup':
      return `${team.teamName} has won ${team.country?.name ? `${team.country.name}'s ` : 'a '}National Cup.`;
    case 'league':
      return `${team.teamName} has won a league title.`;
    case 'challenger_cup':
      return `${team.teamName} has won a Challenger Cup.`;
    case 'consolation_cup':
      return `${team.teamName} has won a Consolation Cup.`;
    default:
      return null;
  }
}

/**
 * P3 — significant achievements.
 * Returns multiple candidates; selector chooses at most one unless sentence budget allows more.
 */
export function buildAchievementCandidates(manager: ManagerSnapshot): StoryCandidate[] {
  const candidates: StoryCandidate[] = [];

  for (const team of manager.currentTeams) {
    const trophies = team.trophies ?? [];

    const best = trophies
      .filter((trophy) => TROPHY_SCORE[trophy.kind] >= 50)
      .sort((a, b) => TROPHY_SCORE[b.kind] - TROPHY_SCORE[a.kind])[0];

    if (best) {
      const text = classifyAchievementText(team, best);
      if (text) {
        candidates.push({
          id: `achievement:${team.teamId}:${best.kind}`,
          topic: 'achievement',
          tier: 3,
          score:
            TROPHY_SCORE[best.kind]
            + (team.isPrimaryClub ? 15 : 0)
            + (team.isTournamentTeam ? 10 : 0),
          tags: ['achievement', `team:${team.teamId}`],
          text:
            team.isPrimaryClub || team.isTournamentTeam
              ? text
              : `Among their other clubs, ${text[0].toLowerCase()}${text.slice(1)}`,
        });
      }
    }

    const seriesWins = trophies.filter((trophy) => trophy.kind === 'series').length;
    if (seriesWins >= 3) {
      candidates.push({
        id: `series-count:${team.teamId}`,
        topic: 'achievement',
        tier: 3,
        score: Math.min(65, 25 + seriesWins * 4),
        tags: ['achievement', `team:${team.teamId}`],
        text: `${team.teamName} has collected ${numberWord(seriesWins)} series titles over its history.`,
      });
    }
  }

  return candidates;
}

/**
 * P3 — notable current league ranks.
 * Do not compare teams across countries and declare a "best club".
 */
export function buildRankCandidates(manager: ManagerSnapshot): StoryCandidate[] {
  return manager.currentTeams
    .filter((team) => !team.isTournamentTeam)
    .map((team): StoryCandidate | null => {
      const rank = validRank(team.teamRank);
      if (!rank || rank > 100) return null;

      const score = rank <= 10 ? 95 : rank <= 50 ? 80 : 65;

      return {
        id: `rank:${team.teamId}`,
        topic: 'rank',
        tier: 3,
        score,
        tags: ['rank', `team:${team.teamId}`],
        text: `${team.teamName} currently holds league rank #${rank}${team.country?.name ? ` in ${team.country.name}` : ''}.`,
      };
    })
    .filter((candidate): candidate is StoryCandidate => Boolean(candidate));
}

/**
 * P4 — long-running current-club history.
 * Primary-club history is normally already embedded in P2, so this focuses
 * on cases where no primary fact exists or a different club is unusually old.
 */
export function buildHistoryCandidates(manager: ManagerSnapshot): StoryCandidate[] {
  const primary = primaryClub(manager);

  return manager.currentTeams
    .filter((team) => team.foundedDate)
    .map((team): StoryCandidate | null => {
      const year = yearOf(team.foundedDate);
      if (!year) return null;

      const age = ageInYears(team.foundedDate!, manager.spotlightDateKey);

      // Avoid duplicating a normal primary-club sentence unless longevity is exceptional.
      if (team.teamId === primary?.teamId && age < 20) return null;
      if (age < 8) return null;

      const text =
        age >= 20
          ? `${team.teamName} has been active since ${year}, giving the manager more than two decades of current-club history.`
          : age >= 15
            ? `${team.teamName} has been active since ${year}.`
            : `${team.teamName} dates back to ${year}.`;

      return {
        id: `history:${team.teamId}`,
        topic: 'history',
        tier: 4,
        score: Math.min(85, 30 + age * 2),
        tags: ['history', `team:${team.teamId}`],
        text,
      };
    })
    .filter((candidate): candidate is StoryCandidate => Boolean(candidate));
}

/**
 * P4 — geography/current-account shape.
 * Use as supporting material, not the default headline when stronger facts exist.
 */
export function buildFootprintCandidates(manager: ManagerSnapshot): StoryCandidate[] {
  const teams = manager.currentTeams;
  if (teams.length <= 1) return [];

  const countries = distinctCountries(teams);
  const candidates: StoryCandidate[] = [];

  if (countries.length === teams.length && teams.length >= 3) {
    candidates.push({
      id: 'footprint:all-different-countries',
      topic: 'footprint',
      tier: 4,
      score: 70 + teams.length,
      tags: ['footprint'],
      text: `${manager.managerName} currently manages ${numberWord(teams.length)} clubs in ${numberWord(countries.length)} different countries.`,
    });
  } else if (teams.length === 2 && countries.length === 2) {
    candidates.push({
      id: 'footprint:two-two',
      topic: 'footprint',
      tier: 4,
      score: 55,
      tags: ['footprint'],
      text: `Their two current clubs are split between ${countries[0]} and ${countries[1]}.`,
    });
  } else if (countries.length === 1) {
    candidates.push({
      id: 'footprint:one-country',
      topic: 'footprint',
      tier: 4,
      score: 45,
      tags: ['footprint', `country:${countries[0]}`],
      text: `All ${numberWord(teams.length)} current clubs are based in ${countries[0]}.`,
    });
  } else {
    candidates.push({
      id: 'footprint:multi-country',
      topic: 'footprint',
      tier: 4,
      score: 50,
      tags: ['footprint'],
      text: `${manager.managerName} currently manages ${numberWord(teams.length)} clubs across ${numberWord(countries.length)} countries.`,
    });
  }

  const homegrown = teams.filter((team) => team.specialLeague === 'Homegrown');
  const hfi = teams.filter((team) => team.specialLeague === 'HFI');
  if (homegrown.length && hfi.length) {
    const sharedCountry =
      countryName(homegrown[0]) &&
      countryName(homegrown[0]) === countryName(hfi[0])
        ? countryName(homegrown[0])
        : null;

    candidates.push({
      id: 'footprint:special-leagues',
      topic: 'footprint',
      tier: 4,
      score: 75,
      tags: ['footprint', 'special-leagues'],
      text: `Their current clubs include both Homegrown and HFI sides${sharedCountry ? ` in ${sharedCountry}` : ''}.`,
    });
  }

  return candidates;
}

/**
 * P5 — low-priority colour/fallback facts.
 * Stable data only.
 */
export function buildColourCandidates(manager: ManagerSnapshot): StoryCandidate[] {
  const candidates: StoryCandidate[] = [];

  for (const team of manager.currentTeams) {
    if (team.youthTeamName) {
      candidates.push({
        id: `colour:youth:${team.teamId}`,
        topic: 'colour',
        tier: 5,
        score: 30 + (manager.currentTeams.length === 1 ? 20 : 0),
        tags: ['colour', `team:${team.teamId}`],
        text: `${team.teamName} also runs the ${team.youthTeamName} youth side.`,
      });
    }

    if (team.fanclubSize && team.fanclubSize >= 3000) {
      candidates.push({
        id: `colour:fanclub:${team.teamId}`,
        topic: 'colour',
        tier: 5,
        score: Math.min(55, 20 + Math.floor(team.fanclubSize / 500)),
        tags: ['colour', `team:${team.teamId}`],
        text: `${team.teamName} has a fanclub of more than ${Math.floor(team.fanclubSize / 100) * 100} supporters.`,
      });
    }

    if (team.arenaName && manager.currentTeams.length === 1) {
      candidates.push({
        id: `colour:arena:${team.teamId}`,
        topic: 'colour',
        tier: 5,
        score: 20,
        tags: ['colour', `team:${team.teamId}`],
        text: `${team.teamName} plays its home matches at ${team.arenaName}.`,
      });
    }
  }

  return candidates;
}

function candidatePool(manager: ManagerSnapshot): StoryCandidate[] {
  return [
    ...(buildExceptionalRoleCandidate(manager) ? [buildExceptionalRoleCandidate(manager)!] : []),
    ...(buildTournamentCandidate(manager) ? [buildTournamentCandidate(manager)!] : []),
    ...(buildPrimaryClubCandidate(manager) ? [buildPrimaryClubCandidate(manager)!] : []),
    ...buildAchievementCandidates(manager),
    ...buildRankCandidates(manager),
    ...buildHistoryCandidates(manager),
    ...buildFootprintCandidates(manager),
    ...buildColourCandidates(manager),
  ];
}

/**
 * Suppress obvious duplicate facts.
 *
 * Rules:
 * - never select more than one achievement sentence for the same team
 * - never select a separate rank/history fact for a team already described
 *   in the tournament sentence unless the fact is exceptionally strong
 * - only one generic footprint sentence
 * - only one colour sentence
 */
function conflicts(candidate: StoryCandidate, selected: StoryCandidate[]) {
  const selectedIds = new Set(selected.map((item) => item.id));

  if (selectedIds.has(candidate.id)) return true;

  if (candidate.topic === 'footprint' && selected.some((item) => item.topic === 'footprint')) {
    return true;
  }

  if (candidate.topic === 'colour' && selected.some((item) => item.topic === 'colour')) {
    return true;
  }

  const candidateTeamTags = candidate.tags.filter((tag) => tag.startsWith('team:'));

  for (const teamTag of candidateTeamTags) {
    const sameTeam = selected.filter((item) => item.tags.includes(teamTag));

    if (candidate.topic === 'achievement' && sameTeam.some((item) => item.topic === 'achievement')) {
      return true;
    }

    if (
      (candidate.topic === 'rank' || candidate.topic === 'history') &&
      sameTeam.some((item) => item.topic === 'tournament' || item.topic === 'primary-club')
    ) {
      // Keep only truly exceptional supporting facts.
      if (candidate.score < 90) return true;
    }
  }

  return false;
}

function chooseOptionalCandidates(
  manager: ManagerSnapshot,
  pool: StoryCandidate[],
  selected: StoryCandidate[],
  maxSentences: number,
) {
  const optional = pool
    .filter((candidate) => !candidate.mandatory && !selected.some((item) => item.id === candidate.id))
    .sort((a, b) =>
      a.tier - b.tier ||
      b.score - a.score ||
      stableTie(manager, a) - stableTie(manager, b));

  for (const candidate of optional) {
    if (selected.length >= maxSentences) break;
    if (conflicts(candidate, selected)) continue;
    selected.push(candidate);
  }
}

/**
 * Final composition rules:
 *
 * - P0 exceptional role: always first when present.
 * - P1 tournament: always present when tournament club is known.
 * - P2 primary club: strongly preferred when it is a different club.
 * - Fill remaining 1–2 slots from achievements/rank/history/footprint/colour.
 * - 3 sentences normally, 4 max.
 */
export function buildManagerStory(
  manager: ManagerSnapshot,
  options: { targetSentences?: 3 | 4; maxSentences?: 3 | 4 } = {},
): StoryResult {
  const pool = candidatePool(manager);
  const selected: StoryCandidate[] = [];

  const exceptional = pool.find((candidate) => candidate.topic === 'exceptional-role');
  const tournament = pool.find((candidate) => candidate.topic === 'tournament');
  const primary = pool.find((candidate) => candidate.topic === 'primary-club');

  if (exceptional) selected.push(exceptional);

  /**
   * Without P0, start with a manager-level/current-account identity fact when possible.
   * This stops every card from opening with the tournament sentence.
   */
  if (!exceptional) {
    const footprint = pool
      .filter((candidate) => candidate.topic === 'footprint')
      .sort((a, b) => b.score - a.score)[0];

    if (primary && manager.currentTeams.length === 1) {
      selected.push(primary);
    } else if (footprint) {
      selected.push(footprint);
    } else if (primary) {
      selected.push(primary);
    }
  }

  if (tournament && !selected.some((item) => item.id === tournament.id)) {
    selected.push(tournament);
  }

  /**
   * Preserve registered/main-club identity.
   * With an exceptional P0 role, this normally becomes sentence 3.
   * Without P0 it is included whenever the opening footprint did not already use it.
   */
  if (
    primary &&
    !selected.some((item) => item.id === primary.id) &&
    !conflicts(primary, selected) &&
    selected.length < 3
  ) {
    selected.push(primary);
  }

  const targetSentences = options.targetSentences ?? 3;
  const maxSentences = options.maxSentences ?? 4;

  chooseOptionalCandidates(manager, pool, selected, targetSentences);

  /**
   * Allow a fourth sentence only when the next candidate is genuinely strong.
   * This prevents filling space with weak trivia.
   */
  if (selected.length < maxSentences) {
    const remainingStrong = pool
      .filter((candidate) =>
        !candidate.mandatory &&
        !selected.some((item) => item.id === candidate.id) &&
        candidate.tier <= 4 &&
        candidate.score >= 75 &&
        !conflicts(candidate, selected))
      .sort((a, b) =>
        a.tier - b.tier ||
        b.score - a.score ||
        stableTie(manager, a) - stableTie(manager, b))[0];

    if (remainingStrong) selected.push(remainingStrong);
  }

  const ordered = selected
    .slice(0, maxSentences)
    .sort((a, b) => {
      // Exceptional role always opens.
      if (a.topic === 'exceptional-role') return -1;
      if (b.topic === 'exceptional-role') return 1;

      // Preserve original selection order for everything else.
      return selected.indexOf(a) - selected.indexOf(b);
    });

  const sentences = ordered.map((candidate) => candidate.text);

  return {
    text: sentences.join(' '),
    sentences,
    selected: ordered,
    candidates: pool,
  };
}

/**
 * Map raw CHPP NationalTeamStaffType:
 * 0 = National Team Coach
 * 1 = Assistant Coach
 * 2 = Scout
 */
export function mapNationalTeamStaffType(value: number): NationalTeamRoleType | null {
  if (value === 0) return 'coach';
  if (value === 1) return 'assistant';
  if (value === 2) return 'scout';
  return null;
}

/**
 * Map CHPP trophy data into story-level categories.
 * Keep raw parsing elsewhere; this is semantic normalization only.
 */
export function classifyTrophy(input: {
  trophyTypeId: number;
  cupLeagueLevel?: number | null;
  cupLevel?: number | null;
}): TrophyKind {
  switch (input.trophyTypeId) {
    case 78: return 'world_cup_gold';
    case 79: return 'world_cup_silver';
    case 80: return 'world_cup_bronze';
    case 91: return 'masters';
    case 18: return 'league';
    case 17: return 'series';
    case 103: return 'tournament';
    case 16:
      if (input.cupLeagueLevel === 0 && input.cupLevel === 1) return 'national_cup';
      if (input.cupLevel === 2) return 'challenger_cup';
      if (input.cupLevel === 3) return 'consolation_cup';
      return 'other';
    default:
      return 'other';
  }
}
