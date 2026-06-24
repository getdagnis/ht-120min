import { getAuthHeader } from './chpp-auth.js';
import { readChppTag } from './chpp-xml.js';

const CHPP_URL = 'https://chpp.hattrick.org/chppxml.ashx';
const DEFAULT_CHALLENGES_VERSION = '1.6';

export type ChppChallengeActionType = 'view' | 'challengeable' | 'challenge' | 'accept' | 'decline' | 'withdraw';
export type ChppChallengeMatchType = 0 | 1;
export type ChppChallengeMatchPlace = 0 | 1 | 2;

export interface ChppChallengesRequestOptions {
  /** Omit version query param entirely when null */
  version?: string | null;
  includeWeekendParam?: boolean;
  teamIdParamName?: 'teamId' | 'teamID';
  suggestedTeamIdsParamName?: 'suggestedTeamIds' | 'suggestedTeamID';
}

export interface ChppChallengesRawResult {
  httpStatus: number;
  rawXml: string;
  params: Record<string, string>;
  requestQuery: string;
  requestUrl: string;
}

export interface ChppChallengesBaseParse {
  errorCode?: number;
  errorMessage?: string;
}

export interface ChppChallengeableTeamResult {
  teamId: number;
  challengeable?: boolean;
  reason?: string;
}

export interface ChppChallengeableParse extends ChppChallengesBaseParse {
  teams: ChppChallengeableTeamResult[];
}

export interface SendChppChallengeInput {
  consumerKey: string;
  consumerSecret: string;
  oauthToken: string;
  oauthTokenSecret: string;
  teamId: number;
  opponentTeamId: number;
  matchType?: ChppChallengeMatchType;
  matchPlace?: ChppChallengeMatchPlace;
  isWeekendFriendly?: 0 | 1;
  requestOptions?: ChppChallengesRequestOptions;
}

export interface SendChppChallengeResult {
  success: boolean;
  trainingMatchId?: number;
  errorCode?: number;
  errorMessage?: string;
  rawXml?: string;
  requestUrl?: string;
  requestQuery?: string;
  challengeable?: ChppChallengeableParse;
  skippedChallengeableCheck?: boolean;
}

export function shouldRequireChallengeableCheck(): boolean {
  return process.env.CHPP_REQUIRE_CHALLENGEABLE_CHECK === 'true';
}

export function mapAdMatchTypeToChpp(matchType: string): ChppChallengeMatchType {
  return matchType === '120min' ? 1 : 0;
}

export function mapAdHomeAwayToChppMatchPlace(homeAway: string): ChppChallengeMatchPlace {
  if (homeAway === 'home') return 1;
  if (homeAway === 'away') return 0;
  return 0;
}

export function parseChppBaseResponse(xml: string): ChppChallengesBaseParse {
  const errorCodeRaw = xml.match(/<ErrorCode>(\d+)<\/ErrorCode>/i)?.[1];
  const errorCode = errorCodeRaw ? parseInt(errorCodeRaw, 10) : undefined;
  const errorMessage =
    readChppTag(xml, 'ErrorMessage') ||
    readChppTag(xml, 'Error') ||
    (errorCode !== undefined && errorCode !== 0 ? `CHPP returned error code ${errorCode}` : undefined);

  return { errorCode, errorMessage };
}

function parseBooleanTag(value?: string): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return undefined;
}

export function parseChallengeableResponse(xml: string): ChppChallengeableParse {
  const base = parseChppBaseResponse(xml);
  const teams: ChppChallengeableTeamResult[] = [];

  for (const blockMatch of xml.matchAll(/<SuggestedTeam>([\s\S]*?)<\/SuggestedTeam>/gi)) {
    const block = blockMatch[1];
    const teamIdRaw = block.match(/<TeamID>(\d+)<\/TeamID>/i)?.[1];
    if (!teamIdRaw) continue;

    const challengeableRaw =
      readChppTag(block, 'Challengeable') ||
      readChppTag(block, 'IsChallengeable') ||
      readChppTag(block, 'PossibleToChallenge');

    teams.push({
      teamId: parseInt(teamIdRaw, 10),
      challengeable: parseBooleanTag(challengeableRaw),
      reason: readChppTag(block, 'Reason') || readChppTag(block, 'ErrorMessage'),
    });
  }

  if (teams.length === 0) {
    for (const blockMatch of xml.matchAll(/<Team>([\s\S]*?)<\/Team>/gi)) {
      const block = blockMatch[1];
      const teamIdRaw = block.match(/<TeamID>(\d+)<\/TeamID>/i)?.[1];
      if (!teamIdRaw) continue;

      const challengeableRaw =
        readChppTag(block, 'Challengeable') ||
        readChppTag(block, 'IsChallengeable') ||
        readChppTag(block, 'PossibleToChallenge');

      if (challengeableRaw !== undefined) {
        teams.push({
          teamId: parseInt(teamIdRaw, 10),
          challengeable: parseBooleanTag(challengeableRaw),
          reason: readChppTag(block, 'Reason') || readChppTag(block, 'ErrorMessage'),
        });
      }
    }
  }

  return { ...base, teams };
}

function parseChallengeSendResponse(xml: string, request?: Pick<ChppChallengesRawResult, 'requestUrl' | 'requestQuery'>) {
  const base = parseChppBaseResponse(xml);

  if (base.errorCode !== undefined && base.errorCode !== 0) {
    return {
      success: false as const,
      errorCode: base.errorCode,
      errorMessage: base.errorMessage,
      rawXml: xml,
      requestUrl: request?.requestUrl,
      requestQuery: request?.requestQuery,
    };
  }

  const trainingMatchIdRaw =
    xml.match(/<ChallengesByMe>[\s\S]*?<TrainingMatchID>(\d+)<\/TrainingMatchID>/i)?.[1] ||
    xml.match(/<TrainingMatchID>(\d+)<\/TrainingMatchID>/i)?.[1];

  const trainingMatchId = trainingMatchIdRaw ? parseInt(trainingMatchIdRaw, 10) : undefined;

  if (!trainingMatchId) {
    return {
      success: false as const,
      errorCode: base.errorCode ?? -1,
      errorMessage: base.errorMessage || 'Challenge response did not include a challenge ID.',
      rawXml: xml,
      requestUrl: request?.requestUrl,
      requestQuery: request?.requestQuery,
    };
  }

  return {
    success: true as const,
    trainingMatchId,
    errorCode: 0,
    rawXml: xml,
    requestUrl: request?.requestUrl,
    requestQuery: request?.requestQuery,
  };
}

function resolveRequestOptions(options?: ChppChallengesRequestOptions) {
  return {
    version: options?.version === undefined ? DEFAULT_CHALLENGES_VERSION : options.version,
    includeWeekendParam: options?.includeWeekendParam ?? true,
    teamIdParamName: options?.teamIdParamName ?? 'teamId',
    suggestedTeamIdsParamName: options?.suggestedTeamIdsParamName ?? 'suggestedTeamIds',
  };
}

export async function fetchChppChallengesRaw(input: {
  consumerKey: string;
  consumerSecret: string;
  oauthToken: string;
  oauthTokenSecret: string;
  actionType: ChppChallengeActionType;
  teamId?: number;
  extraParams?: Record<string, string | number | undefined>;
  requestOptions?: ChppChallengesRequestOptions;
}): Promise<ChppChallengesRawResult> {
  const resolved = resolveRequestOptions(input.requestOptions);
  const params: Record<string, string> = {
    file: 'challenges',
    actionType: input.actionType,
  };

  if (resolved.version !== null) {
    params.version = resolved.version;
  }

  if (input.teamId !== undefined) {
    params[resolved.teamIdParamName] = String(input.teamId);
  }

  for (const [key, value] of Object.entries(input.extraParams ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      params[key] = String(value);
    }
  }

  const authHeader = getAuthHeader(
    'GET',
    CHPP_URL,
    params,
    input.consumerKey,
    input.consumerSecret,
    input.oauthToken,
    input.oauthTokenSecret,
  );

  const query = new URLSearchParams(params);
  const requestQuery = query.toString();
  const requestUrl = `${CHPP_URL}?${requestQuery}`;

  if (input.actionType === 'challengeable' || process.env.CHPP_DEBUG === 'true') {
    console.log('[CHPP challenges]', {
      actionType: input.actionType,
      url: requestUrl,
      params,
    });
  }

  const response = await fetch(requestUrl, {
    headers: { Authorization: authHeader },
  });

  const rawXml = await response.text();

  if (input.actionType === 'challengeable' || process.env.CHPP_DEBUG === 'true') {
    console.log('[CHPP challenges response]', {
      actionType: input.actionType,
      httpStatus: response.status,
      bodyPreview: rawXml.slice(0, 500),
    });
  }

  return {
    httpStatus: response.status,
    rawXml,
    params,
    requestQuery,
    requestUrl,
  };
}

export async function viewChppChallenges(input: {
  consumerKey: string;
  consumerSecret: string;
  oauthToken: string;
  oauthTokenSecret: string;
  teamId?: number;
  isWeekendFriendly?: 0 | 1;
  requestOptions?: ChppChallengesRequestOptions;
}): Promise<ChppChallengesRawResult & { parsed: ChppChallengesBaseParse }> {
  const resolved = resolveRequestOptions(input.requestOptions);
  const extraParams: Record<string, string | number | undefined> = {};
  if (resolved.includeWeekendParam) {
    extraParams.isWeekendFriendly = input.isWeekendFriendly ?? 0;
  }

  const raw = await fetchChppChallengesRaw({
    ...input,
    actionType: 'view',
    extraParams,
    requestOptions: input.requestOptions,
  });

  return { ...raw, parsed: parseChppBaseResponse(raw.rawXml) };
}

export async function checkChppChallengeable(input: {
  consumerKey: string;
  consumerSecret: string;
  oauthToken: string;
  oauthTokenSecret: string;
  teamId: number;
  suggestedTeamIds: number[];
  isWeekendFriendly?: 0 | 1;
  requestOptions?: ChppChallengesRequestOptions;
}): Promise<ChppChallengesRawResult & { parsed: ChppChallengeableParse }> {
  const resolved = resolveRequestOptions(input.requestOptions);
  const extraParams: Record<string, string | number | undefined> = {
    [resolved.suggestedTeamIdsParamName]: input.suggestedTeamIds.join(','),
  };
  if (resolved.includeWeekendParam) {
    extraParams.isWeekendFriendly = input.isWeekendFriendly ?? 0;
  }

  const raw = await fetchChppChallengesRaw({
    ...input,
    actionType: 'challengeable',
    teamId: input.teamId,
    extraParams,
    requestOptions: input.requestOptions,
  });

  return { ...raw, parsed: parseChallengeableResponse(raw.rawXml) };
}

export function isOpponentChallengeable(
  parsed: ChppChallengeableParse,
  opponentTeamId: number,
): { ok: boolean; reason?: string } {
  if (parsed.errorCode !== undefined && parsed.errorCode !== 0) {
    return { ok: false, reason: parsed.errorMessage || `CHPP error ${parsed.errorCode}` };
  }

  const entry = parsed.teams.find((team) => team.teamId === opponentTeamId);
  if (!entry) {
    return {
      ok: false,
      reason:
        'CHPP challengeable response did not include the opponent team. Inspect raw XML via /api/testing/challengeable.',
    };
  }

  if (entry.challengeable === false) {
    return { ok: false, reason: entry.reason || 'Opponent is not challengeable right now.' };
  }

  if (entry.challengeable === true) {
    return { ok: true };
  }

  return {
    ok: false,
    reason:
      'Could not determine challengeability from CHPP XML. Inspect raw XML via /api/testing/challengeable before sending.',
  };
}

export async function sendChppChallengeDirect(input: SendChppChallengeInput): Promise<SendChppChallengeResult> {
  const resolved = resolveRequestOptions(input.requestOptions);
  const extraParams: Record<string, string | number | undefined> = {
    opponentTeamId: input.opponentTeamId,
    matchType: input.matchType ?? 0,
    matchPlace: input.matchPlace ?? 0,
  };
  if (resolved.includeWeekendParam) {
    extraParams.isWeekendFriendly = input.isWeekendFriendly ?? 0;
  }

  const raw = await fetchChppChallengesRaw({
    consumerKey: input.consumerKey,
    consumerSecret: input.consumerSecret,
    oauthToken: input.oauthToken,
    oauthTokenSecret: input.oauthTokenSecret,
    actionType: 'challenge',
    teamId: input.teamId,
    extraParams,
    requestOptions: input.requestOptions,
  });

  if (raw.httpStatus < 200 || raw.httpStatus >= 300) {
    return {
      success: false,
      errorMessage: `CHPP challenges request failed (${raw.httpStatus})`,
      rawXml: raw.rawXml,
      requestUrl: raw.requestUrl,
      requestQuery: raw.requestQuery,
      skippedChallengeableCheck: !shouldRequireChallengeableCheck(),
    };
  }

  return {
    ...parseChallengeSendResponse(raw.rawXml, raw),
    skippedChallengeableCheck: !shouldRequireChallengeableCheck(),
  };
}

export async function sendChppChallenge(input: SendChppChallengeInput): Promise<SendChppChallengeResult> {
  if (!shouldRequireChallengeableCheck()) {
    return sendChppChallengeDirect(input);
  }

  const challengeable = await checkChppChallengeable({
    consumerKey: input.consumerKey,
    consumerSecret: input.consumerSecret,
    oauthToken: input.oauthToken,
    oauthTokenSecret: input.oauthTokenSecret,
    teamId: input.teamId,
    suggestedTeamIds: [input.opponentTeamId],
    isWeekendFriendly: input.isWeekendFriendly ?? 0,
    requestOptions: input.requestOptions,
  });

  const challengeableCheck = isOpponentChallengeable(challengeable.parsed, input.opponentTeamId);
  if (!challengeableCheck.ok) {
    return {
      success: false,
      errorCode: challengeable.parsed.errorCode,
      errorMessage: challengeableCheck.reason,
      rawXml: challengeable.rawXml,
      requestUrl: challengeable.requestUrl,
      requestQuery: challengeable.requestQuery,
      challengeable: challengeable.parsed,
      skippedChallengeableCheck: false,
    };
  }

  const result = await sendChppChallengeDirect(input);
  return { ...result, challengeable: challengeable.parsed, skippedChallengeableCheck: false };
}

export function parseChppRequestOptionsFromQuery(query: Record<string, string | string[] | undefined>): ChppChallengesRequestOptions {
  const read = (key: string) => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const versionRaw = read('version');
  const omitVersion = read('omitVersion') === '1';
  const omitWeekend = read('omitWeekend') === '1';
  const teamIdParamName = read('teamIdParam') === 'teamID' ? 'teamID' : 'teamId';
  const suggestedTeamIdsParamName =
    read('suggestedParam') === 'suggestedTeamID' ? 'suggestedTeamID' : 'suggestedTeamIds';

  let version: string | null | undefined = DEFAULT_CHALLENGES_VERSION;
  if (omitVersion || versionRaw === 'none') {
    version = null;
  } else if (versionRaw) {
    version = versionRaw;
  }

  return {
    version,
    includeWeekendParam: !omitWeekend,
    teamIdParamName,
    suggestedTeamIdsParamName,
  };
}
