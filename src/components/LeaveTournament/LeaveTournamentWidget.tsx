'use client';

import { useTranslations } from 'next-intl';
import { SignOut } from 'phosphor-react';
import { useEffect, useState } from 'react';
import styles from './LeaveTournamentWidget.module.sass';

type OwnTeam = { id: string; name: string; checked: boolean };

export function LeaveTournamentWidget({ tournamentId, roundId }: { tournamentId: string; roundId: string }) {
  const text = useTranslations('PublicUI.LeaveTournamentWidget');
  const [teams, setTeams] = useState<OwnTeam[]>([]);
  const [busyTeamId, setBusyTeamId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setTeams([]);
    setError('');
    void fetch(`/api/app?route=tournament-team-departure&tournamentId=${encodeURIComponent(tournamentId)}`, {
      credentials: 'include', cache: 'no-store',
    }).then(async (response) => {
      const result = (await response.json()) as { teams?: OwnTeam[]; error?: string };
      if (!response.ok) throw new Error(result.error || text('loadFailed'));
      if (!cancelled) setTeams(result.teams || []);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : text('loadFailed'));
    });
    return () => { cancelled = true; };
  }, [tournamentId, roundId, text]);

  const change = async (team: OwnTeam, checked: boolean) => {
    setBusyTeamId(team.id);
    setError('');
    try {
      const response = await fetch('/api/app?route=tournament-team-departure', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId, teamId: team.id, checked }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || text('saveFailed'));
      setTeams((current) => current.map((item) => item.id === team.id ? { ...item, checked } : item));
      window.dispatchEvent(new Event('tournament-departure-updated'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text('saveFailed'));
    } finally {
      setBusyTeamId(null);
    }
  };

  if (teams.length === 0 && !error) return null;
  return (
    <section className={styles.widget} aria-labelledby="leave-tournament-title">
      <h2 id="leave-tournament-title"><SignOut size={18} weight="bold" /> {text('title')}</h2>
      {teams.map((team) => (
        <div key={team.id} className={styles.team}>
          {teams.length > 1 && <strong>{team.name}</strong>}
          <label className={styles.checkbox}>
            <input type="checkbox" checked={team.checked} disabled={busyTeamId !== null}
              onChange={(event) => void change(team, event.target.checked)} />
            {text('afterRound')}
          </label>
        </div>
      ))}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
