'use client';

import { useTranslations } from 'next-intl';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Flag } from 'phosphor-react';
import type { FlagQuizState } from '../../../shared/flag-quiz';
import { Button } from '../Button/Button';
import { ReusableWidget } from '../ReusableWidget/ReusableWidget';
import styles from './SidebarPollWidget.module.sass';

const QUIZ_URL = '/api/app?route=flag-quiz';

export const SidebarPollWidget: React.FC<{ myHtUserId: number | null }> = ({ myHtUserId }) => {
  const t = useTranslations('PublicUI.SidebarPollWidget');
  const [quiz, setQuiz] = useState<FlagQuizState | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'loadError' | 'saveError' | 'expired' | 'sessionExpired' | null>(null);
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const response = await fetch(QUIZ_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error('Quiz unavailable');
      const next: FlagQuizState = await response.json();
      if (version !== requestVersion.current) return false;
      setQuiz(next);
      setSelected(null);
      setError(null);
      return true;
    } catch {
      if (version === requestVersion.current) setError('loadError');
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const requests = requestVersion;
    void Promise.resolve().then(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; requests.current++; };
  }, [load, myHtUserId]);

  useEffect(() => {
    if (!quiz) return;
    const delay = Math.max(1000, Date.parse(quiz.question.expiresAt) - Date.now() + 250);
    const timer = window.setTimeout(() => { void load(); }, delay);
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [quiz, load]);

  const login = () => {
    document.cookie = `auth_return_url=${encodeURIComponent(window.location.pathname + window.location.search)}; path=/; max-age=300`;
    window.location.href = '/api/auth/init';
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!quiz || selected === null || busy || quiz.answer) return;
    const version = ++requestVersion.current;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(QUIZ_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: quiz.question.id, selectedLeagueId: selected }),
      });
      if (response.status === 409) {
        if (await load()) setError('expired');
        return;
      }
      if (response.status === 401) {
        if (version === requestVersion.current) {
          setQuiz({ ...quiz, canAnswer: false });
          setError('sessionExpired');
        }
        return;
      }
      if (!response.ok) throw new Error('Answer unavailable');
      const next: FlagQuizState = await response.json();
      if (version === requestVersion.current) { setQuiz(next); setSelected(null); }
    } catch {
      if (version === requestVersion.current) setError('saveError');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ReusableWidget title={t('flagQuiz')} icon={<Flag size={20} weight="bold" />} className={styles.widget}>
      {quiz ? <>
        <span className={styles.flag} role="img" aria-label={t('flagLabel')}>{quiz.question.emoji}</span>
        <p className={styles.question}>{t('question')}</p>
        {quiz.answer && quiz.results ? <div className={styles.results} aria-live="polite">
          <span>{t('totalAnswers', { count: quiz.results.total })}</span>
          <ol className={styles.resultList}>
            {quiz.question.options.map((option) => {
              const count = quiz.results!.options.find((result) => result.leagueId === option.leagueId)?.count ?? 0;
              const percent = quiz.results!.total ? Math.round(count / quiz.results!.total * 100) : 0;
              const correct = option.leagueId === quiz.answer!.correctLeagueId;
              const mine = option.leagueId === quiz.answer!.selectedLeagueId;
              return <li key={option.leagueId} className={styles.resultItem}>
                <div className={styles.resultHeading}><span>{option.name}</span><span>{percent}% · {count}</span></div>
                <div className={styles.bar} aria-hidden="true"><span className={correct ? styles.correctBar : styles.fill} style={{ width: `${percent}%` }} /></div>
                {(mine || correct) && <span className={styles.markers}>{[mine && t('yourGuess'), correct && t('correctAnswer')].filter(Boolean).join(' · ')}</span>}
              </li>;
            })}
          </ol>
          {quiz.leaders.length > 0 && <div className={styles.leaderboard}>
            <strong>{t('bestThisMonth')}</strong>
            <ol className={styles.leaders}>{quiz.leaders.map((leader, index) => <li key={index}>
              <span>{leader.rank}. {leader.managerName}</span>
              <span>{t('score', { correct: leader.correct, attempted: leader.attempted })}</span>
            </li>)}</ol>
          </div>}
        </div> : <form onSubmit={submit} className={styles.form}>
          <fieldset disabled={busy || !quiz.canAnswer} className={styles.options}>
            <legend className={styles.legend}>{t('chooseCountry')}</legend>
            {quiz.question.options.map((option) => <label key={option.leagueId} className={styles.option}>
              <input type="radio" name={`flag-quiz-${quiz.question.id}`} value={option.leagueId}
                checked={selected === option.leagueId} onChange={() => setSelected(option.leagueId)} />
              <span>{option.name}</span>
            </label>)}
          </fieldset>
          {quiz.canAnswer ? <Button type="submit" size="sm" fullWidth disabled={selected === null || busy}>
            {busy ? t('submitting') : t('submitGuess')}
          </Button> : <Button type="button" size="sm" fullWidth onClick={login}>{t('loginToGuess')}</Button>}
        </form>}
        <span className={styles.notice}>{t('rotationNotice')}</span>
      </> : !error && <p className={styles.notice} role="status">{t('loading')}</p>}
      {error && <p className={styles.error} role="alert">{t(error)}</p>}
      {error === 'loadError' && <Button type="button" size="sm" onClick={() => { void load(); }}>{t('retry')}</Button>}
    </ReusableWidget>
  );
};
