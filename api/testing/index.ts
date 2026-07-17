import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  checkChppChallengeable,
  parseChppRequestOptionsFromQuery,
  sendChppChallengeDirect,
  viewChppChallenges,
} from '../_lib/chpp-challenges.js';
import { fetchManagerTeamsFromChpp, fetchTeamBookingStatus, getManagerChppCredentials } from '../_lib/matchmaker.js';
import { getSupabase } from '../_lib/supabase.js';
import { isForgeAdminRequest } from '../_lib/forge-session.js';
import { rejectIfForgeTestingUnauthorized } from './_lib/guard.js';
import { beautifyXml } from './_lib/xml-format.js';

function value(req: VercelRequest, key: string) {
  const raw = req.query[key];
  return String(Array.isArray(raw) ? raw[0] : raw || '').trim();
}

function numberValue(req: VercelRequest, key: string) {
  const parsed = Number(value(req, key));
  return Number.isFinite(parsed) ? parsed : null;
}

async function resolveManager(req: VercelRequest) {
  const managerId = numberValue(req, 'managerId');
  if (!managerId) return { error: 'Missing managerId.' } as const;
  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) return { error: 'CHPP server configuration is missing.' } as const;
  const credentials = await getManagerChppCredentials(getSupabase(), managerId);
  if (!credentials) return { error: 'No stored OAuth credentials for this manager.' } as const;
  return { managerId, consumerKey, consumerSecret, credentials } as const;
}

function authInput(context: Awaited<ReturnType<typeof resolveManager>>) {
  if ('error' in context) return null;
  return {
    consumerKey: context.consumerKey,
    consumerSecret: context.consumerSecret,
    oauthToken: context.credentials.oauth_token,
    oauthTokenSecret: context.credentials.oauth_token_secret,
  };
}

function manifest() {
  return {
    tools: [
      { id: 'credentials-check', label: 'Credentials check' },
      { id: 'challenges-view', label: 'Challenges view' },
      { id: 'challengeable', label: 'Challengeable check' },
      { id: 'challenges-compare', label: 'Challenges comparison' },
      { id: 'booking-status', label: 'Booking status' },
      { id: 'challenge-send', label: 'Challenge send', sideEffect: true },
    ],
  };
}

async function handleCredentials(req: VercelRequest, res: VercelResponse) {
  const context = await resolveManager(req);
  if ('error' in context) return res.status(400).json(context);
  let teams: Array<{ teamId: number; teamName: string }> = [];
  try {
    const snapshot = await fetchManagerTeamsFromChpp(
      context.consumerKey,
      context.consumerSecret,
      context.credentials,
      context.managerId,
    );
    teams = snapshot.teams.map((team) => ({ teamId: team.teamId, teamName: team.teamName }));
  } catch {
    // Credentials are still useful to inspect even when managercompendium is unavailable.
  }
  return res.status(200).json({
    managerId: context.managerId,
    hasCredentials: true,
    managerName: context.credentials.manager_name,
    teamsFromChpp: teams,
    chppConfigured: true,
  });
}

async function handleView(req: VercelRequest, res: VercelResponse) {
  const context = await resolveManager(req);
  if ('error' in context) return res.status(400).json(context);
  const auth = authInput(context);
  const teamId = numberValue(req, 'teamId');
  const result = await viewChppChallenges({
    ...auth!,
    teamId: teamId || undefined,
    isWeekendFriendly: value(req, 'isWeekendFriendly') === '1' ? 1 : 0,
    requestOptions: parseChppRequestOptionsFromQuery(req.query),
  });
  return res.status(200).json({
    tool: 'challenges-view',
    chppHttpStatus: result.httpStatus,
    requestUrl: result.requestUrl,
    requestParams: result.params,
    parsed: result.parsed,
    rawXml: result.rawXml,
    rawXmlFormatted: beautifyXml(result.rawXml),
  });
}

async function handleChallengeable(req: VercelRequest, res: VercelResponse) {
  const context = await resolveManager(req);
  if ('error' in context) return res.status(400).json(context);
  const teamId = numberValue(req, 'teamId');
  const opponentTeamId = numberValue(req, 'opponentTeamId');
  if (!teamId || !opponentTeamId) return res.status(400).json({ error: 'Missing teamId or opponentTeamId.' });
  const result = await checkChppChallengeable({
    ...authInput(context)!,
    teamId,
    suggestedTeamIds: [opponentTeamId],
    isWeekendFriendly: value(req, 'isWeekendFriendly') === '1' ? 1 : 0,
    requestOptions: parseChppRequestOptionsFromQuery(req.query),
  });
  return res.status(200).json({
    tool: 'challengeable',
    chppHttpStatus: result.httpStatus,
    requestUrl: result.requestUrl,
    requestParams: result.params,
    parsed: result.parsed,
    rawXml: result.rawXml,
    rawXmlFormatted: beautifyXml(result.rawXml),
  });
}

async function handleCompare(req: VercelRequest, res: VercelResponse) {
  const context = await resolveManager(req);
  if ('error' in context) return res.status(400).json(context);
  const teamId = numberValue(req, 'teamId');
  const opponentTeamId = numberValue(req, 'opponentTeamId');
  if (!teamId || !opponentTeamId) return res.status(400).json({ error: 'Missing teamId or opponentTeamId.' });
  const auth = authInput(context)!;
  const isWeekendFriendly = value(req, 'isWeekendFriendly') === '1' ? 1 : 0;
  const variants = [
    { label: 'view-default', kind: 'view' as const, options: {} },
    { label: 'challengeable-default', kind: 'challengeable' as const, options: {} },
    { label: 'challengeable-no-version', kind: 'challengeable' as const, options: { version: null } },
    { label: 'challengeable-no-weekend', kind: 'challengeable' as const, options: { includeWeekendParam: false } },
  ];
  const runs = [];
  for (const variant of variants) {
    const result = variant.kind === 'view'
      ? await viewChppChallenges({ ...auth, teamId, isWeekendFriendly, requestOptions: variant.options })
      : await checkChppChallengeable({
          ...auth,
          teamId,
          suggestedTeamIds: [opponentTeamId],
          isWeekendFriendly,
          requestOptions: variant.options,
        });
    runs.push({
      variant: variant.label,
      httpStatus: result.httpStatus,
      requestUrl: result.requestUrl,
      requestParams: result.params,
      parsed: result.parsed,
      rawXmlFormatted: beautifyXml(result.rawXml),
    });
  }
  return res.status(200).json({ tool: 'challenges-compare', managerId: context.managerId, teamId, opponentTeamId, runs });
}

async function handleBooking(req: VercelRequest, res: VercelResponse) {
  const context = await resolveManager(req);
  if ('error' in context) return res.status(400).json(context);
  const teamId = numberValue(req, 'teamId');
  if (!teamId) return res.status(400).json({ error: 'Missing teamId.' });
  const booking = await fetchTeamBookingStatus(context.consumerKey, context.consumerSecret, context.credentials, teamId);
  return res.status(200).json({
    teamId,
    isBooked: booking.isBooked,
    match: booking.match,
    hint: booking.isBooked ? 'An upcoming friendly is booked for this team.' : 'No booked friendly detected via matches.',
  });
}

async function handleSend(req: VercelRequest, res: VercelResponse) {
  const context = await resolveManager(req);
  if ('error' in context) return res.status(400).json(context);
  const teamId = numberValue(req, 'teamId');
  const opponentTeamId = numberValue(req, 'opponentTeamId');
  if (!teamId || !opponentTeamId) return res.status(400).json({ error: 'Missing teamId or opponentTeamId.' });
  if (value(req, 'confirm') !== '1') {
    return res.status(400).json({ error: 'Confirm the side effect before sending a real CHPP challenge.' });
  }
  const result = await sendChppChallengeDirect({
    ...authInput(context)!,
    teamId,
    opponentTeamId,
    matchType: Number(value(req, 'matchType') || '1') === 1 ? 1 : 0,
    matchPlace: 0,
    requestOptions: parseChppRequestOptionsFromQuery(req.query),
  });
  return res.status(result.success ? 200 : 502).json({
    tool: 'challenge-send',
    success: result.success,
    trainingMatchId: result.trainingMatchId,
    error: result.errorMessage,
    rawXml: result.rawXml,
    rawXmlFormatted: result.rawXml ? beautifyXml(result.rawXml) : undefined,
    warning: 'This created a real Hattrick challenge side effect.',
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!isForgeAdminRequest(req.headers.cookie)) {
    if (rejectIfForgeTestingUnauthorized(req, res)) return;
  }

  const tool = value(req, 'tool').replace(/^\//, '') || 'manifest';
  try {
    switch (tool) {
      case 'credentials-check': return await handleCredentials(req, res);
      case 'challenges-view': return await handleView(req, res);
      case 'challengeable': return await handleChallengeable(req, res);
      case 'challenges-compare': return await handleCompare(req, res);
      case 'booking-status': return await handleBooking(req, res);
      case 'challenge-send': return await handleSend(req, res);
      case 'manifest': return res.status(200).json(manifest());
      default: return res.status(404).json({ error: 'Unknown testing tool.' });
    }
  } catch (error) {
    console.error(`Forge testing tool failed: ${tool}`, error);
    return res.status(502).json({ error: error instanceof Error ? error.message : 'CHPP testing tool failed.' });
  }
}
