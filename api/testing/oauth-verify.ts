import type { VercelRequest, VercelResponse } from '@vercel/node';
import { auditManagerCredentials, TESTING_AUTH_EXPLANATION } from './_lib/oauth-audit.js';
import { rejectIfTestingDisabled } from './_lib/guard.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (rejectIfTestingDisabled(res)) return;

  const managerId = Number(req.query.managerId);
  if (!Number.isFinite(managerId)) {
    return res.status(400).json({ error: 'Missing managerId' });
  }

  const audit = await auditManagerCredentials(managerId);

  return res.status(200).json({
    ...audit,
    authModel: TESTING_AUTH_EXPLANATION,
    diagnosis:
      !audit.hasUserTokens
        ? 'No user OAuth tokens in DB for this managerId. Log in via /api/auth/init.'
        : !audit.chppLiveCallOk
          ? 'Tokens exist in DB but live managercompendium call failed — tokens may be expired or revoked.'
          : !audit.identityMatches
            ? `Token belongs to CHPP user ${audit.chppVerifiedUserId}, not requested ${managerId}.`
            : !audit.hasManageChallengesScope
              ? 'Tokens valid but oauth_scope does not include manage_challenges. Re-authorize via /api/auth/init to get a fresh token with the correct scope.'
              : 'User OAuth tokens exist, CHPP confirms identity, and manage_challenges scope is granted.',
  });
}
