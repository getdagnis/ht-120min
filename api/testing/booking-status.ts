import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchTeamBookingStatus } from '../_lib/matchmaker.js';
import { rejectIfTestingDisabled } from './_lib/guard.js';
import { resolveTestingManager } from './_lib/manager-context.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (rejectIfTestingDisabled(res)) return;

  const context = await resolveTestingManager(req);
  if ('error' in context) return res.status(400).json({ error: context.error });

  const teamId = Number(req.query.teamId);
  if (!Number.isFinite(teamId)) {
    return res.status(400).json({ error: 'Missing teamId' });
  }

  try {
    const booking = await fetchTeamBookingStatus(
      context.consumerKey,
      context.consumerSecret,
      context.credentials,
      teamId,
    );

    return res.status(200).json({
      teamId,
      isBooked: booking.isBooked,
      match: booking.match,
      hint: booking.isBooked
        ? 'Team has an upcoming booked friendly — challenge testing may fail until the slot clears.'
        : 'No booked friendly detected via matches feed.',
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Booking status check failed.',
    });
  }
}
