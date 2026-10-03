// Production-mode Next cache verification against a LOCAL FAKE PostgREST server.
// Prerequisite: npm run build. No real Supabase/CHPP requests or browser execution.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createClient } from '@supabase/supabase-js';
import { buildHomeSnapshot } from '../src/server/api/_lib/home-snapshot-builder.ts';
import { parseHomeSnapshot } from '../src/server/api/_lib/home-snapshot-contract.ts';

const fixture = {
  id: 'probe-cup', name: 'Home Snapshot Probe One', slug: 'probe-cup', created_at: '2026-01-01T00:00:00Z',
  season: 1, is_private: false, is_test: false, is_featured: true, status: 'active', is_archived: false,
  country_limit: null, scoring_mode: null, league_category: null, max_teams: 8, rounds: [], teams: [],
};
const source = createClient('https://fake.invalid', 'fake', {
  auth: { persistSession: false }, global: { fetch: async (input) => new Response(
    JSON.stringify(new URL(String(input)).pathname.endsWith('/tournaments') ? [fixture] : []),
    { headers: { 'Content-Type': 'application/json' } },
  ) },
});
let payload = parseHomeSnapshot(await buildHomeSnapshot(source));
let generation = 1;
let acknowledged = 0;
let exposure = 'public';
let unavailable = false;
let publishedReads = 0;
let normalizedReads = 0;
const secret = 'local-only-home-worker-probe-secret';
const database = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Content-Type', 'application/json');
  if (url.pathname.endsWith('/public_snapshots')) {
    if (url.searchParams.get('select')?.includes('payload')) {
      publishedReads++;
      if (unavailable) { res.writeHead(503); res.end('{"message":"fake unavailable"}'); return; }
      res.end(JSON.stringify(exposure === 'public' ? { exposure, payload, published_generation: generation } : null));
    } else res.end(JSON.stringify({ exposure, source_generation: generation, published_generation: generation, cache_invalidated_generation: acknowledged }));
    return;
  }
  if (url.pathname.endsWith('/dirty_home_snapshot_time_boundary')) { res.end('null'); return; }
  if (url.pathname.endsWith('/claim_public_snapshot_build')) { res.end('[]'); return; }
  if (url.pathname.endsWith('/acknowledge_public_snapshot_invalidation')) { acknowledged = generation; res.end('true'); return; }
  normalizedReads++;
  res.writeHead(500); res.end('{"message":"unexpected normalized source access"}');
});
database.listen(0, '127.0.0.1');
await once(database, 'listening');
const databaseUrl = `http://127.0.0.1:${database.address().port}`;
const portProbe = createServer();
portProbe.listen(0, '127.0.0.1');
await once(portProbe, 'listening');
const port = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const next = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  env: { ...process.env, PUBLIC_HOME_SNAPSHOT_ENABLED: 'true', PUBLIC_HOME_WORKER_SECRET: secret,
    SUPABASE_URL: databaseUrl, SUPABASE_SECRET_KEY: 'fake-local-service-key' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
next.stdout.on('data', (chunk) => { logs += chunk; });
next.stderr.on('data', (chunk) => { logs += chunk; });
async function refresh() {
  return fetch(`${origin}/api/public-data/home/refresh`, { method: 'POST', headers: { Authorization: `Bearer ${secret}` } });
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      if ((await fetch(`${origin}/api/public-data/home/refresh`)).status === 405) { ready = true; break; }
    } catch { /* local server startup */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'Next did not start');
  assert.equal((await refresh()).status, 200);
  assert.equal((await fetch(`${origin}/api/public-data/home/refresh`, { method: 'POST' })).status, 401);
  const first = await fetch(`${origin}/en`);
  assert.equal(first.status, 200);
  assert.match(await first.text(), /Home Snapshot Probe One/);
  const coldReads = publishedReads;
  assert.equal(coldReads, 1);
  unavailable = true;
  for (const locale of ['en', 'lv', 'en']) {
    const warm = await fetch(`${origin}/${locale}`);
    assert.equal(warm.status, 200);
    assert.match(await warm.text(), /Home Snapshot Probe One/);
  }
  assert.equal(publishedReads, coldReads, 'Warm Home queried Supabase');
  const rsc = await fetch(`${origin}/en`, { headers: { RSC: '1' } });
  assert.equal(rsc.status, 200);
  assert.match(await rsc.text(), /Home Snapshot Probe One/);
  assert.equal(publishedReads, coldReads, 'Warm RSC queried Supabase');
  unavailable = false;
  payload.featuredTournaments[0].name = 'Home Snapshot Probe Two';
  generation++;
  assert.equal((await refresh()).status, 200);
  const changed = await fetch(`${origin}/en`);
  assert.equal(changed.status, 200);
  assert.match(await changed.text(), /Home Snapshot Probe Two/);
  assert.equal(publishedReads, coldReads + 1);
  exposure = 'withdrawn'; generation++;
  assert.equal((await refresh()).status, 200);
  const withdrawn = await fetch(`${origin}/en`);
  assert.equal(withdrawn.status, 500);
  assert.doesNotMatch(await withdrawn.text(), /Home Snapshot Probe Two/);
  assert.equal(normalizedReads, 0, 'Public path reconstructed sources');
  console.log('PASS: real Next production cache: cold=1 snapshot read, warm HTML/RSC/outage=0, cross-locale reuse, refresh purge, withdrawn cold read denied, unauthorized worker denied; no normalized/CHPP reads.');
} catch (error) {
  console.error(logs.slice(-4000));
  throw error;
} finally {
  if (next.exitCode === null && next.signalCode === null) {
    const exited = once(next, 'exit');
    next.kill('SIGTERM');
    await exited;
  }
  await new Promise((resolve) => database.close(resolve));
}
