import type { LengthSchedulePairing } from './length-schedule.js';

/** Ranked opener, then complete circle-method cycles; no factorial matching search. */
export function buildRoundRobinCycles(teamIds: string[], roundCount: number): LengthSchedulePairing[][] {
  if (teamIds.length < 2 || roundCount < 1) return [];
  const ids: Array<string | null> = [...teamIds];
  if (ids.length % 2) ids.push(null);
  const wheel: Array<string | null> = Array(ids.length).fill(null);
  for (let i = 0; i < ids.length / 2; i++) {
    wheel[i] = ids[i * 2]!;
    wheel[ids.length - 1 - i] = ids[i * 2 + 1]!;
  }
  const cycle: LengthSchedulePairing[][] = [];
  for (let r = 0; r < ids.length - 1; r++) {
    cycle.push(Array.from({ length: ids.length / 2 }, (_, i) => {
      const a = wheel[i] ?? null;
      const b = wheel[wheel.length - 1 - i] ?? null;
      return { homeTeamId: a || b, awayTeamId: a && b ? b : null, isBye: !a || !b };
    }));
    wheel.splice(1, 0, wheel.pop()!);
  }
  const seed = new Map(teamIds.map((id, i) => [id, i]));
  const distance = (round: LengthSchedulePairing[]) => round.reduce((sum, pair) =>
    sum + (pair.awayTeamId ? Math.abs(seed.get(pair.homeTeamId!)! - seed.get(pair.awayTeamId)!) : 0), 0);
  const ordered = [cycle[0]!, ...cycle.slice(1).sort((a, b) => distance(a) - distance(b))];
  const rounds = Array.from({ length: roundCount }, (_, r) => ordered[r % ordered.length]!.map(pair => ({ ...pair })));

  // Even occurrences of a pairing cancel home/away. Orient the remaining simple
  // graph along Euler circuits (join odd-degree vertices to a dummy vertex), so
  // every team's total home/away difference is at most one, including partial cycles.
  const occurrences = new Map<string, LengthSchedulePairing[]>();
  for (const pair of rounds.flat()) {
    if (!pair.awayTeamId) continue;
    const key = [pair.homeTeamId!, pair.awayTeamId].sort().join(':');
    const group = occurrences.get(key) || [];
    group.push(pair);
    occurrences.set(key, group);
  }
  const edges: Array<[string, string]> = [];
  const adjacency = new Map<string, number[]>();
  const addEdge = (a: string, b: string) => {
    const i = edges.push([a, b]) - 1;
    adjacency.set(a, [...(adjacency.get(a) || []), i]);
    adjacency.set(b, [...(adjacency.get(b) || []), i]);
  };
  for (const group of occurrences.values()) {
    if (group.length % 2) addEdge(group[0]!.homeTeamId!, group[0]!.awayTeamId!);
  }
  const dummy = '__round_robin_balance__';
  for (const [id, list] of [...adjacency]) if (list.length % 2) addEdge(id, dummy);
  const used = new Set<number>();
  const homeForPair = new Map<string, string>();
  for (const start of adjacency.keys()) {
    const stack = [start];
    while (stack.length) {
      const a = stack[stack.length - 1]!;
      const list = adjacency.get(a)!;
      while (list.length && used.has(list[list.length - 1]!)) list.pop();
      const index = list.pop();
      if (index === undefined) { stack.pop(); continue; }
      used.add(index);
      const [x, y] = edges[index]!;
      const b = a === x ? y : x;
      if (a !== dummy && b !== dummy) homeForPair.set([a, b].sort().join(':'), a);
      stack.push(b);
    }
  }
  for (const [key, group] of occurrences) {
    const first = group[0]!;
    const a = first.homeTeamId!;
    const b = first.awayTeamId!;
    const home = homeForPair.get(key) || a;
    const away = home === a ? b : a;
    group.forEach((pair, i) => {
      pair.homeTeamId = i % 2 ? away : home;
      pair.awayTeamId = i % 2 ? home : away;
    });
  }
  return rounds;
}
