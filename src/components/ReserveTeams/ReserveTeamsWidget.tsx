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
  planning_status?: {
    inCup: boolean | null;
    bookedOutsideTournament: boolean;
  } | null;
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
  allowReserveRegistration: boolean;
  reserveTeams: ReserveTeam[];
  myTeams: MyReserveTeam[];
}

interface ReserveTeamsWidgetProps {
  tournamentId: string;
}

const teamHref = (teamId: number) => `https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${teamId}`;

const reserveTeamsPreviewMode =
  process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_RESERVE_TEAMS_PREVIEW === '1';
const previewTeamId = 900101;
const previewTeamRowId = 'reserve-preview-team';
const previewTeam: MyReserveTeam = {
  team_id: previewTeamId,
  name: 'Preview Reserve FC',
  logo_url: null,
  country_name: 'Guam',
  country_id: 117,
  eligible: true,
  state: 'available',
  existing_team_id: null,
};

export const ReserveTeamsWidget: React.FC<ReserveTeamsWidgetProps> = ({ tournamentId }) => {
  const [data, setData] = useState<ReserveTeamsResponse | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readData = useCallback(async () => {
    try {
      const response = await fetch(`/api/app?route=reserve-teams&tournamentId=${encodeURIComponent(tournamentId)}`, {
        cache: 'no-store',
      });
      const next = (await response.json()) as ReserveTeamsResponse & { error?: string };
      if (!response.ok) throw new Error(next.error || 'Could not load reserve teams.');
      if (!reserveTeamsPreviewMode) return next;
      return {
        ...next,
        authenticated: true,
        myTeams: [previewTeam],
      };
    } catch (reason: unknown) {
      if (!reserveTeamsPreviewMode) throw reason;
      return {
        authenticated: true,
        reserveTeams: [],
        myTeams: [previewTeam],
      } satisfies ReserveTeamsResponse;
    }
  }, [tournamentId]);

  const applyData = useCallback((next: ReserveTeamsResponse) => {
    setData(next);
    setSelectedTeamId(
      (current) => current || String(next.myTeams.find((team) => team.state === 'available')?.team_id || ''),
    );
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

  const availableTeams = useMemo(() => data?.myTeams.filter((team) => team.state === 'available') || [], [data]);
  const ownReserve = data?.myTeams.filter((team) => team.state === 'reserve') || [];

  if (data && !data.allowReserveRegistration && data.reserveTeams.length === 0) return null;

  const post = async (action: 'join' | 'leave', teamId: string) => {
    setBusy(true);
    setError(null);
    try {
      if (reserveTeamsPreviewMode) {
        setData((current) => {
          if (!current) return current;
          const isJoining = action === 'join';
          const nextTeam = {
            ...previewTeam,
            state: isJoining ? ('reserve' as const) : ('available' as const),
            existing_team_id: isJoining ? previewTeamRowId : null,
          };
          return {
            ...current,
            reserveTeams: isJoining
              ? [
                  ...current.reserveTeams,
                  {
                    id: previewTeamRowId,
                    name: previewTeam.name,
                    ht_team_id: previewTeam.team_id,
                    logo_url: previewTeam.logo_url,
                    country_name: previewTeam.country_name,
                    country_id: previewTeam.country_id,
                    manager_name: 'Preview manager',
                    hattrick_user_id: 9001001,
                  },
                ]
              : current.reserveTeams.filter((team) => team.id !== previewTeamRowId),
            myTeams: [nextTeam],
          };
        });
        return;
      }
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
    <section
      id="reserve-teams-widget"
      className={styles.widget}
      aria-labelledby="reserve-teams-title"
      tabIndex={-1}
    >
      <h2 id="reserve-teams-title">
        <ShieldCheck size={18} weight="bold" /> Reserve teams
      </h2>
      <p className={styles.intro}>
        Teams in the reserve list will be contacted first if a position opens in the tournament. They are also valid
        opponents that can replace your planned fixture partner when necessary.
      </p>
      {data && !data.allowReserveRegistration && (
        <p className={styles.previewNote}>Reserve team registration is currently closed.</p>
      )}
      {reserveTeamsPreviewMode && (
        <p className={styles.previewNote}>Local preview only. Join and Leave do not contact Supabase or Hattrick.</p>
      )}
      <div className={styles.list}>
        {(data?.reserveTeams || []).map((team) => {
          const planningStatus = team.planning_status;
          const hasPlanningStatus = planningStatus?.inCup === true || planningStatus?.bookedOutsideTournament;
          return (
            <div className={styles.team} key={team.id}>
              <img src={team.logo_url || '/default-logo.png'} alt="" />
              <div>
                <div className={styles.teamName}>
                  <a href={teamHref(team.ht_team_id)} target="_blank" rel="noopener noreferrer">
                    {team.name}
                  </a>
                  {hasPlanningStatus && (
                    <span className={styles.planningStatus}>
                      {planningStatus.inCup === true && '[in cup]'}
                      {planningStatus.inCup === true && planningStatus.bookedOutsideTournament && ' '}
                      {planningStatus.bookedOutsideTournament && '[booked]'}
                    </span>
                  )}
                </div>
                <span>
                  {team.manager_name && team.hattrick_user_id ? (
                    <a
                      href={`https://www.hattrick.org/goto.ashx?path=/Club/Manager/?userId=${team.hattrick_user_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {team.manager_name}
                    </a>
                  ) : (
                    team.manager_name
                  )}
                  {team.country_id ? ` ${getCountryWorldDetails(team.country_id)?.emoji || ''}` : ''}
                </span>
              </div>
            </div>
          );
        })}
        {data && data.reserveTeams.length === 0 && <p className={styles.empty}>No reserve teams yet.</p>}
      </div>
      {data?.authenticated ? (
        <div className={styles.actions}>
          {ownReserve.map((team) => (
            <button
              type="button"
              key={team.team_id}
              onClick={() => post('leave', team.existing_team_id || '')}
              disabled={busy}
            >
              Remove {team.name}
            </button>
          ))}
          {data.allowReserveRegistration && availableTeams.length > 0 && (
            <div className={styles.joinAction}>
              {availableTeams.length > 1 && (
                <select
                  value={selectedTeamId}
                  onChange={(event) => setSelectedTeamId(event.target.value)}
                  disabled={busy}
                >
                  {availableTeams.map((team) => (
                    <option key={team.team_id} value={team.team_id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" onClick={() => post('join', selectedTeamId)} disabled={busy || !selectedTeamId}>
                Join reserve list
              </button>
            </div>
          )}
        </div>
      ) : data?.allowReserveRegistration ? (
        <button type="button" className={styles.login} onClick={login}>
          Login to join reserve list
        </button>
      ) : null}
      {(error || availableTeams.some((team) => team.reason)) && (
        <p className={styles.error}>{error || availableTeams.find((team) => team.reason)?.reason}</p>
      )}
    </section>
  );
};
