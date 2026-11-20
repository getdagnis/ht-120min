import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { FUNDRAISER_PRODUCTS } from '../shared/fundraiser.ts';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildAppSessionCookie } from '../src/server/api/_lib/app-session.ts';
import {
  clickedByManager, handleBmcWebhook, handleFundraiser, handleFundraiserCheckout, handleFundraiserClaim, handleFundraiserReturn,
  parseBmcShopOrder, verifyBmcSignature,
} from '../src/server/api/_lib/fundraiser.ts';

function shopEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'extra_purchase.created', live_mode: true, created: 1795000000,
    data: {
      id: 98765, object: 'payment', support_type: 'Extra', status: 'succeeded',
      refunded: 'false', amount: 20, currency: 'EUR', created_at: 1795000000,
      extras: [
        { id: 599987, object: 'extra', amount: 5, quantity: 2, currency: 'EUR' },
        { id: 599982, object: 'extra', amount: 10, quantity: 1, currency: 'EUR' },
      ],
      ...(overrides.data as object ?? {}),
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'data')),
  };
}

test('BMC signature covers the exact raw request body', () => {
  const body = JSON.stringify(shopEvent());
  const secret = 'test-secret';
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verifyBmcSignature(body, secret, signature), true);
  assert.equal(verifyBmcSignature(`${body}\n`, secret, signature), false);
  assert.equal(verifyBmcSignature(body, secret, signature.slice(1)), false);
  assert.equal(verifyBmcSignature(body, secret, undefined), false);
});

test('all four Shop URLs and item IDs are mapped to the approved beer values', () => {
  assert.deepEqual(FUNDRAISER_PRODUCTS.map(({ key, itemId, url, beers }) => ({ key, itemId, url, beers })), [
    { key: 'hfi', itemId: 599984, url: 'https://buymeacoffee.com/dagnis/e/599984', beers: 1 },
    { key: 'flags', itemId: 599987, url: 'https://buymeacoffee.com/dagnis/e/599987', beers: 1 },
    { key: '120min', itemId: 599986, url: 'https://buymeacoffee.com/dagnis/e/599986', beers: 1 },
    { key: 'general', itemId: 599982, url: 'https://buymeacoffee.com/dagnis/e/599982', beers: 1 },
  ]);
});

test('fundraiser state distinguishes a verified manager from an anonymous visitor', async () => {
  const previousSecret = process.env.APP_SESSION_SECRET;
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  const previousFetch = globalThis.fetch;
  process.env.APP_SESSION_SECRET = 'test-app-session-secret';
  process.env.SUPABASE_URL = 'https://fundraiser-test.invalid';
  process.env.SUPABASE_SECRET_KEY = 'test-service-key';
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.hostname, 'fundraiser-test.invalid');
    assert.ok(url.pathname === '/rest/v1/rpc/next_season_fundraiser_summary' ||
      url.pathname === '/rest/v1/next_season_bmc_payments');
    return Response.json([]);
  };
  try {
    let state: { authenticated: boolean; hasSupported: boolean } | null = null;
    const res = {
      setHeader() { return this; },
      status(code: number) { assert.equal(code, 200); return this; },
      json(value: { authenticated: boolean; hasSupported: boolean }) { state = value; return this; },
    } as unknown as VercelResponse;
    const request = (cookie?: string) => ({ method: 'GET', headers: { cookie } }) as VercelRequest;
    await handleFundraiser(request(), res);
    assert.equal(state?.authenticated, false);
    assert.equal(state?.hasSupported, false);
    const session = buildAppSessionCookie(42, process.env.APP_SESSION_SECRET, false).split(';')[0];
    await handleFundraiser(request(session), res);
    assert.equal(state?.authenticated, true);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previousKey;
    if (previousSecret === undefined) delete process.env.APP_SESSION_SECRET;
    else process.env.APP_SESSION_SECRET = previousSecret;
  }
});

test('checkout records the signed-in manager and product before redirecting to the real Shop URL', async () => {
  const previousSecret = process.env.APP_SESSION_SECRET;
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  const previousFetch = globalThis.fetch;
  process.env.APP_SESSION_SECRET = 'test-app-session-secret';
  process.env.SUPABASE_URL = 'https://fundraiser-test.invalid';
  process.env.SUPABASE_SECRET_KEY = 'test-service-key';
  let recordedClick: unknown;
  globalThis.fetch = async (_input, init) => {
    recordedClick = JSON.parse(String(init?.body));
    return new Response('', { status: 201 });
  };
  try {
    const headers = new Map<string, string>();
    let status = 200;
    let location = '';
    const res = {
      setHeader(name: string, value: string) { headers.set(name, value); return this; },
      status(value: number) { status = value; return this; },
      json: () => undefined,
      redirect(value: number, url: string) { status = value; location = url; return this; },
    } as unknown as VercelResponse;
    const session = buildAppSessionCookie(42, process.env.APP_SESSION_SECRET, false).split(';')[0];
    const req = { method: 'GET', query: { item: 'hfi' }, headers: { cookie: session } } as unknown as VercelRequest;
    await handleFundraiserCheckout(req, res);
    assert.equal((recordedClick as { item_id: number }).item_id, 599984);
    assert.equal((recordedClick as { manager_id: number }).manager_id, 42);
    assert.equal(status, 303);
    assert.equal(location, FUNDRAISER_PRODUCTS[0].url);
    const click = headers.get('Set-Cookie') ?? '';
    assert.match(click, /HttpOnly; SameSite=Lax/);
    assert.equal(clickedByManager(`${session}; ${click.split(';')[0]}`, 'hfi', 42, process.env.APP_SESSION_SECRET), true);
    assert.equal(clickedByManager(click, 'hfi', 43, process.env.APP_SESSION_SECRET), false);
    assert.equal(clickedByManager(click, 'flags', 42, process.env.APP_SESSION_SECRET), false);
    const cookiePair = click.split(';')[0];
    const altered = `${cookiePair.slice(0, -1)}${cookiePair.endsWith('x') ? 'y' : 'x'}`;
    assert.equal(clickedByManager(altered, 'hfi', 42, process.env.APP_SESSION_SECRET), false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previousKey;
    if (previousSecret === undefined) delete process.env.APP_SESSION_SECRET;
    else process.env.APP_SESSION_SECRET = previousSecret;
  }
});

test('a claim needs the signed original return even when the manager is logged in', async () => {
  const previousSecret = process.env.APP_SESSION_SECRET;
  process.env.APP_SESSION_SECRET = 'test-app-session-secret';
  try {
    const session = buildAppSessionCookie(42, process.env.APP_SESSION_SECRET, false).split(';')[0];
    let status = 200;
    let body: unknown;
    const res = {
      setHeader: () => undefined,
      status(value: number) { status = value; return this; },
      json(value: unknown) { body = value; return this; },
    } as unknown as VercelResponse;
    await handleFundraiserClaim({
      method: 'POST', headers: { cookie: session }, body: { item: 'hfi' },
    } as unknown as VercelRequest, res);
    assert.equal(status, 200);
    assert.deepEqual(body, { matched: false });
  } finally {
    if (previousSecret === undefined) delete process.env.APP_SESSION_SECRET;
    else process.env.APP_SESSION_SECRET = previousSecret;
  }
});

test('a return keeps its original signed context on refresh', () => {
  const previousSecret = process.env.APP_SESSION_SECRET;
  process.env.APP_SESSION_SECRET = 'test-app-session-secret';
  try {
    let cookie = '';
    const res = {
      setHeader(name: string, value: string) { if (name === 'Set-Cookie') cookie = value; return this; },
      status() { return this; },
      json() { return this; },
    } as unknown as VercelResponse;
    const request = (cookieHeader = '') => ({
      method: 'POST', body: { item: 'hfi' }, headers: { cookie: cookieHeader },
    }) as unknown as VercelRequest;
    handleFundraiserReturn(request(), res);
    const first = cookie.split(';')[0];
    assert.match(first, /^ht120_fundraiser_return_hfi=/);
    handleFundraiserReturn(request(first), res);
    assert.equal(cookie.split(';')[0], first);
  } finally {
    if (previousSecret === undefined) delete process.env.APP_SESSION_SECRET;
    else process.env.APP_SESSION_SECRET = previousSecret;
  }
});

test('Shop order uses extra item IDs, quantities, and integer EUR cents', () => {
  assert.deepEqual(parseBmcShopOrder(shopEvent()), {
    paymentId: 98765, refunded: false,
    createdAt: new Date(1795000000 * 1000).toISOString(),
    eventAt: new Date(1795000000 * 1000).toISOString(),
    items: [
      { item_id: 599987, quantity: 2, euro_cents: 500 },
      { item_id: 599982, quantity: 1, euro_cents: 1000 },
    ],
  });
  assert.equal(parseBmcShopOrder(shopEvent({ data: { extras: [
    { id: 123456, object: 'extra', amount: 5, quantity: 1, currency: 'EUR' },
  ] } }))?.items.length, 0);
});

test('refund and updated states are recognized; invalid amounts and IDs are rejected', () => {
  const refunded = shopEvent({ type: 'extra_purchase.refunded', data: { status: 'refunded', refunded: 'true' } });
  assert.equal(parseBmcShopOrder(refunded)?.refunded, true);
  assert.equal(parseBmcShopOrder(shopEvent({ type: 'extra_purchase.updated', data: {
    status: 'refunded', refunded: 'true', extras: [],
  } }))?.refunded, true);
  assert.equal(parseBmcShopOrder(shopEvent({ data: { id: '98765' } })), null);
  assert.equal(parseBmcShopOrder(shopEvent({ data: { extras: [
    { id: 599987, object: 'extra', amount: 5, quantity: 1, currency: 'USD' },
  ] } })), null);
  assert.equal(parseBmcShopOrder(shopEvent({ data: { amount: 0 } })), null);
  assert.equal(parseBmcShopOrder(shopEvent({ data: { extras: [
    { id: 599987, object: 'extra', amount: 5, quantity: 0, currency: 'EUR' },
  ] } })), null);
  assert.ok(parseBmcShopOrder(shopEvent({ data: { extras: [
    { id: 599987, object: 'extra', amount: 7, quantity: 1, currency: 'EUR' },
  ] } })));
  assert.equal(parseBmcShopOrder(shopEvent({ type: 'extra_purchase.refunded', data: {
    status: 'refunded', refunded: 'true', extras: undefined,
  } }))?.items.length, 0);
  assert.equal(parseBmcShopOrder(shopEvent({ type: 'extra_purchase.refunded', data: {
    status: 'refunded', refunded: 'true', extras: [{ id: 599987, quantity: 0 }],
  } }))?.items.length, 0);
  assert.ok(parseBmcShopOrder(shopEvent({ data: { amount: undefined, currency: undefined,
    created_at: undefined } })));
});

test('webhook rejects invalid signatures and ignores signed dashboard test events', async () => {
  const originalSecret = process.env.BMC_WEBHOOK_SECRET;
  process.env.BMC_WEBHOOK_SECRET = 'test-secret';
  try {
    const body = JSON.stringify(shopEvent({ live_mode: false }));
    let status = 200;
    let responseBody: unknown;
    const res = {
      setHeader: () => undefined,
      status(value: number) { status = value; return this; },
      json(value: unknown) { responseBody = value; return this; },
    } as unknown as VercelResponse;
    const req = {
      method: 'POST', body,
      headers: { 'x-signature-sha256': 'bad' },
    } as unknown as VercelRequest;
    await handleBmcWebhook(req, res);
    assert.equal(status, 401);
    req.headers['x-signature-sha256'] = createHmac('sha256', 'test-secret').update(body).digest('hex');
    await handleBmcWebhook(req, res);
    assert.equal(status, 200);
    assert.deepEqual(responseBody, { ok: true });
  } finally {
    if (originalSecret === undefined) delete process.env.BMC_WEBHOOK_SECRET;
    else process.env.BMC_WEBHOOK_SECRET = originalSecret;
  }
});
