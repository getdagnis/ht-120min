import assert from 'node:assert/strict';
import test from 'node:test';

import { findUnslottedPairingTeamIds } from '../src/server/api/_lib/length-schedule-service.js';

test('round preparation identifies paired participants without a current-season slot', () => {
  assert.deepEqual(findUnslottedPairingTeamIds([
    { home_team_id: 'slotted-1', away_team_id: 'unslotted' },
    { home_team_id: 'slotted-2', away_team_id: null },
  ], ['slotted-1', 'slotted-2']), ['unslotted']);
});

test('round preparation allows checked Waiting admissions to receive slots atomically', () => {
  assert.deepEqual(findUnslottedPairingTeamIds([
    { home_team_id: 'current', away_team_id: 'waiting' },
  ], ['current'], ['waiting']), []);
});
