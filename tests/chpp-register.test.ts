import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getActiveTournamentConflicts, registerOAuthTeam, registerReserveTeam } from '../src/server/api/_lib/chpp-register.js';

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

function createQuery(result: QueryResult) {
  const query = {
    select: () => query,
    update: () => query,
    eq: () => query,
    maybeSingle: async () => result,
  };
  return query;
}

function createReactivationClient() {
  const queries = [createQuery({ data: { id: 'existing-team', active: false }, error: null })];
  const client = {
    from: (table: string) => {
      assert.equal(table, 'teams');
      const query = queries.shift();
      assert.ok(query, 'Unexpected Supabase query');
      return query;
    },
  } as unknown as SupabaseClient;

  return { client };
}

async function withServiceRpcMock<T>(result: unknown, run: (getPayload: () => unknown) => Promise<T>) {
  const originalUrl = process.env.SUPABASE_URL;
  const originalSecret = process.env.SUPABASE_SECRET_KEY;
  const originalServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFetch = globalThis.fetch;
  let payload: unknown;

  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_SECRET_KEY = 'test-secret';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  globalThis.fetch = async (_input, init) => {
    payload = JSON.parse(String(init?.body ?? 'null'));
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    return await run(() => payload);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = originalSecret;
    if (originalServiceRole === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRole;
  }
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
  teamRank: 1278,
  skipMembershipCheck: true,
};

test('rejoining an existing Season 2 team activates the row and clears its suggestion marker', async () => {
  const mock = createReactivationClient();

  await withServiceRpcMock('existing-team', async (getPayload) => {
    const teamId = await registerOAuthTeam(mock.client, registrationInput);
    assert.equal(teamId, 'existing-team');
    assert.deepEqual(getPayload(), {
      p_values: {
        active: true,
        reserve_active: false,
        reserve_joined_at: null,
        actively_waiting: false,
        reapply_season_number: null,
        name: 'Guåhan Goddesses',
        manager_name: 'Dagnis',
        logo_url: null,
        country_id: null,
        country_name: null,
        league_id: 9,
        gender_id: 2,
        league_level: null,
        team_rank: 1278,
        power_rating: null,
        power_global_rank: null,
        power_league_rank: null,
        power_region_rank: null,
        join_story: null,
        oauth_token: 'oauth-token',
        oauth_token_secret: 'oauth-secret',
        hattrick_user_id: 8777402,
        joined_via_oauth: true,
        ht_team_name: 'Guåhan Goddesses',
      },
      p_existing_id: 'existing-team',
      p_skip_membership: true,
    });
  });
});

test('rejoining fails instead of reporting success when the activation update matches no row', async () => {
  const mock = createReactivationClient();
  await withServiceRpcMock(null, async () => {
    await assert.rejects(
      registerOAuthTeam(mock.client, registrationInput),
      /Could not reactivate Guåhan Goddesses/,
    );
  });
});

test('site-admin reserve registration uses the guarded membership-bypass RPC', async () => {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: null, error: null }),
  };
  const client = {
    from(table: string) {
      assert.equal(table, 'teams');
      return query;
    },
  } as unknown as SupabaseClient;

  await withServiceRpcMock('reserve-team', async (getPayload) => {
    const id = await registerReserveTeam(client, {
      ...registrationInput,
      skipMembershipCheck: true,
    });
    assert.equal(id, 'reserve-team');
    const payload = getPayload() as { p_values: Record<string, unknown>; p_existing_id: unknown; p_skip_membership: unknown };
    assert.equal(typeof payload.p_values.reserve_joined_at, 'string');
    assert.deepEqual({ ...payload, p_values: { ...payload.p_values, reserve_joined_at: null } }, {
      p_values: {
        tournament_id: 'tournament-2',
        ht_team_id: 3220518,
        name: 'Guåhan Goddesses',
        ht_team_name: 'Guåhan Goddesses',
        manager_name: 'Dagnis',
        hattrick_user_id: 8777402,
        country_id: null,
        country_name: null,
        league_id: 9,
        gender_id: 2,
        league_level: null,
        team_rank: 1278,
        power_rating: null,
        power_global_rank: null,
        power_league_rank: null,
        power_region_rank: null,
        logo_url: null,
        oauth_token: 'oauth-token',
        oauth_token_secret: 'oauth-secret',
        joined_via_oauth: true,
        active: false,
        reapply_season_number: null,
        reserve_active: true,
        reserve_joined_at: null,
        actively_waiting: false,
      },
      p_existing_id: null,
      p_skip_membership: true,
    });
  });
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
