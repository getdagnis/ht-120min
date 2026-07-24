import assert from 'node:assert/strict';
import test from 'node:test';

import { canViewerJoinTournament } from '../src/utils/tournament-joinability';

test('open tournament is not joinable when max team limit is full', () => {
  assert.equal(
    canViewerJoinTournament({
      hasJoined: false,
      isGenerated: false,
      maxTeams: 4,
      teams: [
        { active: true },
        { active: true },
        { active: true },
        { active: true },
      ],
    }),
    false,
  );
});

test('open tournament is joinable below max team limit', () => {
  assert.equal(
    canViewerJoinTournament({
      hasJoined: false,
      isGenerated: false,
      maxTeams: 4,
      teams: [{ active: true }, { active: true }, { active: true }],
    }),
    true,
  );
});

test('generated tournament is joinable only with replacement or odd-team spot', () => {
  assert.equal(
    canViewerJoinTournament({
      hasJoined: false,
      isGenerated: true,
      maxTeams: 4,
      teams: [{ active: true }, { active: true }, { active: true }, { active: true }],
    }),
    false,
  );
  assert.equal(
    canViewerJoinTournament({
      hasJoined: false,
      isGenerated: true,
      maxTeams: 4,
      teams: [{ active: true }, { active: true }, { active: true }],
    }),
    true,
  );
  assert.equal(
    canViewerJoinTournament({
      hasJoined: false,
      isGenerated: true,
      maxTeams: 4,
      teams: [{ active: true }, { active: true }, { active: false }],
    }),
    true,
  );
});

test('registration-closed tournaments are not joinable despite an odd-team spot', () => {
  assert.equal(
    canViewerJoinTournament({
      hasJoined: false,
      isGenerated: true,
      maxTeams: 4,
      status: 'active',
      registrationClosedAt: '2026-07-24T12:00:00.000Z',
      teams: [{ active: true }, { active: true }, { active: true }],
    }),
    false,
  );
});

test('current participant never sees join prompt', () => {
  assert.equal(
    canViewerJoinTournament({
      hasJoined: true,
      isGenerated: false,
      maxTeams: 8,
      teams: [{ active: true }],
    }),
    false,
  );
});

test('paused tournament remains joinable under normal rules', () => {
  assert.equal(
    canViewerJoinTournament({
      hasJoined: false,
      isGenerated: false,
      maxTeams: 4,
      status: 'paused',
      teams: [{ active: true }, { active: true }],
    }),
    true,
  );
});

test('stopped and finished tournaments are not joinable', () => {
  for (const status of ['stopped', 'finished', 'archived']) {
    assert.equal(
      canViewerJoinTournament({
        hasJoined: false,
        isGenerated: false,
        maxTeams: 4,
        status,
        teams: [{ active: true }, { active: true }],
      }),
      false,
    );
  }
});

test('locks an auto-started season until its current-season schedule exists', () => {
  assert.equal(
    canViewerJoinTournament({
      hasJoined: false,
      isGenerated: false,
      maxTeams: null,
      status: 'active',
      teams: [{ active: true }],
    }),
    false,
  );
});
