import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAppSessionSecret, verifyAppSessionCookie } from './app-session.js';
import { isForgeAdminRequest } from './forge-session.js';
import { getServiceSupabase } from './supabase.js';
import { isForgeEnabled } from '../../forge-availability.js';
import { surveyImportance, surveyPriorities, type SurveyImportance, type SurveyPriority, type SurveyVariant } from '../../../../shared/survey.js';

type SurveyTeamRow = {
  id: string; ht_team_id: number | null; name: string; manager_name: string | null; logo_url: string | null;
  country_id: number | null; hattrick_user_id: number | null; active: boolean;
  reserve_active: boolean | null; is_placeholder: boolean | null;
};
type AnswerInput = { teamId: string; priority: SurveyPriority; comments: string };

function queryString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function validateSurveyAnswers(value: unknown, teamIds: string[], variant: SurveyVariant): AnswerInput[] | null {
  if (!Array.isArray(value) || value.length !== teamIds.length || teamIds.length === 0) return null;
  const expected = new Set(teamIds);
  const allowed = new Set(surveyPriorities[variant].map((option) => option.value));
  const answers: AnswerInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.teamId !== 'string' || !expected.delete(item.teamId)
      || !allowed.has(item.priority) || typeof item.comments !== 'string' || item.comments.length > 1000) return null;
    answers.push({ teamId: item.teamId, priority: item.priority, comments: item.comments.trim() });
  }
  return expected.size === 0 ? answers : null;
}

async function loadActiveTeams(tournamentId: string, managerId: number) {
  const db = getServiceSupabase(6000);
  const { data, error } = await db.from('teams')
    .select('id, ht_team_id, name, manager_name, logo_url, country_id, hattrick_user_id, active, reserve_active, is_placeholder')
    .eq('tournament_id', tournamentId).eq('hattrick_user_id', managerId).eq('active', true)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return ((data || []) as SurveyTeamRow[]).filter((team) => !team.reserve_active && !team.is_placeholder && Number(team.ht_team_id) > 0);
}

export async function handleManagerSurvey(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  res.setHeader('Cache-Control', 'private, no-store');
  const secret = getAppSessionSecret();
  const session = secret ? verifyAppSessionCookie(req.headers.cookie, secret) : null;
  if (!session) return res.status(401).json({ error: 'Please sign in with Hattrick first.' });
  const tournamentId = queryString(req.method === 'GET' ? req.query.tournamentId : req.body?.tournamentId);
  if (!tournamentId || !/^[0-9a-f-]{36}$/i.test(tournamentId)) return res.status(400).json({ error: 'Invalid tournament.' });
  const db = getServiceSupabase(6000);
  const { data: survey, error: surveyError } = await db.from('tournament_preference_surveys')
    .select('id, tournament_id, variant').eq('tournament_id', tournamentId).eq('status', 'active').maybeSingle();
  if (surveyError) throw surveyError;
  if (!survey) return res.status(200).json({ survey: null });
  const { data: existing, error: existingError } = await db.from('tournament_preference_responses')
    .select('completed_at').eq('survey_id', survey.id).eq('manager_ht_id', session.userId).maybeSingle();
  if (existingError) throw existingError;
  if (existing) return req.method === 'GET'
    ? res.status(200).json({ survey: null })
    : res.status(409).json({ error: 'This survey has already been submitted.' });
  const teams = await loadActiveTeams(tournamentId, session.userId);
  if (!teams.length) return req.method === 'GET'
    ? res.status(200).json({ survey: null })
    : res.status(403).json({ error: 'No participating teams found.' });
  if (req.method === 'GET') {
    const { data: profile, error } = await db.from('profiles').select('manager_name')
      .eq('hattrick_user_id', session.userId).maybeSingle();
    if (error) throw error;
    return res.status(200).json({
      survey: { id: survey.id, variant: survey.variant }, managerName: profile?.manager_name || teams[0].manager_name || 'Manager',
      teams: teams.map((team) => ({ id: team.id, name: team.name, logo_url: team.logo_url })),
    });
  }
  if (req.body?.surveyId !== survey.id) return res.status(409).json({ error: 'Survey changed. Reload the page.' });
  const variant = survey.variant as SurveyVariant;
  if (!(variant in surveyPriorities)) return res.status(500).json({ error: 'Survey configuration is invalid.' });
  const answers = validateSurveyAnswers(req.body?.answers, teams.map((team) => team.id), variant);
  const managerImportance = req.body?.managerImportance as SurveyImportance;
  if (!answers || !surveyImportance.some((option) => option.value === managerImportance)) {
    return res.status(400).json({ error: 'Answer every team and the final question.' });
  }
  const { data: profile, error: profileError } = await db.from('profiles')
    .select('manager_name, country_id').eq('hattrick_user_id', session.userId).maybeSingle();
  if (profileError) throw profileError;
  const byId = new Map(teams.map((team) => [team.id, team]));
  const teamAnswers = answers.map((answer) => {
    const team = byId.get(answer.teamId)!;
    return { team_id: team.id, ht_team_id: team.ht_team_id, team_name: team.name,
      country_id: team.country_id, priority: answer.priority, comments: answer.comments };
  });
  const { error } = await db.rpc('submit_tournament_preference_survey', {
    p_survey_id: survey.id, p_tournament_id: tournamentId, p_manager_ht_id: session.userId,
    p_manager_name: profile?.manager_name || teams[0].manager_name || 'Manager',
    p_manager_country_id: profile?.country_id ?? null,
    p_manager_importance: managerImportance, p_team_answers: teamAnswers,
  });
  if (error?.code === '23505') return res.status(409).json({ error: 'This survey has already been submitted.' });
  if (error?.code === '40001') return res.status(409).json({ error: 'The survey or team list changed. Reload the page.' });
  if (error) throw error;
  return res.status(201).json({ submitted: true });
}

async function allRows(table: 'tournament_preference_responses' | 'teams', surveyId: string, tournamentId: string) {
  const db = getServiceSupabase(6000);
  const rows: Record<string, unknown>[] = [];
  for (let start = 0; ; start += 500) {
    const query = table === 'teams'
      ? db.from('teams').select('id, ht_team_id, hattrick_user_id, active, reserve_active, is_placeholder')
        .eq('tournament_id', tournamentId).eq('active', true).order('id').range(start, start + 499)
      : db.from('tournament_preference_responses')
        .select('manager_ht_id, manager_name, manager_country_id, manager_importance, team_answers, completed_at')
        .eq('survey_id', surveyId).order('completed_at', { ascending: false })
        .order('manager_ht_id').range(start, start + 499);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 500) return rows;
  }
}

export async function handleForgeSurveys(req: VercelRequest, res: VercelResponse) {
  if (!isForgeEnabled()) return res.status(404).json({ error: 'Not found.' });
  if (!isForgeAdminRequest(req.headers.cookie)) return res.status(403).json({ error: 'Access denied.' });
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  res.setHeader('Cache-Control', 'private, no-store');
  const db = getServiceSupabase(6000);
  if (req.method === 'POST') {
    const action = req.body?.action;
    if (action === 'create') {
      const slug = queryString(req.body?.slug)?.trim();
      if (!slug || slug.length > 160) return res.status(400).json({ error: 'Enter a tournament slug.' });
      const { data: tournament, error } = await db.from('tournaments')
        .select('id, slug, league_category').eq('slug', slug).maybeSingle();
      if (error) throw error;
      if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });
      let variant: SurveyVariant;
      if (slug === 'around-the-world') variant = 'flag_hunters';
      else {
        if (tournament.league_category !== 'hfi') return res.status(400).json({ error: 'This tournament has no survey template.' });
        const { data: collection, error: collectionError } = await db.from('tournament_collections')
          .select('id').eq('slug', 'exotic-hfi').maybeSingle();
        if (collectionError) throw collectionError;
        const { data: membership, error: membershipError } = await db.from('tournament_collection_memberships')
          .select('tournament_id').eq('collection_id', collection?.id || '').eq('tournament_id', tournament.id).maybeSingle();
        if (membershipError) throw membershipError;
        if (!membership) return res.status(400).json({ error: 'This tournament has no survey template.' });
        variant = 'exotic_hfi';
      }
      const { data: created, error: createError } = await db.from('tournament_preference_surveys')
        .insert({ tournament_id: tournament.id, variant }).select('id').single();
      if (createError) throw createError;
      return res.status(201).json({ id: created.id });
    }
    const surveyId = queryString(req.body?.surveyId);
    if (!surveyId || !['publish', 'close'].includes(action)) return res.status(400).json({ error: 'Invalid survey action.' });
    const from = action === 'publish' ? 'draft' : 'active';
    const to = action === 'publish' ? 'active' : 'closed';
    const { data, error } = await db.from('tournament_preference_surveys')
      .update({ status: to, ...(to === 'active' ? { published_at: new Date().toISOString() } : { closed_at: new Date().toISOString() }) })
      .eq('id', surveyId).eq('status', from).select('id').maybeSingle();
    if (error?.code === '23505') return res.status(409).json({ error: 'This tournament already has an active survey.' });
    if (error) throw error;
    if (!data) return res.status(409).json({ error: 'Survey state changed. Reload.' });
    return res.status(200).json({ saved: true });
  }
  const { data: surveys, error: surveysError } = await db.from('tournament_preference_surveys')
    .select('id, tournament_id, variant, status, created_at, published_at, closed_at')
    .order('created_at', { ascending: false });
  if (surveysError) throw surveysError;
  const tournamentIds = [...new Set((surveys || []).map((survey) => survey.tournament_id))];
  const tournamentResult = tournamentIds.length
    ? await db.from('tournaments').select('id, name, slug').in('id', tournamentIds)
    : { data: [], error: null };
  if (tournamentResult.error) throw tournamentResult.error;
  const names = new Map((tournamentResult.data || []).map((item) => [item.id, item]));
  const items = (surveys || []).map((survey) => ({ ...survey, tournament: names.get(survey.tournament_id) || null }));
  const selectedId = queryString(req.query.surveyId) || items[0]?.id;
  const selected = items.find((item) => item.id === selectedId);
  if (!selected) return res.status(200).json({ surveys: items, selected: null });
  const [responses, teams] = await Promise.all([
    allRows('tournament_preference_responses', selected.id, selected.tournament_id),
    allRows('teams', selected.id, selected.tournament_id),
  ]);
  const activeTeams = teams.filter((team) => team.active && !team.reserve_active && !team.is_placeholder
    && Number(team.ht_team_id) > 0 && Number(team.hattrick_user_id) > 0);
  return res.status(200).json({ surveys: items, selected: {
    ...selected, responses,
    totalTeams: activeTeams.length,
    totalManagers: new Set(activeTeams.map((team) => team.hattrick_user_id).filter(Boolean)).size,
  } });
}
