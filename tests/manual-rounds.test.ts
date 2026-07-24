import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManualRoundNormalizationPlan } from '../src/utils/manual-rounds';
import { buildClearSeasonResultsPayload } from '../src/utils/season-results';

test('persisted scheduled_for dates become chronological rounds and share same-date rounds', () => {
  const plan = buildManualRoundNormalizationPlan([
    {
      id: 'newer',
      round_number: 1,
      matches: [
        { id: 'm2', scheduled_for: '2026-02-02T12:00:00Z' },
        { id: 'm3', scheduled_for: '2026-02-02T18:00:00Z' },
      ],
    },
    { id: 'empty', round_number: 2, matches: [] },
    { id: 'older', round_number: 3, matches: [{ id: 'm1', scheduled_for: '2026-01-01T12:00:00Z' }] },
  ]);

  assert.deepEqual(plan.finalRounds, [
    { roundId: 'newer', dateKey: '2026-01-01', roundNumber: 1 },
    { roundId: 'older', dateKey: '2026-02-02', roundNumber: 2 },
  ]);
  assert.deepEqual(plan.assignments, [
    { matchId: 'm1', roundId: 'newer', dateKey: '2026-01-01' },
    { matchId: 'm2', roundId: 'older', dateKey: '2026-02-02' },
    { matchId: 'm3', roundId: 'older', dateKey: '2026-02-02' },
  ]);
  assert.deepEqual(plan.emptyRoundIds, ['empty']);
});

test('older matches added to a newer set create a new chronological round target', () => {
  const plan = buildManualRoundNormalizationPlan([
    {
      id: 'newer',
      round_number: 1,
      matches: [
        { id: 'new', scheduled_for: '2026-03-01T12:00:00Z' },
        { id: 'old', scheduled_for: '2026-01-01T12:00:00Z' },
      ],
    },
  ]);
  assert.deepEqual(plan.finalRounds, [
    { roundId: 'newer', dateKey: '2026-01-01', roundNumber: 1 },
    { roundId: null, dateKey: '2026-03-01', roundNumber: 2 },
  ]);
  assert.deepEqual(plan.assignments[0], { matchId: 'old', roundId: 'newer', dateKey: '2026-01-01' });
});

test('clear results uses valid unclassified APPG values without changing fixtures', () => {
  const payload = buildClearSeasonResultsPayload();

  assert.equal(payload.appg_outcome, 'needs_review');
  assert.equal(payload.appg_outcome_source, 'unclassified');
  assert.equal(payload.completed, false);
  assert.equal(payload.home_goals, null);
  assert.equal(payload.away_goals, null);
});

test('normalization preserves 58 matches, groups dates, and is idempotent', () => {
  const firstDate = Date.UTC(2026, 3, 28);
  const lastDate = Date.UTC(2026, 6, 19);
  const matches = Array.from({ length: 58 }, (_, index) => ({
    id: `match-${index + 1}`,
    scheduled_for: new Date(
      firstDate + Math.round((lastDate - firstDate) * Math.floor((index * 27) / 58) / 26),
    ).toISOString(),
  }));
  const initialRounds = Array.from({ length: 30 }, (_, index) => ({
    id: `round-${index + 1}`,
    round_number: index + 1,
    matches: index === 0 ? matches : [],
  }));

  const firstPlan = buildManualRoundNormalizationPlan(initialRounds);
  assert.equal(firstPlan.assignments.length, 58);
  assert.equal(new Set(firstPlan.assignments.map((assignment) => assignment.matchId)).size, 58);
  assert.equal(firstPlan.finalRounds.length, 27);
  assert.equal(firstPlan.finalRounds[0]?.dateKey, '2026-04-28');
  assert.equal(firstPlan.finalRounds.at(-1)?.dateKey, '2026-07-19');
  assert.ok(firstPlan.assignments.filter((assignment) => assignment.dateKey === '2026-04-28').length > 1);

  const appliedRoundIdByDate = new Map(
    firstPlan.finalRounds.map((round) => [round.dateKey, round.roundId || `new-${round.roundNumber}`]),
  );
  const normalizedRounds = firstPlan.finalRounds.map((round) => ({
    id: appliedRoundIdByDate.get(round.dateKey) as string,
    round_number: round.roundNumber,
    matches: firstPlan.assignments
      .filter((assignment) => assignment.dateKey === round.dateKey)
      .map((assignment) => ({ id: assignment.matchId, scheduled_for: matches.find((match) => match.id === assignment.matchId)?.scheduled_for })),
  }));
  const secondPlan = buildManualRoundNormalizationPlan(normalizedRounds);
  const appliedAssignments = firstPlan.assignments.map((assignment) => ({
    ...assignment,
    roundId: appliedRoundIdByDate.get(assignment.dateKey) as string,
  }));
  const appliedFinalRounds = firstPlan.finalRounds.map((round) => ({
    ...round,
    roundId: appliedRoundIdByDate.get(round.dateKey) as string,
  }));

  assert.deepEqual(secondPlan.finalRounds, appliedFinalRounds);
  assert.deepEqual(secondPlan.assignments, appliedAssignments);
});
