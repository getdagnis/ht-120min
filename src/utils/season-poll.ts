export interface PollRound {
  round_number: number;
  matches: Array<{ scheduled_for?: string | null }>;
}

export interface PollTeamOption {
  id: string;
  name: string;
}

export interface PollVote {
  team_id: string;
}

export interface PollResult extends PollTeamOption {
  votes: number;
}

/**
 * Returns the UTC calendar-day boundary for the ceiling middle round. Schedules
 * are stored as instants, but this poll deliberately has day-level precision.
 */
export function getSeasonPollCloseDate(rounds: PollRound[]): Date | null {
  const orderedRounds = [...rounds]
    .filter((round) => Number.isInteger(round.round_number) && round.round_number > 0)
    .sort((left, right) => left.round_number - right.round_number);

  if (!orderedRounds.length) return null;

  const closingRound = orderedRounds[Math.ceil(orderedRounds.length / 2) - 1];
  const scheduledFor = closingRound.matches
    .map((match) => match.scheduled_for)
    .find((value): value is string => {
      if (!value) return false;
      return Number.isFinite(new Date(value).getTime());
    });

  if (!scheduledFor) return null;

  const scheduledDate = new Date(scheduledFor);
  return new Date(Date.UTC(scheduledDate.getUTCFullYear(), scheduledDate.getUTCMonth(), scheduledDate.getUTCDate()));
}

export function isSeasonPollClosed(closeDate: Date, now = new Date()): boolean {
  return now.getTime() >= closeDate.getTime();
}

export function getSeasonPollVoteTotal(votes: PollVote[]): number {
  return votes.length;
}

export function buildSeasonPollResults(teams: PollTeamOption[], votes: PollVote[]): PollResult[] {
  const voteCounts = new Map<string, number>();
  votes.forEach((vote) => voteCounts.set(vote.team_id, (voteCounts.get(vote.team_id) || 0) + 1));

  return teams
    .map((team) => ({ ...team, votes: voteCounts.get(team.id) || 0 }))
    .sort((left, right) => right.votes - left.votes || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}
