import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getActiveTournamentConflicts, registerOAuthTeam } from '../src/server/api/_lib/chpp-register.js';

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

test('picker conflict lookup exposes only another real active tournament with its public slug', async () => {
  const rows = [
    {
      ht_team_id: 3220518,
      tournament_id: 'gibraltar',
      tournaments: {
        name: 'Exotic HFI — Gibraltar 🇬🇮',
        slug: 'exotic-hfi-gibraltar',
        status: 'open',
        is_test: false,
        registration_type: 'chpp',
      },
    },
    {
      ht_team_id: 681813,
      tournament_id: 'finished',
      tournaments: {
        name: 'Old cup',
        slug: 'old-cup',
        status: 'finished',
        is_test: false,
        registration_type: 'chpp',
      },
    },
    {
      ht_team_id: 123456,
      tournament_id: 'sandbox',
      tournaments: {
        name: 'Sandbox cup',
        slug: 'sandbox-cup',
        status: 'open',
        is_test: true,
        registration_type: 'sandbox',
      },
    },
  ];
  const query = {
    select: () => query,
    in: () => query,
    eq: () => query,
    neq: async () => ({ data: rows, error: null }),
  };
  const client = { from: () => query } as unknown as SupabaseClient;

  const conflicts = await getActiveTournamentConflicts(client, [3220518, 681813, 123456], 'target');

  assert.deepEqual(conflicts.get(3220518), {
    tournamentId: 'gibraltar',
    name: 'Exotic HFI — Gibraltar 🇬🇮',
    slug: 'exotic-hfi-gibraltar',
  });
  assert.equal(conflicts.has(681813), false);
  assert.equal(conflicts.has(123456), false);
});
