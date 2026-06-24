import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  checkChppChallengeable,
  parseChppRequestOptionsFromQuery,
  viewChppChallenges,
  type ChppChallengesRequestOptions,
} from '../_lib/chpp-challenges.js';
import { rejectIfTestingDisabled } from './_lib/guard.js';
import { resolveTestingManager } from './_lib/manager-context.js';
import { beautifyXml } from './_lib/xml-format.js';

const VARIANTS: Array<{ label: string; requestOptions: ChppChallengesRequestOptions }> = [
  { label: 'view-default', requestOptions: {} },
  { label: 'challengeable-default', requestOptions: {} },
  { label: 'challengeable-no-version', requestOptions: { version: null } },
  { label: 'challengeable-no-weekend', requestOptions: { includeWeekendParam: false } },
  { label: 'challengeable-teamID-casing', requestOptions: { teamIdParamName: 'teamID' } },
  {
    label: 'challengeable-suggestedTeamID',
    requestOptions: { suggestedTeamIdsParamName: 'suggestedTeamID' },
  },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (rejectIfTestingDisabled(res)) return;

  const context = await resolveTestingManager(req);
  if ('error' in context) return res.status(400).json({ error: context.error });

  const teamId = Number(req.query.teamId);
  const opponentTeamId = Number(req.query.opponentTeamId);
  const isWeekendFriendly = Number(req.query.isWeekendFriendly ?? 0) === 1 ? 1 : 0;
  const baseOptions = parseChppRequestOptionsFromQuery(req.query);

  if (!Number.isFinite(teamId) || !Number.isFinite(opponentTeamId)) {
    return res.status(400).json({ error: 'Missing teamId and opponentTeamId.' });
  }

  const auth = {
    consumerKey: context.consumerKey,
    consumerSecret: context.consumerSecret,
    oauthToken: context.credentials.oauth_token,
    oauthTokenSecret: context.credentials.oauth_token_secret,
  };

  const runs: Array<Record<string, unknown>> = [];

  for (const variant of VARIANTS) {
    const requestOptions = { ...baseOptions, ...variant.requestOptions };

    if (variant.label.startsWith('view')) {
      const result = await viewChppChallenges({
        ...auth,
        teamId,
        isWeekendFriendly,
        requestOptions,
      });
      runs.push({
        variant: variant.label,
        httpStatus: result.httpStatus,
        requestUrl: result.requestUrl,
        requestParams: result.params,
        parsed: result.parsed,
        rawXmlPreview: result.rawXml.slice(0, 400),
        rawXmlFormatted: beautifyXml(result.rawXml),
      });
      continue;
    }

    const result = await checkChppChallengeable({
      ...auth,
      teamId,
      suggestedTeamIds: [opponentTeamId],
      isWeekendFriendly,
      requestOptions,
    });

    runs.push({
      variant: variant.label,
      httpStatus: result.httpStatus,
      requestUrl: result.requestUrl,
      requestParams: result.params,
      parsed: result.parsed,
      rawXmlPreview: result.rawXml.slice(0, 400),
      rawXmlFormatted: beautifyXml(result.rawXml),
    });
  }

  return res.status(200).json({
    tool: 'challenges-compare',
    managerId: context.managerId,
    teamId,
    opponentTeamId,
    hint: 'Compare requestUrl and httpStatus across variants. Check server logs for [CHPP challenges] lines.',
    runs,
  });
}
