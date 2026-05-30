export interface SchedulerOptions {
  mode: 'single' | 'double';
  neutralInSingle?: boolean;
}

export interface ScheduledMatch {
  home: string | null;
  away: string | null;
  venueType: 'home_away' | 'neutral';
  isBye: boolean;
}

export interface ScheduledRound {
  roundNumber: number;
  matches: ScheduledMatch[];
}

/**
 * Rotates the team array for the Circle Method.
 * The first element stays fixed (index 0), others rotate clockwise.
 * Example for 6 teams: [1, 2, 3, 4, 5, 6] -> [1, 6, 2, 3, 4, 5]
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
 * 
 * Home/Away Balancing:
 * - We alternate the orientation of pairings based on round index.
 * - Team at index 0 (fixed) alternates home/away every round.
 */
export function buildRound(
  teams: (string | null)[],
  roundIdx: number,
  options: SchedulerOptions
): ScheduledMatch[] {
  const matches: ScheduledMatch[] = [];
  const half = teams.length / 2;

  for (let i = 0; i < half; i++) {
    const teamA = teams[i];
    const teamB = teams[teams.length - 1 - i];

    // Determine home/away based on round index and match index to balance.
    // For the fixed team (i=0), we alternate every round.
    // For other pairs, we swap based on parity of round + pairing index.
    let shouldSwap = (roundIdx + i) % 2 === 0;
    
    // Exception for the first pair (fixed team) to ensure consistency
    if (i === 0) {
      shouldSwap = roundIdx % 2 !== 0;
    }

    let home = shouldSwap ? teamB : teamA;
    let away = shouldSwap ? teamA : teamB;

    const isBye = home === null || away === null;
    const venueType = options.mode === 'double' ? 'home_away' : (options.neutralInSingle ? 'neutral' : 'home_away');

    matches.push({
      home,
      away,
      venueType,
      isBye
    });
  }

  return matches;
}

/**
 * Reverses home/away for a list of matches (used for second half of double round robin).
 */
export function mirrorMatches(matches: ScheduledMatch[]): ScheduledMatch[] {
  return matches.map(m => ({
    ...m,
    home: m.away,
    away: m.home
  }));
}

/**
 * Generates a proper round robin schedule using the Circle Method.
 * 
 * Logic for Odd Team Counts:
 * - We add a dummy 'null' team. Whoever is paired with 'null' has a BYE.
 * - These BYE matches are included in the return but marked with isBye=true.
 * 
 * Logic for Rotation:
 * - Standard Circle Method: Fix one team and rotate the rest.
 * - Deterministic: Same input teamIds array will always yield same schedule.
 */
export function generateRoundRobin(
  teamIds: string[],
  options: SchedulerOptions = { mode: 'single', neutralInSingle: true }
): ScheduledRound[] {
  const teams: (string | null)[] = [...teamIds];
  
  // If odd number of teams, add a dummy team for BYEs
  if (teams.length % 2 !== 0) {
    teams.push(null);
  }

  const numTeams = teams.length;
  const numRounds = numTeams - 1;
  let currentTeams: (string | null)[] = [...teams];
  const firstHalf: ScheduledRound[] = [];

  // Generate first half (Single Round Robin)
  for (let r = 0; r < numRounds; r++) {
    firstHalf.push({
      roundNumber: r + 1,
      matches: buildRound(currentTeams, r, options)
    });
    currentTeams = rotateTeams(currentTeams);
  }

  if (options.mode === 'single') {
    return firstHalf;
  }

  // Generate second half (Mirror with reversed venues)
  const secondHalf: ScheduledRound[] = firstHalf.map((round) => ({
    roundNumber: round.roundNumber + numRounds,
    matches: mirrorMatches(round.matches)
  }));

  return [...firstHalf, ...secondHalf];
}

/**
 * Generates a recurring schedule (weeks 1-4 initially).
 * Just repeats the same sequence of pairings.
 */
export function generateRecurring(
  teamIds: string[],
  startRound: number = 1,
  numWeeks: number = 4
): ScheduledRound[] {
  const teams: (string | null)[] = [...teamIds];
  if (teams.length % 2 !== 0) {
    teams.push(null);
  }

  const rounds: ScheduledRound[] = [];
  let currentTeams: (string | null)[] = [...teams];
  
  // To make it deterministic and ensure we don't repeat the same round immediately
  // if we are continuing, we rotate startRound-1 times.
  const totalRotation = teams.length - 1;
  for (let i = 0; i < (startRound - 1) % totalRotation; i++) {
    currentTeams = rotateTeams(currentTeams);
  }

  for (let i = 0; i < numWeeks; i++) {
    const roundIdx = startRound - 1 + i;
    rounds.push({
      roundNumber: roundIdx + 1,
      matches: buildRound(currentTeams, roundIdx, { mode: 'single', neutralInSingle: true })
    });
    currentTeams = rotateTeams(currentTeams);
  }

  return rounds;
}
