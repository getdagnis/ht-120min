import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendChppChallenge, sendChppChallengeDirect, parseChppRequestOptionsFromQuery } from '../_lib/chpp-challenges.js';
import { rejectIfTestingDisabled } from './_lib/guard.js';
import { resolveTestingManager } from './_lib/manager-context.js';
import { getResponseFormat, wantsRawXml } from './_lib/respond.js';
import { beautifyXml, renderTestingHtmlPage } from './_lib/xml-format.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (rejectIfTestingDisabled(res)) return;

  const context = await resolveTestingManager(req);
  if ('error' in context) return res.status(400).json({ error: context.error });

  const teamId = Number(req.query.teamId);
  const opponentTeamId = Number(req.query.opponentTeamId);
  const matchType = Number(req.query.matchType ?? 1) === 1 ? 1 : 0;
  const matchPlace = Number(req.query.matchPlace ?? 0);
  const confirm = String(req.query.confirm ?? '') === '1';

  if (!Number.isFinite(teamId) || !Number.isFinite(opponentTeamId)) {
    return res.status(400).json({ error: 'Missing teamId and opponentTeamId.' });
  }

  if (!confirm) {
    return res.status(400).json({
      error: 'Refusing to send a real challenge without confirm=1.',
      hint: 'Direct CHPP challenge (challengeable check skipped unless CHPP_REQUIRE_CHALLENGEABLE_CHECK=true).',
      dryRunParams: { teamId, opponentTeamId, matchType, matchPlace },
    });
  }

  const requestOptions = parseChppRequestOptionsFromQuery(req.query);
  const useDirect = req.query.useDirect !== '0';

  try {
    const challengeInput = {
      consumerKey: context.consumerKey,
      consumerSecret: context.consumerSecret,
      oauthToken: context.credentials.oauth_token,
      oauthTokenSecret: context.credentials.oauth_token_secret,
      teamId,
      opponentTeamId,
      matchType: matchType as 0 | 1,
      matchPlace: matchPlace as 0 | 1 | 2,
      requestOptions,
    };

    const result = useDirect
      ? await sendChppChallengeDirect(challengeInput)
      : await sendChppChallenge(challengeInput);

    if (wantsRawXml(req) && result.rawXml) {
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      return res.status(result.success ? 200 : 502).send(beautifyXml(result.rawXml));
    }

    if (getResponseFormat(req) === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(result.success ? 200 : 502).send(
        renderTestingHtmlPage({
          title: 'challenge-send',
          subtitle: result.success
            ? `Challenge sent. TrainingMatchID: ${result.trainingMatchId ?? 'unknown'}`
            : result.errorMessage || 'Challenge failed',
          parsed: {
            success: result.success,
            trainingMatchId: result.trainingMatchId,
            errorCode: result.errorCode,
            challengeable: result.challengeable,
            skippedChallengeableCheck: result.skippedChallengeableCheck,
            requestUrl: result.requestUrl,
            requestQuery: result.requestQuery,
          },
          rawXml: result.rawXml,
        }),
      );
    }

    return res.status(result.success ? 200 : 502).json({
      tool: 'challenge-send',
      success: result.success,
      trainingMatchId: result.trainingMatchId,
      errorCode: result.errorCode,
      error: result.errorMessage,
      challengeable: result.challengeable,
      skippedChallengeableCheck: result.skippedChallengeableCheck,
      requestUrl: result.requestUrl,
      requestQuery: result.requestQuery,
      rawXml: result.rawXml,
      rawXmlFormatted: result.rawXml ? beautifyXml(result.rawXml) : undefined,
      warning: 'This created a real Hattrick challenge side effect.',
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'CHPP challenge send failed.',
    });
  }
}
