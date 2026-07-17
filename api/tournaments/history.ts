import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAppSessionSecret, verifyAppSessionCookie } from '../_lib/app-session.js';
import { findOwnedSeasonParticipant, validateSeasonComment } from '../_lib/season-comments.js';
import { getServiceSupabase, getSupabase } from '../_lib/supabase.js';

const COMMENT_SELECT = 'id, season_id, team_id, team_name, manager_name, comment, created_at';
const HISTORY_REPORT_DISMISSED_NOTICE = 'history-report-dismissed';
const HISTORY_REPORT_VIEWED_NOTICE = 'history-report-viewed';
const HISTORY_REPORT_STATUS_NOTICE = 'history-report-status';

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
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
      console.error('Tournament history comment configuration error:', error);
      return res.status(503).json({
        error: 'Season comments cannot be posted until the server write key is configured.',
      });
    }

    const secret = getAppSessionSecret();
    if (!secret) return res.status(500).json({ error: 'Session configuration is missing.' });
    const session = verifyAppSessionCookie(req.headers.cookie, secret);
    if (!session) return res.status(401).json({ error: 'Please sign in with Hattrick first.' });

    if (action === 'mark-history-report-dismissed' || action === 'mark-history-report-seen') {
      const seasonId = readString(req.body?.seasonId);
      const tournamentId = readString(req.body?.tournamentId);
      if (!seasonId || !tournamentId) return res.status(400).json({ error: 'Missing season or tournament.' });
      const noticePrefix =
        action === 'mark-history-report-dismissed' ? HISTORY_REPORT_DISMISSED_NOTICE : HISTORY_REPORT_VIEWED_NOTICE;

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
    if (season.status !== 'finished') {
      return res.status(409).json({ error: 'Season comments open after the season is finished.' });
    }

    const participant = findOwnedSeasonParticipant(season.snapshot_json, teamId, session.userId);
    if (!participant) {
      return res.status(403).json({ error: 'Only this season’s team owner can leave its final comment.' });
    }

    const { data: ownedTeam, error: ownedTeamError } = await supabase
      .from('teams')
      .select('id')
      .eq('id', teamId)
      .eq('tournament_id', season.tournament_id)
      .eq('hattrick_user_id', session.userId)
      .maybeSingle();
    if (ownedTeamError) throw ownedTeamError;
    if (!ownedTeam) {
      return res.status(403).json({ error: 'This team is not linked to your Hattrick account.' });
    }

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

    if (error?.code === '23505') {
      return res.status(409).json({ error: 'This team has already left its final season comment.' });
    }
    if (error) throw error;
    return res.status(201).json({ comment: data });
  } catch (error) {
    console.error('Tournament history comment error:', error);
    return res.status(500).json({
      error: req.method === 'GET' ? 'Season comments are unavailable right now.' : 'Could not save the season comment.',
    });
  }
}
