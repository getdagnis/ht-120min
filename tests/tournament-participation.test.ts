import assert from 'node:assert/strict';
import test from 'node:test';

import { validateTournamentLeave } from '../src/server/api/_lib/tournament-participation.js';

const validRequest = {
  viewerUserId: 8777402,
  tournamentSeason: 2,
  registrationOpen: true,
  team: {
    active: false,
    hattrickUserId: 8777402,
    reapplySeasonNumber: 2,
  },
};

test('an inactive team owner can leave the pending current season', () => {
  assert.equal(validateTournamentLeave(validRequest), null);
});

test('another manager cannot remove a team from Season 2 suggestions', () => {
  assert.deepEqual(
    validateTournamentLeave({
      ...validRequest,
      viewerUserId: 1000,
    }),
    { status: 403, error: 'Only this team owner can leave the tournament.' },
  );
});

test('a stale inactive team or any team outside open registration cannot leave', () => {
  assert.equal(
    validateTournamentLeave({
      ...validRequest,
      team: { ...validRequest.team, reapplySeasonNumber: 1 },
    })?.status,
    409,
  );
  assert.equal(
    validateTournamentLeave({
      ...validRequest,
      registrationOpen: false,
    })?.status,
    409,
  );
});

test('an active owner can leave during open registration', () => {
  assert.equal(
    validateTournamentLeave({
      ...validRequest,
      team: { ...validRequest.team, active: true, reapplySeasonNumber: null },
    }),
    null,
  );
});
