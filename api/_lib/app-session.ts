import { createHmac, timingSafeEqual } from 'crypto';

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const DEV_FALLBACK_SECRET = 'ht-120min-dev-app-session-secret';

export interface AppSessionPayload {
  userId: number;
  exp: number;
}

export function buildAppSessionCookie(userId: number, secret: string, secure: boolean): string {
  const payload: AppSessionPayload = {
    userId,
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  const cookieParts = [
    `ht_session=${encoded}.${signature}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ];

  if (secure) {
    cookieParts.push('Secure');
  }

  return cookieParts.join('; ');
}

export function verifyAppSessionCookie(cookieHeader: string | undefined, secret: string): AppSessionPayload | null {
  if (!cookieHeader) return null;

  const match = cookieHeader.match(/ht_session=([^;]+)/);
  if (!match) return null;

  const [encoded, signature] = match[1].split('.');
  if (!encoded || !signature) return null;

  const expected = createHmac('sha256', secret).update(encoded).digest('base64url');
  if (expected.length !== signature.length) return null;

  try {
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as AppSessionPayload;
    if (!payload?.userId || !payload?.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getAppSessionSecret(): string | null {
  return process.env.APP_SESSION_SECRET || process.env.CHPP_CONSUMER_SECRET || (process.env.NODE_ENV !== 'production' ? DEV_FALLBACK_SECRET : null);
}
