import { getCountryWorldDetails, getLeagueWorldDetails } from './worlddetails.js';

/** Flag Hunters prototype snapshots contain display data only, never credentials. */
export interface FlagHunterTeam {
  id: string;
  htTeamId: number;
  name: string;
  managerId: number | null;
  managerName: string | null;
  countryName: string | null;
  countryId: number | null;
  managerCountryId: number | null;
  /** Country identity encoded as its regular CHPP LeagueID; never the competition LeagueID. */
  flagCountryId: number | null;
  leagueId: number | null;
}
export interface FlagCollection {
  htTeamId: number;
  managerId: number | null;
  leagueId: number | null;
  home: number[];
  away: number[];
  homeUnknown: boolean;
  awayUnknown: boolean;
  fetchedAt: string;
}
export interface FlagSnapshot {
  version: 2;
  tournamentId: string;
  savedAt: string;
  teams: FlagHunterTeam[];
  flags: Record<string, FlagCollection>;
}
export interface FlagPair { homeId: number; awayId: number }
export interface FlagDraft { seed: string; pairs: FlagPair[]; byeId: number | null; unresolvedIds: number[] }
export type FlagBenefit = 'gain' | 'none' | 'unknown';
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** Actual CountryID -> regular-league country flag key, without changing competition membership. */
export function resolveFlagCountryId(countryId: number | null): number | null {
  return getCountryWorldDetails(countryId)?.leagueId ?? null;
}

export function normalizeFlagCountries(leagueIds: number[]) {
  const countries = new Set<number>();
  let unknown = false;
  for (const leagueId of leagueIds) {
    const countryId = getLeagueWorldDetails(leagueId)?.countryId;
    const flagCountryId = countryId == null ? null : resolveFlagCountryId(countryId);
    if (flagCountryId === null) unknown = true;
    else countries.add(flagCountryId);
  }
  return { ids: [...countries].sort((a, b) => a - b), unknown };
}

export function parseFlagSnapshot(raw: unknown): FlagSnapshot {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid Flag Hunters snapshot.');
  const value = raw as Omit<FlagSnapshot, 'version'> & { version: number };
  if (![1, 2].includes(value.version) || typeof value.tournamentId !== 'string' || !Array.isArray(value.teams)
    || !value.flags || typeof value.flags !== 'object' || Array.isArray(value.flags)
    || !Number.isFinite(Date.parse(value.savedAt))) throw new Error('Invalid Flag Hunters snapshot.');
  const legacy = value.version === 1;
  const nullableId = (id: unknown) => id === null || positive(id);
  const ids = new Set<number>();
  for (const team of value.teams) {
    if (!team || typeof team.id !== 'string' || !positive(team.htTeamId) || ids.has(team.htTeamId)
      || typeof team.name !== 'string' || !nullableId(team.managerId) || !nullableId(team.leagueId)
      || (!legacy && (!nullableId(team.countryId) || !nullableId(team.managerCountryId)
        || team.flagCountryId !== resolveFlagCountryId(team.countryId)))
      || !(team.managerName === null || typeof team.managerName === 'string')
      || !(team.countryName === null || typeof team.countryName === 'string')) throw new Error('Invalid or duplicate snapshot team.');
    ids.add(team.htTeamId);
  }
  for (const [key, flags] of Object.entries(value.flags)) {
    if (!flags || !positive(flags.htTeamId) || key !== String(flags.htTeamId) || !ids.has(flags.htTeamId)
      || !nullableId(flags.managerId) || !nullableId(flags.leagueId)
      || !Array.isArray(flags.home) || !Array.isArray(flags.away) || !flags.home.every(positive) || !flags.away.every(positive)
      || (!legacy && (typeof flags.homeUnknown !== 'boolean' || typeof flags.awayUnknown !== 'boolean'))
      || typeof flags.fetchedAt !== 'string' || !Number.isFinite(Date.parse(flags.fetchedAt))) throw new Error('Invalid flag collection.');
  }
  // Upgrade v1 without throwing away successful reads. Regular-league country metadata
  // can be inferred; special-league country identity comes from the fresh roster on reconcile.
  return { version: 2, tournamentId: value.tournamentId, savedAt: value.savedAt,
    teams: value.teams.map(({ id, htTeamId, name, managerId, managerName, countryName, leagueId, countryId, managerCountryId }) => {
      const actualCountryId = legacy ? getLeagueWorldDetails(leagueId)?.countryId ?? null : countryId;
      return { id, htTeamId, name, managerId, managerName, countryName, leagueId, countryId: actualCountryId,
        managerCountryId: legacy ? null : managerCountryId, flagCountryId: resolveFlagCountryId(actualCountryId) };
    }),
    flags: Object.fromEntries(Object.entries(value.flags).map(([key, flags]) => {
      const home = normalizeFlagCountries(flags.home), away = normalizeFlagCountries(flags.away);
      return [key, { htTeamId: flags.htTeamId, managerId: flags.managerId, leagueId: flags.leagueId,
        home: home.ids, away: away.ids, homeUnknown: home.unknown || (!legacy && flags.homeUnknown),
        awayUnknown: away.unknown || (!legacy && flags.awayUnknown), fetchedAt: flags.fetchedAt }];
    })) };
}

export function reconcileFlagSnapshot(snapshot: FlagSnapshot, tournamentId: string, roster: FlagHunterTeam[]) {
  if (snapshot.tournamentId !== tournamentId) throw new Error('This snapshot belongs to another tournament.');
  const current = new Map(roster.map(team => [team.htTeamId, team]));
  const saved = new Map(snapshot.teams.map(team => [team.htTeamId, team]));
  const missing = roster.filter(team => !saved.has(team.htTeamId)).map(team => team.htTeamId);
  const departed = snapshot.teams.filter(team => !current.has(team.htTeamId)).map(team => team.htTeamId);
  const changed = roster.filter(team => {
    const previous = saved.get(team.htTeamId);
    return previous && (previous.managerId !== team.managerId || previous.leagueId !== team.leagueId || previous.id !== team.id
      || (previous.countryId !== null && previous.countryId !== team.countryId));
  }).map(team => team.htTeamId);
  const flags = Object.fromEntries(Object.entries(snapshot.flags).filter(([, item]) => {
    const team = current.get(item.htTeamId);
    return team && !changed.includes(team.htTeamId) && item.managerId === team.managerId && item.leagueId === team.leagueId;
  }));
  return { missing, departed, changed, flags };
}

export function flagBenefit(team: FlagHunterTeam, opponent: FlagHunterTeam, side: 'home' | 'away', flags: Record<string, FlagCollection>): FlagBenefit {
  const collection = flags[String(team.htTeamId)];
  if (!collection || !opponent.flagCountryId || collection.managerId !== team.managerId || collection.leagueId !== team.leagueId) return 'unknown';
  if (collection[side].includes(opponent.flagCountryId)) return 'none';
  return collection[side === 'home' ? 'homeUnknown' : 'awayUnknown'] ? 'unknown' : 'gain';
}

export function pairBenefits(pair: FlagPair, roster: FlagHunterTeam[], flags: Record<string, FlagCollection>) {
  const home = roster.find(team => team.htTeamId === pair.homeId);
  const away = roster.find(team => team.htTeamId === pair.awayId);
  if (!home || !away) throw new Error('Draft no longer matches the roster.');
  return { home: flagBenefit(home, away, 'home', flags), away: flagBenefit(away, home, 'away', flags) };
}

export function draftMetrics(draft: FlagDraft, roster: FlagHunterTeam[], flags: Record<string, FlagCollection>) {
  let gaining = 0, nothing = 0, unknown = 0, both = 0;
  for (const pair of draft.pairs) {
    const benefits = pairBenefits(pair, roster, flags);
    if (benefits.home === 'gain' && benefits.away === 'gain') both++;
    for (const benefit of [benefits.home, benefits.away]) {
      if (benefit === 'gain') gaining++; else if (benefit === 'none') nothing++; else unknown++;
    }
  }
  return { gaining, nothing, unknown, both };
}

function seededRandom(seed: string) {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => {
    state += 0x6D2B79F5;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function createFlagDraft(roster: FlagHunterTeam[], flags: Record<string, FlagCollection>, seed: string): FlagDraft {
  const random = seededRandom(seed);
  const groups = new Map<number, FlagHunterTeam[]>();
  const unresolvedIds: number[] = [];
  const seen = new Set<number>();
  for (const team of [...roster].sort((a, b) => a.htTeamId - b.htTeamId)) {
    if (seen.has(team.htTeamId)) throw new Error('Duplicate Hattrick team in roster.');
    seen.add(team.htTeamId);
    if (!team.managerId) { unresolvedIds.push(team.htTeamId); continue; }
    const group = groups.get(team.managerId) ?? [];
    group.push(team); groups.set(team.managerId, group);
  }
  for (const group of groups.values()) {
    for (let i = group.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1)); [group[i], group[j]] = [group[j], group[i]];
    }
  }
  const pairs: FlagPair[] = [];
  while (true) {
    const candidates = [...groups.values()].filter(group => group.length).map(group => ({ group, tie: random() }))
      .sort((a, b) => b.group.length - a.group.length || a.tie - b.tie);
    if (candidates.length < 2) break;
    const a = candidates[0].group.pop()!, b = candidates[1].group.pop()!;
    const ab: FlagPair = { homeId: a.htTeamId, awayId: b.htTeamId };
    const ba: FlagPair = { homeId: b.htTeamId, awayId: a.htTeamId };
    const score = (pair: FlagPair) => Object.values(pairBenefits(pair, roster, flags)).filter(value => value === 'gain').length;
    const scoreAB = score(ab), scoreBA = score(ba);
    pairs.push(scoreBA > scoreAB || (scoreBA === scoreAB && random() < 0.5) ? ba : ab);
  }
  const leftovers = [...groups.values()].flat().map(team => team.htTeamId);
  // A single unpaired team is the normal parity BYE; multiple leftovers violate the manager constraint.
  const byeId = leftovers.length === 1 && unresolvedIds.length === 0 ? leftovers[0] : null;
  if (byeId === null) unresolvedIds.push(...leftovers);
  return { seed, pairs, byeId, unresolvedIds };
}
