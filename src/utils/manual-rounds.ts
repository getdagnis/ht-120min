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

function getMatchDateKey(match: ManualRoundMatchInput, fallback: string) {
  const value = match.scheduled_for;
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : fallback;
}

export function buildManualRoundNormalizationPlan(rounds: ManualRoundInput[]): ManualRoundNormalizationPlan {
  const nonEmptyRounds = rounds
    .filter((round) => round.matches.length > 0)
    .sort((a, b) => a.round_number - b.round_number || a.id.localeCompare(b.id));
  const groups = new Map<string, string[]>();

  for (const round of nonEmptyRounds) {
    for (const match of round.matches) {
      const dateKey = getMatchDateKey(match, `round:${round.id}:match:${match.id}`);
      const matchIds = groups.get(dateKey) || [];
      matchIds.push(match.id);
      groups.set(dateKey, matchIds);
    }
  }

  const dateKeys = [...groups.keys()].sort();
  const targetRoundIds = nonEmptyRounds.map((round) => round.id);
  const assignments = dateKeys.flatMap((dateKey, index) =>
    (groups.get(dateKey) || []).map((matchId) => ({
      matchId,
      roundId: targetRoundIds[index] || null,
      dateKey,
    })),
  );

  return {
    assignments,
    existingRoundNumbers: rounds.map((round) => ({ roundId: round.id, roundNumber: round.round_number })),
    finalRounds: dateKeys.map((dateKey, index) => ({
      roundId: targetRoundIds[index] || null,
      dateKey,
      roundNumber: index + 1,
    })),
    emptyRoundIds: rounds.filter((round) => round.matches.length === 0).map((round) => round.id),
  };
}
