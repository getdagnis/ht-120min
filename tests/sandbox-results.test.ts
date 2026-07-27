import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAppgOutcome } from '../src/utils/appg';
import { createSandboxResultUpdates } from '../src/utils/sandbox-results';

const fixtures = [
  { id: 'fixture', home_team_id: 'home', away_team_id: 'away' },
  { id: 'bye', home_team_id: 'home', away_team_id: null },
];

test('sandbox APPG random fill creates immediately valid classified results and skips BYEs', () => {
  for (const randomValue of [0, 0.2, 0.4, 0.6, 0.8]) {
    const updates = createSandboxResultUpdates(fixtures, 'appg', () => randomValue);
    assert.deepEqual(Object.keys(updates), ['fixture']);
    const update = updates.fixture;
    assert.ok(update.appg_outcome);
    assert.equal(
      validateAppgOutcome({
        home_goals: update.home_goals ?? null,
        away_goals: update.away_goals ?? null,
        went_120: update.went_120,
        total_minutes: update.total_minutes,
        penalty_shootout_home_goals: update.penalty_shootout_home_goals,
        penalty_shootout_away_goals: update.penalty_shootout_away_goals,
        appg_outcome: update.appg_outcome,
      }),
      null,
    );
  }
});

test('sandbox standard random fill creates ordinary completed results', () => {
  const updates = createSandboxResultUpdates(fixtures, 'points', () => 0.5);
  assert.deepEqual(Object.keys(updates), ['fixture']);
  assert.equal(updates.fixture.completed, true);
  assert.equal(updates.fixture.went_120, false);
  assert.equal(updates.fixture.total_minutes, 90);
  assert.equal(updates.fixture.appg_outcome, undefined);
});
