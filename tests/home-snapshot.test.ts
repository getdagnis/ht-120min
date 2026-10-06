import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { buildHomeSnapshot, getHomeWeeklyCutoff, getHomeWeeklyExpiry } from '../src/server/api/_lib/home-snapshot-builder.js';
import { normalizeHomeSnapshot, parseHomeSnapshot } from '../src/server/api/_lib/home-snapshot-contract.js';
import { runHomeSnapshotWorker } from '../src/server/api/_lib/home-snapshot-worker.js';
import { isHomeWorkerAuthorized } from '../src/server/api/home-snapshot.js';
import { selectCollectionHomepageMembers } from '../src/utils/tournament-collections.js';

const now = Date.parse('2026-10-03T12:00:00Z');
test('Weekly calendar cutoff and exact expiry handle unequal month lengths without overflow', () => {
  assert.equal(getHomeWeeklyCutoff(Date.parse('2026-04-30T12:00:00Z')).toISOString(), '2026-02-28T12:00:00.000Z');
  assert.equal(new Date(getHomeWeeklyExpiry('2025-12-31T12:00:00Z')).toISOString(), '2026-03-01T00:00:00.000Z');
  assert.equal(new Date(getHomeWeeklyExpiry('2026-01-30T12:00:00Z')).toISOString(), '2026-03-30T12:00:00.001Z');
});
const token = '12345678-1234-4321-8123-123456789012';
const tournament = {
  id: 'cup', name: 'Cup', slug: 'cup', created_at: '2026-09-01T12:00:00Z', season: 1,
  is_private: false, is_test: false, is_featured: false, is_archived: false, status: 'active',
  country_limit: null, scoring_mode: null, league_category: null, max_teams: 8,
  rounds: [], teams: [{ id: 'team', name: 'Team', ht_team_id: 1, joined_via_oauth: true, active: true,
    created_at: '2026-10-02T12:00:00Z', manager_name: 'Manager', oauth_token: 'secret', admin_password: 'secret' }],
  admin_password: 'secret', oauth_token: 'secret',
};

function client(reply: (url: URL, body: Record<string, unknown> | null) => unknown | { failure: true }) {
  const requests: URL[] = [];
  const supabase = createClient('https://home-test.invalid', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      requests.push(url);
      const data = reply(url, request.method === 'POST' ? await request.json() : null);
      const failed = data && typeof data === 'object' && 'failure' in data;
      return new Response(JSON.stringify(failed ? { message: 'private diagnostic' } : data), {
        status: failed ? 500 : 200, headers: { 'Content-Type': 'application/json' },
      });
    } },
  });
  return { supabase, requests };
}

function sources(url: URL) {
  if (url.pathname.endsWith('/tournaments')) return [tournament];
  if (url.pathname.endsWith('/tournament_collections')) return [];
  if (url.pathname.endsWith('/tournament_collection_memberships')) return [];
  if (url.pathname.endsWith('/fixture_warnings')) return [];
  if (url.pathname.endsWith('/news_posts')) return [];
  throw new Error(`Unexpected request ${url.pathname}`);
}

test('Home builder preserves cards, participant counts and schedules explicit activity expiry', async () => {
  const { supabase, requests } = client(sources);
  const data = parseHomeSnapshot(await buildHomeSnapshot(supabase, now));
  assert.equal(data.openTournaments[0].name, 'Cup');
  assert.equal(data.openTournaments[0].validatedTeamCount, 1);
  assert.equal(data.openTournaments[0].teamCount, 1);
  assert.equal(data.activity[0].type, 'join');
  assert.equal(data.nextRefreshAt, '2026-10-09T12:00:00.001Z');
  assert.deepEqual(data.weeklyPosts, []);
  assert.equal(requests.length, 6);
  assert.ok(requests.every((url) => !url.searchParams.get('select')?.includes('*')));
  assert.ok(!JSON.stringify(data).includes('secret'));
  assert.ok(!JSON.stringify(data).includes('join_story'));
});

test('Home source failure does not build an empty successful publication', async () => {
  for (const table of ['tournaments', 'fixture_warnings', 'news_posts']) {
    const { supabase } = client((url) => url.pathname.endsWith(`/${table}`) ? { failure: true } : sources(url));
    await assert.rejects(buildHomeSnapshot(supabase, now));
  }
});

test('nullable placeholder identities do not prevent valid public directory publication', async () => {
  const { supabase } = client((url) => url.pathname.endsWith('/tournaments')
    ? [{ ...tournament, teams: [...tournament.teams, { id: 'placeholder', name: 'Pending', ht_team_id: null, joined_via_oauth: null, is_placeholder: true }] }]
    : sources(url));
  const data = parseHomeSnapshot(await buildHomeSnapshot(supabase, now));
  assert.equal(data.openTournaments[0].teamCount, 1);
  assert.equal(data.openTournaments[0].validatedTeamCount, 1);
});

test('Home contract rejects malformed payloads and nonpublic directory rows', async () => {
  const { supabase } = client(sources);
  const candidate = await buildHomeSnapshot(supabase, now);
  assert.throws(() => parseHomeSnapshot({ ...candidate, topTeams: 'invalid' }));
  assert.throws(() => parseHomeSnapshot({ ...candidate, nextRefreshAt: 'invalid' }));
  for (const field of ['is_private', 'is_test', 'is_archived']) {
    assert.throws(() => parseHomeSnapshot({ ...candidate, openTournaments: [{ ...candidate.openTournaments[0], [field]: true }] }));
  }
});

test('older cached Home payload restores the exact Exotic section and removes duplicate featured cards', async () => {
  const { supabase } = client(sources);
  const candidate = await buildHomeSnapshot(supabase, now);
  const queens = { ...candidate.openTournaments[0], id: 'queens', slug: 'queens-of-the-pacific-cup' };
  const bhutan = { ...candidate.openTournaments[0], id: 'bhutan', slug: 'exotic-hfi-bhutan' };
  const oldPayload = {
    ...candidate, collections: undefined,
    featuredTournaments: [queens, bhutan],
    openTournaments: [queens, bhutan],
    exoticHfiTournaments: [bhutan, queens],
  } as unknown as typeof candidate;
  for (const restored of [parseHomeSnapshot(oldPayload), normalizeHomeSnapshot(oldPayload)]) {
    assert.deepEqual(restored.collections[0].members.map((member) => member.tournament.slug),
      ['queens-of-the-pacific-cup', 'exotic-hfi-bhutan']);
    assert.equal(restored.collections[0].bannerUrl, '/series/exotic-tiny-hfi-banner.jpg');
    assert.deepEqual(restored.featuredTournaments, []);
    assert.deepEqual(restored.openTournaments, []);
  }
});

test('builder excludes unlisted/stopped/test/archived tournaments, including their activity', async () => {
  const { supabase } = client((url) => url.pathname.endsWith('/tournaments')
    ? [{ ...tournament, is_private: true }, { ...tournament, is_test: true }, { ...tournament, status: 'stopped' }]
    : sources(url));
  const data = parseHomeSnapshot(await buildHomeSnapshot(supabase, now));
  assert.deepEqual(data.openTournaments, []);
  assert.deepEqual(data.activity, []);
});

test('published collections are many-to-many, exclude nonpublic cards and do not duplicate catalogue cards', async () => {
  const collections = [
    { id: 'one', slug: 'exotic-hfi', title: 'Exotic Small HFI Series', description: '', banner_url: null, display_order: 1 },
    { id: 'two', slug: 'german-world', title: 'German World', description: '', banner_url: null, display_order: 2 },
  ];
  const memberships = [
    { collection_id: 'one', tournament_id: 'cup', is_featured: true, display_order: 2 },
    { collection_id: 'two', tournament_id: 'cup', is_featured: false, display_order: 1 },
    { collection_id: 'one', tournament_id: 'hidden', is_featured: false, display_order: 3 },
  ];
  const { supabase } = client((url) => {
    if (url.pathname.endsWith('/tournament_collections')) return collections;
    if (url.pathname.endsWith('/tournament_collection_memberships')) return memberships;
    if (url.pathname.endsWith('/tournaments')) return [tournament, { ...tournament, id: 'hidden', slug: 'hidden', is_test: true }];
    return sources(url);
  });
  const data = parseHomeSnapshot(await buildHomeSnapshot(supabase, now));
  assert.deepEqual(data.collections.map((collection) => collection.members.map((member) => member.tournament.id)), [['cup'], ['cup']]);
  assert.deepEqual(data.openTournaments, []);
  assert.equal(data.collections[0].members[0].isFeatured, true);
});

test('unpublished collection memberships do not remove tournaments from the public catalogue', async () => {
  const { supabase } = client((url) => {
    if (url.pathname.endsWith('/tournament_collection_memberships')) {
      return [{ collection_id: 'draft', tournament_id: 'cup', is_featured: true, display_order: 1 }];
    }
    return sources(url);
  });
  const data = parseHomeSnapshot(await buildHomeSnapshot(supabase, now));
  assert.deepEqual(data.collections, []);
  assert.equal(data.openTournaments[0].id, 'cup');
});

test('collection homepage picks eight featured then deterministic open and active fallback', () => {
  const members = Array.from({ length: 12 }, (_, index) => ({
    tournament: {
      id: String(index), slug: `cup-${index}`, status: index % 2 ? 'open' : 'active',
      rounds: index % 2 ? [] : [{}], totalMatches: 0, completedMatches: 0,
    },
    isFeatured: index === 10 || index === 11,
    displayOrder: 11 - index,
  }));
  const first = selectCollectionHomepageMembers(members);
  assert.equal(first.length, 8);
  assert.deepEqual(first.slice(0, 2).map((member) => member.tournament.id), ['11', '10']);
  assert.deepEqual(first.slice(2).map((member) => member.tournament.id), ['9', '7', '5', '3', '1', '8']);
  assert.deepEqual(selectCollectionHomepageMembers([...members].reverse()), first);
});

test('worker publishes only its lease generation and acknowledges only after invalidation', async () => {
  const order: string[] = [];
  const { supabase } = client((url, body) => {
    const name = url.pathname.split('/').at(-1)!;
    order.push(name);
    if (name === 'dirty_home_snapshot_time_boundary') return null;
    if (name === 'claim_public_snapshot_build') return [{ source_generation: 7, lease_token: token, lease_expires_at: '2026-10-03T12:01:30Z' }];
    if (name === 'publish_public_snapshot') {
      assert.equal(body?.p_source_generation, 7);
      assert.equal(body?.p_lease_token, token);
      assert.ok(!JSON.stringify(body?.p_payload).includes('secret'));
      return true;
    }
    if (name === 'public_snapshots') return { exposure: 'public', source_generation: 7, published_generation: 7, cache_invalidated_generation: 6 };
    if (name === 'acknowledge_public_snapshot_invalidation') return true;
    return sources(url);
  });
  assert.deepEqual(await runHomeSnapshotWorker(supabase, async () => { order.push('invalidate'); }), { built: true, invalidated: true });
  assert.ok(order.indexOf('publish_public_snapshot') < order.indexOf('invalidate'));
  assert.ok(order.indexOf('invalidate') < order.indexOf('acknowledge_public_snapshot_invalidation'));
});

test('worker repairs invalidation without a build and leaves withdrawal unverified', async () => {
  for (const exposure of ['public', 'withdrawn']) {
    const { supabase, requests } = client((url) => {
      if (url.pathname.endsWith('/dirty_home_snapshot_time_boundary')) return null;
      if (url.pathname.endsWith('/claim_public_snapshot_build')) return [];
      if (url.pathname.endsWith('/public_snapshots')) return { exposure, source_generation: 8, published_generation: 7, cache_invalidated_generation: 6 };
      if (url.pathname.endsWith('/acknowledge_public_snapshot_invalidation')) return true;
      throw new Error('Unexpected source read or verification');
    });
    let calls = 0;
    assert.deepEqual(await runHomeSnapshotWorker(supabase, async () => { calls++; }), { built: false, invalidated: true });
    assert.equal(calls, 1);
    assert.equal(requests.length, 5);
  }
});

test('purge failure is not acknowledged, and busy workers do not reconstruct sources', async () => {
  const { supabase, requests } = client((url) => {
    if (url.pathname.endsWith('/dirty_home_snapshot_time_boundary')) return null;
    if (url.pathname.endsWith('/claim_public_snapshot_build')) return [];
    if (url.pathname.endsWith('/public_snapshots')) return { exposure: 'public', source_generation: 7, published_generation: 7, cache_invalidated_generation: 6 };
    throw new Error('Unexpected request');
  });
  await assert.rejects(runHomeSnapshotWorker(supabase, async () => { throw new Error('purge'); }));
  assert.equal(requests.length, 4);
});

test('worker authentication rejects missing/short configuration and all mismatched tokens', () => {
  const secret = 'x'.repeat(32);
  assert.equal(isHomeWorkerAuthorized(`Bearer ${secret}`, secret), true);
  for (const value of [undefined, [], 'Bearer wrong', `bearer ${secret}`]) assert.equal(isHomeWorkerAuthorized(value, secret), false);
  assert.equal(isHomeWorkerAuthorized('Bearer short', 'short'), false);
  assert.equal(isHomeWorkerAuthorized('Bearer anything', undefined), false);
});

test('visibility-removal admission is purged before a failed rebuild and never publishes empty data', async () => {
  const order: string[] = [];
  const { supabase } = client((url) => {
    const name = url.pathname.split('/').at(-1)!;
    order.push(name);
    if (name === 'dirty_home_snapshot_time_boundary') return null;
    if (name === 'public_snapshots') return { exposure: 'approved', published_generation: 7 };
    if (name === 'claim_public_snapshot_build') return [{ source_generation: 8, lease_token: token, lease_expires_at: '2026-10-03T12:01:30Z' }];
    if (name === 'tournaments') return { failure: true };
    if (name === 'fixture_warnings') return [];
    if (name === 'fail_public_snapshot_build') return true;
    throw new Error('Unexpected publication/ack');
  });
  await assert.rejects(runHomeSnapshotWorker(supabase, async () => { order.push('invalidate'); }));
  assert.ok(order.indexOf('invalidate') < order.indexOf('claim_public_snapshot_build'));
  assert.ok(order.includes('fail_public_snapshot_build'));
  assert.ok(!order.includes('publish_public_snapshot'));
});

test('stale worker publication rejection never rebases or approves the target', async () => {
  const { supabase, requests } = client((url) => {
    const name = url.pathname.split('/').at(-1)!;
    if (name === 'dirty_home_snapshot_time_boundary') return null;
    if (name === 'public_snapshots') return { exposure: 'draft', published_generation: 0 };
    if (name === 'claim_public_snapshot_build') return [{ source_generation: 7, lease_token: token, lease_expires_at: '2026-10-03T12:01:30Z' }];
    if (name === 'publish_public_snapshot') return false;
    return sources(url);
  });
  assert.deepEqual(await runHomeSnapshotWorker(supabase, async () => { throw new Error('Unexpected purge'); }), { built: false, invalidated: false });
  assert.equal(requests.filter((url) => url.pathname.endsWith('/publish_public_snapshot')).length, 1);
  assert.equal(requests.filter((url) => url.pathname.includes('approve_public_snapshot')).length, 0);
});
