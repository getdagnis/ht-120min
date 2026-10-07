import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../migrations/102_delete_owned_test_tournaments.sql', import.meta.url), 'utf8');
const appApi = readFileSync(new URL('../src/server/api/app.ts', import.meta.url), 'utf8');

test('bulk test cleanup is owner-scoped and refuses registered or validated teams', () => {
  assert.match(migration, /WHERE organizer_id = p_organizer_id/);
  assert.match(migration, /COALESCE\(is_test, false\) OR registration_type = 'sandbox'/);
  assert.match(migration, /joined_via_oauth IS TRUE/);
  assert.match(migration, /hattrick_user_id IS NOT NULL/);
  assert.match(migration, /NULLIF\(btrim\(oauth_token\), ''\) IS NOT NULL/);
  assert.match(migration, /NULLIF\(btrim\(oauth_token_secret\), ''\) IS NOT NULL/);
  assert.match(migration, /oauth_scope IS NOT NULL/);
  assert.match(migration, /Test cleanup aborted: at least one tournament contains a user-registered or Hattrick-validated team/);
});

test('bulk test cleanup preflights outside references before its first write and fails closed on unknown FKs', () => {
  const preflightIndex = migration.indexOf('Inspect every foreign key');
  const firstWriteIndex = migration.indexOf('DELETE FROM public.tournament_season_poll_votes');

  assert.ok(preflightIndex >= 0 && firstWriteIndex > preflightIndex);
  assert.match(migration, /m\.home_team_id = ANY\(team_ids\)/);
  assert.match(migration, /m\.away_team_id = ANY\(team_ids\)/);
  assert.match(migration, /m\.reserve_team_id = ANY\(team_ids\)/);
  assert.match(migration, /m\.reserve_replaces_team_id = ANY\(team_ids\)/);
  assert.match(migration, /unknown\/global references fail closed/i);
  assert.match(migration, /has_external_reference := true/);
  assert.match(migration, /USING ERRCODE = '23514'/);
});

test('bulk cleanup API uses the signed-in manager id and returns safety aborts as conflicts', () => {
  assert.match(appApi, /p_organizer_id: session\.userId/);
  assert.match(appApi, /error\?\.code === '23514'.*status\(409\)/s);
});
