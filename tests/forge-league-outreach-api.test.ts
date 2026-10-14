import assert from 'node:assert/strict';
import test from 'node:test';
import { buildForgeSessionCookie } from '../src/server/api/_lib/forge-session.js';
import handleForgeLeagues from '../src/server/api/testing/leagues.js';

function responseRecorder() {
  let statusCode = 200;
  let payload: unknown;
  const response = {
    status(code: number) { statusCode = code; return response; },
    json(value: unknown) { payload = value; return response; },
    setHeader() { return response; },
  };
  return { response, get status() { return statusCode; }, get payload() { return payload; } };
}

function saveEnv(name: string) {
  return process.env[name];
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('outreach ledger import is Forge-authorized and repeat imports are idempotent', async () => {
  const names = ['FORGE_ENABLED', 'APP_SESSION_SECRET', 'FORGE_SUPERADMIN_HT_ID', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY'];
  const prior = Object.fromEntries(names.map((name) => [name, saveEnv(name)]));
  const originalFetch = globalThis.fetch;
  const stored = new Set<string>();
  process.env.FORGE_ENABLED = 'true';
  process.env.APP_SESSION_SECRET = 'outreach-test-secret';
  process.env.FORGE_SUPERADMIN_HT_ID = '8777402';
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_SECRET_KEY = 'outreach-test-service-key';
  globalThis.fetch = async (_input, init) => {
    const rows = JSON.parse(String(init?.body || '[]')) as Array<{ campaign_id: string; manager_id: number }>;
    const inserted = rows.filter((row) => {
      const key = `${row.campaign_id}:${row.manager_id}`;
      if (stored.has(key)) return false;
      stored.add(key);
      return true;
    });
    return new Response(JSON.stringify(inserted), { status: 201, headers: { 'content-type': 'application/json' } });
  };

  try {
    const cookie = buildForgeSessionCookie(8777402, false).split(';')[0];
    const invoke = async (headers: Record<string, string>, managerIds: unknown[]) => {
      const recorder = responseRecorder();
      await handleForgeLeagues({
        method: 'POST', headers, query: { action: 'outreach-import-local' },
        body: { campaignId: 'around-the-world-in-one-twenty', managerIds },
      } as never, recorder.response as never);
      return recorder;
    };

    const denied = await invoke({}, [11]);
    assert.equal(denied.status, 401);

    const first = await invoke({ cookie }, [11, 12, 11, 0, 'bad']);
    assert.equal(first.status, 200);
    assert.deepEqual(first.payload, {
      submittedRows: 5,
      uniqueValidIds: 2,
      imported: 2,
      alreadyPresent: 0,
      duplicateInputCount: 1,
      invalidRows: [{ index: 3, value: 0 }, { index: 4, value: 'bad' }],
      unmatchedRows: [],
    });

    const repeated = await invoke({ cookie }, [11, 12]);
    assert.equal(repeated.status, 200);
    assert.deepEqual(repeated.payload, {
      submittedRows: 2,
      uniqueValidIds: 2,
      imported: 0,
      alreadyPresent: 2,
      duplicateInputCount: 0,
      invalidRows: [],
      unmatchedRows: [],
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) restoreEnv(name, prior[name]);
  }
});

test('outreach loads contacts beyond 1,000 and retains manager matching across teams', async () => {
  const names = ['FORGE_ENABLED', 'APP_SESSION_SECRET', 'FORGE_SUPERADMIN_HT_ID', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY'];
  const prior = Object.fromEntries(names.map((name) => [name, saveEnv(name)]));
  const originalFetch = globalThis.fetch;
  process.env.FORGE_ENABLED = 'true';
  process.env.APP_SESSION_SECRET = 'outreach-test-secret';
  process.env.FORGE_SUPERADMIN_HT_ID = '8777402';
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_SECRET_KEY = 'outreach-test-service-key';
  const rows = Array.from({ length: 1047 }, (_, index) => ({ campaign_id: 'invitation', manager_id: index + 1 }));
  const offsets: number[] = [];
  let failSecondPage = false;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    let data: unknown[] = [];
    if (url.pathname.endsWith('/forge_league_outreach_contacts')) {
      assert.equal(url.searchParams.get('order'), 'campaign_id.asc,manager_id.asc');
      assert.equal(url.searchParams.get('limit'), '1000');
      const offset = Number(url.searchParams.get('offset'));
      offsets.push(offset);
      if (failSecondPage && offset === 1000) {
        return new Response(JSON.stringify({ message: 'page unavailable' }), { status: 500 });
      }
      data = rows.slice(offset, offset + 1000);
    } else if (url.pathname.endsWith('/forge_league_outreach_campaigns')) {
      data = [{ id: 'invitation', name: 'Invitation', campaign_date: '2026-10-14' }];
    }
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const invoke = async () => {
      const recorder = responseRecorder();
      await handleForgeLeagues({
        method: 'GET', headers: { cookie: buildForgeSessionCookie(8777402, false).split(';')[0] },
        query: { action: 'outreach' },
      } as never, recorder.response as never);
      return recorder;
    };
    const result = await invoke();
    assert.equal(result.status, 200);
    const payload = result.payload as { contacts: { campaignId: string; managerId: number }[] };
    assert.equal(payload.contacts.length, 1047);
    assert.deepEqual(offsets, [0, 1000]);
    const { getForgeOutreachStatus } = await import('../src/utils/forge-leagues.js');
    // Different league/team rows for the same manager use the same contact ledger.
    for (const team of [{ leagueId: 1, teamId: 11, managerId: 1047 }, { leagueId: 2, teamId: 22, managerId: 1047 }]) {
      assert.equal(getForgeOutreachStatus('invitation', team.managerId, [], payload.contacts).contacted, true);
    }
    failSecondPage = true;
    await assert.rejects(invoke, /Outreach history is unavailable/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) restoreEnv(name, prior[name]);
  }
});
