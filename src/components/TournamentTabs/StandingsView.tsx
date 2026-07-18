import React, { useEffect, useMemo, useState } from 'react';
import { SectionCard } from '../../components/Card/SectionCard';
import { ArrowRight, ShieldCheck } from 'phosphor-react';
import { TeamByline } from '../TeamByline/TeamByline';
import { SeasonYearbook, type TournamentSeasonComment } from '../TournamentHistory/TournamentHistory';

import type { TeamStanding } from '../../utils/standings';
// import { MottoWidget } from '../../components/MottoWidget/MottoWidget';
// import { TOURNAMENT_DEFAULT } from '../../constants/descriptions';

import styles from '../../pages/Public/TournamentView.module.sass';

interface StandingsViewProps {
  standings: TeamStanding[];
  is120minMode: boolean;
  myHtUserId: string | null;
  tournament: {
    id?: string;
    thumbnail_index?: number;
  } | null;
  seasonStatus?: 'planned' | 'ongoing' | 'finished';
  lastSeenMap?: Record<number, string | null>;
  onRefreshPresence?: () => void;
  canJoinTournament?: boolean;
  isConnecting?: boolean;
  onJoinWithHattrick?: () => void;
  onVisitHistory?: () => void;
  canAddSeasonComment?: boolean;
  onCommentsLoaded?: (seasonId: string, commentCount: number) => void;
  seasonId?: string | null;
  seasonNumber?: number;
}

const DEFAULT_TEAM_LOGO = '/default-logo.png';
type StandingsSortKey = 'default' | 'team' | 'achievements120min' | 'totalMinutes' | 'played' | 'won' | 'drawn' | 'lost' | 'gd' | 'gf' | 'pts';
type SortDirection = 'asc' | 'desc';

export const StandingsView: React.FC<StandingsViewProps> = ({
  standings,
  is120minMode,
  myHtUserId,
  tournament,
  seasonStatus,
  lastSeenMap = {},
  onRefreshPresence,
  canJoinTournament = false,
  isConnecting = false,
  onJoinWithHattrick,
  onVisitHistory,
  canAddSeasonComment = false,
  onCommentsLoaded,
  seasonId = null,
  seasonNumber = 0,
}) => {
  const [presencePulse, setPresencePulse] = useState(0);
  const [show120minScoring, setShow120minScoring] = useState(is120minMode);
  const [sortKey, setSortKey] = useState<StandingsSortKey>('default');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [seasonComments, setSeasonComments] = useState<TournamentSeasonComment[]>([]);
  const [loadedSeasonCommentsId, setLoadedSeasonCommentsId] = useState<string | null>(null);
  const seasonCommentsLoading = Boolean(seasonId && loadedSeasonCommentsId !== seasonId);

  const sortedStandings = useMemo(() => {
    const rows = [...standings];
    const compareDefault = (a: TeamStanding, b: TeamStanding) => {
      if (show120minScoring) {
        if (b.achievements120min !== a.achievements120min) return b.achievements120min - a.achievements120min;
        if (b.gd !== a.gd) return b.gd - a.gd;
        if (b.gf !== a.gf) return b.gf - a.gf;
        return a.played - b.played;
      }
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (b.gd !== a.gd) return b.gd - a.gd;
      return b.gf - a.gf;
    };

    rows.sort((a, b) => {
      if (sortKey === 'default') return compareDefault(a, b);
      if (sortKey === 'team') {
        const result = a.teamName.localeCompare(b.teamName, undefined, { sensitivity: 'base' });
        return sortDirection === 'asc' ? result : -result;
      }

      const result = Number(b[sortKey]) - Number(a[sortKey]);
      if (result !== 0) return sortDirection === 'asc' ? -result : result;
      return a.teamName.localeCompare(b.teamName, undefined, { sensitivity: 'base' });
    });

    return rows;
  }, [show120minScoring, sortDirection, sortKey, standings]);

  const toggleScoringDisplay = () => {
    setShow120minScoring((value) => !value);
    setSortKey('default');
    setSortDirection('desc');
  };

  const handleSort = (nextKey: StandingsSortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === 'team' ? 'asc' : 'desc');
  };

  const sortIndicator = (key: StandingsSortKey) => sortKey === key ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : '';
  const sortableHeader = (label: string, key: StandingsSortKey, className = '') => (
    <th className={className} aria-sort={sortKey === key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={styles.sortHeader} onClick={() => handleSort(key)}>
        {label}<span aria-hidden="true">{sortIndicator(key)}</span>
      </button>
    </th>
  );

  useEffect(() => {
    const tick = setInterval(() => setPresencePulse((value) => value + 1), 60_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!onRefreshPresence) return;

    const refresh = () => {
      if (document.visibilityState === 'visible') {
        onRefreshPresence();
      }
    };

    refresh();

    const interval = setInterval(refresh, 2.5 * 60 * 1000);
    document.addEventListener('visibilitychange', refresh);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [onRefreshPresence]);

  useEffect(() => {
    if (!seasonId) return;

    let cancelled = false;
    fetch(`/api/app?route=history&seasonId=${encodeURIComponent(seasonId)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load season comments.');
        return (data.comments || []) as TournamentSeasonComment[];
      })
      .then((comments) => {
        if (!cancelled) {
          setSeasonComments(comments);
          setLoadedSeasonCommentsId(seasonId);
          onCommentsLoaded?.(seasonId, comments.length);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSeasonComments([]);
          setLoadedSeasonCommentsId(seasonId);
          onCommentsLoaded?.(seasonId, 0);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [onCommentsLoaded, seasonId]);

  return (
    <div className={styles.mainColumn} data-presence-pulse={presencePulse}>
      <SectionCard
        title="🏆 Standings"
        thumbnailSeed={tournament?.id}
        headerRight={(
          <button
            type="button"
            className={styles.scoringToggle}
            onClick={toggleScoringDisplay}
            aria-label={`Switch to ${show120minScoring ? '90min' : '120min'} scoring display`}
          >
            {show120minScoring ? '120min scoring' : '90min scoring'}
          </button>
        )}
      >
        <div className={styles.tableWrapper}>
          <table>
            <thead>
              <tr>
                <th>#</th>
                {sortableHeader('Team', 'team')}
                {show120minScoring ? (
                  <>
                    {sortableHeader('120m', 'achievements120min', styles.center120)}
                    {sortableHeader('Mins', 'totalMinutes', styles.center)}
                    {sortableHeader('Pld', 'played', styles.center)}
                    {sortableHeader('Dif', 'gd', styles.center)}
                    {sortableHeader('Goals', 'gf', styles.center)}
                  </>
                ) : (
                  <>
                    {sortableHeader('Pld', 'played', styles.center)}
                    {sortableHeader('W', 'won', styles.center)}
                    {sortableHeader('D', 'drawn', styles.center)}
                    {sortableHeader('L', 'lost', styles.center)}
                    {sortableHeader('GD', 'gd', styles.center)}
                    {sortableHeader('Pts', 'pts', styles.center)}
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {standings.length === 0 && (
                <tr>
                  <td className={styles.muted}>1</td>
                  <td className={styles.teamNameCell}>
                    <div className={styles.teamInfo}>
                      <img src={DEFAULT_TEAM_LOGO} alt="" className={styles.standingLogo} />
                      <div className={styles.teamTextContainer}>
                        <button
                          type="button"
                          className={`${styles.idLink} ${styles.placeholderJoinLink}`}
                          onClick={onJoinWithHattrick}
                          disabled={!canJoinTournament || isConnecting}
                        >
                          <div className={styles.nameRow}>
                            <span className={styles.teamName}>Be the FIRST team to join!</span>
                            <ArrowRight size={15} weight="bold" className={styles.placeholderArrow} />
                          </div>
                        </button>
                        <span className={styles.placeholderByline}>Invite others to get this tournament started!</span>
                      </div>
                    </div>
                  </td>
                  {show120minScoring ? (
                    <>
                      <td className={`${styles.highlight} ${styles.center}`}>0</td>
                      <td className={styles.center}>0</td>
                      <td className={styles.center}>0</td>
                      <td className={styles.center}>0</td>
                      <td className={styles.center}>0</td>
                    </>
                  ) : (
                    <>
                      <td className={styles.center}>0</td>
                      <td className={styles.center}>0</td>
                      <td className={styles.center}>0</td>
                      <td className={styles.center}>0</td>
                      <td className={styles.center}>0</td>
                      <td className={styles.center}>0</td>
                    </>
                  )}
                </tr>
              )}
              {sortedStandings.map((s, idx) => {
                const isMyTeam = s.htTeamId === Number(myHtUserId);
                return (
                  <tr key={s.teamId} className={isMyTeam ? styles.myTeamRow : ''}>
                    <td className={styles.muted}>{idx + 1}</td>
                    <td className={styles.teamNameCell}>
                      <div className={styles.teamInfo}>
                        <img
                          src={s.logoUrl || DEFAULT_TEAM_LOGO}
                          alt={s.teamName}
                          className={styles.standingLogo}
                          onError={(event) => {
                            event.currentTarget.src = DEFAULT_TEAM_LOGO;
                          }}
                        />
                        <div className={styles.teamTextContainer}>
                          <a
                            href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${s.htTeamId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.idLink}
                          >
                            <div className={styles.nameRow}>
                              <span className={styles.teamName}>
                                {s.teamName}
                                {isMyTeam && <span className={styles.myTeamBadge}> (You)</span>}
                              </span>
                              {s.joinedViaOauth && (
                                <span title="Hattrick Validated Team">
                                  <ShieldCheck size={14} weight="bold" className={styles.validatedIcon} />
                                </span>
                              )}
                            </div>
                          </a>
                          <TeamByline
                            countryName={s.countryName}
                            countryId={s.countryId}
                            leagueId={s.leagueId}
                            teamId={s.htTeamId}
                            managerName={s.managerName}
                            managerHtId={s.hattrickUserId}
                            mode="standings"
                            lastSeenAt={s.hattrickUserId != null ? (lastSeenMap[s.hattrickUserId] ?? null) : null}
                          />
                        </div>
                      </div>
                    </td>
                    {show120minScoring ? (
                      <>
                        <td className={`${styles.highlight} ${styles.center}`}>{s.achievements120min}</td>
                        <td className={styles.center}>{s.totalMinutes}</td>
                        <td className={styles.center}>{s.played}</td>
                        <td className={styles.center}>{s.gd > 0 ? `+${s.gd}` : s.gd}</td>
                        <td className={styles.center}>{s.gf}</td>
                      </>
                    ) : (
                      <>
                        <td className={styles.center}>{s.played}</td>
                        <td className={styles.center}>{s.won}</td>
                        <td className={styles.center}>{s.drawn}</td>
                        <td className={styles.center}>{s.lost}</td>
                        <td className={styles.center}>{s.gd > 0 ? `+${s.gd}` : s.gd}</td>
                        <td className={styles.center}>{s.pts}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
      {seasonId && seasonStatus === 'finished' && (
        <SeasonYearbook
          seasonNumber={seasonNumber}
          comments={seasonId && loadedSeasonCommentsId === seasonId ? seasonComments : []}
          totalTeams={standings.length}
          commentsLoading={seasonCommentsLoading}
          teamLogoById={Object.fromEntries(standings.map((standing) => [standing.teamId, standing.logoUrl]))}
          showProgress={seasonStatus === 'finished'}
          showComments={seasonStatus === 'finished'}
          emptyMessage={
            seasonStatus === 'finished'
              ? undefined
              : 'The season yearbook will open once the season concludes and its final report is published.'
          }
        />
      )}
      <SectionCard title="News Feed">
        <ul className={styles.newsFeed}>
          <li className={styles.feedItem}>
            <div className={styles.feedIcon}></div>
            <div className={styles.feedContent}>
              <p>Team and tournament announcements almost here!</p>
              <span>2 hours from now</span>
            </div>
          </li>
        </ul>
      </SectionCard>
      {seasonId && seasonStatus !== 'finished' && (
        <SeasonYearbook
          seasonNumber={seasonNumber}
          comments={[]}
          commentsLoading={false}
          showComments={false}
          showProgress={false}
          emptyMessage={
            <>
              The season yearbook will open once the season concludes and its final report is published.
              {canAddSeasonComment && onVisitHistory && (
                <>
                  {' '}
                  <button type="button" className={styles.yearbookHistoryLink} onClick={onVisitHistory}>
                    Visit history to add yours
                  </button>
                </>
              )}
            </>
          }
        />
      )}
    </div>
  );
};
