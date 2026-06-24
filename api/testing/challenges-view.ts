import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  checkChppChallengeable,
  parseChppRequestOptionsFromQuery,
  viewChppChallenges,
} from '../_lib/chpp-challenges.js';
import { rejectIfTestingDisabled } from './_lib/guard.js';
import { resolveTestingManager } from './_lib/manager-context.js';
import { respondWithChppResult } from './_lib/respond.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (rejectIfTestingDisabled(res)) return;

  const context = await resolveTestingManager(req);
  if ('error' in context) return res.status(400).json({ error: context.error });

  const teamIdRaw = req.query.teamId;
  const teamId = teamIdRaw ? Number(Array.isArray(teamIdRaw) ? teamIdRaw[0] : teamIdRaw) : undefined;
  const isWeekendFriendly = Number(req.query.isWeekendFriendly ?? 0) === 1 ? 1 : 0;
  const requestOptions = parseChppRequestOptionsFromQuery(req.query);

  try {
    const result = await viewChppChallenges({
      consumerKey: context.consumerKey,
      consumerSecret: context.consumerSecret,
      oauthToken: context.credentials.oauth_token,
      oauthTokenSecret: context.credentials.oauth_token_secret,
      teamId: Number.isFinite(teamId) ? teamId : undefined,
      isWeekendFriendly,
      requestOptions,
    });

    const hasPermission =
      result.parsed.errorCode === undefined ||
      result.parsed.errorCode === 0 ||
      !/permission|scope|manage_challenges/i.test(result.parsed.errorMessage || result.rawXml);

    return respondWithChppResult(req, res, {
      label: 'challenges-view',
      params: result.params,
      httpStatus: result.httpStatus,
      rawXml: result.rawXml,
      requestUrl: result.requestUrl,
      requestQuery: result.requestQuery,
      parsed: {
        ...result.parsed,
        requestOptions,
        likelyHasManageChallenges: hasPermission,
        hint:
          result.parsed.errorCode === 0
            ? 'CHPP challenges view succeeded. manage_challenges likely works.'
            : 'Inspect rawXml. Permission errors usually mention scope or access.',
      },
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'CHPP challenges view failed.',
    });
  }
}
