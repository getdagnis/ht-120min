import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSandboxCopyIdentity, selectEffectiveRoster } from '../src/server/api/_lib/sandbox-duplicate.js';

const teams = [
  { id: 'old', name: 'Old team', ht_team_id: 1, active: false, is_placeholder: false, reserve_active: false, manager_name: 'Old' },
  { id: 'current-a', name: 'Current A', ht_team_id: 2, active: true, is_placeholder: false, reserve_active: false, manager_name: 'A' },
  { id: 'current-b', name: 'Current B', ht_team_id: 3, active: true, is_placeholder: false, reserve_active: false, manager_name: 'B' },
  { id: 'reserve', name: 'Reserve', ht_team_id: 4, active: false, is_placeholder: false, reserve_active: true, manager_name: 'R' },
  { id: 'placeholder', name: 'Open', ht_team_id: null, active: true, is_placeholder: true, reserve_active: false, manager_name: null },
];

test('effective sandbox roster uses current season-slot occupants when slots exist', () => {
  const roster = selectEffectiveRoster(teams, [
    { current_team_id: 'current-b' },
    { current_team_id: 'old' },
    { current_team_id: null },
  ]);

  assert.deepEqual(roster.map((team) => team.id), ['old', 'current-b']);
});

test('effective sandbox roster falls back to active non-placeholder non-reserve rows before scheduling', () => {
  const roster = selectEffectiveRoster(teams, []);

  assert.deepEqual(roster.map((team) => team.id), ['current-a', 'current-b']);
});

test('sandbox copy identity follows the existing test name and slug convention', () => {
  const identity = buildSandboxCopyIdentity('Exotic HFI — San Marino 🇸🇲', new Date('2026-09-29T12:34:56Z'));

  assert.equal(identity.name, 'Exotic HFI — San Marino sandbox 2026-09-29 12:34:56 (test)');
  assert.equal(identity.slug, 'exotic-hfi-san-marino-sandbox-2026-09-29-123456-test');
  assert.ok(identity.adminPassword.length >= 8);
});
