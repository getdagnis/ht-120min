import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import {
  createPublicSnapshotStore,
  parsePublicWithdrawalStatus,
  PUBLIC_SNAPSHOT_MAX_BYTES,
  type PublicSnapshotLease,
} from '../src/server/api/_lib/public-snapshot-store.js';

const token = '12345678-1234-4321-8123-123456789012';
const lease: PublicSnapshotLease = {
  targetKey: 'season:test-season', contractVersion: 1, sourceGeneration: 7,
  token, expiresAt: '2026-10-03T12:01:30.000Z',
};

function parseTitle(input: unknown) {
  assert.ok(input && typeof input === 'object' && !Array.isArray(input));
  assert.equal(typeof (input as { title?: unknown }).title, 'string');
  // A real component contract likewise constructs allowlisted fields, not a row spread.
  return { title: (input as { title: string }).title };
}

function harness(replies: Array<{ data: unknown; status?: number }>) {
  const requests: Array<{ url: URL; body: Record<string, unknown> | null }> = [];
  const supabase = createClient('https://publication-test.invalid', 'test-server-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push({ url: new URL(request.url), body: request.method === 'POST' ? await request.json() : null });
        const reply = replies.shift();
        assert.ok(reply, 'Unexpected extra database request');
        return new Response(JSON.stringify(reply.data), {
          status: reply.status ?? 200, headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });
  return {
    requests, supabase,
    store: createPublicSnapshotStore(supabase, { targetKey: lease.targetKey, version: 1, parse: parseTitle }),
  };
}

test('published reads use only the scoped publication row and decode an allowlisted payload', async () => {
  const { store, requests } = harness([{ data: {
    exposure: 'public', published_generation: 7,
    payload: { title: 'Season One', oauth_token: 'not-public', admin_password: 'not-public' },
  } }]);
  assert.deepEqual(await store.readPublished(), { generation: 7, payload: { title: 'Season One' } });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.pathname, '/rest/v1/public_snapshots');
  assert.equal(requests[0].url.searchParams.get('target_key'), 'eq.season:test-season');
  assert.equal(requests[0].url.searchParams.get('contract_version'), 'eq.1');
  assert.equal(requests[0].url.searchParams.get('exposure'), 'eq.public');
  assert.equal(requests[0].url.searchParams.get('select'), 'payload,published_generation,exposure');
});

test('missing publications do not reconstruct sources or initiate CHPP', async () => {
  const { store, requests } = harness([{ data: null }]);
  assert.equal(await store.readPublished(), null);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.pathname, '/rest/v1/public_snapshots');
});

test('draft, approved and withdrawn rows are never returned as public fallback data', async () => {
  for (const exposure of ['draft', 'approved', 'withdrawn']) {
    const { store } = harness([{ data: { exposure, payload: { title: 'Old payload' }, published_generation: 7 } }]);
    assert.equal(await store.readPublished(), null);
  }
});

test('database outage fails without a source-table fallback or leaking transport diagnostics', async () => {
  const { store, requests } = harness([{ status: 500, data: {
    code: 'XX000', message: 'secret diagnostic', details: 'private transport detail',
  } }]);
  await assert.rejects(store.readPublished(), /^Error: Public publication read failed\.$/);
  assert.equal(requests.length, 1);
});

test('dirtying a target does not implicitly approve public publication', async () => {
  const { store, requests } = harness([{ data: 1 }, { data: 2 }]);
  assert.equal(await store.markDirty(), 1);
  assert.equal(await store.approvePublication(1), 2);
  assert.equal(requests[0].url.pathname, '/rest/v1/rpc/mark_public_snapshot_dirty');
  assert.equal(requests[1].url.pathname, '/rest/v1/rpc/approve_public_snapshot');
  assert.equal(requests[1].body?.p_expected_generation, 1);
});

test('approval/withdrawal conflicts are returned as null rather than retried with new authority', async () => {
  const { store, requests } = harness([{ data: null }, { data: null }]);
  assert.equal(await store.approvePublication(7), null);
  assert.equal(await store.withdraw(7), null);
  assert.equal(requests.length, 2);
});

test('build claim captures the database generation/token/expiry and bounds lease duration', async () => {
  const { store, requests } = harness([{ data: [{ source_generation: 7, lease_token: token, lease_expires_at: lease.expiresAt }] }]);
  assert.deepEqual(await store.claimBuild(), lease);
  assert.equal(requests[0].body?.p_lease_seconds, 90);
  await assert.rejects(store.claimBuild(91), /Invalid publication lease duration/);
  await assert.rejects(store.claimBuild(0), /Invalid publication lease duration/);
  assert.equal(requests.length, 1);
});

test('busy/clean/ineligible targets yield no lease, not a fallback build', async () => {
  const { store, requests } = harness([{ data: [] }]);
  assert.equal(await store.claimBuild(), null);
  assert.equal(requests.length, 1);
});

test('publication passes the exact captured fence and strips fields through the contract', async () => {
  const { store, requests } = harness([{ data: true }]);
  assert.equal(await store.publish(lease, { title: 'Final facts', admin_password: 'not-public' }), true);
  assert.deepEqual(requests[0].body?.p_payload, { title: 'Final facts' });
  assert.equal(requests[0].body?.p_source_generation, 7);
  assert.equal(requests[0].body?.p_lease_token, token);
  assert.match(String(requests[0].body?.p_payload_checksum), /^[0-9a-f]{64}$/);
});

test('database rejection of a stale/expired build is surfaced without token or generation rebasing', async () => {
  const { store, requests } = harness([{ data: false }]);
  assert.equal(await store.publish(lease, { title: 'Old result' }), false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body?.p_source_generation, 7);
});

test('lease scope mismatch and malformed token are rejected before a database call', async () => {
  const { store, requests } = harness([]);
  await assert.rejects(store.publish({ ...lease, targetKey: 'season:another-season' }, { title: 'No' }), /lease does not match/);
  await assert.rejects(store.failBuild({ ...lease, contractVersion: 2 }), /lease does not match/);
  await assert.rejects(store.publish({ ...lease, token: '' }, { title: 'No' }), /lease does not match/);
  assert.equal(requests.length, 0);
});

test('oversized UTF-8 payloads and invalid decoded payloads never reach publication', async () => {
  const { store, requests } = harness([]);
  await assert.rejects(store.publish(lease, { title: '😀'.repeat(PUBLIC_SNAPSHOT_MAX_BYTES / 4) }), /size limit/);
  await assert.rejects(store.publish(lease, { title: 42 }));
  assert.equal(requests.length, 0);
});

test('build failures use the captured fence and only persist a sanitized fixed error code in SQL', async () => {
  const { store, requests } = harness([{ data: true }]);
  assert.equal(await store.failBuild(lease), true);
  assert.equal(requests[0].url.pathname, '/rest/v1/rpc/fail_public_snapshot_build');
  assert.equal(requests[0].body?.p_source_generation, 7);
  assert.equal(requests[0].body?.p_lease_token, token);
  assert.equal('error' in (requests[0].body || {}), false);
});

test('withdrawal invalidation acknowledgment and verification are different operations', async () => {
  const { store, requests } = harness([{ data: 8 }, { data: true }, { data: true }]);
  assert.equal(await store.withdraw(7), 8);
  assert.equal(await store.acknowledgeInvalidation(8), true);
  assert.equal(await store.verifyWithdrawal(8), true);
  assert.deepEqual(requests.map(request => request.url.pathname), [
    '/rest/v1/rpc/withdraw_public_snapshot',
    '/rest/v1/rpc/acknowledge_public_snapshot_invalidation',
    '/rest/v1/rpc/verify_public_snapshot_withdrawal',
  ]);
});

const pendingWithdrawal = {
  exposure: 'withdrawn', withdrawal_requested_at: '2026-10-03T12:00:00.000Z',
  withdrawal_deadline_at: '2026-10-03T12:01:00.000Z', withdrawal_verified_at: null,
  error_code: null,
};

test('withdrawal remains pending on failure and becomes target-breached after 60 seconds', () => {
  const pending = parsePublicWithdrawalStatus(pendingWithdrawal, Date.parse('2026-10-03T12:00:30Z'));
  assert.equal(pending?.label, 'Withdrawal pending');
  assert.equal(pending?.targetBreached, false);
  const failed = parsePublicWithdrawalStatus({ ...pendingWithdrawal, error_code: 'purge_failed' }, Date.parse('2026-10-03T12:01:01Z'));
  assert.equal(failed?.label, 'Withdrawal pending');
  assert.equal(failed?.targetBreached, true);
  assert.equal(failed?.errorCode, 'purge_failed');
});

test('late verification retains the recorded target breach rather than hiding it', () => {
  const status = parsePublicWithdrawalStatus({ ...pendingWithdrawal, withdrawal_verified_at: '2026-10-03T12:01:02Z' });
  assert.equal(status?.label, 'Withdrawal verified');
  assert.equal(status?.targetBreached, true);
});

test('private withdrawal status reads do not load the retained payload', async () => {
  const { store, requests } = harness([{ data: { ...pendingWithdrawal, error_code: 'coverage_missing' } }]);
  assert.equal((await store.readWithdrawalStatus(Date.parse('2026-10-03T12:00:30Z')))?.label, 'Withdrawal pending');
  assert.equal(requests[0].url.searchParams.get('select')?.includes('payload'), false);
});

test('withdrawal failure records only recognized failure codes and the expected generation', async () => {
  const { store, requests } = harness([{ data: true }]);
  assert.equal(await store.failWithdrawal(8, 'probe_failed'), true);
  assert.equal(requests[0].body?.p_generation, 8);
  assert.equal(requests[0].body?.p_error_code, 'probe_failed');
});

test('malformed generations, deadlines, contracts and transport responses fail closed', async () => {
  const { store, supabase, requests } = harness([{ data: 'true' }]);
  await assert.rejects(store.acknowledgeInvalidation(7), /Invalid publication mutation response/);
  await assert.rejects(store.withdraw(Number.MAX_SAFE_INTEGER + 1), /Invalid publication generation/);
  assert.throws(() => parsePublicWithdrawalStatus({ ...pendingWithdrawal, withdrawal_deadline_at: '2026-10-03T12:02:00Z' }), /Invalid withdrawal deadline/);
  assert.throws(() => createPublicSnapshotStore(supabase, { targetKey: 'unscoped', version: 1, parse: parseTitle }), /Invalid public publication contract/);
  assert.equal(requests.length, 1);
});
