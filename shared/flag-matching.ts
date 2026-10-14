import type { FlagDraft, FlagHunterTeam } from './flag-hunters.js';

/** A seeded, stable tie-break; input order and wall-clock timing do not affect the result. */
export function seededFlagTie(seed: string, key: string) {
  let hash = 2166136261;
  for (const char of `${seed}:${key}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) / 4294967296;
}
export function canFlagTeamsPair(a: FlagHunterTeam, b: FlagHunterTeam) {
  return a.htTeamId !== b.htTeamId && a.managerId !== null && b.managerId !== null && a.managerId !== b.managerId
    && !(a.genderId && b.genderId && a.genderId !== b.genderId);
}
/** Edmonds alternating-tree/blossom matching, cardinality only. Tested against exhaustive small graphs. */
export function maximumFlagMatching(roster: FlagHunterTeam[], seed: string, forcedByeId: number | null = null): FlagDraft {
  const teams = [...roster].sort((a, b) => a.htTeamId - b.htTeamId);
  if (forcedByeId !== null && (teams.length % 2 === 0 || !teams.some(team => team.htTeamId === forcedByeId))) throw new Error('A BYE override requires an odd roster and an included team.');
  if (new Set(teams.map(team => team.htTeamId)).size !== teams.length) throw new Error('Duplicate Hattrick team in roster.');
  const n = teams.length;
  const graph = teams.map(a => teams.map((b, i) => ({ b, i })).filter(({ b }) =>
    a.htTeamId !== forcedByeId && b.htTeamId !== forcedByeId && canFlagTeamsPair(a, b))
    .sort((x, y) => seededFlagTie(seed, `edge:${a.htTeamId}:${x.b.htTeamId}`) - seededFlagTie(seed, `edge:${a.htTeamId}:${y.b.htTeamId}`)).map(x => x.i));
  const match = Array<number>(n).fill(-1);
  let parent = Array<number>(n).fill(-1), base = Array.from({ length: n }, (_, i) => i), used = Array<boolean>(n).fill(false);
  let blossom = Array<boolean>(n).fill(false);
  const commonBase = (a: number, b: number) => {
    const path = Array<boolean>(n).fill(false);
    while (true) { a = base[a]; path[a] = true; if (match[a] === -1) break; a = parent[match[a]]; }
    while (true) { b = base[b]; if (path[b]) return b; b = parent[match[b]]; }
  };
  const markPath = (vertex: number, root: number, child: number) => {
    while (base[vertex] !== root) {
      blossom[base[vertex]] = blossom[base[match[vertex]]] = true;
      parent[vertex] = child; child = match[vertex]; vertex = parent[match[vertex]];
    }
  };
  const findPath = (root: number): number => {
    used = Array<boolean>(n).fill(false); parent = Array<number>(n).fill(-1); base = Array.from({ length: n }, (_, i) => i);
    const queue = [root]; used[root] = true;
    for (let k = 0; k < queue.length; k++) {
      const vertex = queue[k];
      for (let next of graph[vertex]) {
        if (base[vertex] === base[next] || match[vertex] === next) continue;
        if (next === root || (match[next] !== -1 && parent[match[next]] !== -1)) {
          const rootBase = commonBase(vertex, next); blossom = Array<boolean>(n).fill(false);
          markPath(vertex, rootBase, next); markPath(next, rootBase, vertex);
          for (let i = 0; i < n; i++) if (blossom[base[i]]) { base[i] = rootBase; if (!used[i]) { used[i] = true; queue.push(i); } }
        } else if (parent[next] === -1) {
          parent[next] = vertex;
          if (match[next] === -1) return next;
          next = match[next]; used[next] = true; queue.push(next);
        }
      }
    }
    return -1;
  };
  for (let i = 0; i < n; i++) if (match[i] === -1) {
    let vertex = findPath(i);
    while (vertex !== -1) { const previous = parent[vertex], next = previous === -1 ? -1 : match[previous]; match[vertex] = previous; if (previous !== -1) match[previous] = vertex; vertex = next; }
  }
  const pairs = teams.flatMap((team, i) => match[i] > i ? [{ homeId: team.htTeamId, awayId: teams[match[i]].htTeamId }] : []);
  const left = teams.filter((_, i) => match[i] === -1).map(team => team.htTeamId);
  const byeCandidates = left.filter(id => teams.find(team => team.htTeamId === id)?.managerId).sort((a, b) => seededFlagTie(seed, `bye:${a}`) - seededFlagTie(seed, `bye:${b}`));
  const byeId = forcedByeId ?? (n % 2 === 1 ? byeCandidates[0] ?? null : null);
  return { seed, pairs, byeId, unresolvedIds: left.filter(id => id !== byeId) };
}
