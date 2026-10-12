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
