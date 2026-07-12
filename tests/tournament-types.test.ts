import assert from 'node:assert/strict';
import test from 'node:test';

import { isSandboxTournament, normalizeTournamentRegistrationType } from '../src/utils/tournament-types';

test('registration type normalizer supports current and legacy values', () => {
  assert.equal(normalizeTournamentRegistrationType('validated'), 'validated');
  assert.equal(normalizeTournamentRegistrationType('Hattrick Validated (CHPP)'), 'validated');
  assert.equal(normalizeTournamentRegistrationType('manual'), 'manual');
  assert.equal(normalizeTournamentRegistrationType('Organizer-Managed'), 'manual');
  assert.equal(normalizeTournamentRegistrationType('sandbox'), 'sandbox');
  assert.equal(normalizeTournamentRegistrationType('Sandbox Playground'), 'sandbox');
});

test('sandbox tournaments can be detected from type or test flag', () => {
  assert.equal(isSandboxTournament('sandbox', false), true);
  assert.equal(isSandboxTournament('manual', true), true);
  assert.equal(isSandboxTournament('validated', false), false);
});
