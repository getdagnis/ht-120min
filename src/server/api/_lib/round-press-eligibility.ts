export interface RoundPressEligibilityMatch {
  home_team_id?: string | null;
  away_team_id?: string | null;
  completed?: boolean | null;
  status?: string | null;
  scheduled_for?: string | Date | null;
  match_date?: string | Date | null;
}

export interface RoundPressEligibilityRound {
  round_number: number;
  matches: RoundPressEligibilityMatch[];
}

function isPlayable(match: RoundPressEligibilityMatch) {
  return Boolean(match.home_team_id && match.away_team_id);
}

function isFinished(match: RoundPressEligibilityMatch) {
  return match.completed === true || match.status === 'misarranged';
}

function scheduledTime(match: RoundPressEligibilityMatch) {
  const value = match.scheduled_for ?? match.match_date;
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Finds the latest safely finished round whose next round has not started.
 * This is deliberately pure so the public-window rule can be tested without
 * Supabase, CHPP, or a browser clock.
 */
export function getEligibleRoundPressNumber(
  rounds: RoundPressEligibilityRound[],
  now: Date = new Date(),
): number | null {
  const ordered = [...rounds].sort((left, right) => left.round_number - right.round_number);
  const nowTimestamp = now.getTime();

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const round = ordered[index];
    const playable = round.matches.filter(isPlayable);
    if (playable.length === 0 || !playable.every(isFinished)) continue;

    const nextRound = ordered[index + 1];
    if (!nextRound) return round.round_number;

    const nextKickoffs = nextRound.matches
      .filter(isPlayable)
      .map(scheduledTime)
      .filter((value): value is number => value !== null);
    const firstNextKickoff = nextKickoffs.length > 0 ? Math.min(...nextKickoffs) : null;
    if (firstNextKickoff === null || nowTimestamp < firstNextKickoff) return round.round_number;
  }

  return null;
}
