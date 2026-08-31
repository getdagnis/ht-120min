import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canViewerJoinAnotherTeam,
  canViewerJoinTournament,
  isTournamentRegistrationOpen,
} from '../src/utils/tournament-joinability';

test('participant actions are available only while open registration has no fixtures', () => {
  assert.equal(
    isTournamentRegistrationOpen({ isGenerated: false, status: 'open', registrationClosedAt: null }),
    true,
  );
  assert.equal(
    isTournamentRegistrationOpen({ isGenerated: false, status: 'waiting', registrationClosedAt: null }),
    true,
  );
  assert.equal(
    isTournamentRegistrationOpen({ isGenerated: false, status: 'active', registrationClosedAt: null }),
    false,
  );
  assert.equal(
    isTournamentRegistrationOpen({
      isGenerated: false,
      status: 'waiting',
      registrationClosedAt: '2026-08-30T10:00:00.000Z',
    }),
    false,
  );
  assert.equal(
    isTournamentRegistrationOpen({ isGenerated: true, status: 'waiting', registrationClosedAt: null }),
    false,
  );
});

test('joining with another team requires login, open registration, and a free place', () => {
  const availableTournament = {
    isRegistrationOpen: true,
    maxTeams: 4,
    activeTeamsCount: 3,
  };

  assert.equal(canViewerJoinAnotherTeam({ ...availableTournament, isLoggedIn: false }), false);
  assert.equal(canViewerJoinAnotherTeam({ ...availableTournament, isLoggedIn: true }), true);
  assert.equal(
    canViewerJoinAnotherTeam({
      ...availableTournament,
      isLoggedIn: true,
      isRegistrationOpen: false,
    }),
    false,
  );
  assert.equal(
    canViewerJoinAnotherTeam({
      ...availableTournament,
      isLoggedIn: true,
      activeTeamsCount: 4,
    }),
    false,
  );
});

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
