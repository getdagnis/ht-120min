import type { VercelRequest, VercelResponse } from '@vercel/node';
import { REAL_BOOKING_CONFIRMATION } from '../_lib/auto-booking-worker.js';
import { isValidCronBearerToken } from '../_lib/cron-auth.js';
import { runAutoBookingWorker } from '../forge/matches.js';

function headerValue(req: VercelRequest, name: string) {
  const value = req.headers[name] ?? req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const configuredSecret = process.env.AUTO_BOOKING_CRON_SECRET;
  if (!configuredSecret || configuredSecret.length < 32) {
    return res.status(503).json({ error: 'Cron authentication is not configured.' });
  }
  if (!isValidCronBearerToken(headerValue(req, 'authorization'), configuredSecret)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'A JSON request body is required.' });
  }
  const requestedMode = req.body.mode === 'real' ? 'real' : 'dry_run';
  if (requestedMode === 'real' && process.env.AUTO_BOOKING_CRON_LIVE_ENABLED !== 'true') {
    return res.status(409).json({ error: 'Live booking is disabled for the cron endpoint.' });
  }

  const workerRequest = {
    ...req,
    body: {
      ...req.body,
      action: 'run-auto-booking-worker',
      mode: requestedMode,
      ...(requestedMode === 'real' ? { confirmRealChpp: REAL_BOOKING_CONFIRMATION } : {}),
    },
  } as VercelRequest;

  try {
    return await runAutoBookingWorker(workerRequest, res);
  } catch (error) {
    console.error('Auto-booking cron request failed:', error);
    return res.status(500).json({ error: 'Auto-booking worker failed.' });
  }
}
