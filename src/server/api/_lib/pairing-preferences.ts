import type { SupabaseClient } from '@supabase/supabase-js';
import type { PairingPreference } from '../../../../shared/pairing-preferences.js';
import type { SurveyImportance, SurveyPriority } from '../../../../shared/survey.js';

interface PreferenceTeam { ht_team_id?: number | null; hattrick_user_id?: number | null }

/** Read only current owner/team preferences. Survey comments are historical organizer context. */
export async function loadPairingPreferences(db: SupabaseClient, tournamentId: string, teams: PreferenceTeam[], comments = false): Promise<Record<string, PairingPreference>> {
  const managers = [...new Set(teams.map(team => team.hattrick_user_id).filter((id): id is number => Number.isSafeInteger(id) && Number(id) > 0))];
  if (!managers.length) return {};
  const teamIds = [...new Set(teams.map(team => team.ht_team_id).filter((id): id is number => Number.isSafeInteger(id) && Number(id) > 0))];
  if (!teamIds.length) return {};
  const [teamResult, managerResult] = await Promise.all([
    db.from('team_preferences').select('ht_team_id,manager_ht_id,priority').eq('tournament_id', tournamentId)
      .in('manager_ht_id', managers).in('ht_team_id', teamIds),
    db.from('manager_preferences').select('manager_ht_id,importance_120m').eq('tournament_id', tournamentId).in('manager_ht_id', managers),
  ]);
  if (teamResult.error) throw teamResult.error;
  if (managerResult.error) throw managerResult.error;
  const managerValues = new Map((managerResult.data || []).map(row => [row.manager_ht_id, row.importance_120m as SurveyImportance]));
  const teamValues = new Map((teamResult.data || []).map(row => [`${row.manager_ht_id}:${row.ht_team_id}`, row.priority as SurveyPriority]));
  const result: Record<string, PairingPreference> = {};
  for (const team of teams) {
    if (!team.ht_team_id || !team.hattrick_user_id) continue;
    const preference = teamValues.get(`${team.hattrick_user_id}:${team.ht_team_id}`) || null;
    const importance = managerValues.get(team.hattrick_user_id) || null;
    if (preference || importance) result[String(team.ht_team_id)] = { priority: preference, importance120m: importance };
  }
  if (!comments || !Object.keys(result).length) return result;
  const surveys = await db.from('surveys').select('id').eq('tournament_id', tournamentId);
  if (surveys.error) throw surveys.error;
  const surveyIds = (surveys.data || []).map(row => row.id);
  if (!surveyIds.length) return result;
  for (let offset = 0; ; offset += 500) {
    const responses = await db.from('survey_responses').select('manager_ht_id,team_answers,completed_at')
      .in('survey_id', surveyIds).in('manager_ht_id', managers).order('completed_at', { ascending: false })
      .order('manager_ht_id').range(offset, offset + 499);
    if (responses.error) throw responses.error;
    for (const response of responses.data || []) {
      if (!Array.isArray(response.team_answers)) continue;
      for (const answer of response.team_answers) {
        if (!answer || typeof answer !== 'object') continue;
        const row = answer as { ht_team_id?: number; comments?: string };
        const team = teams.find(candidate => candidate.ht_team_id === row.ht_team_id && candidate.hattrick_user_id === response.manager_ht_id);
        const entry = team && result[String(team.ht_team_id)];
        if (entry && !entry.comment && typeof row.comments === 'string' && row.comments.trim()) {
          entry.comment = row.comments.trim(); entry.commentedAt = response.completed_at;
        }
      }
    }
    if ((responses.data?.length || 0) < 500) break;
  }
  return result;
}
