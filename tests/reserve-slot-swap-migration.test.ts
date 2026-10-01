import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migration = readFileSync(
  fileURLToPath(new URL('../migrations/20261001134036_atomic_reserve_slot_swap.sql', import.meta.url)),
  'utf8',
);

test('reserve slot swap migration protects linked and arranged fixtures before mutation', () => {
  assert.match(migration, /m\.ht_match_id IS NOT NULL/);
  assert.match(migration, /COALESCE\(m\.status, 'not_arranged'\) NOT IN \('not_arranged', 'misarranged'\)/);
  assert.match(migration, /m\.completed IS DISTINCT FROM true/);
  assert.match(migration, /m\.scheduled_for IS NULL/);
  assert.match(migration, /m\.scheduled_for <= now\(\)/);
  assert.match(migration, /m\.scheduled_for > now\(\)/);
  assert.match(migration, /RAISE EXCEPTION 'The reserve swap is blocked by a protected fixture'/);
  assert.match(migration, /RAISE EXCEPTION 'The reserve fill is blocked by a protected fixture'/);
});

test('reserve slot swap normalizes lifecycle flags and retires warnings without temporary reserve links', () => {
  assert.match(migration, /active = false,\s+reserve_active = true,\s+reserve_joined_at = now\(\)/);
  assert.match(migration, /active = true,\s+reserve_active = false,\s+reserve_joined_at = NULL/);
  assert.match(migration, /UPDATE public\.fixture_warnings fw[\s\S]*SET active = false/);
  assert.doesNotMatch(migration, /\breserve_team_id\b|\breserve_replaces_team_id\b/);
});
