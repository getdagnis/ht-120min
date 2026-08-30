import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';

import { registerOAuthTeam } from '../src/server/api/_lib/chpp-register.js';

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

function createQuery(result: QueryResult, onUpdate?: (payload: Record<string, unknown>) => void) {
  const query = {
    select: () => query,
    update: (payload: Record<string, unknown>) => {
      onUpdate?.(payload);
      return query;
    },
    eq: () => query,
    maybeSingle: async () => result,
  };
  return query;
}

function createReactivationClient(updatedTeam: unknown) {
  let updatePayload: Record<string, unknown> | null = null;
  const queries = [
    createQuery({ data: { id: 'existing-team', active: false }, error: null }),
    createQuery({ data: updatedTeam, error: null }, (payload) => {
      updatePayload = payload;
    }),
  ];
  const client = {
    from: (table: string) => {
      assert.equal(table, 'teams');
      const query = queries.shift();
      assert.ok(query, 'Unexpected Supabase query');
      return query;
    },
  } as unknown as SupabaseClient;

  return { client, getUpdatePayload: () => updatePayload };
}

const registrationInput = {
  tournamentId: 'tournament-2',
  team: {
    teamId: 3220518,
    teamName: 'Guåhan Goddesses',
    leagueId: 9,
    genderId: 2,
  },
  managerName: 'Dagnis',
  hattrickUserId: 8777402,
  accessToken: 'oauth-token',
  accessTokenSecret: 'oauth-secret',
  skipMembershipCheck: true,
};

test('rejoining an existing Season 2 team activates the row and clears its suggestion marker', async () => {
  const mock = createReactivationClient({
    id: 'existing-team',
    active: true,
    reapply_season_number: null,
  });

  const teamId = await registerOAuthTeam(mock.client, registrationInput);

  assert.equal(teamId, 'existing-team');
  assert.equal(mock.getUpdatePayload()?.active, true);
  assert.equal(mock.getUpdatePayload()?.reapply_season_number, null);
});

test('rejoining fails instead of reporting success when the activation update matches no row', async () => {
  const mock = createReactivationClient(null);

  await assert.rejects(
    registerOAuthTeam(mock.client, registrationInput),
    /Could not reactivate Guåhan Goddesses/,
  );
});
