import type { VercelRequest, VercelResponse } from '@vercel/node';
import { redirectAuthFailure } from '../_lib/auth-failure.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'HEAD' || req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    const { default: callbackHandler } = await import('../_lib/auth-callback-handler.js');
    return callbackHandler(req, res);
  } catch (error: unknown) {
    return redirectAuthFailure(req, res, 'auth-callback', error);
  }
}
