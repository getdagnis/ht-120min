import { getHattrickWeekFromDate, getStockholmWallClock } from './hattrick-calendar';

export type ImportedFixtureRoundPeriod = 'full_week' | 'midweek' | 'weekend';

export interface ImportedFixtureRoundKey {
  htSeason: number;
  htWeek: number;
  period: ImportedFixtureRoundPeriod;
  key: string;
}

export interface ManualRoundMatchInput {
  id: string;
  scheduled_for?: string | null;
}

export interface ManualRoundInput {
  id: string;
  round_number: number;
  matches: ManualRoundMatchInput[];
}

export interface ManualRoundNormalizationPlan {
  assignments: Array<{ matchId: string; roundId: string | null; dateKey: string }>;
  existingRoundNumbers: Array<{ roundId: string; roundNumber: number }>;
  finalRounds: Array<{ roundId: string | null; dateKey: string; roundNumber: number }>;
  emptyRoundIds: string[];
}

/**
 * Imported-round weekday decisions use the app's existing Hattrick timezone
 * convention (Europe/Stockholm), not the browser's local timezone.
 */
export function getImportedFixtureRoundPeriod(scheduledFor: string | Date): ImportedFixtureRoundPeriod {
  const date = scheduledFor instanceof Date ? scheduledFor : new Date(scheduledFor);
  if (!Number.isFinite(date.getTime())) return 'midweek';
  const { htWeek } = getHattrickWeekFromDate(date);
  if (htWeek < 15) return 'full_week';
  const stockholmWeekday = getStockholmWallClock(date).getUTCDay();
  return stockholmWeekday === 0 || stockholmWeekday === 6 ? 'weekend' : 'midweek';
}

export function getImportedFixtureRoundKey(scheduledFor: string | Date): ImportedFixtureRoundKey | null {
  const date = scheduledFor instanceof Date ? scheduledFor : new Date(scheduledFor);
  if (!Number.isFinite(date.getTime())) return null;
  const { htSeason, htWeek } = getHattrickWeekFromDate(date);
  const period = getImportedFixtureRoundPeriod(date);
  const periodSuffix = period === 'full_week' ? '' : `-${period}`;
  return {
    htSeason,
    htWeek,
    period,
    key: `S${htSeason}-W${htWeek}${periodSuffix}`,
  };
}

function getMatchGroup(match: ManualRoundMatchInput, fallback: string) {
  if (!match.scheduled_for) return { key: fallback, timestamp: Number.POSITIVE_INFINITY };
  const date = new Date(match.scheduled_for);
  const roundKey = getImportedFixtureRoundKey(date);
  if (!roundKey) return { key: fallback, timestamp: Number.POSITIVE_INFINITY };
  return { key: roundKey.key, timestamp: date.getTime() };
}

export function buildManualRoundNormalizationPlan(rounds: ManualRoundInput[]): ManualRoundNormalizationPlan {
  const nonEmptyRounds = rounds
    .filter((round) => round.matches.length > 0)
    .sort((a, b) => a.round_number - b.round_number || a.id.localeCompare(b.id));
  const groups = new Map<string, { matchIds: string[]; earliestTimestamp: number }>();

  for (const round of nonEmptyRounds) {
    for (const match of round.matches) {
      const group = getMatchGroup(match, `round:${round.id}:match:${match.id}`);
      const existing = groups.get(group.key);
      if (existing) {
        existing.matchIds.push(match.id);
        existing.earliestTimestamp = Math.min(existing.earliestTimestamp, group.timestamp);
      } else {
        groups.set(group.key, { matchIds: [match.id], earliestTimestamp: group.timestamp });
      }
    }
  }

  const orderedGroups = [...groups.entries()].sort(
    ([keyA, groupA], [keyB, groupB]) => groupA.earliestTimestamp - groupB.earliestTimestamp || keyA.localeCompare(keyB),
  );
  const targetRoundIds = nonEmptyRounds.map((round) => round.id);
  const assignments = orderedGroups.flatMap(([dateKey, group], index) =>
    group.matchIds.map((matchId) => ({
      matchId,
      roundId: targetRoundIds[index] || null,
      dateKey,
    })),
  );

  return {
    assignments,
    existingRoundNumbers: rounds.map((round) => ({ roundId: round.id, roundNumber: round.round_number })),
    finalRounds: orderedGroups.map(([dateKey], index) => ({
      roundId: targetRoundIds[index] || null,
      dateKey,
      roundNumber: index + 1,
    })),
    emptyRoundIds: rounds.filter((round) => round.matches.length === 0).map((round) => round.id),
  };
}
