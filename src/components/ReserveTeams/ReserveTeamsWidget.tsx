'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'phosphor-react';
import { getCountryWorldDetails } from '../../../shared/worlddetails';
import styles from './ReserveTeamsWidget.module.sass';

interface ReserveTeam {
  id: string;
  name: string;
  ht_team_id: number;
  logo_url?: string | null;
  country_name?: string | null;
  country_id?: number | null;
  manager_name?: string | null;
  hattrick_user_id?: number | null;
}

interface MyReserveTeam {
  team_id: number;
  name: string;
  logo_url?: string | null;
  country_name?: string | null;
  country_id?: number | null;
  eligible: boolean;
  reason?: string;
  state: 'participant' | 'reserve' | 'available';
  existing_team_id?: string | null;
}

interface ReserveTeamsResponse {
  authenticated: boolean;
  reserveTeams: ReserveTeam[];
  myTeams: MyReserveTeam[];
}

interface ReserveTeamsWidgetProps {
  tournamentId: string;
}

const teamHref = (teamId: number) =>
  `https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${teamId}`;

export const ReserveTeamsWidget: React.FC<ReserveTeamsWidgetProps> = ({ tournamentId }) => {
  const [data, setData] = useState<ReserveTeamsResponse | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readData = useCallback(async () => {
    const response = await fetch(`/api/app?route=reserve-teams&tournamentId=${encodeURIComponent(tournamentId)}`);
    const next = (await response.json()) as ReserveTeamsResponse & { error?: string };
    if (!response.ok) throw new Error(next.error || 'Could not load reserve teams.');
    return next;
  }, [tournamentId]);

  const applyData = useCallback((next: ReserveTeamsResponse) => {
    setData(next);
    setSelectedTeamId((current) => current || String(next.myTeams.find((team) => team.state === 'available')?.team_id || ''));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void readData()
      .then((next) => {
        if (!cancelled) applyData(next);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load reserve teams.');
      });
    return () => {
      cancelled = true;
    };
  }, [applyData, readData]);

  const availableTeams = useMemo(
    () => data?.myTeams.filter((team) => team.state === 'available') || [],
    [data],
  );
  const ownReserve = data?.myTeams.filter((team) => team.state === 'reserve') || [];

  const post = async (action: 'join' | 'leave', teamId: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/app?route=reserve-teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, tournamentId, teamId }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not update the reserve list.');
      applyData(await readData());
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Could not update the reserve list.');
    } finally {
      setBusy(false);
    }
  };

  const login = () => {
    document.cookie = `auth_return_url=${encodeURIComponent(window.location.pathname + window.location.search)}; path=/; max-age=300`;
    window.location.href = '/api/auth/init';
  };

  return (
    <section className={styles.widget} aria-labelledby="reserve-teams-title">
      <h2 id="reserve-teams-title"><ShieldCheck size={18} weight="bold" /> Reserve teams</h2>
      <p className={styles.intro}>Emergency opponents who are willing to step in when a fixture loses a team.</p>
      <div className={styles.list}>
        {(data?.reserveTeams || []).map((team) => (
          <div className={styles.team} key={team.id}>
            <img src={team.logo_url || '/default-logo.png'} alt="" />
            <div>
              <a href={teamHref(team.ht_team_id)} target="_blank" rel="noopener noreferrer">{team.name}</a>
              <span>
                {team.manager_name && team.hattrick_user_id ? (
                  <a href={`https://www.hattrick.org/goto.ashx?path=/Club/Manager/?userId=${team.hattrick_user_id}`} target="_blank" rel="noopener noreferrer">
                    {team.manager_name}
                  </a>
                ) : team.manager_name}
                {team.country_id ? ` ${getCountryWorldDetails(team.country_id)?.emoji || ''}` : ''}
              </span>
            </div>
          </div>
        ))}
        {data && data.reserveTeams.length === 0 && <p className={styles.empty}>No reserve teams yet.</p>}
      </div>
      {data?.authenticated ? (
        <div className={styles.actions}>
          {ownReserve.map((team) => (
            <button type="button" key={team.team_id} onClick={() => post('leave', team.existing_team_id || '')} disabled={busy}>
              Leave {team.name}
            </button>
          ))}
          {availableTeams.length > 0 && (
            <div className={styles.joinAction}>
              {availableTeams.length > 1 && (
                <select value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)} disabled={busy}>
                  {availableTeams.map((team) => <option key={team.team_id} value={team.team_id}>{team.name}</option>)}
                </select>
              )}
              <button type="button" onClick={() => post('join', selectedTeamId)} disabled={busy || !selectedTeamId}>
                Join reserve list
              </button>
            </div>
          )}
        </div>
      ) : (
        <button type="button" className={styles.login} onClick={login}>Login to join reserve list</button>
      )}
      {(error || availableTeams.some((team) => team.reason)) && <p className={styles.error}>{error || availableTeams.find((team) => team.reason)?.reason}</p>}
    </section>
  );
};
