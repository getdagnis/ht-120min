import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findExactPendingIncomingChallenge,
  findExactPendingOutgoingChallenge,
  isForgeFixtureAlreadyBooked,
  resolveForgeFixtureActionTarget,
  resolveForgeTeamActions,
  selectCurrentForgeRound,
  type ForgeFixtureRecord,
} from '../src/server/api/_lib/forge-matches.js';
import forgeMatchesHandler from '../src/server/api/forge/matches.js';

const home = {
  id: 'home-row',
  name: 'Star Queens',
  managerName: 'stevanovic',
  managerHtId: 101,
  htTeamId: 111,
  active: true,
  isPlaceholder: false,
};
const away = {
  id: 'away-row',
  name: 'Angels Revange',
  managerName: 'LEMMIE',
  managerHtId: 202,
  htTeamId: 222,
  active: true,
  isPlaceholder: false,
};
const fixture: ForgeFixtureRecord = {
  id: 'match-1',
  roundId: 'round-1',
  status: 'not_arranged',
  completed: false,
  home,
  away,
};
const ready = { state: 'ready' as const, reason: 'CHPP challenge state loaded.', outgoing: [], incoming: [] };

test('fixture action resolution keeps both managers, teams, and home/away orientation', () => {
  const homeAction = resolveForgeFixtureActionTarget(fixture, 'home');
  const awayAction = resolveForgeFixtureActionTarget(fixture, 'away');

  assert.equal(homeAction?.team.managerHtId, 101);
  assert.equal(homeAction?.team.htTeamId, 111);
  assert.equal(homeAction?.opponent.managerHtId, 202);
  assert.equal(homeAction?.opponent.htTeamId, 222);
  assert.equal(homeAction?.matchPlace, 0);
  assert.equal(awayAction?.team.managerHtId, 202);
  assert.equal(awayAction?.team.htTeamId, 222);
  assert.equal(awayAction?.opponent.managerHtId, 101);
  assert.equal(awayAction?.opponent.htTeamId, 111);
  assert.equal(awayAction?.matchPlace, 1);
});

test('duplicate outgoing challenge is found for the exact opponent and disables another send', () => {
  const outgoing = [{ opponentTeamId: 222, trainingMatchId: 7001, friendlyType: 1, isAgreed: false }];
  const exact = findExactPendingOutgoingChallenge(outgoing, 222);
  assert.equal(exact?.trainingMatchId, 7001);
  assert.equal(findExactPendingOutgoingChallenge(outgoing, 999), null);

  const actions = resolveForgeTeamActions({
    fixture,
    side: 'home',
    inspection: { ...ready, outgoing },
    outgoing: exact,
    incoming: null,
    opponentOutgoing: null,
  });
  assert.equal(actions.chppState, 'OUTGOING CHALLENGE');
  assert.equal(actions.canChallenge, false);
});

test('incoming exact-opponent challenge enables accept and a wrong opponent does not', () => {
  const incoming = [{ opponentTeamId: 111, trainingMatchId: 7002, friendlyType: 1, isAgreed: false }];
  assert.equal(findExactPendingIncomingChallenge(incoming, 111)?.trainingMatchId, 7002);
  assert.equal(findExactPendingIncomingChallenge(incoming, 999), null);

  const actions = resolveForgeTeamActions({
    fixture,
    side: 'away',
    inspection: { ...ready, incoming },
    outgoing: null,
    incoming: incoming[0],
    opponentOutgoing: null,
  });
  assert.equal(actions.chppState, 'INCOMING CHALLENGE');
  assert.equal(actions.canAccept, true);
});

test('arranged fixture disables challenge actions', () => {
  const arranged = { ...fixture, status: 'arranged' };
  assert.equal(isForgeFixtureAlreadyBooked(arranged), true);
  const actions = resolveForgeTeamActions({
    fixture: arranged,
    side: 'home',
    inspection: ready,
    outgoing: null,
    incoming: null,
    opponentOutgoing: null,
  });
  assert.equal(actions.chppState, 'ARRANGED');
  assert.equal(actions.canChallenge, false);
  assert.equal(actions.canAccept, false);
});

test('missing credentials produce a safe disabled state without crashing', () => {
  const actions = resolveForgeTeamActions({
    fixture,
    side: 'home',
    inspection: { state: 'credentials_missing', reason: 'No stored CHPP credentials.', outgoing: [], incoming: [] },
    outgoing: null,
    incoming: null,
    opponentOutgoing: null,
  });
  assert.equal(actions.chppState, 'CHPP CREDENTIALS MISSING');
  assert.equal(actions.canChallenge, false);
  assert.equal(actions.canAccept, false);
});

test('client-side action target cannot spoof a different opponent or team', () => {
  const target = resolveForgeFixtureActionTarget(fixture, 'home');
  assert.equal(target?.team.id, 'home-row');
  assert.equal(target?.opponent.id, 'away-row');
  assert.equal(resolveForgeFixtureActionTarget(fixture, 'sideways' as 'home' | 'away'), null);
});

test('current Forge round is the earliest materialized round with unfinished fixtures', () => {
  const current = selectCurrentForgeRound([
    { round_number: 1, phase_status: 'materialized', matches: [{ completed: true }] },
    { round_number: 3, phase_status: 'materialized', matches: [{ completed: false }] },
    { round_number: 5, phase_status: 'materialized', matches: [{ completed: false }] },
  ]);
  assert.equal(current?.round_number, 3);
});

test('non-Forge request is rejected before loading tournament data', async () => {
  const previousForgeEnabled = process.env.FORGE_ENABLED;
  process.env.FORGE_ENABLED = 'true';
  let statusCode = 200;
  let payload: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(value: unknown) {
      payload = value;
      return response;
    },
  };
  try {
    await forgeMatchesHandler({ method: 'GET', headers: {}, query: {} } as never, response as never);
  } finally {
    if (previousForgeEnabled === undefined) delete process.env.FORGE_ENABLED;
    else process.env.FORGE_ENABLED = previousForgeEnabled;
  }
  assert.equal(statusCode, 401);
  assert.deepEqual(payload, { error: 'Forge authorization required.' });
});
