import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { FUNDRAISER_PRODUCTS } from '../shared/fundraiser.ts';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleBmcWebhook, parseBmcShopOrder, verifyBmcSignature } from '../src/server/api/_lib/fundraiser.ts';

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
    { key: 'general', itemId: 599982, url: 'https://buymeacoffee.com/dagnis/e/599982', beers: 2 },
  ]);
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
