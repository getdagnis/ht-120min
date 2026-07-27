import type { VercelResponse } from '@vercel/node';
import type { VercelRequest } from '@vercel/node';
import { isForgeAdminRequest } from '../../_lib/forge-session.js';
import { hasSuperAdminBypassCookie } from '../../_lib/superadmin-bypass.js';

export function isTestingEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.TESTING_ENABLED === 'true';
}

export function rejectIfTestingDisabled(res: VercelResponse): boolean {
  if (!isTestingEnabled()) {
    res.status(404).json({
      error: 'Testing tools are disabled. Set NODE_ENV=development or TESTING_ENABLED=true.',
    });
    return true;
  }
  return false;
}

export function rejectIfForgeTestingUnauthorized(req: VercelRequest, res: VercelResponse): boolean {
  if (isForgeAdminRequest(req.headers.cookie) || hasSuperAdminBypassCookie(req.headers.cookie)) return false;
  res.status(401).json({ error: 'Forge authorization required.' });
  return true;
}
