import { useEffect, useRef, useState } from 'react';
import { Button } from '../Button/Button';
import styles from './ManagerSurveyMock.module.sass';

type SurveyTeam = { id: string; name: string; logo_url?: string };

const priorities = [
  { value: 'flags', label: '🇲🇵 Collecting new flags' },
  { value: '120m', label: '⏱ 120-minute matches' },
  { value: 'both', label: '🖇 Both are equally important to this teams' },
  { value: 'fun', label: "🥂 It's here for challenge, fun and no-hassle friendlies" },
] as const;
const importance = [
  '☝️ Highly important',
  '👌 Nice to have',
  '⚽️ Depends on team or current training plan',
  "🏛 I'd prefer regular matches",
];

export function ManagerSurveyMock({ teams }: { teams: SurveyTeam[] }) {
  const [open, setOpen] = useState(true);
  const [teamIndex, setTeamIndex] = useState(0);
  const [step, setStep] = useState<'teams' | 'comments' | 'thanks'>('teams');
  const [answers, setAnswers] = useState<Record<string, { priority?: string; importance?: string }>>({});
  const [comments, setComments] = useState('');
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || teams.length === 0) return;
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
  }, [open, teams.length]);

  if (!open || teams.length === 0) return null;
  const team = teams[teamIndex];
  const answer = answers[team.id] ?? {};
  const setAnswer = (update: { priority?: string; importance?: string }) =>
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
        <h1 id="manager-survey-title">
          <br />
          Welcome back, mr_bots!
        </h1>
        {step === 'thanks' ? (
          <>
            <p>Happy to have you around! Have a great tournament!</p>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </>
        ) : (
          <>
            <p className={styles.subTitle}>
              Please answer this question to store as your team preference. This will be taken in account when pairing
              your teams against future opponents.
            </p>
            {step === 'teams' ? (
              <>
                <div className={styles.team}>
                  {team.logo_url && <img src={team.logo_url} alt="" width={48} height={48} />}
                  <strong>{team.name}</strong>
                </div>
                <fieldset className={styles.fieldset}>
                  <legend>When a choice has to be made, what matters more for this team?</legend>
                  {priorities.map((option) => (
                    <label className={styles.option} key={option.value}>
                      <input
                        type="radio"
                        name={`priority-${team.id}`}
                        checked={answer.priority === option.value}
                        onChange={() => setAnswer({ priority: option.value, importance: undefined })}
                      />
                      {option.label}
                    </label>
                  ))}
                </fieldset>
                {answer.priority && answer.priority !== '120m' && (
                  <fieldset className={styles.fieldset}>
                    <legend>How important are 120-minute matches to you?</legend>
                    {importance.map((option) => (
                      <label className={styles.option} key={option}>
                        <input
                          type="radio"
                          name={`importance-${team.id}`}
                          checked={answer.importance === option}
                          onChange={() => setAnswer({ importance: option })}
                        />{' '}
                        {option}
                      </label>
                    ))}
                  </fieldset>
                )}
                <div className={styles.actions}>
                  {teamIndex > 0 && (
                    <Button variant="outline" onClick={() => setTeamIndex(teamIndex - 1)}>
                      Previous team
                    </Button>
                  )}
                  <Button
                    disabled={!answer.priority || (answer.priority !== '120m' && !answer.importance)}
                    onClick={() => (teamIndex + 1 < teams.length ? setTeamIndex(teamIndex + 1) : setStep('comments'))}
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
                <label htmlFor="survey-comments">Additional comments</label>
                <textarea
                  id="survey-comments"
                  value={comments}
                  onChange={(event) => setComments(event.target.value)}
                  rows={5}
                />
                <div className={styles.actions}>
                  <Button variant="outline" onClick={() => setStep('teams')}>
                    Back
                  </Button>
                  <Button onClick={() => setStep('thanks')}>Submit</Button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
