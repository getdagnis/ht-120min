import type { VercelResponse } from '@vercel/node';

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
