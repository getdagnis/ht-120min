import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTeamReserveTransition } from '../src/server/api/_lib/team-reserve-transition.js';

const participant = { active: true, reserve_active: false, is_placeholder: false };
const reserve = { active: false, reserve_active: true, is_placeholder: false };

test('moves an active participant to reserves before schedule generation', () => {
  assert.deepEqual(
    validateTeamReserveTransition({
      action: 'to_reserve',
      team: participant,
      hasGeneratedRounds: false,
      activeParticipantCount: 8,
      maxTeams: 8,
    }),
    { ok: true, values: { active: false, reserve_active: true } },
  );
});

test('promotes a reserve when capacity is available', () => {
  assert.deepEqual(
    validateTeamReserveTransition({
      action: 'to_participant',
      team: reserve,
      hasGeneratedRounds: false,
      activeParticipantCount: 7,
      maxTeams: 8,
    }),
    { ok: true, values: { active: true, reserve_active: false } },
  );
});

test('rejects reserve transitions after schedule generation', () => {
  const result = validateTeamReserveTransition({
    action: 'to_participant',
    team: reserve,
    hasGeneratedRounds: true,
    activeParticipantCount: 0,
    maxTeams: null,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /schedule has been generated/);
});

test('rejects promotion when the participant limit is full', () => {
  const result = validateTeamReserveTransition({
    action: 'to_participant',
    team: reserve,
    hasGeneratedRounds: false,
    activeParticipantCount: 8,
    maxTeams: 8,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /maximum number of teams/);
});

test('rejects non-reserve inactive rows as promotion targets', () => {
  const result = validateTeamReserveTransition({
    action: 'to_participant',
    team: { active: false, reserve_active: false, is_placeholder: false },
    hasGeneratedRounds: false,
    activeParticipantCount: 1,
    maxTeams: null,
  });
  assert.equal(result.ok, false);
});
