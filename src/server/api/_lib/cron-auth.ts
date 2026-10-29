import { createHash, timingSafeEqual } from 'node:crypto';

export function isValidCronBearerToken(authorization: string | undefined, configuredSecret: string | undefined) {
  if (!configuredSecret || configuredSecret.length < 32 || !authorization) return false;
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization.trim());
  if (!match) return false;
  const suppliedHash = createHash('sha256').update(match[1]).digest();
  const configuredHash = createHash('sha256').update(configuredSecret).digest();
  return timingSafeEqual(suppliedHash, configuredHash);
}
