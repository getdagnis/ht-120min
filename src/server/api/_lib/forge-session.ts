import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const FORGE_COOKIE = 'forge_session';
const FORGE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

interface ForgeSessionPayload {
  userId: number;
  exp: number;
}

function getForgeSecret() {
  return process.env.APP_SESSION_SECRET || null;
}

export function getForgeSuperadminId() {
  // VITE_* values are public browser configuration and must never authorize Forge in production.
  const raw =
    process.env.FORGE_SUPERADMIN_HT_ID ||
    process.env.ADMIN_HT_ID ||
    (process.env.NODE_ENV !== 'production' ? process.env.VITE_ADMIN_HT_ID : '') ||
    '';
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function buildForgeSessionCookie(userId: number, secure: boolean) {
  const secret = getForgeSecret();
  if (!secret) throw new Error('APP_SESSION_SECRET is missing');

  const payload: ForgeSessionPayload = { userId, exp: Date.now() + FORGE_MAX_AGE_SECONDS * 1000 };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return [
    `${FORGE_COOKIE}=${encoded}.${signature}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${FORGE_MAX_AGE_SECONDS}`,
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

export function clearForgeSessionCookie(secure: boolean) {
  return [
    `${FORGE_COOKIE}=`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=0',
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

export function verifyForgeSessionCookie(cookieHeader: string | undefined) {
  const secret = getForgeSecret();
  if (!secret || !cookieHeader) return null;

  const match = cookieHeader.match(new RegExp(`${FORGE_COOKIE}=([^;]+)`));
  if (!match) return null;

  const [encoded, signature] = match[1].split('.');
  if (!encoded || !signature) return null;
  const expected = createHmac('sha256', secret).update(encoded).digest('base64url');
  if (expected.length !== signature.length) return null;

  try {
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as ForgeSessionPayload;
    const adminId = getForgeSuperadminId();
    if (!adminId || payload.userId !== adminId || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function isForgeAdminRequest(cookieHeader: string | undefined) {
  return Boolean(verifyForgeSessionCookie(cookieHeader));
}

export function createVisitorId() {
  return randomBytes(18).toString('base64url');
}
