/**
 * Generates a round robin schedule for a list of team IDs.
 * If there's an odd number of teams, a BYE (null) is added.
 */
export function generateRoundRobin(teamIds: string[]) {
  const teams = [...teamIds];
  if (teams.length % 2 !== 0) {
    teams.push(null as any); // BYE
  }

  const roundsCount = teams.length - 1;
  const matchesPerRound = teams.length / 2;
  const schedule = [];

  for (let round = 0; round < roundsCount; round++) {
    const roundMatches = [];
    for (let match = 0; match < matchesPerRound; match++) {
      const home = teams[match];
      const away = teams[teams.length - 1 - match];

      if (home !== null && away !== null) {
        roundMatches.push({ home, away });
      }
    }
    schedule.push({ roundNumber: round + 1, matches: roundMatches });

    // Rotate teams (keep the first one fixed)
    teams.splice(1, 0, teams.pop()!);
  }

  return schedule;
}
