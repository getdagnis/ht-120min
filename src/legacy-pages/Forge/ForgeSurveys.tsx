import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/Button/Button';
import { SectionCard } from '../../components/Card/SectionCard';
import { getCountryWorldDetails } from '../../../shared/worlddetails';
import { surveyImportance, surveyPriorities, type SurveyImportance, type SurveyPriority, type SurveyVariant } from '../../../shared/survey';
import styles from './Forge.module.sass';
import surveyStyles from './ForgeSurveys.module.sass';

type SurveyItem = {
  id: string; tournament_id: string; variant: SurveyVariant; status: 'draft' | 'active' | 'closed';
  tournament: { id: string; name: string; slug: string } | null;
};
type TeamAnswer = {
  team_id: string; ht_team_id: number; team_name: string; country_id: number | null;
  priority: SurveyPriority; comments: string;
};
type ManagerResponse = {
  manager_ht_id: number; manager_name: string; manager_country_id: number | null;
  manager_importance: SurveyImportance; team_answers: TeamAnswer[]; completed_at: string;
};
type SelectedSurvey = SurveyItem & { responses: ManagerResponse[]; totalTeams: number; totalManagers: number };

const completionDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Riga',
});

function numberedAnswer(options: readonly { value: string; label: string }[], value: string) {
  const index = options.findIndex((option) => option.value === value);
  return index < 0 ? value : `${index + 1}. ${options[index].label}`;
}

export function ForgeSurveys() {
  const [surveys, setSurveys] = useState<SurveyItem[]>([]);
  const [selected, setSelected] = useState<SelectedSurvey | null>(null);
  const [draftSlug, setDraftSlug] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (surveyId?: string) => {
    const url = surveyId
      ? `/api/app?route=forge-surveys&surveyId=${encodeURIComponent(surveyId)}`
      : '/api/app?route=forge-surveys';
    const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load surveys.');
    const data = await response.json();
    setSurveys(data.surveys);
    setSelected(data.selected);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/app?route=forge-surveys', { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load surveys.');
        const data = await response.json();
        if (!controller.signal.aborted) { setSurveys(data.surveys); setSelected(data.selected); }
      }).catch((failure) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, []);

  const change = async (action: 'create' | 'publish' | 'close') => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/app?route=forge-surveys', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'create' ? { action, slug: draftSlug.trim() } : { action, surveyId: selected?.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Survey action failed.');
      if (action === 'create') { setEditing(false); setDraftSlug(''); }
      await load(action === 'create' ? data.id : selected?.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Survey action failed.');
    } finally { setBusy(false); }
  };

  const options = selected ? surveyPriorities[selected.variant] : [];
  const responses = selected?.responses ?? [];
  const teamAnswers = responses.flatMap((response) => response.team_answers);
  const counts = options.map((option) => ({ ...option, count: teamAnswers.filter((answer) => answer.priority === option.value).length }));

  return (
    <div className={styles.sectionStack}>
      <div className={styles.dashboardHeading}><h1 className={styles.pageTitle}>Surveys</h1></div>
      {error && <p role="alert">{error}</p>}
      <div className={styles.analyticsLayout}>
        <div className={styles.analyticsMain}>
          {editing && (
            <SectionCard title="Create a survey" className={styles.surfaceCard}>
              <label>
                Tournament slug
                <br />
                <input className={styles.dashboardSearch} value={draftSlug}
                  onChange={(event) => setDraftSlug(event.target.value)} placeholder="Tournament slug" />
              </label>{' '}
              <Button disabled={!draftSlug.trim() || busy} onClick={() => void change('create')}>Save draft</Button>
            </SectionCard>
          )}
          {selected ? (
            <SectionCard title={selected.tournament?.name || 'Tournament'} className={styles.surfaceCard}>
              <h2 className={surveyStyles.surveyTitle}>What brings your team here?</h2>
              <div className={surveyStyles.resultList}>
                {responses.length === 0 && <p>No responses yet.</p>}
                {responses.map((manager) => (
                  <article className={surveyStyles.managerResult} key={manager.manager_ht_id}>
                    <div className={surveyStyles.managerHeading}>
                      <h3>
                        <span aria-hidden="true">{getCountryWorldDetails(manager.manager_country_id)?.emoji || '🌐'}</span>{' '}
                        {manager.manager_name}
                      </h3>
                      <time dateTime={manager.completed_at}>{completionDate.format(new Date(manager.completed_at))}</time>
                    </div>
                    <ul className={surveyStyles.teamAnswers}>
                      {manager.team_answers.map((team) => (
                        <li key={team.team_id}>
                          <div className={surveyStyles.teamAnswer}>
                            <strong>
                              <span aria-hidden="true">{getCountryWorldDetails(team.country_id)?.emoji || '🌐'}</span>{' '}
                              {team.team_name}
                            </strong>
                            <span>{numberedAnswer(options, team.priority)}</span>
                          </div>
                          {team.comments && <p className={surveyStyles.comments}>{team.comments}</p>}
                        </li>
                      ))}
                    </ul>
                    <p className={surveyStyles.managerAnswer}>
                      120-minute matches: {numberedAnswer(surveyImportance, manager.manager_importance)}
                    </p>
                  </article>
                ))}
              </div>
            </SectionCard>
          ) : <SectionCard title="Surveys" className={styles.surfaceCard}><p>No surveys yet.</p></SectionCard>}
        </div>
        <aside className={styles.statsSidebar}>
          <SectionCard title="Survey controls" className={styles.surfaceCard}>
            <div className={surveyStyles.controlGroup}>
              <strong>Tournament surveys</strong>
              {surveys.map((survey) => (
                <Button key={survey.id} variant={selected?.id === survey.id ? 'primary' : 'outline'}
                  onClick={() => void load(survey.id).catch((failure) => setError(failure.message))}>
                  {survey.tournament?.name || 'Tournament'} · {survey.status}
                </Button>
              ))}
            </div>
            {selected?.status === 'draft' && <Button disabled={busy} onClick={() => void change('publish')}>Publish survey</Button>}
            {selected?.status === 'active' && <Button disabled={busy} onClick={() => void change('close')}>Close survey</Button>}
          </SectionCard>
          {selected && (
            <SectionCard title="Response summary" className={styles.surfaceCard}>
              <p>{selected.status === 'active'
                ? `${teamAnswers.length} of ${selected.totalTeams} teams · ${responses.length} of ${selected.totalManagers} managers`
                : `${teamAnswers.length} team responses · ${responses.length} managers`}</p>
              <div className={surveyStyles.answerCounts}>
                {counts.map((answer, index) => (
                  <div key={answer.value}>
                    <span>{index + 1}. {answer.label}: {answer.count}</span>
                    <progress value={answer.count} max={Math.max(1, teamAnswers.length)}>
                      {answer.count} of {teamAnswers.length}
                    </progress>
                  </div>
                ))}
                {surveyImportance.map((answer, index) => (
                  <div key={answer.value}>
                    <span>120m {index + 1}. {answer.label}: {responses.filter((response) => response.manager_importance === answer.value).length}</span>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
          <SectionCard title="Drafts" className={styles.surfaceCard}>
            <Button onClick={() => setEditing((current) => !current)}>{editing ? 'Close editor' : 'Create draft'}</Button>
          </SectionCard>
        </aside>
      </div>
    </div>
  );
}
