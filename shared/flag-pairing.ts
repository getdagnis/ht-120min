import { canFlagTeamsPair, maximumFlagMatching, seededFlagTie as tie } from './flag-matching.js';
import { HATTRICK_WORLD_DETAILS } from './worlddetails.js';
import { getCountryActiveTeamCount } from './country-active-team-counts.js';
import { flagBenefit, type FlagCollection, type FlagDraft, type FlagHunterTeam, type FlagPair } from './flag-hunters.js';

export const FLAG_COUNTRIES = Object.values(HATTRICK_WORLD_DETAILS).filter(country => country.countryId !== null).map(country => country.leagueId);
export type CollectionStatus = 'collecting' | 'complete' | 'unavailable' | 'unknown';
export interface FlagPriority {
  teamId: number; priority: number | null; status: CollectionStatus;
  usefulOpponentIds: number[]; homeCount: number | null; awayCount: number | null;
  managerTotal: number; activeTeams: number | null; reason: string;
}
export interface FlagShortage { teamIds: number[]; opponentIds: number[]; minimumMisses: number }
export interface FlagAnalysis { priorities: FlagPriority[]; shortages: FlagShortage[] }
export interface ScarcityDraft extends FlagDraft {
  algorithm: 'scarcity'; analysis: FlagAnalysis; searchLimited: boolean; evaluations: number; byeReason: string | null;
}

function currentCollection(team: FlagHunterTeam, flags: Record<string, FlagCollection>) {
  const collection = flags[String(team.htTeamId)];
  return collection?.managerId === team.managerId && collection?.leagueId === team.leagueId ? collection : undefined;
}

export function analyzeFlagRoster(roster: FlagHunterTeam[], flags: Record<string, FlagCollection>, seed: string): FlagAnalysis {
  const managerTotals = new Map<number, number>();
  for (const team of roster) {
    const collection = currentCollection(team, flags);
    if (team.managerId && collection) managerTotals.set(team.managerId,
      Math.max(managerTotals.get(team.managerId) ?? 0, collection.home.length + collection.away.length));
  }
  const rows: FlagPriority[] = roster.map(team => {
    const collection = currentCollection(team, flags);
    const usefulOpponentIds = roster.filter(opponent => canFlagTeamsPair(team, opponent)
      && (flagBenefit(team, opponent, 'home', flags) === 'gain' || flagBenefit(team, opponent, 'away', flags) === 'gain'))
      .map(opponent => opponent.htTeamId).sort((a, b) => a - b);
    const known = collection && !collection.homeUnknown && !collection.awayUnknown && team.flagCountryId !== null;
    const complete = known && FLAG_COUNTRIES.every(id => collection.home.includes(id) && collection.away.includes(id));
    const status: CollectionStatus = !known ? 'unknown' : complete ? 'complete' : usefulOpponentIds.length ? 'collecting' : 'unavailable';
    return { teamId: team.htTeamId, priority: null, status, usefulOpponentIds,
      homeCount: collection?.home.length ?? null, awayCount: collection?.away.length ?? null,
      managerTotal: team.managerId ? managerTotals.get(team.managerId) ?? 0 : 0,
      activeTeams: getCountryActiveTeamCount(team.countryId), reason: '' };
  });
  const collecting = rows.filter(row => row.status === 'collecting').sort((a, b) =>
    a.usefulOpponentIds.length - b.usefulOpponentIds.length || b.managerTotal - a.managerTotal
    || (a.activeTeams ?? Infinity) - (b.activeTeams ?? Infinity) || tie(seed, `priority:${a.teamId}`) - tie(seed, `priority:${b.teamId}`) || a.teamId - b.teamId);
  collecting.forEach((row, index) => {
    row.priority = index + 1;
    row.reason = `${row.usefulOpponentIds.length} useful opponent${row.usefulOpponentIds.length === 1 ? '' : 's'}; manager maximum ${row.managerTotal}; ${row.activeTeams === null ? 'country population unknown' : `${row.activeTeams} active teams`}; seeded tie-break.`;
  });
  for (const row of rows.filter(row => row.priority === null)) row.reason = row.status === 'complete'
    ? 'Both collections cover every mapped country; can supply opponents where eligible.'
    : row.status === 'unavailable' ? 'Incomplete collection, but no eligible opponent in this roster supplies a confirmed missing flag.'
      : 'Collections or country mapping are unknown; not assigned scarcity priority.';
  return { priorities: [...collecting, ...rows.filter(row => row.priority === null).sort((a, b) => a.teamId - b.teamId)], shortages: sharedShortages(collecting) };
}

/** Hall-deficient alternating sets prove shared shortages; this is not a full feasibility proof. */
function sharedShortages(collectors: FlagPriority[]): FlagShortage[] {
  const assigned = new Map<number, number>();
  const byId = new Map(collectors.map(row => [row.teamId, row]));
  const augment = (teamId: number, seen: Set<number>): boolean => {
    for (const opponentId of byId.get(teamId)!.usefulOpponentIds) {
      if (seen.has(opponentId)) continue;
      seen.add(opponentId);
      const owner = assigned.get(opponentId);
      if (owner === undefined || augment(owner, seen)) { assigned.set(opponentId, teamId); return true; }
    }
    return false;
  };
  const unmatched = collectors.filter(row => !augment(row.teamId, new Set()));
  const groups: FlagShortage[] = [];
  for (const row of unmatched) {
    const teams = new Set([row.teamId]), opponents = new Set<number>(), queue = [row.teamId];
    for (let i = 0; i < queue.length; i++) for (const opponent of byId.get(queue[i])!.usefulOpponentIds) {
      opponents.add(opponent);
      const owner = assigned.get(opponent);
      if (owner !== undefined && !teams.has(owner)) { teams.add(owner); queue.push(owner); }
    }
    if (teams.size > opponents.size) {
      const previous = groups.find(group => group.teamIds.some(id => teams.has(id)));
      if (previous) {
        previous.teamIds = [...new Set([...previous.teamIds, ...teams])].sort((a, b) => a - b);
        previous.opponentIds = [...new Set([...previous.opponentIds, ...opponents])].sort((a, b) => a - b);
        previous.minimumMisses = previous.teamIds.length - previous.opponentIds.length;
      } else groups.push({ teamIds: [...teams].sort((a, b) => a - b), opponentIds: [...opponents].sort((a, b) => a - b), minimumMisses: teams.size - opponents.size });
    }
  }
  return groups;
}


type Slot = [number, number]; // -1 is an unpaired slot, not a fake Hattrick team.
interface EdgeScore { priority: bigint; managers: bigint; gains: number; mutual: number; rare: number; seeded: number }
interface Score extends EdgeScore { singleManagerBye: number; usefulBye: number; changes: number; repeats: number }
export interface FlagPairingOptions {
  managerFirst?: boolean;
  baseline?: FlagPair[];
  baselineByes?: number[];
  previousPairs?: FlagPair[];
  /** Gains already secured by booked matches from the same round. */
  gainingManagerIds?: number[];
}
const empty = (): EdgeScore => ({ priority: 0n, managers: 0n, gains: 0, mutual: 0, rare: 0, seeded: 0 });
const bitCount = (value: bigint) => { let count = 0; for (; value; value &= value - 1n) count++; return count; };
function compare(a: Score, b: Score, options: FlagPairingOptions) {
  if (options.baseline && a.changes !== b.changes) return b.changes - a.changes;
  const coverage = bitCount(a.managers) - bitCount(b.managers);
  if (options.managerFirst && coverage) return coverage;
  // Exact lexicographic priority bits: no numeric weight can reverse an earlier collecting need.
  if (a.priority !== b.priority) return a.priority > b.priority ? 1 : -1;
  const rareDifference = a.rare - b.rare;
  const rareOrder = Math.abs(rareDifference) > Number.EPSILON * 32 * Math.max(1, Math.abs(a.rare), Math.abs(b.rare)) ? rareDifference : 0;
  return bitCount(a.managers) - bitCount(b.managers) || a.gains - b.gains || rareOrder
    || b.repeats - a.repeats || b.singleManagerBye - a.singleManagerBye || b.usefulBye - a.usefulBye || a.seeded - b.seeded;
}
function partitions(ids: number[]): Slot[][] {
  if (!ids.length) return [[]];
  const [first, ...rest] = ids;
  return rest.flatMap((second, i) => partitions(rest.filter((_, j) => i !== j)).map(tail => [[first, second] as Slot, ...tail]));
}

export function createScarcityDraft(roster: FlagHunterTeam[], flags: Record<string, FlagCollection>, seed: string, forcedByeId: number | null = null, options: FlagPairingOptions = {}): ScarcityDraft {
  const compareScores = (a: Score, b: Score) => compare(a, b, options);
  if (forcedByeId !== null && (roster.length % 2 === 0 || !roster.some(team => team.htTeamId === forcedByeId))) throw new Error('A BYE override requires an odd roster and an included team.');
  const analysis = analyzeFlagRoster(roster, flags, seed), teams = new Map(roster.map(team => [team.htTeamId, team]));
  const priorityBits = new Map(analysis.priorities.filter(row => row.priority !== null).map((row, i, all) => [row.teamId, 1n << BigInt(all.length - i - 1)]));
  const managerIds = [...new Set([...roster.map(team => team.managerId).filter((id): id is number => id !== null), ...(options.gainingManagerIds || [])])].sort((a, b) => a - b);
  const managerBits = new Map(managerIds.map((id, i) => [id, 1n << BigInt(i)]));
  const managerTeams = new Map(managerIds.map(id => [id, roster.filter(team => team.managerId === id).length]));
  const priorityRows = new Map(analysis.priorities.map(row => [row.teamId, row]));
  const edges = new Map<string, EdgeScore>();
  for (const home of roster) for (const away of roster) if (canFlagTeamsPair(home, away)) {
    const score = empty();
    const benefits = [flagBenefit(home, away, 'home', flags) === 'gain', flagBenefit(away, home, 'away', flags) === 'gain'];
    for (const [team, opponent, gain] of [[home, away, benefits[0]], [away, home, benefits[1]]] as const) if (gain) {
      score.priority |= priorityBits.get(team.htTeamId) ?? 0n; score.managers |= managerBits.get(team.managerId!)!; score.gains++;
      const count = getCountryActiveTeamCount(opponent.countryId); if (count !== null) score.rare += 1 / count;
    }
    score.mutual = benefits.every(Boolean) ? 1 : 0; score.seeded = tie(seed, `venue:${home.htTeamId}:${away.htTeamId}`);
    edges.set(`${home.htTeamId}:${away.htTeamId}`, score);
  }
  const orientations = (pair: Slot): Slot[] => {
    const [a, b] = pair;
    if (a < 0 || b < 0) { const id = Math.max(a, b); return id < 0 ? [] : [[id, -1]]; }
    if (a === forcedByeId || b === forcedByeId || !canFlagTeamsPair(teams.get(a)!, teams.get(b)!)) return [];
    const ab = edges.get(`${a}:${b}`)!, ba = edges.get(`${b}:${a}`)!;
    if (!options.managerFirst && !options.baseline && ab.priority !== ba.priority) return [ab.priority > ba.priority ? [a, b] : [b, a]];
    if (options.baseline || options.managerFirst) return [[a, b], [b, a]];
    if (ab.managers === ba.managers && ab.gains === ba.gains && ab.rare === ba.rare) return [ab.seeded > ba.seeded ? [a, b] : [b, a]];
    return [[a, b], [b, a]];
  };
  const score = (slots: Slot[]): Score => {
    const result: Score = { ...empty(), singleManagerBye: 0, usefulBye: 0, changes: 0, repeats: 0 };
    for (const id of options.gainingManagerIds || []) result.managers |= managerBits.get(id) ?? 0n;
    for (const [a, b] of slots) {
      if (options.baseline) {
        for (const id of [a, b].filter(id => id >= 0)) {
          const old = options.baseline.find(pair => pair.homeId === id || pair.awayId === id);
          if (old && (old.homeId !== a || old.awayId !== b)) result.changes++;
          if (!old && b >= 0 && options.baselineByes?.includes(id)) result.changes++;
        }
      }
      if (b < 0) {
        if (managerTeams.get(teams.get(a)!.managerId!) === 1) result.singleManagerBye++;
        result.usefulBye += priorityRows.get(a)?.usefulOpponentIds.length ?? 0; continue;
      }
      const edge = edges.get(`${a}:${b}`)!;
      if (options.previousPairs?.some(pair => (pair.homeId === a && pair.awayId === b) || (pair.homeId === b && pair.awayId === a))) result.repeats++;
      result.priority |= edge.priority; result.managers |= edge.managers; result.gains += edge.gains; result.mutual += edge.mutual;
      result.rare += edge.rare; result.seeded += edge.seeded;
    }
    return result;
  };
  const start = maximumFlagMatching(roster, seed, forcedByeId, options.baseline);
  let slots: Slot[] = [...start.pairs.map(pair => [pair.homeId, pair.awayId] as Slot),
    ...[...start.unresolvedIds, ...(start.byeId === null ? [] : [start.byeId])].map(id => [id, -1] as Slot)];
  // Optimize individual venues before considering reassignment.
  for (let i = 0; i < slots.length; i++) {
    const options = orientations(slots[i]);
    for (const option of options) { const candidate = slots.map((slot, j) => j === i ? option : slot); if (compareScores(score(candidate), score(slots)) > 0) slots = candidate; }
  }
  let evaluations = 0, limited = false;
  const BUDGET = 60000; // Fixed bounded search, not a scoring weight or organizer setting.
  const attempt = (indices: number[]): Slot[] | null => {
    const selected = new Set(indices), rest = slots.filter((_, i) => !selected.has(i));
    const pairCount = indices.filter(i => slots[i][1] >= 0).length;
    const currentScore = score(slots), restScore = score(rest);
    let best: Slot[] | null = null, bestScore = currentScore;
    for (const partition of partitions(indices.flatMap(i => slots[i]))) {
      if (partition.filter(([a, b]) => a >= 0 && b >= 0).length !== pairCount) continue;
      const choices = partition.map(orientations); if (choices.some(options => !options.length)) continue;
      const visit = (i: number, patch: Slot[]) => {
        if (evaluations >= BUDGET) { limited = true; return; }
        if (i < choices.length) { for (const option of choices[i]) visit(i + 1, [...patch, option]); return; }
        evaluations++;
        const candidate = [...rest, ...patch], patchScore = score(patch);
        const candidateScore: Score = { priority: restScore.priority | patchScore.priority, managers: restScore.managers | patchScore.managers,
          gains: restScore.gains + patchScore.gains, mutual: restScore.mutual + patchScore.mutual,
          rare: restScore.rare + patchScore.rare, seeded: restScore.seeded + patchScore.seeded,
          changes: restScore.changes + patchScore.changes, repeats: restScore.repeats + patchScore.repeats,
          singleManagerBye: restScore.singleManagerBye + patchScore.singleManagerBye, usefulBye: restScore.usefulBye + patchScore.usefulBye };
        if (compareScores({ ...candidateScore, seeded: 0 }, { ...currentScore, seeded: 0 }) > 0
          && compareScores(candidateScore, bestScore) > 0) { best = candidate; bestScore = candidateScore; }
      };
      visit(0, []);
    }
    return best;
  };
  // First-improvement descent revisits old pairings; no greedy pick is permanently locked.
  while (!limited) {
    let improved = false;
    for (let i = 0; i < slots.length && !improved && !limited; i++) for (let j = i + 1; j < slots.length && !improved && !limited; j++) {
      const candidate = attempt([i, j]); if (candidate) { slots = candidate; improved = true; }
    }
    if (improved) continue;
    // Search three-slot alternating reassignments specifically around unsatisfied collectors.
    const currentScore = score(slots);
    for (const row of analysis.priorities.filter(item => item.priority !== null)) {
      if ((currentScore.priority & priorityBits.get(row.teamId)!) !== 0n) continue;
      const i = slots.findIndex(slot => slot.includes(row.teamId));
      for (const opponent of row.usefulOpponentIds) {
        const j = slots.findIndex(slot => slot.includes(opponent)); if (i === j) continue;
        for (let k = 0; k < slots.length && !improved && !limited; k++) if (k !== i && k !== j) {
          const candidate = attempt([i, j, k]); if (candidate) { slots = candidate; improved = true; }
        }
        if (improved || limited) break;
      }
      if (improved || limited) break;
    }
    if (!improved) break;
  }
  const pairs = slots.filter(([, b]) => b >= 0).map(([homeId, awayId]) => ({ homeId, awayId })).sort((a, b) => a.homeId - b.homeId);
  const remaining = slots.filter(([, b]) => b < 0).map(([id]) => id);
  const pairedIds = new Set(pairs.flatMap(pair => [pair.homeId, pair.awayId]));
  const hasPairedManagerTeam = (id: number) => roster.some(team => team.managerId === teams.get(id)!.managerId && pairedIds.has(team.htTeamId));
  const byeCandidates = remaining.filter(id => teams.get(id)?.managerId).sort((a, b) =>
    Number((priorityRows.get(a)?.usefulOpponentIds.length ?? 0) > 0) - Number((priorityRows.get(b)?.usefulOpponentIds.length ?? 0) > 0)
    || Number(hasPairedManagerTeam(b)) - Number(hasPairedManagerTeam(a))
    || Number(priorityRows.get(b)?.status === 'complete') - Number(priorityRows.get(a)?.status === 'complete')
    || tie(seed, `bye:${a}`) - tie(seed, `bye:${b}`));
  const byeId = forcedByeId ?? (roster.length % 2 === 1 ? byeCandidates[0] ?? null : null);
  const byeTeam = byeId === null ? null : teams.get(byeId)!;
  const byeReason = !byeTeam ? null : forcedByeId !== null ? 'Organizer BYE override; other unresolved teams are shown separately.'
    : `${priorityRows.get(byeTeam.htTeamId)?.usefulOpponentIds.length ? 'BYE remains after protecting earlier collecting gains' : 'No confirmed collecting opportunity sacrificed'}; ${hasPairedManagerTeam(byeTeam.htTeamId) ? 'this manager has another paired team' : 'this manager has no other paired team; no better reassignment was found'}.`;
  return { seed, algorithm: 'scarcity', pairs, byeId, unresolvedIds: remaining.filter(id => id !== byeId), analysis, searchLimited: limited, evaluations, byeReason };
}

export function reviewFlagDraft(draft: FlagDraft, roster: FlagHunterTeam[], flags: Record<string, FlagCollection>, analysis = analyzeFlagRoster(roster, flags, draft.seed)) {
  const teams = new Map(roster.map(team => [team.htTeamId, team]));
  const assignments = new Map<number, { opponentId: number; venue: 'home' | 'away' }>();
  for (const pair of draft.pairs) {
    assignments.set(pair.homeId, { opponentId: pair.awayId, venue: 'home' }); assignments.set(pair.awayId, { opponentId: pair.homeId, venue: 'away' });
  }
  const rows = analysis.priorities.map(row => {
    const assignment = assignments.get(row.teamId), team = teams.get(row.teamId)!;
    const benefit = assignment ? flagBenefit(team, teams.get(assignment.opponentId)!, assignment.venue, flags) : 'none';
    const gainCountryId = benefit === 'gain' ? teams.get(assignment!.opponentId)!.flagCountryId : null;
    const status = row.teamId === draft.byeId ? 'BYE' : draft.unresolvedIds.includes(row.teamId) ? 'unresolved'
      : gainCountryId !== null ? 'gain' : row.status === 'complete' ? 'complete' : benefit === 'unknown' || row.status === 'unknown' ? 'unknown' : 'unavailable';
    const shortage = analysis.shortages.find(group => group.teamIds.includes(row.teamId));
    let explanation = status === 'gain' ? 'Confirmed missing flag in the selected venue.' : row.reason;
    if (row.status === 'collecting' && gainCountryId === null) {
      explanation = shortage ? `Shared shortage: ${shortage.teamIds.length} collecting teams share ${shortage.opponentIds.length} useful opponents; at least ${shortage.minimumMisses} must miss.${'algorithm' in draft ? ' Priority protects earlier gains.' : ''}`
        : 'algorithm' in draft ? 'No gain found while preserving earlier-priority gains and the number of matches. A larger reassignment may improve this heuristic draft.'
          : 'The random baseline did not select a useful opponent and venue; the scarcity draft may recover this opportunity.';
    }
    if (status === 'BYE') explanation = 'byeReason' in draft ? String(draft.byeReason) : 'Random baseline BYE, or organizer override.';
    return { ...row, team, opponent: assignment ? teams.get(assignment.opponentId)! : null, venue: assignment?.venue ?? null, gainCountryId, result: status, explanation };
  });
  const managers = [...new Set(roster.map(team => team.managerId))].map(managerId => ({ managerId,
    managerName: roster.find(team => team.managerId === managerId)?.managerName ?? 'Unknown',
    teams: roster.filter(team => team.managerId === managerId).map(team => team.name),
    gains: rows.filter(row => row.team.managerId === managerId && row.gainCountryId !== null).length,
  }));
  const gainIds = new Set(rows.filter(row => row.gainCountryId !== null).map(row => row.teamId));
  return { rows, managers, summary: { matches: draft.pairs.length, byes: draft.byeId === null ? 0 : 1, unresolved: draft.unresolvedIds.length,
    gainingTeams: gainIds.size, gainingManagers: managers.filter(manager => manager.managerId !== null && manager.gains > 0).length,
    mutualMatches: draft.pairs.filter(pair => gainIds.has(pair.homeId) && gainIds.has(pair.awayId)).length,
    complete: rows.filter(row => row.status === 'complete').length, unknown: rows.filter(row => row.status === 'unknown').length,
    unavailable: rows.filter(row => row.status === 'unavailable').length,
    missedCollectors: rows.filter(row => row.status === 'collecting' && row.gainCountryId === null).length } };
}
