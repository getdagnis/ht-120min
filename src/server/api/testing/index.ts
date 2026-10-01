import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  checkChppChallengeable,
  parseChppRequestOptionsFromQuery,
  sendChppChallengeDirect,
  viewChppChallenges,
} from '../_lib/chpp-challenges.js';
import { fetchManagerTeamsFromChpp, fetchTeamBookingStatus, getManagerChppCredentials } from '../_lib/matchmaker.js';
import { getSupabase } from '../_lib/supabase.js';
import { getServiceSupabase } from '../_lib/supabase.js';
import { isForgeAdminRequest } from '../_lib/forge-session.js';
import { rejectIfForgeTestingUnauthorized } from './_lib/guard.js';
import { beautifyXml } from './_lib/xml-format.js';
import { getAuthHeader } from '../_lib/chpp-auth.js';
import {
  getFootballScore,
  getPenaltyShootoutScore,
  mapMatchEventDetailsToFixture,
  parseMatchEventDetails,
} from '../_lib/chpp-match-events.js';

function value(req: VercelRequest, key: string) {
  const raw = req.query[key];
  return String(Array.isArray(raw) ? raw[0] : raw || '').trim();
}

function numberValue(req: VercelRequest, key: string) {
  const parsed = Number(value(req, key));
  return Number.isFinite(parsed) ? parsed : null;
}

function bodyRecord(req: VercelRequest): Record<string, unknown> | null {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? (req.body as Record<string, unknown>)
    : null;
}

function requestValue(req: VercelRequest, key: string): unknown {
  return bodyRecord(req)?.[key] ?? req.query[key];
}

function requestString(req: VercelRequest, key: string) {
  const raw = requestValue(req, key);
  if (Array.isArray(raw)) return String(raw[0] ?? '').trim();
  return String(raw ?? '').trim();
}

function requestNumber(req: VercelRequest, key: string) {
  const parsed = Number(requestString(req, key));
  return Number.isFinite(parsed) ? parsed : null;
}

function isLocalRequest(req: VercelRequest) {
  const rawHost = String(req.headers.host || '').toLowerCase();
  const host = rawHost.startsWith('[') ? rawHost.slice(1, rawHost.indexOf(']')) : rawHost.split(':')[0];
  return process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '::1'].includes(host);
}

function rejectIfBatchChallengeNotLocal(req: VercelRequest, res: VercelResponse) {
  if (isLocalRequest(req)) return false;
  res.status(404).json({ error: 'Batch challenge tools are available only from local Forge development.' });
  return true;
}

const MAX_BATCH_CANDIDATES = 25;

interface BatchChallengeInput {
  teamId: number;
  candidateTeamIds: number[];
  matchType: 0 | 1;
  matchPlace: 0 | 1;
  isWeekendFriendly: 0 | 1;
}

function parseCandidateTeamIds(raw: unknown) {
  const values = Array.isArray(raw) ? raw : [raw];
  const tokens = values
    .flatMap((value) => String(value ?? '').split(/[\s,]+/))
    .map((token) => token.trim())
    .filter(Boolean);
  const invalid = tokens.filter((token) => !/^\d+$/.test(token));
  if (invalid.length > 0) throw new Error(`Candidate team IDs must be numbers: ${invalid.slice(0, 3).join(', ')}`);

  const ids = [...new Set(tokens.map((token) => Number(token)).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (ids.length === 0) throw new Error('Enter at least one candidate Hattrick team ID.');
  if (ids.length > MAX_BATCH_CANDIDATES) {
    throw new Error(`Batch challenge is limited to ${MAX_BATCH_CANDIDATES} candidates per run.`);
  }
  return ids;
}

function parseBatchInput(req: VercelRequest): BatchChallengeInput {
  const teamId = requestNumber(req, 'teamId');
  if (!teamId || !Number.isSafeInteger(teamId) || teamId <= 0) throw new Error('Missing sender team ID.');

  const matchType = requestString(req, 'matchType');
  if (matchType && matchType !== 'cup_rules' && matchType !== 'normal') {
    throw new Error('Match type must be cup_rules or normal.');
  }

  const matchPlace = requestString(req, 'matchPlace');
  if (matchPlace && matchPlace !== 'home' && matchPlace !== 'away') {
    throw new Error('Venue must be home or away.');
  }

  const weekendRaw = requestValue(req, 'isWeekendFriendly');
  const isWeekendFriendly = weekendRaw === true || String(weekendRaw ?? '') === '1' ? 1 : 0;
  return {
    teamId,
    candidateTeamIds: parseCandidateTeamIds(requestValue(req, 'candidateTeamIds')),
    matchType: matchType === 'normal' ? 0 : 1,
    matchPlace: matchPlace === 'away' ? 1 : 0,
    isWeekendFriendly,
  };
}

interface ExistingChallenge {
  opponentTeamId: number;
  trainingMatchId?: number;
  isAgreed: boolean;
}

function parseExistingChallenges(xml: string): ExistingChallenge[] {
  const section = xml.match(/<ChallengesByMe>([\s\S]*?)<\/ChallengesByMe>/i)?.[1] || '';
  return [...section.matchAll(/<Challenge>([\s\S]*?)<\/Challenge>/gi)]
    .map((match) => {
      const block = match[1];
      const opponentBlock = block.match(/<Opponent>([\s\S]*?)<\/Opponent>/i)?.[1] || '';
      const opponentTeamId = Number(opponentBlock.match(/<TeamID>(\d+)<\/TeamID>/i)?.[1] || '0');
      const trainingMatchId = Number(block.match(/<TrainingMatchID>(\d+)<\/TrainingMatchID>/i)?.[1] || '0');
      const isAgreed = /<IsAgreed>\s*(true|1)\s*<\/IsAgreed>/i.test(block);
      return {
        opponentTeamId,
        trainingMatchId: trainingMatchId > 0 ? trainingMatchId : undefined,
        isAgreed,
      };
    })
    .filter((challenge) => challenge.opponentTeamId > 0);
}

async function resolveBatchOwner(req: VercelRequest, input: BatchChallengeInput) {
  const context = await resolveManager(req);
  if ('error' in context) return { context, error: context.error } as const;

  const managerTeams = await fetchManagerTeamsFromChpp(
    context.consumerKey,
    context.consumerSecret,
    context.credentials,
    context.managerId,
  );
  const sender = managerTeams.teams.find((team) => team.teamId === input.teamId);
  if (!sender) {
    return {
      context,
      error: 'The selected sender team is not owned by the OAuth-authorized manager.',
    } as const;
  }
  return { context, sender, managerTeams } as const;
}

async function loadBatchPreflight(context: Awaited<ReturnType<typeof resolveManager>> & object, input: BatchChallengeInput) {
  if ('error' in context) throw new Error(context.error);
  const auth = authInput(context);
  if (!auth) throw new Error('CHPP credentials are unavailable.');
  const requestOptions = parseChppRequestOptionsFromQuery({});
  let challengeable: Awaited<ReturnType<typeof checkChppChallengeable>> | null = null;
  let challengeableError: string | undefined;
  try {
    const result = await checkChppChallengeable({
      ...auth,
      teamId: input.teamId,
      suggestedTeamIds: input.candidateTeamIds,
      isWeekendFriendly: input.isWeekendFriendly,
      requestOptions,
    });
    if (result.httpStatus < 200 || result.httpStatus >= 300) {
      challengeableError = `CHPP challengeable preflight failed (${result.httpStatus}).`;
    } else if (result.parsed.errorCode !== undefined && result.parsed.errorCode !== 0) {
      challengeableError = result.parsed.errorMessage || `CHPP challengeable preflight failed (${result.parsed.errorCode}).`;
    } else {
      challengeable = result;
    }
  } catch (error) {
    challengeableError = error instanceof Error ? error.message : 'CHPP challengeable preflight was unavailable.';
  }

  const existing = await viewChppChallenges({
    ...auth,
    teamId: input.teamId,
    isWeekendFriendly: input.isWeekendFriendly,
    requestOptions,
  });
  if (existing.httpStatus < 200 || existing.httpStatus >= 300) {
    throw new Error(`CHPP challenge view failed (${existing.httpStatus}).`);
  }
  if (existing.parsed.errorCode !== undefined && existing.parsed.errorCode !== 0) {
    throw new Error(existing.parsed.errorMessage || `CHPP challenge view failed (${existing.parsed.errorCode}).`);
  }

  const existingByOpponent = new Map(
    parseExistingChallenges(existing.rawXml).map((challenge) => [challenge.opponentTeamId, challenge]),
  );
  const challengeableByTeam = new Map(challengeable?.parsed.teams.map((team) => [team.teamId, team]) || []);
  const candidates = input.candidateTeamIds.map((teamId) => {
    const existingChallenge = existingByOpponent.get(teamId);
    const challengeableTeam = challengeableByTeam.get(teamId);
    const challengeableNow = challengeableTeam?.challengeable ?? null;
    return {
      teamId,
      challengeable: challengeableNow,
      alreadyChallenged: Boolean(existingChallenge),
      existingTrainingMatchId: existingChallenge?.trainingMatchId,
      existingChallengeAgreed: existingChallenge?.isAgreed ?? false,
      reason: existingChallenge
        ? existingChallenge.isAgreed
          ? 'Challenge already accepted.'
          : 'Challenge already sent.'
        : challengeableNow === false
          ? challengeableTeam?.reason || 'CHPP preflight says not challengeable; direct challenge will still be attempted.'
          : challengeableNow === null
            ? 'CHPP challengeable preflight did not return a result; direct challenge will still be attempted.'
            : challengeableTeam?.reason,
      sendable: !existingChallenge,
    };
  });

  return {
    candidates,
    sendableCount: candidates.filter((candidate) => candidate.sendable).length,
    challengeableError,
    challengeableRequestParams: challengeable?.params,
    viewRequestParams: existing.params,
  };
}

function isGlobalChallengeFailure(errorMessage?: string) {
  return /401|403|permission|scope|oauth|authorization|not authorized/i.test(errorMessage || '');
}

async function handleBatchChallenge(req: VercelRequest, res: VercelResponse) {
  const input = parseBatchInput(req);
  const owner = await resolveBatchOwner(req, input);
  if ('error' in owner) return res.status(400).json({ error: owner.error });

  const preflight = await loadBatchPreflight(owner.context, input);
  const phase = requestString(req, 'phase') || 'preview';
  const base = {
    tool: 'challenge-batch',
    phase,
    managerId: owner.context.managerId,
    sender: { teamId: owner.sender.teamId, teamName: owner.sender.teamName },
    settings: {
      matchType: input.matchType === 1 ? 'cup_rules' : 'normal',
      matchPlace: input.matchPlace === 0 ? 'home' : 'away',
      isWeekendFriendly: input.isWeekendFriendly === 1,
    },
    candidates: preflight.candidates,
    sendableCount: preflight.sendableCount,
    warning: 'CHPP challengeable is diagnostic only. The direct CHPP challenge response decides whether each send succeeds. This does not enroll a team in a tournament.',
  };

  if (phase !== 'send') return res.status(200).json(base);
  if (requestString(req, 'confirm') !== '1' && requestValue(req, 'confirm') !== true) {
    return res.status(400).json({ error: 'Confirm the batch side effect before sending.' });
  }

  const results = [];
  let stoppedEarly = false;
  const auth = authInput(owner.context)!;
  for (const candidate of preflight.candidates) {
    if (!candidate.sendable) {
      results.push({ ...candidate, status: 'skipped' as const });
      continue;
    }

    const result = await sendChppChallengeDirect({
      ...auth,
      teamId: input.teamId,
      opponentTeamId: candidate.teamId,
      matchType: input.matchType,
      matchPlace: input.matchPlace,
      isWeekendFriendly: input.isWeekendFriendly,
      requestOptions: parseChppRequestOptionsFromQuery({}),
    });
    results.push({
      ...candidate,
      status: result.success ? ('sent' as const) : ('failed' as const),
      trainingMatchId: result.trainingMatchId,
      error: result.errorMessage,
    });

    if (!result.success && isGlobalChallengeFailure(result.errorMessage)) {
      stoppedEarly = true;
      break;
    }
  }

  return res.status(200).json({
    ...base,
    phase: 'send',
    results,
    sentCount: results.filter((result) => result.status === 'sent').length,
    stoppedEarly,
  });
}

async function resolveManager(req: VercelRequest) {
  const managerId = requestNumber(req, 'managerId') ?? numberValue(req, 'managerId');
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
      { id: 'challenge-batch', label: 'Batch challenge rescue', sideEffect: true, localOnly: true },
      { id: 'round-press-matchdetails-backfill', label: 'Round press MatchDetails backfill', sideEffect: true },
    ],
  };
}

async function handleRoundPressMatchDetailsBackfill(req: VercelRequest, res: VercelResponse) {
  const context = await resolveManager(req);
  if ('error' in context) return res.status(400).json(context);
  const tournamentId = value(req, 'tournamentId');
  const seasonNumber = numberValue(req, 'seasonNumber');
  const roundNumber = numberValue(req, 'roundNumber');
  const apply = value(req, 'apply') === '1';
  if (!tournamentId || !seasonNumber || !roundNumber) {
    return res.status(400).json({ error: 'tournamentId, seasonNumber, and roundNumber are required.' });
  }

  const supabase = getServiceSupabase();
  const { data: round, error: roundError } = await supabase
    .from('rounds')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('season_number', seasonNumber)
    .eq('round_number', roundNumber)
    .maybeSingle();
  if (roundError) throw roundError;
  if (!round) return res.status(404).json({ error: 'Round not found.' });

  const { data: matches, error: matchesError } = await supabase
    .from('matches')
    .select('id, ht_match_id, home_team:teams!matches_home_team_id_fkey(ht_team_id), away_team:teams!matches_away_team_id_fkey(ht_team_id)')
    .eq('round_id', round.id)
    .not('ht_match_id', 'is', null);
  if (matchesError) throw matchesError;
  if (!matches?.length) return res.status(422).json({ error: 'Round has no linked Hattrick matches.' });
  if (matches.length > 10) return res.status(422).json({ error: 'Backfill is limited to ten matches per request.' });

  const url = 'https://chpp.hattrick.org/chppxml.ashx';
  const refreshed = [];
  for (const match of matches) {
    const htMatchId = Number(match.ht_match_id);
    const params = { file: 'matchdetails', version: '3.1', matchID: String(htMatchId), matchEvents: 'true' };
    const authHeader = getAuthHeader('GET', url, params, context.consumerKey, context.consumerSecret, context.credentials.oauth_token, context.credentials.oauth_token_secret);
    const response = await fetch(`${url}?file=matchdetails&version=3.1&matchEvents=true&matchID=${htMatchId}`, { headers: { Authorization: authHeader } });
    const xml = await response.text();
    if (!response.ok || /<Error/i.test(xml)) {
      refreshed.push({ matchId: match.id, htMatchId, refreshed: false, error: 'CHPP MatchDetails was unavailable.' });
      continue;
    }

    const homeTeam = match.home_team as { ht_team_id?: number | null } | null;
    const awayTeam = match.away_team as { ht_team_id?: number | null } | null;
    const details = mapMatchEventDetailsToFixture(
      parseMatchEventDetails(xml),
      typeof homeTeam?.ht_team_id === 'number' ? homeTeam.ht_team_id : null,
      typeof awayTeam?.ht_team_id === 'number' ? awayTeam.ht_team_id : null,
    );
    const footballScore = getFootballScore(details);
    const shootout = getPenaltyShootoutScore(details);
    if (apply) {
      const { error } = await supabase.from('matches').update({
        match_event_details: details,
        home_goals: footballScore?.home ?? null,
        away_goals: footballScore?.away ?? null,
        went_120: details.result?.reached120 ?? false,
        penalty_shootout_home_goals: shootout.home,
        penalty_shootout_away_goals: shootout.away,
      }).eq('id', match.id);
      if (error) throw error;
    }
    refreshed.push({
      matchId: match.id,
      htMatchId,
      refreshed: true,
      persisted: apply,
      version: details.version,
      result: details.result,
    });
  }
  return res.status(200).json({ tool: 'round-press-matchdetails-backfill', tournamentId, seasonNumber, roundNumber, apply, refreshed });
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
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isForgeAdminRequest(req.headers.cookie)) {
    if (rejectIfForgeTestingUnauthorized(req, res)) return;
  }

  const tool = value(req, 'tool').replace(/^\//, '') || 'manifest';
  if (tool === 'challenge-batch' && rejectIfBatchChallengeNotLocal(req, res)) return;
  try {
    switch (tool) {
      case 'credentials-check': return await handleCredentials(req, res);
      case 'challenges-view': return await handleView(req, res);
      case 'challengeable': return await handleChallengeable(req, res);
      case 'challenges-compare': return await handleCompare(req, res);
      case 'booking-status': return await handleBooking(req, res);
      case 'challenge-send': return await handleSend(req, res);
      case 'challenge-batch': return await handleBatchChallenge(req, res);
      case 'round-press-matchdetails-backfill': return await handleRoundPressMatchDetailsBackfill(req, res);
      case 'manifest': return res.status(200).json(manifest());
      default: return res.status(404).json({ error: 'Unknown testing tool.' });
    }
  } catch (error) {
    console.error(`Forge testing tool failed: ${tool}`, error);
    return res.status(502).json({ error: error instanceof Error ? error.message : 'CHPP testing tool failed.' });
  }
}
