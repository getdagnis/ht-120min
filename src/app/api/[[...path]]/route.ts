import type { NextRequest } from 'next/server';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import appHandler from '../../../server/api/app.js';
import homeSnapshotHandler from '../../../server/api/home-snapshot.js';
import authInitHandler from '../../../server/api/auth/init.js';
import authCallbackHandler from '../../../server/api/auth/callback.js';
import authCompleteHandler from '../../../server/api/auth/complete.js';
import liveMatchesHandler from '../../../server/api/chpp/live-matches.js';
import publishHandler from '../../../server/api/matchmaker/publish.js';
import sendChallengeHandler from '../../../server/api/matchmaker/send-challenge.js';
import showInterestHandler from '../../../server/api/matchmaker/show-interest.js';
import matchmakerTeamsHandler from '../../../server/api/matchmaker/teams.js';
import teamInfoHandler from '../../../server/api/teams/info.js';
import refreshFixturesHandler from '../../../server/api/teams/refresh-fixtures.js';
import testingHandler from '../../../server/api/testing/index.js';
import forgeMatchesHandler from '../../../server/api/forge/matches.js';
import { invalidatePublicTournament } from '../../../server/api/_lib/tournament-cache.js';

const cookieHeaderToObject = (value: string | null) => {
  const cookies: Record<string, string> = {};
  for (const part of value?.split(';') ?? []) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    cookies[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
  }
  return cookies;
};

const queryToObject = (request: NextRequest) => {
  const query: Record<string, string | string[]> = {};
  request.nextUrl.searchParams.forEach((value, key) => {
    const current = query[key];
    query[key] = current === undefined ? value : Array.isArray(current) ? [...current, value] : [current, value];
  });
  return query;
};

function selectHandler(request: NextRequest, query: Record<string, string | string[]>) {
  const segments = request.nextUrl.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const key = segments.join('/');

  switch (key) {
    case 'public-data/home/refresh':
      return homeSnapshotHandler;
    case 'app':
      return appHandler;
    case 'presence':
      query.route = 'presence';
      return appHandler;
    case 'tournaments/history':
      query.route = 'history';
      return appHandler;
    case 'activity':
      query.route = 'activity';
      return appHandler;
    case 'forge/stats':
      query.route = 'forge-stats';
      return appHandler;
    case 'forge/matches':
      return forgeMatchesHandler;
    case 'auth/init':
      return authInitHandler;
    case 'auth/callback':
      return authCallbackHandler;
    case 'auth/complete':
      return authCompleteHandler;
    case 'chpp/live-matches':
      return liveMatchesHandler;
    case 'matchmaker/publish':
      return publishHandler;
    case 'matchmaker/send-challenge':
      return sendChallengeHandler;
    case 'matchmaker/show-interest':
      return showInterestHandler;
    case 'matchmaker/teams':
      return matchmakerTeamsHandler;
    case 'teams/info':
      return teamInfoHandler;
    case 'teams/refresh-fixtures':
      return refreshFixturesHandler;
    case 'testing':
      return testingHandler;
    default:
      if (key.startsWith('testing/')) {
        query.tool ||= key.slice('testing/'.length);
        return testingHandler;
      }
      return null;
  }
}

async function invoke(request: NextRequest) {
  const query = queryToObject(request);
  const handler = selectHandler(request, query);
  if (!handler) return Response.json({ error: 'API route not found.' }, { status: 404 });

  const contentType = request.headers.get('content-type') || '';
  let body: unknown;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const rawBody = await request.text();
    if (contentType.includes('application/json') && rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        return Response.json({ error: 'Invalid JSON request body.' }, { status: 400 });
      }
    } else {
      body = rawBody || undefined;
    }
  }

  let statusCode = 200;
  let payload: unknown;
  let redirected = false;
  const responseHeaders = new Headers();
  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(value: unknown) {
      payload = value;
      responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
      return response;
    },
    send(value: unknown) {
      payload = value;
      return response;
    },
    end(value?: unknown) {
      if (value !== undefined) payload = value;
      return response;
    },
    redirect(statusOrUrl: number | string, maybeUrl?: string) {
      statusCode = typeof statusOrUrl === 'number' ? statusOrUrl : 307;
      responseHeaders.set('Location', typeof statusOrUrl === 'string' ? statusOrUrl : maybeUrl || '/');
      redirected = true;
      return response;
    },
    setHeader(name: string, value: string | string[]) {
      if (name.toLowerCase() === 'set-cookie') {
        responseHeaders.delete('Set-Cookie');
        for (const cookie of Array.isArray(value) ? value : [value]) {
          responseHeaders.append('Set-Cookie', cookie);
        }
        return response;
      }

      responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
      return response;
    },
  } as unknown as VercelResponse;

  const legacyRequest = {
    method: request.method,
    url: `${request.nextUrl.pathname}${request.nextUrl.search}`,
    query,
    body,
    headers: Object.fromEntries(request.headers.entries()),
    cookies: cookieHeaderToObject(request.headers.get('cookie')),
  } as unknown as VercelRequest;

  await handler(legacyRequest, response);

  // Existing handlers enforce their own authorization. Purge only successful
  // tournament writes, including CHPP final results, before replying to callers.
  const result = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const mutationRoutes = new Set([
    'update-hfi-ranks', 'refresh-spotlight-profiles', 'generate-length-schedule', 'repair-length-round', 'recover-length-round-one',
    'save-length-results', 'tournament-participation', 'season-slot-replacement', 'reserve-team-swap',
    'reserve-team-fill', 'move-inactive-team-to-reserve', 'reset-season-to-planning', 'archive-tournament',
    'scheduled-team-removal', 'admin-team-reserve-transition', 'admin-add-reserve-team', 'reserve-teams',
    'backfill-round-matchdetails',
  ]);
  const path = request.nextUrl.pathname;
  const finishedLiveResult = path === '/api/chpp/live-matches' && result.results &&
    Object.values(result.results).some((value) => value && typeof value === 'object' && 'status' in value && value.status === 'finished');
  const isMutation =
    (path === '/api/app' && request.method !== 'GET' && mutationRoutes.has(String(query.route))) ||
    (path === '/api/teams/refresh-fixtures' && input.dryRun !== true &&
      !['suggest_ht_matches', 'team_planning_statuses'].includes(String(input.action))) || finishedLiveResult ||
    (path === '/api/matchmaker/teams' && Boolean(query.managerId)) ||
    (path === '/api/auth/complete' && (Boolean(result.tournamentId) || Array.isArray(result.tournamentIds))) ||
    (path.startsWith('/api/testing') && query.apply === '1' && query.tool === 'round-press-matchdetails-backfill');
  const affectedId = input.tournamentId || input.tournament_id || query.tournamentId || query.tournament_id || result.tournamentId;
  const affectedIds = Array.from(new Set([
    ...(Array.isArray(result.tournamentIds) ? result.tournamentIds.filter((id): id is string => typeof id === 'string') : []),
    ...(typeof affectedId === 'string' ? [affectedId] : []),
  ]));
  if (isMutation && affectedIds.length && ((statusCode >= 200 && statusCode < 300) || result.resultsSaved)) {
    try {
      await Promise.all(affectedIds.map(invalidatePublicTournament));
    } catch (error) {
      // A cache failure must not turn a completed registration/write into an
      // apparent failure and invite duplicate submissions. TTL is the fallback.
      console.error('Tournament cache invalidation failed:', error);
      responseHeaders.set('X-Tournament-Cache', 'invalidation-failed');
    }
  }

  if (redirected) return new Response(null, { status: statusCode, headers: responseHeaders });
  if (payload === undefined) return new Response(null, { status: statusCode, headers: responseHeaders });

  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return new Response(serialized, { status: statusCode, headers: responseHeaders });
}

export const GET = invoke;
export const POST = invoke;
export const PUT = invoke;
export const PATCH = invoke;
export const DELETE = invoke;
export const OPTIONS = invoke;
