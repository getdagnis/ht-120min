'use client';

import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DotsThreeVertical } from 'phosphor-react';
import { useClientNow } from '../../../hooks/useHydratedBrowserState';
import { supabase } from '../../../lib/supabase';
import { getCountryFlagUrl } from '../../../utils/ht-data';
import { Tooltip } from '../../Tooltip/Tooltip';
import {
  formatTeamJoinedAge,
  getAdminTeamTableStats,
  getHighRiskManagerTeamIds,
  type TeamRisk,
  type TeamTableStats,
} from '../../../utils/admin-team-table';
import type { RoundWithMatches, Team } from '../../../legacy-pages/Public/TournamentView';
import styles from './ActiveTeamsTable.module.sass';

type SortKey = 'team' | 'manager' | 'played' | 'misarranged' | 'fixture' | 'risk' | 'now' | 'joined';
type Filter = 'all' | 'high-risk' | 'high-risk-managers' | 'conflict' | 'no-games' | 'leaving';
interface WarningRow {
  team_id: string;
  round_id: string;
  reason: string;
  active: boolean;
}
interface AssignmentRow {
  team_id: string | null;
  assigned_at: string;
  released_at: string | null;
}

const riskRank: Record<TeamRisk, number> = { critical: 5, high: 4, medium: 3, low: 2, none: 1, unknown: 0 };
const nowRank: Record<TeamTableStats['now'], number> = {
  conflict: 7,
  'no-fixture': 6,
  unbooked: 5,
  unknown: 4,
  bye: 3,
  booked: 2,
  played: 1,
  none: 0,
};
const nowLabel: Record<TeamTableStats['now'], string> = {
  conflict: 'Misr.',
  'no-fixture': 'No fixture',
  unbooked: 'Unbooked',
  unknown: 'Unknown',
  bye: 'BYE',
  booked: 'Arngd.',
  played: 'Played',
  none: '—',
};
const nowDetail: Record<TeamTableStats['now'], string> = {
  conflict: 'Fixture misarranged',
  'no-fixture': 'No opponent assigned',
  unbooked: 'Fixture not arranged',
  unknown: 'Fixture status unknown',
  bye: 'BYE',
  booked: 'Arranged',
  played: 'Played',
  none: 'No upcoming fixture',
};
const misarrangedTooltip = (stats: TeamTableStats) => stats.misarrangedRounds === null
  ? 'Warning history unavailable.'
  : stats.misarrangedRounds.length
    ? `Misarranged by this team:\n${stats.misarrangedRounds.join('\n')}`
    : 'No misarrangements attributed to this team.';
const nextTooltip = (stats: TeamTableStats) => {
  if (!stats.nextRoundLabel) return 'No upcoming fixture in the open rounds.';
  return [
    stats.nextRoundLabel,
    stats.nextOpponentName ? `Opponent: ${stats.nextOpponentName}` : null,
    nowDetail[stats.now],
    stats.now === 'conflict'
      ? `Counted in Misr.: ${stats.nextOwnWarning === null ? 'warning history unavailable' : stats.nextOwnWarning ? 'yes' : 'no'}`
      : null,
  ].filter(Boolean).join('\n');
};
const riskLabel: Record<TeamRisk, string> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
  none: '✓',
  unknown: '—',
};
interface Props {
  tournamentId: string;
  teams: Team[];
  rounds: RoundWithMatches[];
  focusedRoundId: string | null;
  assignments: AssignmentRow[];
  leavingTeamIds: ReadonlySet<string>;
  renderTeamMarkers?: (team: Team) => React.ReactNode;
  renderActions: (team: Team, stats: TeamTableStats) => React.ReactNode;
}

export function ActiveTeamsTable({
  tournamentId,
  teams,
  rounds,
  focusedRoundId,
  assignments,
  leavingTeamIds,
  renderTeamMarkers,
  renderActions,
}: Props) {
  const [warningState, setWarningState] = useState<{ key: string; rows: WarningRow[] | null; error: boolean } | null>(
    null,
  );
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('risk');
  const [ascending, setAscending] = useState(false);
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const tooltipId = useId();
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const now = useClientNow(60 * 60 * 1000);

  const roundIds = useMemo(
    () =>
      rounds
        .filter((round) => round.phase !== 'postseason' && round.is_unscored !== true)
        .map((round) => round.id),
    [rounds],
  );
  const roundIdsKey = roundIds.join(',');
  const warningKey = `${tournamentId}:${roundIdsKey}`;
  const warnings = useMemo(
    () => (roundIds.length === 0 ? [] : warningState?.key === warningKey ? warningState.rows : null),
    [roundIds.length, warningState, warningKey],
  );
  const warningError = warningState?.key === warningKey && warningState.error;
  useEffect(() => {
    let cancelled = false;
    if (roundIds.length === 0) return;
    const load = async () => {
      const rows: WarningRow[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase
          .from('fixture_warnings')
          .select('team_id,round_id,reason,active,id')
          .eq('tournament_id', tournamentId)
          .eq('reason', 'misarranged')
          .in('round_id', roundIds)
          .order('id', { ascending: true })
          .range(offset, offset + 499);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < 500) break;
      }
      if (!cancelled) setWarningState({ key: warningKey, rows, error: false });
    };
    void load().catch(() => {
      if (!cancelled) setWarningState({ key: warningKey, rows: null, error: true });
    });
    return () => {
      cancelled = true;
    };
    // The joined IDs represent the current season's round set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warningKey]);

  const rows = useMemo(
    () =>
      teams.map((team) => ({
        team,
        stats: getAdminTeamTableStats(team, rounds, warnings, assignments, focusedRoundId),
      })),
    [teams, rounds, warnings, assignments, focusedRoundId],
  );
  const highRiskManagerTeamIds = useMemo(
    () => getHighRiskManagerTeamIds(rows.map(({ team, stats }) => ({ team, risk: stats.risk }))),
    [rows],
  );
  const visibleRows = useMemo(
    () =>
      rows
        .filter(({ team, stats }) => {
          const needle = search.trim().toLocaleLowerCase();
          if (
            needle &&
            !`${team.name} ${team.manager_name || ''} ${team.ht_team_id}`.toLocaleLowerCase().includes(needle)
          )
            return false;
          if (filter === 'high-risk') return stats.risk === 'critical' || stats.risk === 'high';
          if (filter === 'high-risk-managers') return highRiskManagerTeamIds.has(team.id);
          if (filter === 'conflict') return stats.now === 'conflict';
          if (filter === 'no-games') return stats.played === 0;
          if (filter === 'leaving') return leavingTeamIds.has(team.id);
          return true;
        })
        .sort((a, b) => {
          const value = (row: typeof a): string | number | null => {
            switch (sortKey) {
              case 'team':
                return row.team.name.toLocaleLowerCase();
              case 'manager':
                return row.team.manager_name?.trim().toLocaleLowerCase() || null;
              case 'played':
                return row.stats.played;
              case 'misarranged':
                return row.stats.misarranged;
              case 'fixture':
                return row.stats.fixture === null ? null : Number(row.stats.fixture);
              case 'risk':
                return riskRank[row.stats.risk];
              case 'now':
                return nowRank[row.stats.now];
              case 'joined':
                return Date.parse(row.team.created_at);
            }
          };
          const first = value(a);
          const second = value(b);
          if (first === null || second === null) return first === null ? (second === null ? 0 : 1) : -1;
          const order =
            typeof first === 'string' && typeof second === 'string'
              ? first.localeCompare(second)
              : Number(first) - Number(second);
          return (
            (ascending ? order : -order) ||
            (sortKey === 'risk' ? b.stats.latestMisarrangedRound - a.stats.latestMisarrangedRound : 0) ||
            a.team.name.localeCompare(b.team.name) ||
            a.team.id.localeCompare(b.team.id)
          );
        }),
    [rows, search, filter, sortKey, ascending, leavingTeamIds, highRiskManagerTeamIds],
  );
  const openRow = visibleRows.find(({ team }) => team.id === openActionsId);
  const openTeam = openRow?.team;

  useLayoutEffect(() => {
    if (!openTeam) return;
    const trigger = document.getElementById(`admin-team-actions-${openTeam.id}`);
    const menu = actionMenuRef.current;
    if (!trigger || !menu) return;

    const position = () => {
      const anchor = trigger.getBoundingClientRect();
      const gap = 6;
      const gutter = 8;
      const above = anchor.top - gutter - gap;
      const below = window.innerHeight - anchor.bottom - gutter - gap;
      const placeAbove = above >= Math.min(menu.scrollHeight, 160) || above >= below;
      const available = Math.max(80, placeAbove ? above : below);
      menu.style.maxHeight = `${available}px`;
      const height = Math.min(menu.scrollHeight, available);
      menu.style.top = `${placeAbove ? Math.max(gutter, anchor.top - height - gap) : anchor.bottom + gap}px`;
      menu.style.left = `${Math.max(gutter, Math.min(anchor.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - gutter))}px`;
      menu.style.visibility = 'visible';
    };

    position();
    menu.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')?.focus();
    const observer = new ResizeObserver(position);
    observer.observe(menu);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [openTeam]);

  useEffect(() => {
    if (!openTeam) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !actionMenuRef.current?.contains(target) &&
        !document.getElementById(`admin-team-actions-${openTeam.id}`)?.contains(target)
      )
        setOpenActionsId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpenActionsId(null);
      document.getElementById(`admin-team-actions-${openTeam.id}`)?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openTeam]);

  const setSort = (key: SortKey) => {
    setOpenActionsId(null);
    if (sortKey === key) setAscending((value) => !value);
    else {
      setSortKey(key);
      setAscending(key === 'team' || key === 'manager' || key === 'joined');
    }
  };
  const headers: Array<{ key: SortKey; label: string; title: string }> = [
    { key: 'played', label: 'Played', title: 'Games played' },
    { key: 'misarranged', label: 'Misr.', title: 'Recorded misarranged games attributed to this team' },
    { key: 'fixture', label: 'Fixture', title: 'Fixture status for each open round, in calendar order' },
    {
      key: 'risk',
      label: 'Risk',
      title: 'Recorded team misarrangements in the last five eligible rounds',
    },
    {
      key: 'now',
      label: 'Next',
      title: 'Earliest open fixture for this team. Misr. means the fixture was misarranged.',
    },
    {
      key: 'joined',
      label: 'Joined',
      title: 'Time since joining. 3.2w means 3 weeks and 2 days; from week four, only full weeks are shown.',
    },
  ];

  return (
    <div ref={setPortalHost} className={styles.root}>
      <div className={styles.controls}>
        <input
          type="search"
          aria-label="Search active teams"
          placeholder="Search team or manager"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setOpenActionsId(null);
          }}
        />
        <select
          aria-label="Filter teams"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value as Filter);
            setOpenActionsId(null);
          }}
        >
          <option value="all">All teams</option>
          <option value="high-risk">High risk</option>
          <option value="high-risk-managers">High risk managers</option>
          <option value="conflict">Misarranged</option>
          <option value="no-games">No games</option>
          <option value="leaving">Leaving</option>
        </select>
        <span className={styles.count}>
          {filter === 'all' && !search.trim()
            ? `${teams.length} teams`
            : `${visibleRows.length} of ${teams.length} teams`}
        </span>
      </div>
      {warnings === null && !warningError && (
        <p className={styles.notice} role="status">
          Loading warning history…
        </p>
      )}
      {warningError && <p className={styles.notice}>Warning history could not be loaded. Risk is unavailable.</p>}
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">
                <span className={styles.srOnly}>Row number</span>
              </th>
              <th
                scope="col"
                aria-sort={sortKey === 'team' || sortKey === 'manager' ? (ascending ? 'ascending' : 'descending') : 'none'}
              >
                <button type="button" aria-label="Sort by team name" onClick={() => setSort('team')}>
                  Teams{sortKey === 'team' && <span aria-hidden="true">{ascending ? ' ↑' : ' ↓'}</span>}
                </button>
                {' / '}
                <button type="button" aria-label="Sort by manager name" onClick={() => setSort('manager')}>
                  Managers{sortKey === 'manager' && <span aria-hidden="true">{ascending ? ' ↑' : ' ↓'}</span>}
                </button>
              </th>
              {headers.map(({ key, label, title }) => (
                <th
                  key={key}
                  scope="col"
                  aria-sort={sortKey === key ? (ascending ? 'ascending' : 'descending') : 'none'}
                >
                  <button type="button" aria-label={title} onClick={() => setSort(key)}>
                    {label}
                    <span aria-hidden="true">{sortKey === key ? (ascending ? ' ↑' : ' ↓') : ''}</span>
                  </button>
                </th>
              ))}
              <th scope="col">
                <span className={styles.srOnly}>Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(({ team, stats }, index) => {
              const teamFlag = getCountryFlagUrl(team.country_id, team.country_name);
              const managerFlag = getCountryFlagUrl(team.manager_country_id, team.manager_country_name);
              const actionsOpen = openActionsId === team.id;
              return (
                <tr key={team.id}>
                  <td className={styles.rowNumber}>{index + 1}</td>
                  <td className={styles.teamCell}>
                    <div className={styles.teamLine}>
                      <img
                        className={styles.logo}
                        src={team.logo_url || '/matchKitLarge.png'}
                        alt=""
                        onError={(event) => {
                          event.currentTarget.onerror = null;
                          event.currentTarget.src = '/matchKitLarge.png';
                        }}
                      />
                      <span className={styles.identities}>
                        <span className={styles.identityLine}>
                          {teamFlag && (
                            <img className={styles.flag} src={teamFlag} alt={team.country_name || 'Team country'} />
                          )}
                          {team.ht_team_id ? (
                            <a
                              href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${team.ht_team_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {team.name}
                            </a>
                          ) : (
                            <strong>{team.name || 'Open slot'}</strong>
                          )}
                          {renderTeamMarkers?.(team)}
                        </span>
                        <span className={styles.identityLine}>
                          <span className={styles.teamId}>
                            ID {team.ht_team_id || '—'}
                            {team.manager_name ? ' ·' : ''}
                          </span>
                          {managerFlag && (
                            <img
                              className={styles.flag}
                              src={managerFlag}
                              alt={team.manager_country_name || 'Manager country'}
                            />
                          )}
                          {team.manager_name ? (
                            team.hattrick_user_id ? (
                              <a
                                href={`https://www.hattrick.org/goto.ashx?path=/Club/Manager/?userId=${team.hattrick_user_id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {team.manager_name}
                              </a>
                            ) : (
                              team.manager_name
                            )
                          ) : null}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td>{stats.played}</td>
                  <td>
                    <span
                      data-tooltip-id={tooltipId}
                      data-tooltip-content={misarrangedTooltip(stats)}
                      tabIndex={0}
                    >
                      {stats.misarranged ?? '—'}
                    </span>
                  </td>
                  <td>
                    <span className={styles.fixtureBadges}>
                      {stats.fixtureRounds.length ? stats.fixtureRounds.map(({ roundId, label, status }) => (
                        <span
                          key={roundId}
                          className={`${styles.fixtureBadge} ${styles[status === 'yes' ? 'none' : status === 'no' ? 'high' : 'unknown']}`}
                          aria-label={`${label}: ${status === 'yes' ? 'fixture' : status === 'no' ? 'no fixture' : status === 'bye' ? 'BYE' : 'not selected'}`}
                        >
                          {status === 'yes' ? '✓' : status === 'no' ? '𝖷' : status === 'bye' ? 'BYE' : '—'}
                        </span>
                      )) : '—'}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`${styles.risk} ${styles[stats.risk]}`}
                      data-tooltip-id={stats.risk !== 'none' && stats.risk !== 'unknown' ? tooltipId : undefined}
                      data-tooltip-content={
                        stats.risk !== 'none' && stats.risk !== 'unknown'
                          ? `${riskLabel[stats.risk]}: ${stats.riskReason}`
                          : undefined
                      }
                      tabIndex={stats.risk !== 'none' && stats.risk !== 'unknown' ? 0 : undefined}
                    >
                      {riskLabel[stats.risk]}
                    </span>
                  </td>
                  <td
                    className={
                      stats.now === 'conflict' ? styles.conflict : stats.now === 'booked' ? styles.arranged : ''
                    }
                  >
                    <span
                      data-tooltip-id={tooltipId}
                      data-tooltip-content={nextTooltip(stats)}
                      tabIndex={0}
                    >
                      {stats.now === 'conflict' && <img src="/warn-red.png" alt="" className={styles.missIcon} />}
                      {nowLabel[stats.now]}
                    </span>
                  </td>
                  <td>{formatTeamJoinedAge(team.created_at, now)}</td>
                  <td>
                    <button
                      type="button"
                      id={`admin-team-actions-${team.id}`}
                      className={styles.actionsButton}
                      aria-label={`Actions for ${team.name}`}
                      aria-expanded={actionsOpen}
                      aria-controls={actionsOpen ? `admin-team-menu-${team.id}` : undefined}
                      aria-haspopup="dialog"
                      onClick={() => setOpenActionsId(actionsOpen ? null : team.id)}
                    >
                      <DotsThreeVertical size={20} weight="bold" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visibleRows.length === 0 && <p className={styles.empty}>No teams match this search or filter.</p>}
      </div>
      <p className={styles.legend}>
        Fixture badges follow the open rounds in calendar order; — means not selected. Risk is for review only.
      </p>
      <Tooltip id={tooltipId} />
      {openTeam &&
        portalHost &&
        createPortal(
          <div
            ref={actionMenuRef}
            id={`admin-team-menu-${openTeam.id}`}
            className={styles.actionMenu}
            role="dialog"
            aria-label={`Actions for ${openTeam.name}`}
          >
            {openRow && renderActions(openTeam, openRow.stats)}
          </div>,
          portalHost,
        )}
    </div>
  );
}
