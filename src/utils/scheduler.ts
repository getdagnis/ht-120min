export interface SchedulerOptions {
  mode: 'single' | 'double';
}

export interface ScheduledMatch {
  home: string | null;
  away: string | null;
  venueType: 'home_away';
  isBye: boolean;
}

export interface ScheduledRound {
  roundNumber: number;
  matches: ScheduledMatch[];
}

/**
 * Rotates the team array for the Circle Method.
 * The first element stays fixed (index 0), others rotate clockwise.
 */
export function rotateTeams(teams: (string | null)[]): (string | null)[] {
  if (teams.length <= 2) return teams;
  const newTeams = [...teams];
  const last = newTeams.pop()!;
  newTeams.splice(1, 0, last);
  return newTeams;
}

/**
 * Builds matches for a single round using the current team positions.
 * Home/away is passed in as a pre-computed map for this round.
 */
export function buildRound(teams: (string | null)[], homeMap: Map<string, boolean>): ScheduledMatch[] {
  const matches: ScheduledMatch[] = [];
  const half = teams.length / 2;

  for (let i = 0; i < half; i++) {
    const teamA = teams[i];
    const teamB = teams[teams.length - 1 - i];
    const isBye = teamA === null || teamB === null;
    // teamA is home unless homeMap says otherwise
    const aIsHome = isBye ? true : (homeMap.get(teamA!) ?? true);
    matches.push({
      home: aIsHome ? teamA : teamB,
      away: aIsHome ? teamB : teamA,
      venueType: 'home_away',
      isBye,
    });
  }
  return matches;
}

/**
 * Generates home/away assignment for all rounds up-front, tracking per-team home counts
 * to ensure balance (no team gets more than ceil(numRounds/2) home games).
 */
function buildHomeAssignments(
  rounds: Array<Array<[string | null, string | null]>>,
  numRounds: number,
): Array<Map<string, boolean>> {
  const homeCounts: Record<string, number> = {};
  const maxHome = Math.ceil(numRounds / 2);
  const result: Array<Map<string, boolean>> = [];

  for (const pairings of rounds) {
    const map = new Map<string, boolean>();
    for (const [a, b] of pairings) {
      if (a === null || b === null) continue;
      const aHomes = homeCounts[a] ?? 0;
      const bHomes = homeCounts[b] ?? 0;
      // Give home to team with fewer homes; if equal, prefer 'a'
      const aIsHome = aHomes <= bHomes && aHomes < maxHome ? true
        : bHomes < aHomes && bHomes < maxHome ? false
        : aHomes < maxHome; // fallback: a gets home if still under limit
      map.set(a, aIsHome);
      if (aIsHome) homeCounts[a] = aHomes + 1;
      else homeCounts[b] = bHomes + 1;
    }
    result.push(map);
  }
  return result;
}

/**
 * Reverses home/away for a list of matches (used for second half of double round robin).
 */
export function mirrorMatches(matches: ScheduledMatch[]): ScheduledMatch[] {
  return matches.map((m) => ({
    ...m,
    home: m.away,
    away: m.home,
  }));
}

/**
 * Generates a proper round robin schedule using the Circle Method.
 * Deterministic: Same input teamIds array will always yield same schedule.
 * Home/away is assigned greedily to keep counts balanced (≤ ceil(n/2) home games per team).
 */
export function generateRoundRobin(
  teamIds: string[],
  options: SchedulerOptions = { mode: 'single' },
): ScheduledRound[] {
  const teams: (string | null)[] = [...teamIds];
  if (teams.length % 2 !== 0) teams.push(null);

  const numTeams = teams.length;
  const numRounds = numTeams - 1;
  let currentTeams: (string | null)[] = [...teams];

  // Step 1: collect raw pairings per round (just who plays whom, no home/away yet)
  const allPairings: Array<Array<[string | null, string | null]>> = [];
  for (let r = 0; r < numRounds; r++) {
    const pairs: Array<[string | null, string | null]> = [];
    const half = currentTeams.length / 2;
    for (let i = 0; i < half; i++) {
      pairs.push([currentTeams[i], currentTeams[currentTeams.length - 1 - i]]);
    }
    allPairings.push(pairs);
    currentTeams = rotateTeams(currentTeams);
  }

  const totalRounds = options.mode === 'double' ? numRounds * 2 : numRounds;

  // For double, second half mirrors first half's pairings (home/away flipped)
  const allPairingsForAssignment = options.mode === 'double'
    ? [...allPairings, ...allPairings.map(p => p.map(([a, b]) => [b, a] as [string | null, string | null]))]
    : allPairings;

  // Step 2: assign home/away with balanced counting
  const homeMaps = buildHomeAssignments(allPairingsForAssignment, totalRounds);

  // Step 3: build ScheduledRound[]
  return allPairingsForAssignment.map((pairs, ri) => {
    const homeMap = homeMaps[ri];
    const matches: ScheduledMatch[] = pairs.map(([a, b]) => {
      const isBye = a === null || b === null;
      const aIsHome = isBye ? true : (homeMap.get(a!) ?? true);
      return {
        home: aIsHome ? a : b,
        away: aIsHome ? b : a,
        venueType: 'home_away' as const,
        isBye,
      };
    });
    return { roundNumber: ri + 1, matches };
  });
}

/**
 * Generates a recurring schedule (weeks 1-4 initially).
 */
export function generateRecurring(teamIds: string[], startRound: number = 1, numWeeks: number = 4): ScheduledRound[] {
  const teams: (string | null)[] = [...teamIds];
  if (teams.length % 2 !== 0) teams.push(null);

  let currentTeams: (string | null)[] = [...teams];
  const totalRotation = teams.length - 1;
  for (let i = 0; i < (startRound - 1) % totalRotation; i++) {
    currentTeams = rotateTeams(currentTeams);
  }

  // Collect pairings first, then assign home/away with balance tracking
  const allPairings: Array<Array<[string | null, string | null]>> = [];
  for (let i = 0; i < numWeeks; i++) {
    const pairs: Array<[string | null, string | null]> = [];
    const half = currentTeams.length / 2;
    for (let j = 0; j < half; j++) {
      pairs.push([currentTeams[j], currentTeams[currentTeams.length - 1 - j]]);
    }
    allPairings.push(pairs);
    currentTeams = rotateTeams(currentTeams);
  }

  const homeMaps = buildHomeAssignments(allPairings, numWeeks);

  return allPairings.map((pairs, i) => {
    const homeMap = homeMaps[i];
    return {
      roundNumber: startRound + i,
      matches: pairs.map(([a, b]) => {
        const isBye = a === null || b === null;
        const aIsHome = isBye ? true : (homeMap.get(a!) ?? true);
        return { home: aIsHome ? a : b, away: aIsHome ? b : a, venueType: 'home_away' as const, isBye };
      }),
    };
  });
}
