import { useEffect, useRef, useState } from 'react';
import { Button } from '../Button/Button';
import { surveyImportance, surveyPriorities, type SurveyImportance, type SurveyPriority, type SurveyVariant } from '../../../shared/survey';
import styles from './ManagerSurveyMock.module.sass';

type SurveyTeam = { id: string; name: string; logo_url?: string };
type SurveyPrompt = { id: string; variant: SurveyVariant; managerName: string; teams: SurveyTeam[] };

export function ManagerSurveyMock({ tournamentId }: { tournamentId: string }) {
  const [survey, setSurvey] = useState<SurveyPrompt | null>(null);
  const [open, setOpen] = useState(true);
  const [teamIndex, setTeamIndex] = useState(0);
  const [step, setStep] = useState<'teams' | 'manager' | 'thanks'>('teams');
  const [answers, setAnswers] = useState<Record<string, { priority?: SurveyPriority; comments?: string }>>({});
  const [managerImportance, setManagerImportance] = useState<SurveyImportance | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/app?route=manager-survey&tournamentId=${encodeURIComponent(tournamentId)}`, {
      credentials: 'include', signal: controller.signal, cache: 'no-store',
    }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json();
      if (!controller.signal.aborted && data.survey && Array.isArray(data.teams)) {
        setSurvey({ ...data.survey, managerName: data.managerName, teams: data.teams });
      }
    }).catch(() => {});
    return () => controller.abort();
  }, [tournamentId]);

  const teams = survey?.teams ?? [];

  const submit = async () => {
    if (!survey || !managerImportance || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const response = await fetch('/api/app?route=manager-survey', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId, surveyId: survey.id, managerImportance,
          answers: teams.map((team) => ({ teamId: team.id, priority: answers[team.id]?.priority,
            comments: answers[team.id]?.comments ?? '' })) }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Could not save the survey. Please try again.');
      }
      setStep('thanks');
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not save the survey. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!open || !survey || teams.length === 0) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key !== 'Tab') return;
      const focusable = overlayRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled)',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!overlayRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [open, survey, teams.length]);

  if (!open || !survey || teams.length === 0) return null;
  const team = teams[teamIndex];
  const answer = answers[team.id] ?? {};
  const setAnswer = (update: { priority?: SurveyPriority; comments?: string }) =>
    setAnswers((current) => ({
      ...current,
      [team.id]: { ...current[team.id], ...update },
    }));

  return (
    <div
      ref={overlayRef}
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="manager-survey-title"
    >
      <div className={styles.contentWrapper}>
        <div className={styles.content}>
          <button
            ref={closeRef}
            className={styles.close}
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close survey"
          >
            ×
          </button>
          {step === 'thanks' ? (
            <>
              <h1 id="manager-survey-title">Thank you, {survey.managerName}!</h1>
              <p>Happy to have you around! Have a great tournament!</p>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </>
          ) : (
            <>
              {step === 'teams' ? (
                <>
                  <h1 id="manager-survey-title">Welcome back, {survey.managerName}!</h1>
                  <p className={styles.subTitle}>
                    Please answer this question to store as your team preference. This will be taken in account when
                    pairing your teams against future opponents.
                  </p>
                  <div className={styles.team}>
                    {team.logo_url && <img src={team.logo_url} alt="" width={48} height={48} />}
                    <strong>{team.name}</strong>
                  </div>
                  <fieldset className={styles.fieldset}>
                    <legend>When a choice has to be made, what matters most for this team?</legend>
                    {surveyPriorities[survey.variant].map((option) => (
                      <label
                        className={`${styles.option} ${answer.priority === option.value ? styles.selected : answer.priority ? styles.inactive : ''}`}
                        key={option.value}
                      >
                        <input
                          type="radio"
                          name={`priority-${team.id}`}
                          checked={answer.priority === option.value}
                          onChange={() => setAnswer({ priority: option.value })}
                        />
                        {option.label}
                      </label>
                    ))}
                  </fieldset>
                  <label htmlFor={`survey-team-comments-${team.id}`}>
                    Adittional comments about <strong>{team.name}</strong> preferences:
                  </label>
                  <textarea
                    id={`survey-team-comments-${team.id}`}
                    value={answer.comments ?? ''}
                    onChange={(event) => setAnswer({ comments: event.target.value })}
                    maxLength={1000}
                    rows={2}
                  />
                  <div className={styles.actions}>
                    {teamIndex > 0 && (
                      <Button variant="outline" onClick={() => setTeamIndex(teamIndex - 1)}>
                        Previous team
                      </Button>
                    )}
                    <Button
                      disabled={!answer.priority}
                      onClick={() => (teamIndex + 1 < teams.length ? setTeamIndex(teamIndex + 1) : setStep('manager'))}
                    >
                      {teamIndex + 1 < teams.length ? 'Next team' : 'Continue'}
                    </Button>
                  </div>
                  <p className={styles.teamCount}>
                    {teams.length > 0 && teamIndex + 1}/{teams.length} teams
                  </p>
                </>
              ) : (
                <>
                  <h1 id="manager-survey-title">Last one!</h1>
                  <fieldset className={styles.fieldset}>
                    <legend>In general, how important are 120-minute matches to you?</legend>
                    {surveyImportance.map((option) => (
                      <label
                        className={`${styles.option} ${managerImportance === option.value ? styles.selected : managerImportance ? styles.inactive : ''}`}
                        key={option.value}
                      >
                        <input
                          type="radio"
                          name="manager-importance"
                          checked={managerImportance === option.value}
                          onChange={() => setManagerImportance(option.value)}
                        />
                        {option.label}
                      </label>
                    ))}
                  </fieldset>
                  <div className={styles.actions}>
                    <Button variant="outline" onClick={() => setStep('teams')}>
                      Back
                    </Button>
                    <Button disabled={!managerImportance || submitting} onClick={() => void submit()}>
                      {submitting ? 'Submitting…' : 'Submit'}
                    </Button>
                  </div>
                  {submitError && <p role="alert">{submitError}</p>}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
