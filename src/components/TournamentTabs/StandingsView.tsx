import React, { useEffect, useMemo, useState } from 'react';
import { SectionCard } from '../../components/Card/SectionCard';
import { ArrowRight, Recycle, ShieldCheck } from 'phosphor-react';
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
    scoring_mode?: string | null;
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
  reapplySuggestions?: {
    id: string;
    name: string;
    htTeamId: number;
    hattrickUserId: number | null;
    logoUrl: string | null;
  }[];
  onReapplySuggestion?: (teamId: string) => void;
  onRemoveReapplySuggestion?: (teamId: string) => void;
}

const DEFAULT_TEAM_LOGO = '/default-logo.png';
const STANDINGS_SCORING_MODES = {
  '120min': { enabled: true, label: '120min', tooltip: '120-minute scoring' },
  '90min': { enabled: true, label: '90min', tooltip: 'Regular 90-minute scoring' },
  appg: { enabled: true, label: 'APPG', tooltip: 'Average Points Per Game' },
} as const;

type StandingsScoringMode = keyof typeof STANDINGS_SCORING_MODES;
type StandingsSortKey =
  | 'default'
  | 'team'
  | 'achievements120min'
  | 'totalMinutes'
  | 'played'
  | 'appgPlayed'
  | 'won'
  | 'drawn'
  | 'lost'
  | 'gd'
  | 'gf'
  | 'pts'
  | 'appg';
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
  reapplySuggestions = [],
  onReapplySuggestion,
  onRemoveReapplySuggestion,
}) => {
  const [presencePulse, setPresencePulse] = useState(0);
  const isAppgSupported = tournament?.scoring_mode === 'appg';
  const [scoringMode, setScoringMode] = useState<StandingsScoringMode>(
    isAppgSupported ? 'appg' : is120minMode ? '120min' : '90min',
  );
  const [sortKey, setSortKey] = useState<StandingsSortKey>('default');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [seasonComments, setSeasonComments] = useState<TournamentSeasonComment[]>([]);
  const [loadedSeasonCommentsId, setLoadedSeasonCommentsId] = useState<string | null>(null);
  const seasonCommentsLoading = Boolean(seasonId && loadedSeasonCommentsId !== seasonId);
  const show120minScoring = scoringMode === '120min';
  const showAppgScoring = scoringMode === 'appg';
  const enabledScoringModes = (Object.keys(STANDINGS_SCORING_MODES) as StandingsScoringMode[]).filter(
    (mode) => STANDINGS_SCORING_MODES[mode].enabled && (mode !== 'appg' || isAppgSupported),
  );
  const activeScoringConfig = STANDINGS_SCORING_MODES[scoringMode];

  const averagePointsPerGame = (standing: TeamStanding) =>
    standing.appgPlayed > 0 ? standing.appgPoints / standing.appgPlayed : 0;

  const sortedStandings = useMemo(() => {
    const rows = [...standings];
    const compareDefault = (a: TeamStanding, b: TeamStanding) => {
      if (scoringMode === '120min') {
        if (b.achievements120min !== a.achievements120min) return b.achievements120min - a.achievements120min;
        if (b.gd !== a.gd) return b.gd - a.gd;
        if (b.gf !== a.gf) return b.gf - a.gf;
        return a.played - b.played;
      }
      if (scoringMode === 'appg') {
        const averageDifference = averagePointsPerGame(b) - averagePointsPerGame(a);
        if (averageDifference !== 0) return averageDifference;
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

      const aValue = sortKey === 'appg' ? averagePointsPerGame(a) : Number(a[sortKey]);
      const bValue = sortKey === 'appg' ? averagePointsPerGame(b) : Number(b[sortKey]);
      const result = bValue - aValue;
      if (result !== 0) return sortDirection === 'asc' ? -result : result;
      return a.teamName.localeCompare(b.teamName, undefined, { sensitivity: 'base' });
    });

    return rows;
  }, [scoringMode, sortDirection, sortKey, standings]);

  useEffect(() => {
    const defaultMode: StandingsScoringMode = isAppgSupported ? 'appg' : is120minMode ? '120min' : '90min';
    const resetTimer = window.setTimeout(() => {
      setScoringMode(defaultMode);
      setSortKey('default');
      setSortDirection('desc');
    }, 0);
    return () => window.clearTimeout(resetTimer);
  }, [is120minMode, isAppgSupported]);

  const toggleScoringDisplay = () => {
    const currentIndex = enabledScoringModes.indexOf(scoringMode);
    const nextMode = enabledScoringModes[(currentIndex + 1) % enabledScoringModes.length];
    setScoringMode(nextMode);
    setSortKey('default');
    setSortDirection('desc');
  };

  const handleSort = (nextKey: StandingsSortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === 'team' ? 'asc' : 'desc');
  };

  const sortIndicator = (key: StandingsSortKey) => (sortKey === key ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : '');
  const sortableHeader = (label: string, key: StandingsSortKey, className = '', title?: string) => (
    <th
      className={className}
      aria-sort={sortKey === key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button type="button" className={styles.sortHeader} onClick={() => handleSort(key)} title={title}>
        {label}
        <span aria-hidden="true">{sortIndicator(key)}</span>
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
        headerRight={
          <div className={styles.scoringControl}>
            <span>Scoring:</span>
            <button
              type="button"
              className={styles.scoringToggle}
              onClick={toggleScoringDisplay}
              title={activeScoringConfig.tooltip}
              aria-label={`Switch scoring display from ${activeScoringConfig.label}`}
            >
              <span>{activeScoringConfig.label}</span>
              <Recycle size={16} weight="regular" aria-hidden="true" />
            </button>
          </div>
        }
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
                    {sortableHeader('Class.', 'appgPlayed', styles.center, 'Classified APPG matches')}
                    {sortableHeader('Dif', 'gd', styles.center)}
                    {sortableHeader('Goals', 'gf', styles.center)}
                  </>
                ) : showAppgScoring ? (
                  <>
                    {sortableHeader('APPG', 'appg', `${styles.center} ${styles.pointsHeader}`)}
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
                    {sortableHeader('Pts', 'pts', `${styles.center} ${styles.pointsHeader}`)}
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {standings.length === 0 && reapplySuggestions.length === 0 && (
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
                  ) : showAppgScoring ? (
                    <>
                      <td className={`${styles.highlight} ${styles.center}`}>0.00</td>
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
                        <td className={styles.center}>{s.appgPlayed}</td>
                        <td className={styles.center}>{s.gd > 0 ? `+${s.gd}` : s.gd}</td>
                        <td className={styles.center}>{s.gf}</td>
                      </>
                    ) : showAppgScoring ? (
                      <>
                        <td className={`${styles.highlight} ${styles.center}`}>{averagePointsPerGame(s).toFixed(2)}</td>
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
                        <td className={`${styles.highlight} ${styles.center}`}>{s.pts}</td>
                      </>
                    )}
                  </tr>
                );
              })}
              {reapplySuggestions.map((team) => {
                const isOwner = team.hattrickUserId !== null && team.hattrickUserId === Number(myHtUserId);
                return (
                  <tr key={team.id} className={styles.reapplySuggestionRow}>
                    <td className={styles.muted}>-</td>
                    <td className={styles.teamNameCell}>
                      <div className={styles.reapplySuggestion}>
                        <div className={styles.teamInfo}>
                          <img
                            src={team.logoUrl || DEFAULT_TEAM_LOGO}
                            alt={team.name}
                            className={styles.standingLogo}
                            onError={(event) => {
                              event.currentTarget.src = DEFAULT_TEAM_LOGO;
                            }}
                          />
                          <span className={styles.teamName}>{team.name}</span>
                        </div>
                        {isOwner && (
                          <div className={styles.reapplyActions}>
                            <button type="button" onClick={() => onReapplySuggestion?.(team.id)}>
                              Re-apply
                            </button>
                            <button type="button" onClick={() => onRemoveReapplySuggestion?.(team.id)}>
                              Remove
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                    <td colSpan={show120minScoring ? 5 : showAppgScoring ? 4 : 6} />
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
