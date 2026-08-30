import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  fetchManagerTeamsFromChpp,
  MANAGER_COMPENDIUM_VERSION,
  ManagerCompendiumRequestError,
} from '../src/server/api/_lib/manager-compendium.js';
import { filterTeamsForCategory } from '../src/server/api/_lib/team-eligibility.js';

const managerFixture = readFileSync(new URL('../docs/managercompendium.example.xml', import.meta.url), 'utf8');
const credentials = {
  oauth_token: 'access-token',
  oauth_token_secret: 'access-token-secret',
};

test('requests managercompendium v1.7 and returns the eligible HFI team from a mixed account', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let authorizationHeader = '';

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestedUrl = input instanceof Request ? input.url : String(input);
    authorizationHeader = new Headers(init?.headers).get('Authorization') ?? '';
    return new Response(managerFixture, { status: 200 });
  }) as typeof fetch;

  try {
    const snapshot = await fetchManagerTeamsFromChpp('consumer-key', 'consumer-secret', credentials);
    const url = new URL(requestedUrl);

    assert.equal(url.searchParams.get('file'), 'managercompendium');
    assert.equal(url.searchParams.get('version'), MANAGER_COMPENDIUM_VERSION);
    assert.match(authorizationHeader, /^OAuth /);
    assert.deepEqual(
      snapshot.teams.map((team) => [team.teamId, team.teamName]),
      [
        [681813, 'This bot team is a bot'],
        [3220518, 'Guåhan Goddesses'],
      ],
    );

    const eligibleHfiTeams = filterTeamsForCategory(snapshot.teams, 'hfi', { countryLimit: '179' });
    assert.deepEqual(eligibleHfiTeams.map((team) => team.teamId), [3220518]);

    const eligibleMaleTeams = filterTeamsForCategory(snapshot.teams, 'male', { countryLimit: '48' });
    assert.deepEqual(eligibleMaleTeams.map((team) => team.teamId), [681813]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('preserves CHPP status and response details when managercompendium fails', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('CHPP unavailable', { status: 503 })) as typeof fetch;

  try {
    await assert.rejects(
      fetchManagerTeamsFromChpp('consumer-key', 'consumer-secret', credentials),
      (error: unknown) =>
        error instanceof ManagerCompendiumRequestError &&
        error.status === 503 &&
        error.responseBody === 'CHPP unavailable',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
