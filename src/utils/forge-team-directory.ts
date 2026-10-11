export interface ForgeDirectoryTeam {
  teamId: number;
  teamName: string;
  countryId?: number;
  countryName?: string;
  leagueId?: number;
  booked: boolean | null;
  inCup: boolean | null;
  challengeableMidweek: boolean | null;
  challengeableWeekend: boolean | null;
  checkedAt: string;
}

export interface ChallengeableDirectoryUser {
  managerId: number;
  managerName: string;
  teams: ForgeDirectoryTeam[];
}

// Keep unvisited managers during a rescan, but replace each verified manager's
// snapshot completely (including an empty roster), rather than accumulating hits.
export function mergeForgeDirectoryUsers(
  current: ChallengeableDirectoryUser[],
  incoming: ChallengeableDirectoryUser[],
  refreshedManagerIds: number[],
): ChallengeableDirectoryUser[] {
  const refreshed = new Set(refreshedManagerIds);
  const users = new Map(current.filter(user => !refreshed.has(user.managerId)).map(user => [user.managerId, user]));
  for (const user of incoming) users.set(user.managerId, user);
  return [...users.values()];
}
