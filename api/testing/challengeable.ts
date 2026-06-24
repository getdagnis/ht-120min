import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  checkChppChallengeable,
  parseChppRequestOptionsFromQuery,
} from '../_lib/chpp-challenges.js';
import { rejectIfTestingDisabled } from './_lib/guard.js';
import { resolveTestingManager } from './_lib/manager-context.js';
import { respondWithChppResult } from './_lib/respond.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (rejectIfTestingDisabled(res)) return;

  const context = await resolveTestingManager(req);
  if ('error' in context) return res.status(400).json({ error: context.error });

  const teamId = Number(req.query.teamId);
  const opponentTeamId = Number(req.query.opponentTeamId);
  const isWeekendFriendly = Number(req.query.isWeekendFriendly ?? 0) === 1 ? 1 : 0;
  const requestOptions = parseChppRequestOptionsFromQuery(req.query);

  if (!Number.isFinite(teamId)) {
    return res.status(400).json({ error: 'Missing teamId (your challenging team).' });
  }
  if (!Number.isFinite(opponentTeamId)) {
    return res.status(400).json({ error: 'Missing opponentTeamId.' });
  }

  try {
    const result = await checkChppChallengeable({
      consumerKey: context.consumerKey,
      consumerSecret: context.consumerSecret,
      oauthToken: context.credentials.oauth_token,
      oauthTokenSecret: context.credentials.oauth_token_secret,
      teamId,
      suggestedTeamIds: [opponentTeamId],
      isWeekendFriendly,
      requestOptions,
    });

    return respondWithChppResult(req, res, {
      label: 'challengeable',
      params: result.params,
      httpStatus: result.httpStatus,
      rawXml: result.rawXml,
      requestUrl: result.requestUrl,
      requestQuery: result.requestQuery,
      parsed: {
        ...result.parsed,
        requestOptions,
        hint:
          result.httpStatus === 401
            ? '401 here while view works often means params/version mismatch — try /api/testing/challenges-compare or version=none.'
            : 'Save rawXml to docs/challenges.challengeable.example.xml once captured.',
      },
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'CHPP challengeable check failed.',
    });
  }
}
