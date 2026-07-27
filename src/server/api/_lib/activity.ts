import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'crypto';
import { getAppSessionSecret, verifyAppSessionCookie } from './app-session.js';
import { getServiceSupabase } from './supabase.js';
import { createVisitorId } from './forge-session.js';

const VISITOR_COOKIE = 'ht_visitor';
const VISIT_COOKIE = 'ht_visit';
const RAW_RETENTION_DAYS = 90;

export interface ActivityInput {
  eventType: string;
  route?: string | null;
  tournamentId?: string | null;
  teamId?: string | null;
  metadata?: Record<string, unknown>;
  userId?: number | null;
  managerName?: string | null;
}

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseCookie(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) return null;
  const entry = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? entry.slice(name.length + 1) : null;
}

function parseUserAgent(userAgent: string) {
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Chrome\//.test(userAgent)
      ? 'Chrome'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Safari\//.test(userAgent) && !/Chrome\//.test(userAgent)
          ? 'Safari'
          : /OPR\//.test(userAgent)
            ? 'Opera'
            : 'Other';
  const platform = /iPhone|iPad|iPod/.test(userAgent)
    ? 'iOS'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'Other';
  return { browser, platform };
}

function normalizedReferrer(request: VercelRequest) {
  const value = firstHeader(request.headers.referer) || firstHeader(request.headers.referrer);
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function requestContext(request: VercelRequest) {
  const cookieHeader = request.headers.cookie;
  const visitorId = parseCookie(cookieHeader, VISITOR_COOKIE) || createVisitorId();
  const visitId = parseCookie(cookieHeader, VISIT_COOKIE) || randomUUID();
  const userAgent = firstHeader(request.headers['user-agent']) || '';
  const { browser, platform } = parseUserAgent(userAgent);
  const ip = firstHeader(request.headers['x-forwarded-for'])?.split(',')[0]?.trim() ||
    firstHeader(request.headers['x-real-ip']) || null;
  const appSecret = getAppSessionSecret();
  const session = appSecret ? verifyAppSessionCookie(cookieHeader, appSecret) : null;
  return {
    visitorId,
    visitId,
    session,
    userAgent,
    browser,
    platform,
    ip,
    country: firstHeader(request.headers['x-vercel-ip-country']) || null,
    language: firstHeader(request.headers['accept-language'])?.split(',')[0]?.trim() || null,
    referrer: normalizedReferrer(request),
  };
}

function setTrackingCookies(response: VercelResponse, visitorId: string, visitId: string) {
  response.setHeader('Set-Cookie', [
    `${VISITOR_COOKIE}=${visitorId}; Path=/; Max-Age=${60 * 60 * 24 * 365 * 2}; SameSite=Lax`,
    `${VISIT_COOKIE}=${visitId}; Path=/; Max-Age=${60 * 30}; SameSite=Lax`,
  ]);
}

export async function recordActivity(request: VercelRequest, response: VercelResponse, input: ActivityInput) {
  const context = requestContext(request);
  const supabase = getServiceSupabase();
  let managerName = input.managerName || null;

  if (context.session && !managerName) {
    const { data } = await supabase
      .from('profiles')
      .select('manager_name')
      .eq('hattrick_user_id', context.session.userId)
      .maybeSingle();
    managerName = data?.manager_name || null;
  }

  const { error } = await supabase.from('activity_events').insert({
    visitor_id: context.visitorId,
    visit_id: context.visitId,
    hattrick_user_id: input.userId || context.session?.userId || null,
    manager_name: managerName,
    event_type: input.eventType,
    route: input.route || null,
    tournament_id: input.tournamentId || null,
    team_id: input.teamId || null,
    referrer: context.referrer,
    country_code: context.country,
    language: context.language,
    platform: context.platform,
    browser: context.browser,
    user_agent: context.userAgent || null,
    ip_address: context.ip,
    metadata: input.metadata || {},
  });

  if (error) throw error;

  await supabase.rpc('increment_activity_daily', {
    p_activity_date: new Date().toISOString().slice(0, 10),
    p_event_type: input.eventType,
    p_route: input.route || '',
  });

  setTrackingCookies(response, context.visitorId, context.visitId);
  return { userId: input.userId || context.session?.userId || null, visitorId: context.visitorId };
}

export async function cleanupActivityEvents() {
  const cutoff = new Date(Date.now() - RAW_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const supabase = getServiceSupabase();
  await supabase.from('activity_events').delete().lt('occurred_at', cutoff);
}
