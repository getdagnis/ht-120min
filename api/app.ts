import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAppSessionSecret, verifyAppSessionCookie } from './_lib/app-session.js';
import {
  clearForgeSessionCookie,
  getForgeSuperadminId,
  isForgeAdminRequest,
  verifyForgeSessionCookie,
} from './_lib/forge-session.js';
import { cleanupActivityEvents, recordActivity } from './_lib/activity.js';
import { findOwnedSeasonParticipant, validateSeasonComment } from './_lib/season-comments.js';
import { getServiceSupabase, getSupabase } from './_lib/supabase.js';
import { hasSuperAdminBypassCookie } from './_lib/superadmin-bypass.js';
import {
  loadTournamentAccess,
  loadTournamentRoleRecords,
} from './_lib/tournament-access.js';
import { isTournamentRole, type TournamentRole } from '../shared/tournament-roles.js';

const COMMENT_SELECT = 'id, season_id, team_id, team_name, manager_name, comment, created_at';
const HISTORY_REPORT_DISMISSED_NOTICE = 'history-report-dismissed';
const HISTORY_REPORT_VIEWED_NOTICE = 'history-report-viewed';
const HISTORY_REPORT_STATUS_NOTICE = 'history-report-status';

async function requireTournamentRoleSession(req: VercelRequest, res: VercelResponse, tournamentId: string) {
  const secret = getAppSessionSecret();
  const session = secret ? verifyAppSessionCookie(req.headers.cookie, secret) : null;
  const bypass = hasSuperAdminBypassCookie(req.headers.cookie);
  const userId = session?.userId || (bypass ? getForgeSuperadminId() : null);
  if (!userId) {
    res.status(401).json({ error: 'Please sign in with Hattrick first.' });
    return null;
  }

  const access = await loadTournamentAccess(getServiceSupabase(), tournamentId, userId, bypass);
  if (!access) {
    res.status(404).json({ error: 'Tournament not found.' });
    return null;
  }
  return { userId, access };
}

async function handleTournamentAccess(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  const tournamentId = readString(req.query.tournamentId);
  if (!tournamentId) return res.status(400).json({ error: 'Missing tournamentId.' });
  const actor = await requireTournamentRoleSession(req, res, tournamentId);
  if (!actor) return;
  return res.status(200).json(actor.access);
}

async function handleManagedTournaments(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  const secret = getAppSessionSecret();
  const session = secret ? verifyAppSessionCookie(req.headers.cookie, secret) : null;
  const userId = session?.userId || (hasSuperAdminBypassCookie(req.headers.cookie) ? getForgeSuperadminId() : null);
  if (!userId) return res.status(401).json({ error: 'Please sign in with Hattrick first.' });

  const supabase = getServiceSupabase();
  const [{ data: organizerRows, error: organizerError }, { data: roleRows, error: rolesError }] = await Promise.all([
    supabase.from('tournaments').select('id').eq('organizer_id', userId),
    supabase.from('tournament_roles').select('tournament_id').eq('hattrick_user_id', userId),
  ]);
  if (organizerError) throw organizerError;
  if (rolesError && rolesError.code !== '42P01' && rolesError.code !== 'PGRST205') throw rolesError;
  const tournamentIds = Array.from(new Set([
    ...(organizerRows || []).map((row) => row.id),
    ...(roleRows || []).map((row) => row.tournament_id),
  ]));
  if (tournamentIds.length === 0) return res.status(200).json({ tournaments: [] });

  const { data: tournaments, error: tournamentsError } = await supabase
    .from('tournaments')
    .select('id, name, slug, is_featured, status, is_archived, is_test, registration_type, created_at')
    .in('id', tournamentIds)
    .neq('status', 'archived');
  if (tournamentsError) throw tournamentsError;
  return res.status(200).json({ tournaments: tournaments || [] });
}

async function handleTournamentRoles(req: VercelRequest, res: VercelResponse) {
  const tournamentId = readString(req.method === 'GET' ? req.query.tournamentId : req.body?.tournamentId);
  if (!tournamentId) return res.status(400).json({ error: 'Missing tournamentId.' });

  let actor;
  try {
    actor = await requireTournamentRoleSession(req, res, tournamentId);
  } catch (error) {
    console.error('Tournament role access error:', error);
    return res.status(500).json({ error: 'Could not load tournament roles.' });
  }
  if (!actor) return;

  if (req.method === 'GET') {
    if (!actor.access.canViewRoles) return res.status(403).json({ error: 'This role cannot view tournament roles.' });
    const roleRecords = await loadTournamentRoleRecords(getServiceSupabase(), tournamentId);
    if (!roleRecords) return res.status(404).json({ error: 'Tournament not found.' });
    return res.status(200).json({
      ...actor.access,
      ...roleRecords,
      currentRole: actor.access.actualRole,
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (!actor.access.canManageAdmins && !actor.access.canManagePressOfficer && !actor.access.canManageCoOrganizer) {
    return res.status(403).json({ error: 'This role cannot manage tournament roles.' });
  }

  const action = readString(req.body?.action);
  const targetUserId = Number(req.body?.hattrickUserId) || 0;
  if (!targetUserId) return res.status(400).json({ error: 'A valid Hattrick user ID is required.' });
  if (targetUserId === actor.userId) {
    return res.status(400).json({ error: 'The original organizer cannot be delegated through this panel.' });
  }

  const supabase = getServiceSupabase();
  const { data: tournamentOwner, error: tournamentOwnerError } = await supabase
    .from('tournaments')
    .select('organizer_id')
    .eq('id', tournamentId)
    .single();
  if (tournamentOwnerError) throw tournamentOwnerError;
  if (targetUserId === Number(tournamentOwner.organizer_id)) {
    return res.status(400).json({ error: 'The original organizer cannot be delegated through this panel.' });
  }
  if (action === 'remove') {
    const { data: targetRole, error: targetRoleError } = await supabase
      .from('tournament_roles')
      .select('role')
      .eq('tournament_id', tournamentId)
      .eq('hattrick_user_id', targetUserId)
      .maybeSingle();
    if (targetRoleError) throw targetRoleError;
    if (!targetRole) return res.status(404).json({ error: 'Delegated role not found.' });
    if (targetRole.role === 'co_organizer' && !actor.access.canManageCoOrganizer) return res.status(403).json({ error: 'Only the original organizer can manage the co-organizer.' });
    if (targetRole.role === 'admin' && !actor.access.canManageAdmins) return res.status(403).json({ error: 'This role cannot manage tournament admins.' });
    if (targetRole.role === 'press_officer' && !actor.access.canManagePressOfficer) return res.status(403).json({ error: 'This role cannot manage the press officer.' });
    const { error } = await supabase.from('tournament_roles').delete().eq('tournament_id', tournamentId).eq('hattrick_user_id', targetUserId);
    if (error) throw error;
  } else if (action === 'assign') {
    if (!isTournamentRole(req.body?.role)) return res.status(400).json({ error: 'Invalid tournament role.' });
    const role = req.body.role as TournamentRole;
    if (role === 'co_organizer' && !actor.access.canManageCoOrganizer) return res.status(403).json({ error: 'Only the original organizer can manage the co-organizer.' });
    if (role === 'admin' && !actor.access.canManageAdmins) return res.status(403).json({ error: 'This role cannot manage tournament admins.' });
    if (role === 'press_officer' && !actor.access.canManagePressOfficer) return res.status(403).json({ error: 'This role cannot manage the press officer.' });
    const { data: targetProfile, error: targetProfileError } = await supabase
      .from('profiles')
      .select('hattrick_user_id, manager_name')
      .eq('hattrick_user_id', targetUserId)
      .maybeSingle();
    if (targetProfileError) throw targetProfileError;
    if (!targetProfile) return res.status(422).json({ error: 'This manager has not signed into HT-120min yet.' });
    const { data: currentRoles, error: currentRolesError } = await supabase.from('tournament_roles').select('hattrick_user_id, role').eq('tournament_id', tournamentId);
    if (currentRolesError) throw currentRolesError;
    if (role === 'admin' && !currentRoles?.some((item) => item.hattrick_user_id === targetUserId && item.role === 'admin') && (currentRoles ?? []).filter((item) => item.role === 'admin').length >= 4) {
      return res.status(409).json({ error: 'This tournament already has four tournament admins.' });
    }
    if (role === 'co_organizer' || role === 'press_officer') {
      const existingSlot = currentRoles?.find((item) => item.role === role && item.hattrick_user_id !== targetUserId);
      if (existingSlot) return res.status(409).json({ error: `This tournament already has a ${role === 'co_organizer' ? 'co-organizer' : 'press officer'}. Remove the current one before assigning another.` });
    }
    const { error: removeExistingError } = await supabase.from('tournament_roles').delete().eq('tournament_id', tournamentId).eq('hattrick_user_id', targetUserId);
    if (removeExistingError) throw removeExistingError;
    const { error } = await supabase.from('tournament_roles').insert({
      tournament_id: tournamentId,
      hattrick_user_id: targetUserId,
      role,
      added_by_ht_user_id: actor.userId,
    });
    if (error) throw error;
  } else {
    return res.status(400).json({ error: 'Unknown role action.' });
  }

  const refreshed = await loadTournamentRoleRecords(supabase, tournamentId);
  return res.status(200).json({
    ok: true,
    roles: refreshed?.roles ?? [],
  });
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function routeFor(request: VercelRequest) {
  const raw = request.query.route;
  return readString(Array.isArray(raw) ? raw[0] : raw) || 'activity';
}

function isSecureRequest(request: VercelRequest) {
  const host = String(request.headers.host || '').split(':')[0].toLowerCase();
  return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
}

async function handlePresence(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const secret = getAppSessionSecret();
  if (!secret) return res.status(500).json({ error: 'Server misconfigured' });

  const session = verifyAppSessionCookie(req.headers.cookie, secret);
  const devFallbackUserId =
    process.env.NODE_ENV !== 'production' ? Number(req.headers['x-ht-user-id'] || '0') || null : null;
  if (!session && !devFallbackUserId) {
    return res.status(401).json({ error: 'Unauthorized', details: 'Missing or invalid application session.' });
  }

  const supabase = getSupabase();
  const now = new Date();
  const userId = session?.userId || devFallbackUserId;
  const { data: profile, error: readError } = await supabase
    .from('profiles')
    .select('last_seen_at')
    .eq('hattrick_user_id', userId)
    .maybeSingle();
  if (readError) return res.status(500).json({ error: 'Failed to read presence state', details: readError.message });
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const currentSeenAt = profile.last_seen_at ? new Date(profile.last_seen_at) : null;
  if (currentSeenAt && Number.isFinite(currentSeenAt.getTime()) && now.getTime() - currentSeenAt.getTime() < 120000) {
    return res.status(200).json({ last_seen_at: profile.last_seen_at, updated: false });
  }

  const nextSeenAt = now.toISOString();
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ last_seen_at: nextSeenAt })
    .eq('hattrick_user_id', userId);
  if (updateError) return res.status(500).json({ error: 'Failed to update presence', details: updateError.message });

  return res.status(200).json({ last_seen_at: nextSeenAt, updated: true });
}

async function handleActivity(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const eventType = readString(req.body?.eventType);
  if (!eventType || !/^[a-z0-9_.:-]{2,80}$/i.test(eventType)) {
    return res.status(400).json({ error: 'Invalid activity event.' });
  }

  try {
    const result = await recordActivity(req, res, {
      eventType,
      route: readString(req.body?.route) || null,
      tournamentId: readString(req.body?.tournamentId) || null,
      teamId: readString(req.body?.teamId) || null,
      metadata: typeof req.body?.metadata === 'object' && req.body.metadata ? req.body.metadata : {},
    });
    return res.status(201).json({ ok: true, userId: result.userId });
  } catch (error) {
    console.error('Activity ledger error:', error);
    return res.status(503).json({ error: 'Activity tracking is unavailable.' });
  }
}

async function handleForgeSession(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    const session = verifyForgeSessionCookie(req.headers.cookie);
    if (!session) return res.status(200).json({ authorized: false });
    const { data: profile } = await getServiceSupabase()
      .from('profiles')
      .select('manager_name')
      .eq('hattrick_user_id', session.userId)
      .maybeSingle();
    return res.status(200).json({ authorized: true, userId: session.userId, managerName: profile?.manager_name || null });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Set-Cookie', clearForgeSessionCookie(isSecureRequest(req)));
  return res.status(200).json({ authorized: false });
}

async function handleHistory(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (req.method === 'GET') {
    const supabase = getSupabase();
    const seasonId = readString(req.query.seasonId);
    if (!seasonId) return res.status(400).json({ error: 'Missing seasonId' });

    if (req.query.notice === HISTORY_REPORT_STATUS_NOTICE) {
      const tournamentId = readString(req.query.tournamentId);
      const secret = getAppSessionSecret();
      const session = secret ? verifyAppSessionCookie(req.headers.cookie, secret) : null;
      if (!tournamentId || !session) return res.status(200).json({ dismissed: false, seen: false, tracked: false });

      const { data, error } = await supabase
        .from('tournament_announcement_dismissals')
        .select('notice_key')
        .eq('tournament_id', tournamentId)
        .in('notice_key', [
          `${HISTORY_REPORT_DISMISSED_NOTICE}:${seasonId}`,
          `${HISTORY_REPORT_VIEWED_NOTICE}:${seasonId}`,
        ])
        .eq('hattrick_user_id', session.userId)
        .limit(2);
      if (error) throw error;
      const noticeKeys = new Set((data || []).map((row) => row.notice_key));
      return res.status(200).json({
        dismissed: noticeKeys.has(`${HISTORY_REPORT_DISMISSED_NOTICE}:${seasonId}`),
        seen: noticeKeys.has(`${HISTORY_REPORT_VIEWED_NOTICE}:${seasonId}`),
        tracked: true,
      });
    }

    const { data, error } = await supabase
      .from('tournament_season_comments')
      .select(COMMENT_SELECT)
      .eq('season_id', seasonId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return res.status(200).json({ comments: data ?? [] });
  }

  const action = readString(req.body?.action);
  let supabase: ReturnType<typeof getServiceSupabase>;
  try {
    supabase = getServiceSupabase();
  } catch (error) {
    console.error('Tournament history service configuration error:', error);
    return res.status(503).json({ error: 'Season comments are unavailable right now.' });
  }

  const secret = getAppSessionSecret();
  if (!secret) return res.status(500).json({ error: 'Session configuration is missing.' });
  const session = verifyAppSessionCookie(req.headers.cookie, secret);
  if (!session) return res.status(401).json({ error: 'Please sign in with Hattrick first.' });

  if (action === 'mark-history-report-dismissed' || action === 'mark-history-report-seen') {
    const seasonId = readString(req.body?.seasonId);
    const tournamentId = readString(req.body?.tournamentId);
    if (!seasonId || !tournamentId) return res.status(400).json({ error: 'Missing season or tournament.' });
    const noticePrefix = action === 'mark-history-report-dismissed' ? HISTORY_REPORT_DISMISSED_NOTICE : HISTORY_REPORT_VIEWED_NOTICE;
    const { data, error } = await supabase
      .from('tournament_announcement_dismissals')
      .insert({
        tournament_id: tournamentId,
        notice_key: `${noticePrefix}:${seasonId}`,
        announcement_id: null,
        hattrick_user_id: session.userId,
      })
      .select('id')
      .single();
    if (error?.code === '23505') return res.status(200).json({ seen: action === 'mark-history-report-seen' });
    if (error) throw error;
    return res.status(200).json({ seen: action === 'mark-history-report-seen', id: data?.id });
  }

  const seasonId = readString(req.body?.seasonId);
  const teamId = readString(req.body?.teamId);
  const validatedComment = validateSeasonComment(req.body?.comment);
  if (!seasonId || !teamId) return res.status(400).json({ error: 'Missing season or team.' });
  if (validatedComment.error) return res.status(400).json({ error: validatedComment.error });

  const { data: season, error: seasonError } = await supabase
    .from('tournament_seasons')
    .select('id, tournament_id, status, snapshot_json')
    .eq('id', seasonId)
    .single();
  if (seasonError || !season) return res.status(404).json({ error: 'Season not found.' });
  if (season.status !== 'finished') return res.status(409).json({ error: 'Season comments open after the season is finished.' });

  const participant = findOwnedSeasonParticipant(season.snapshot_json, teamId, session.userId);
  if (!participant) return res.status(403).json({ error: 'Only this season’s team owner can leave its final comment.' });

  const { data: ownedTeam, error: ownedTeamError } = await supabase
    .from('teams')
    .select('id')
    .eq('id', teamId)
    .eq('tournament_id', season.tournament_id)
    .eq('hattrick_user_id', session.userId)
    .maybeSingle();
  if (ownedTeamError) throw ownedTeamError;
  if (!ownedTeam) return res.status(403).json({ error: 'This team is not linked to your Hattrick account.' });

  const { data, error } = await supabase
    .from('tournament_season_comments')
    .insert({
      season_id: season.id,
      tournament_id: season.tournament_id,
      team_id: teamId,
      hattrick_user_id: session.userId,
      team_name: participant.teamName || 'Unknown team',
      manager_name: participant.managerName || null,
      comment: validatedComment.comment,
    })
    .select(COMMENT_SELECT)
    .single();
  if (error?.code === '23505') return res.status(409).json({ error: 'This team has already left its final season comment.' });
  if (error) throw error;
  return res.status(201).json({ comment: data });
}

function toDate(value: unknown, fallback: Date) {
  const parsed = typeof value === 'string' ? new Date(value) : fallback;
  return Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

async function handleForgeStats(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!isForgeAdminRequest(req.headers.cookie) && !hasSuperAdminBypassCookie(req.headers.cookie)) {
    return res.status(401).json({ error: 'Forge authorization required.' });
  }

  const now = new Date();
  const since = toDate(req.query.since, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
  const selectedUserId = Number(req.query.userId || 0) || null;
  const selectedVisitorId = readString(req.query.visitorId) || null;
  const includeAdmin = String(req.query.includeAdmin || '') === '1';
  const adminId = getForgeSuperadminId();
  const supabase = getServiceSupabase();

  await cleanupActivityEvents().catch((error) => console.warn('Activity cleanup failed:', error));

  const { data: rawEvents, error: eventError } = await supabase
    .from('activity_events')
    .select('id, occurred_at, visitor_id, visit_id, hattrick_user_id, manager_name, event_type, route, tournament_id, team_id, referrer, country_code, language, platform, browser, user_agent, ip_address, metadata')
    .gte('occurred_at', since.toISOString())
    .order('occurred_at', { ascending: false })
    .limit(10000);
  if (eventError) throw eventError;

  const adminVisitorIds = new Set(
    (rawEvents || [])
      .filter((event) => adminId && event.hattrick_user_id === adminId)
      .map((event) => event.visitor_id),
  );
  const visibleEvents = (rawEvents || []).filter(
    (event) => includeAdmin || (event.hattrick_user_id !== adminId && !adminVisitorIds.has(event.visitor_id)),
  );
  const identityByVisitor = new Map<string, { userId: number; managerName: string | null }>();
  for (const event of visibleEvents) {
    if (event.hattrick_user_id) {
      identityByVisitor.set(event.visitor_id, {
        userId: event.hattrick_user_id,
        managerName: event.manager_name,
      });
    }
  }
  const events = visibleEvents.map((event) => {
    const identity = identityByVisitor.get(event.visitor_id);
    return {
      ...event,
      resolved_user_id: event.hattrick_user_id || identity?.userId || null,
      resolved_manager_name: event.manager_name || identity?.managerName || null,
    };
  });
  const users = new Map<number, {
    userId: number;
    managerName: string;
    visits: number;
    events: number;
    firstSeen: string;
    lastSeen: string;
    tournaments: Set<string>;
    teams: Set<string>;
  }>();
  const visitorsById = new Map<string, {
    visitorId: string;
    userId: number | null;
    managerName: string | null;
    visits: number;
    events: number;
    firstSeen: string;
    lastSeen: string;
    countries: Set<string>;
    platforms: Set<string>;
    browsers: Set<string>;
    routes: Set<string>;
  }>();
  const visitors = new Set<string>();
  let visitEvents = 0;
  let actionEvents = 0;
  for (const event of events) {
    visitors.add(event.visitor_id);
    if (event.event_type === 'page_view') visitEvents += 1;
    else actionEvents += 1;
    const visitor = visitorsById.get(event.visitor_id) || {
      visitorId: event.visitor_id,
      userId: event.resolved_user_id,
      managerName: event.resolved_manager_name,
      visits: 0,
      events: 0,
      firstSeen: event.occurred_at,
      lastSeen: event.occurred_at,
      countries: new Set<string>(),
      platforms: new Set<string>(),
      browsers: new Set<string>(),
      routes: new Set<string>(),
    };
    visitor.events += 1;
    if (event.event_type === 'page_view') visitor.visits += 1;
    visitor.userId = event.resolved_user_id || visitor.userId;
    visitor.managerName = event.resolved_manager_name || visitor.managerName;
    visitor.firstSeen = event.occurred_at < visitor.firstSeen ? event.occurred_at : visitor.firstSeen;
    visitor.lastSeen = event.occurred_at > visitor.lastSeen ? event.occurred_at : visitor.lastSeen;
    if (event.country_code) visitor.countries.add(event.country_code);
    if (event.platform) visitor.platforms.add(event.platform);
    if (event.browser) visitor.browsers.add(event.browser);
    if (event.route) visitor.routes.add(event.route);
    visitorsById.set(event.visitor_id, visitor);

    if (!event.resolved_user_id) continue;
    const existing = users.get(event.resolved_user_id) || {
      userId: event.resolved_user_id,
      managerName: event.resolved_manager_name || 'Unknown manager',
      visits: 0,
      events: 0,
      firstSeen: event.occurred_at,
      lastSeen: event.occurred_at,
      tournaments: new Set<string>(),
      teams: new Set<string>(),
    };
    existing.events += 1;
    if (event.event_type === 'page_view') existing.visits += 1;
    existing.firstSeen = event.occurred_at < existing.firstSeen ? event.occurred_at : existing.firstSeen;
    existing.lastSeen = event.occurred_at > existing.lastSeen ? event.occurred_at : existing.lastSeen;
    if (event.resolved_manager_name) existing.managerName = event.resolved_manager_name;
    if (event.tournament_id) existing.tournaments.add(event.tournament_id);
    if (event.team_id) existing.teams.add(event.team_id);
    users.set(event.resolved_user_id, existing);
  }

  const userRows = Array.from(users.values()).map((user) => ({
    ...user,
    tournaments: user.tournaments.size,
    teams: user.teams.size,
  })).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  const visitorRows = Array.from(visitorsById.values()).map((visitor) => ({
    ...visitor,
    countries: Array.from(visitor.countries),
    platforms: Array.from(visitor.platforms),
    browsers: Array.from(visitor.browsers),
    routes: Array.from(visitor.routes),
  })).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  const selectedEvents = selectedVisitorId
    ? events.filter((event) => event.visitor_id === selectedVisitorId).slice(0, 500)
    : selectedUserId
      ? events.filter((event) => event.resolved_user_id === selectedUserId).slice(0, 500)
      : events.slice(0, 100);

  const breakdown = (values: Array<string | null | undefined>) => {
    const counts = new Map<string, number>();
    for (const value of values) {
      if (!value) continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  };
  const metadataValues = (key: string) =>
    events.map((event) => (typeof event.metadata?.[key] === 'string' ? String(event.metadata[key]) : null));

  const { data: daily, error: dailyError } = await supabase
    .from('activity_daily')
    .select('activity_date, event_type, route, event_count')
    .gte('activity_date', since.toISOString().slice(0, 10))
    .order('activity_date', { ascending: true });
  if (dailyError) throw dailyError;

  return res.status(200).json({
    since: since.toISOString(),
    summary: {
      events: events.length,
      visits: visitEvents,
      actions: actionEvents,
      uniqueVisitors: visitors.size,
      identifiedUsers: userRows.length,
    },
    users: userRows,
    visitors: visitorRows,
    events: selectedEvents,
    breakdowns: {
      countries: breakdown(events.map((event) => event.country_code)),
      platforms: breakdown(events.map((event) => event.platform)),
      browsers: breakdown(events.map((event) => event.browser)),
      languages: breakdown(events.map((event) => event.language)),
      routes: breakdown(events.map((event) => event.route)),
      referrers: breakdown(events.map((event) => event.referrer)),
      themes: breakdown(metadataValues('theme')),
      screens: breakdown(metadataValues('screen')),
      times: breakdown(
        events.map((event) => {
          const hour = new Date(event.occurred_at).getHours();
          return `${String(hour).padStart(2, '0')}:00`;
        }),
      ),
    },
    selectedVisitorId,
    daily: daily || [],
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    switch (routeFor(req)) {
      case 'presence':
        return await handlePresence(req, res);
      case 'history':
        return await handleHistory(req, res);
      case 'forge-session':
        return await handleForgeSession(req, res);
      case 'forge-stats':
        return await handleForgeStats(req, res);
      case 'tournament-roles':
        return await handleTournamentRoles(req, res);
      case 'tournament-access':
        return await handleTournamentAccess(req, res);
      case 'managed-tournaments':
        return await handleManagedTournaments(req, res);
      case 'activity':
      default:
        return await handleActivity(req, res);
    }
  } catch (error) {
    console.error('Application API error:', error);
    return res.status(500).json({ error: 'Application request failed.' });
  }
}
