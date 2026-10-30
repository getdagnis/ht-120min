import { getHattrickWeekDetails, getStockholmWallClock } from './hattrick-calendar';
import { getMatchDateForRound } from './match-schedule';

interface FocusMatch {
  completed?: boolean;
  status?: string | null;
  schedule_resolution?: string | null;
  scheduled_for?: string | null;
  chpp_match_date?: string | null;
  ht_match_id?: number | null;
  schedule_slot_type?: string | null;
  home_team?: { country_name?: string | null } | null;
}

export function isResolvedFixture(match: FocusMatch): boolean {
  return Boolean(match.completed) || match.status === 'misarranged' || match.status === 'finished'
    || match.schedule_resolution === 'finalized_unplayed';
}

export function getUpcomingFixtureRoundIndex<T extends FocusRound>(rounds: T[], now?: Date): number {
  const latestCompletedDate = Math.max(...rounds.flatMap(round => round.matches
    .filter(match => match.completed)
    .map(match => getMatchDateForRound(round, match, match.home_team?.country_name).getTime())
    .filter(Number.isFinite)), -Infinity);
  const earliestAllowed = (now?.getTime() ?? latestCompletedDate) - 4 * 60 * 60 * 1000;
  return rounds.findIndex(round => round.matches.some(match =>
    !isResolvedFixture(match) &&
    getMatchDateForRound(round, match, match.home_team?.country_name).getTime() >= earliestAllowed,
  ));
}

interface FocusRound {
  created_at: string;
  round_number: number;
  matches: FocusMatch[];
}

function hasFixtureInCurrentWeek(round: FocusRound, week: { htSeason: number; htWeek: number }) {
  return round.matches.some((match) => {
    const date = getMatchDateForRound(round, match, match.home_team?.country_name);
    if (!Number.isFinite(date.getTime())) return false;
    const matchWeek = getHattrickWeekDetails(date);
    return matchWeek.htSeason === week.htSeason && matchWeek.htWeek === week.htWeek;
  });
}

function isNextWeekWindowOpen(now: Date) {
  const stockholmNow = getStockholmWallClock(now);
  const weekday = stockholmNow.getUTCDay();

  return weekday === 4 ? stockholmNow.getUTCHours() >= 6 : weekday === 5 || weekday === 6 || weekday === 0;
}

/**
 * Selects the round shown as the tournament's visual focus. This is separate
 * from the actionable round used to decide which fixtures can be challenged.
 */
export function getFocusedFixtureRoundIndex<T extends FocusRound>(
  rounds: T[],
  actionableRoundIndex: number,
  now: Date,
): number {
  const materializedRoundIndices = rounds
    .map((round, index) => (round.matches.length > 0 ? index : -1))
    .filter((index) => index >= 0);
  if (!materializedRoundIndices.length) return actionableRoundIndex;

  if (!isNextWeekWindowOpen(now)) {
    const currentWeek = getHattrickWeekDetails(now);
    const currentWeekRoundIndex = materializedRoundIndices
      .find((index) =>
        rounds[index].matches.some((match) => !isResolvedFixture(match)) &&
        hasFixtureInCurrentWeek(rounds[index], currentWeek),
      );

    if (currentWeekRoundIndex !== undefined) return currentWeekRoundIndex;
  }

  return actionableRoundIndex >= 0 ? actionableRoundIndex : materializedRoundIndices.at(-1)!;
}
