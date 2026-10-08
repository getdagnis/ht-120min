import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migration = readFileSync(
  fileURLToPath(new URL('../migrations/history/20261001134036_atomic_reserve_slot_swap.sql', import.meta.url)),
  'utf8',
);

interface FixtureState {
  completed: boolean | null;
  ht_match_id: number | null;
  status: 'not_arranged' | 'arranged' | 'ongoing' | 'misarranged' | 'finished' | null;
  scheduled_for: Date | null;
  finished_at: Date | null;
  home_goals: number | null;
  away_goals: number | null;
  match_event_details: object | null;
}

const isProtectedFixture = (fixture: FixtureState, now: Date) =>
  fixture.completed !== true &&
  (fixture.ht_match_id !== null ||
    !['not_arranged', 'misarranged'].includes(fixture.status ?? 'not_arranged') ||
    fixture.finished_at !== null ||
    fixture.home_goals !== null ||
    fixture.away_goals !== null ||
    fixture.match_event_details !== null ||
    fixture.scheduled_for === null ||
    fixture.scheduled_for <= now);

const isMutableFixture = (fixture: FixtureState, now: Date) =>
  fixture.completed !== true &&
  fixture.ht_match_id === null &&
  ['not_arranged', 'misarranged'].includes(fixture.status ?? 'not_arranged') &&
  fixture.finished_at === null &&
  fixture.home_goals === null &&
  fixture.away_goals === null &&
  fixture.match_event_details === null &&
  fixture.scheduled_for !== null &&
  fixture.scheduled_for > now;

test('reserve slot swap migration protects linked and arranged fixtures before mutation', () => {
  assert.match(migration, /m\.ht_match_id IS NOT NULL/);
  assert.match(migration, /COALESCE\(m\.status, 'not_arranged'\) NOT IN \('not_arranged', 'misarranged'\)/);
  assert.match(migration, /AND m\.completed IS NOT TRUE/);
  assert.doesNotMatch(migration, /m\.completed IS DISTINCT FROM true/);
  assert.match(migration, /m\.scheduled_for IS NULL/);
  assert.match(migration, /m\.scheduled_for <= now\(\)/);
  assert.match(migration, /m\.scheduled_for > now\(\)/);
  assert.match(migration, /RAISE EXCEPTION 'The reserve swap is blocked by a protected fixture'/);
  assert.match(migration, /RAISE EXCEPTION 'The reserve fill is blocked by a protected fixture'/);
});

test('future unlinked misarranged fixture is mutable while historical completion is preserved', () => {
  const now = new Date('2026-10-01T10:00:00.000Z');
  const misarrangedFuture: FixtureState = {
    completed: false,
    ht_match_id: null,
    status: 'misarranged',
    scheduled_for: new Date('2026-10-01T12:00:00.000Z'),
    finished_at: null,
    home_goals: null,
    away_goals: null,
    match_event_details: null,
  };
  const historicalCompleted: FixtureState = {
    ...misarrangedFuture,
    completed: true,
    scheduled_for: new Date('2026-09-24T12:00:00.000Z'),
  };

  assert.equal(isProtectedFixture(misarrangedFuture, now), false);
  assert.equal(isMutableFixture(misarrangedFuture, now), true);
  assert.equal(isProtectedFixture(historicalCompleted, now), false);
  assert.equal(isMutableFixture(historicalCompleted, now), false);
  assert.match(migration, /AND m\.completed IS NOT TRUE[\s\S]*AND m\.ht_match_id IS NULL/);
});

test('reserve slot swap normalizes lifecycle flags and retires warnings without temporary reserve links', () => {
  assert.match(migration, /active = false,\s+reserve_active = true,\s+reserve_joined_at = now\(\)/);
  assert.match(migration, /active = true,\s+reserve_active = false,\s+reserve_joined_at = NULL/);
  assert.match(migration, /UPDATE public\.fixture_warnings fw[\s\S]*SET active = false/);
  assert.doesNotMatch(migration, /\breserve_team_id\b|\breserve_replaces_team_id\b/);
});
