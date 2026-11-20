import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import completeAuth from '../src/server/api/auth/complete.ts';
import { verifyAppSessionCookie } from '../src/server/api/_lib/app-session.ts';

const secret = 'session-recovery-test-secret';
const day = 24 * 60 * 60 * 1000;

function signedCookie(userId: number, exp: number) {
  const encoded = Buffer.from(JSON.stringify({ userId, exp })).toString('base64url');
  return `ht_session=${encoded}.${createHmac('sha256', secret).update(encoded).digest('base64url')}`;
}

async function checkSession(cookie?: string) {
  let status = 0;
  let body: { userId: number | null } | null = null;
  let renewedCookie = '';
  const response = {
    setHeader(name: string, value: string) { if (name === 'Set-Cookie') renewedCookie = value; return this; },
    status(code: number) { status = code; return this; },
    json(value: { userId: number | null }) { body = value; return this; },
  } as unknown as VercelResponse;
  await completeAuth({ method: 'POST', body: { action: 'session_status' }, headers: { cookie, host: 'localhost' } } as unknown as VercelRequest, response);
  return { status, body: body as { userId: number | null } | null, renewedCookie };
}

test('valid old 30-day session renews for 60 days without OAuth or database access', async () => {
  const previous = process.env.APP_SESSION_SECRET;
  process.env.APP_SESSION_SECRET = secret;
  try {
    const result = await checkSession(signedCookie(42, Date.now() + 2 * day));
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { userId: 42 });
    assert.match(result.renewedCookie, /Max-Age=5184000/);
    const renewed = verifyAppSessionCookie(result.renewedCookie, secret);
    assert.equal(renewed?.userId, 42);
    assert.ok(renewed && renewed.exp > Date.now() + 59 * day);
  } finally {
    if (previous === undefined) delete process.env.APP_SESSION_SECRET;
    else process.env.APP_SESSION_SECRET = previous;
  }
});

test('expired, missing, and tampered sessions cannot renew', async () => {
  const previous = process.env.APP_SESSION_SECRET;
  process.env.APP_SESSION_SECRET = secret;
  try {
    for (const cookie of [signedCookie(42, Date.now() - day), undefined, `${signedCookie(42, Date.now() + day)}x`]) {
      const result = await checkSession(cookie);
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, { userId: null });
      assert.equal(result.renewedCookie, '');
    }
  } finally {
    if (previous === undefined) delete process.env.APP_SESSION_SECRET;
    else process.env.APP_SESSION_SECRET = previous;
  }
});
