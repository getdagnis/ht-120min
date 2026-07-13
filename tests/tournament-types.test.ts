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

test('only the sandbox registration type enables sandbox behavior', () => {
  assert.equal(isSandboxTournament('sandbox'), true);
  assert.equal(isSandboxTournament('manual'), false);
  assert.equal(isSandboxTournament('validated'), false);
});
