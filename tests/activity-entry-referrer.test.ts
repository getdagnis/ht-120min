import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { normalizeEntryReferrer, recordActivity } from '../src/server/api/_lib/activity.ts';
import appHandler from '../src/server/api/app.ts';
import { buildForgeSessionCookie } from '../src/server/api/_lib/forge-session.ts';
import { trackActivity } from '../src/hooks/useActivityTracking.ts';

test('browser sends the initial document referrer origin with its first activity event', async (t) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousFetch = globalThis.fetch;
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete (globalThis as { window?: Window }).window;
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete (globalThis as { document?: Document }).document;
    globalThis.fetch = previousFetch;
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { hostname: 'ht-120min.vercel.app' } } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { referrer: 'https://www.hattrick.org/Club/?TeamID=42' } });
  const bodies: Array<{ entryReferrer?: string }> = [];
  globalThis.fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as { entryReferrer?: string });
    return Response.json({ ok: true });
  };
  await trackActivity('page_view', { route: '/en' });
  assert.equal(bodies[0]?.entryReferrer, 'https://www.hattrick.org');
});

test('entry source keeps only external origins and treats internal navigation as unknown', () => {
  const host = 'ht-120min.vercel.app';
  assert.equal(normalizeEntryReferrer('https://www.hattrick.org/Club/?TeamID=42', host), 'https://www.hattrick.org');
  assert.equal(normalizeEntryReferrer('https://www.google.com/search?q=ht120', host), 'https://www.google.com');
  assert.equal(normalizeEntryReferrer('https://ht-120min.vercel.app/en/t/cup', host), null);
  assert.equal(normalizeEntryReferrer('https://120min.vercel.app/en', host), null);
  assert.equal(normalizeEntryReferrer('', host), null);
  assert.equal(normalizeEntryReferrer('javascript:alert(1)', host), null);
  assert.equal(normalizeEntryReferrer('https://www.google.com/' + 'x'.repeat(2048), host), null);
});

test('activity stores browser entry source instead of the same-origin API Referer', async (t) => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previousKey;
  });
  process.env.SUPABASE_URL = 'https://activity-test.invalid';
  process.env.SUPABASE_SECRET_KEY = 'test-service-key';
  const inserted: Array<{ referrer: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.hostname, 'activity-test.invalid');
    if (url.pathname === '/rest/v1/activity_events') {
      inserted.push(JSON.parse(String(init?.body)) as { referrer: string | null });
      return new Response(null, { status: 201 });
    }
    assert.match(url.pathname, /^\/rest\/v1\/rpc\/increment_activity_daily(?:_clean)?$/);
    return Response.json(null);
  };
  const response = { setHeader() { return this; } } as unknown as VercelResponse;
  const request = { headers: {
    host: 'ht-120min.vercel.app',
    referer: 'https://ht-120min.vercel.app/en',
  } } as unknown as VercelRequest;

  await recordActivity(request, response, { eventType: 'page_view', route: '/en', entryReferrer: 'https://www.hattrick.org/Club/' });
  await recordActivity(request, response, { eventType: 'page_view', route: '/en/t/cup', entryReferrer: 'https://ht-120min.vercel.app/en' });
  assert.deepEqual(inserted.map((row) => row.referrer), ['https://www.hattrick.org', null]);
});

test('Forge keeps the first visit source, including direct, across later external callbacks', async (t) => {
  const envKeys = ['FORGE_ENABLED', 'APP_SESSION_SECRET', 'FORGE_SUPERADMIN_HT_ID', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY'];
  const previousEnv = envKeys.map((key) => process.env[key]);
  const previousFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previousFetch;
    envKeys.forEach((key, index) => {
      if (previousEnv[index] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[index];
    });
  });
  process.env.FORGE_ENABLED = 'true';
  process.env.APP_SESSION_SECRET = 'activity-test-session-secret';
  process.env.FORGE_SUPERADMIN_HT_ID = '999';
  process.env.SUPABASE_URL = 'https://activity-test.invalid';
  process.env.SUPABASE_SECRET_KEY = 'test-service-key';
  const event = (id: string, visitId: string, occurredAt: string, eventType: string, referrer: string | null) => ({
    id, visit_id: visitId, visitor_id: visitId, occurred_at: occurredAt,
    event_type: eventType, route: '/en', referrer, hattrick_user_id: null,
    manager_name: null, tournament_id: null, team_id: null, country_code: null,
    language: null, platform: null, browser: null, metadata: {},
  });
  const rows = [
    event('4', 'google-visit', '2026-11-20T10:03:00Z', 'control_click', 'https://ht-120min.vercel.app/en'),
    event('3', 'google-visit', '2026-11-20T10:02:00Z', 'page_view', 'https://www.google.com/search'),
    event('2', 'direct-visit', '2026-11-20T10:01:00Z', 'login', 'https://chpp.hattrick.org/oauth'),
    event('1', 'direct-visit', '2026-11-20T10:00:00Z', 'page_view', null),
  ];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.hostname, 'activity-test.invalid');
    assert.equal(url.pathname, '/rest/v1/activity_events');
    return init?.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json(rows);
  };
  let result: Record<string, unknown> = {};
  const response = {
    status(code: number) { assert.equal(code, 200); return this; },
    json(value: Record<string, unknown>) { result = value; return this; },
  } as unknown as VercelResponse;
  const cookie = buildForgeSessionCookie(999, false).split(';')[0];
  const request = { method: 'GET', query: { route: 'forge-stats', all: '1' },
    headers: { cookie, host: 'ht-120min.vercel.app' } } as unknown as VercelRequest;
  await appHandler(request, response);
  const visits = result.visits as Array<{ visitId: string; referrer: string | null }>;
  assert.equal(visits.find((visit) => visit.visitId === 'direct-visit')?.referrer, null);
  assert.equal(visits.find((visit) => visit.visitId === 'google-visit')?.referrer, 'https://www.google.com');
  const sources = (result.breakdowns as { referrers: Array<{ value: string }> }).referrers.map((row) => row.value);
  assert.deepEqual(new Set(sources), new Set(['Direct / unknown', 'https://www.google.com']));
  const actions = result.recentActivity as Array<{ visit_id: string; referrer: string | null }>;
  assert.equal(actions.find((action) => action.visit_id === 'direct-visit')?.referrer, null);
  assert.equal(actions.find((action) => action.visit_id === 'google-visit')?.referrer, 'https://www.google.com');
});
