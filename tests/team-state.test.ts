import test from 'node:test';
import assert from 'node:assert/strict';
import { isCurrentParticipantTeam } from '../src/utils/team-state.js';

test('current participant predicate excludes reserves, inactive rows, and placeholders', () => {
  assert.equal(isCurrentParticipantTeam({ active: true, reserve_active: false, is_placeholder: false }), true);
  assert.equal(isCurrentParticipantTeam({ active: true, reserve_active: true, is_placeholder: false }), false);
  assert.equal(isCurrentParticipantTeam({ active: false, reserve_active: false, is_placeholder: false }), false);
  assert.equal(isCurrentParticipantTeam({ active: true, reserve_active: false, is_placeholder: true }), false);
});
