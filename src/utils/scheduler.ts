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
 * Implements standard Home/Away balancing.
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

    // Standard Circle Method Home/Away balancing:
    // 1. For the fixed team (i=0), alternate every round.
    // 2. For others, alternate based on round + pairing index.
    // Bias: We want the fixed team (usually the "oldest" joined) to play AWAY more if rounds are odd.
    // In a 5-round tourney, we want 2H / 3A for the first team.
    // Round 0 (rIdx=0): Away (Swap=true)
    // Round 1 (rIdx=1): Home (Swap=false)
    let shouldSwap = (roundIdx + i) % 2 === 0;
    
    if (i === 0) {
      // Fixed team bias: starts Away in Round 1
      shouldSwap = roundIdx % 2 === 0;
    }

    const home = shouldSwap ? teamB : teamA;
    const away = shouldSwap ? teamA : teamB;

    const isBye = home === null || away === null;

    matches.push({
      home,
      away,
      venueType: 'home_away',
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
 * Deterministic: Same input teamIds array will always yield same schedule.
 */
export function generateRoundRobin(
  teamIds: string[],
  options: SchedulerOptions = { mode: 'single' }
): ScheduledRound[] {
  const teams: (string | null)[] = [...teamIds];
  
  if (teams.length % 2 !== 0) {
    teams.push(null);
  }

  const numTeams = teams.length;
  const numRounds = numTeams - 1;
  let currentTeams: (string | null)[] = [...teams];
  const firstHalf: ScheduledRound[] = [];

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

  const secondHalf: ScheduledRound[] = firstHalf.map((round) => ({
    roundNumber: round.roundNumber + numRounds,
    matches: mirrorMatches(round.matches)
  }));

  return [...firstHalf, ...secondHalf];
}

/**
 * Generates a recurring schedule (weeks 1-4 initially).
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
  
  const totalRotation = teams.length - 1;
  for (let i = 0; i < (startRound - 1) % totalRotation; i++) {
    currentTeams = rotateTeams(currentTeams);
  }

  for (let i = 0; i < numWeeks; i++) {
    const roundIdx = startRound - 1 + i;
    rounds.push({
      roundNumber: roundIdx + 1,
      matches: buildRound(currentTeams, roundIdx, { mode: 'single' })
    });
    currentTeams = rotateTeams(currentTeams);
  }

  return rounds;
}
