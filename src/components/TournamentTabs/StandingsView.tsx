import React, { useEffect, useMemo, useState } from 'react';
import { SectionCard } from '../../components/Card/SectionCard';
import { ArrowRight, Check, CopySimple, Recycle, ShieldCheck } from 'phosphor-react';
import { Tooltip } from 'react-tooltip';
import { TeamByline } from '../TeamByline/TeamByline';
import { SeasonYearbook, type TournamentSeasonComment } from '../TournamentHistory/TournamentHistory';

import { getAppgStandingsQuota, meetsAppgStandingsQuota, type TeamStanding } from '../../utils/standings';
import { isAppg120ScoringMode } from '../../../shared/scoring-profile';
// import { MottoWidget } from '../../components/MottoWidget/MottoWidget';
// import { TOURNAMENT_DEFAULT } from '../../constants/descriptions';

import styles from '../../pages/Public/TournamentView.module.sass';

interface StandingsViewProps {
  standings: TeamStanding[];
  is120minMode: boolean;
  myHtUserId: string | null;
  tournament: {
    id?: string;
    name?: string;
    slug?: string;
    league_category?: string | null;
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
  | 'achievements120minPercent'
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
  const isAppgSupported = isAppg120ScoringMode(tournament?.scoring_mode);
  const [scoringMode, setScoringMode] = useState<StandingsScoringMode>(
    isAppgSupported ? 'appg' : is120minMode ? '120min' : '90min',
  );
  const [sortKey, setSortKey] = useState<StandingsSortKey>('default');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [seasonComments, setSeasonComments] = useState<TournamentSeasonComment[]>([]);
  const [standingsCopied, setStandingsCopied] = useState(false);
  const [loadedSeasonCommentsId, setLoadedSeasonCommentsId] = useState<string | null>(null);
  const seasonCommentsLoading = Boolean(seasonId && loadedSeasonCommentsId !== seasonId);
  const show120minScoring = scoringMode === '120min';
  const showAppgScoring = isAppg120ScoringMode(scoringMode);
  const enabledScoringModes = (Object.keys(STANDINGS_SCORING_MODES) as StandingsScoringMode[]).filter(
    (mode) => STANDINGS_SCORING_MODES[mode].enabled && (mode !== 'appg' || isAppgSupported),
  );
  const activeScoringConfig = STANDINGS_SCORING_MODES[scoringMode];

  const averagePointsPerGame = (standing: TeamStanding) =>
    standing.appgPlayed > 0 ? standing.appgPoints / standing.appgPlayed : 0;
  const percentage120min = (standing: TeamStanding) =>
    standing.played > 0 ? (standing.achievements120min / standing.played) * 100 : 0;
  const appgMatchQuota = useMemo(() => {
    return showAppgScoring ? getAppgStandingsQuota(standings) : 0;
  }, [showAppgScoring, standings]);
  const reachesAppgQuota = (standing: TeamStanding) => meetsAppgStandingsQuota(standing, appgMatchQuota);

  const sortedStandings = useMemo(() => {
    const rows = [...standings];
    const compareDefault = (a: TeamStanding, b: TeamStanding) => {
      if (scoringMode === '120min') {
        if (b.achievements120min !== a.achievements120min) return b.achievements120min - a.achievements120min;
        if (b.gd !== a.gd) return b.gd - a.gd;
        if (b.gf !== a.gf) return b.gf - a.gf;
        return a.played - b.played;
      }
      if (isAppg120ScoringMode(scoringMode)) {
        const averageDifference = averagePointsPerGame(b) - averagePointsPerGame(a);
        if (averageDifference !== 0) return averageDifference;
        if (b.appgPoints !== a.appgPoints) return b.appgPoints - a.appgPoints;
        if (b.appgPlayed !== a.appgPlayed) return b.appgPlayed - a.appgPlayed;
        return a.teamName.localeCompare(b.teamName, undefined, { sensitivity: 'base' });
      }
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (b.gd !== a.gd) return b.gd - a.gd;
      return b.gf - a.gf;
    };

    rows.sort((a, b) => {
      if (isAppg120ScoringMode(scoringMode)) {
        const aReachesQuota = meetsAppgStandingsQuota(a, appgMatchQuota);
        const bReachesQuota = meetsAppgStandingsQuota(b, appgMatchQuota);
        if (aReachesQuota !== bReachesQuota) return aReachesQuota ? -1 : 1;
      }
      if (sortKey === 'default') return compareDefault(a, b);
      if (sortKey === 'team') {
        const result = a.teamName.localeCompare(b.teamName, undefined, { sensitivity: 'base' });
        return sortDirection === 'asc' ? result : -result;
      }

      const aValue =
        sortKey === 'appg'
          ? averagePointsPerGame(a)
          : sortKey === 'achievements120minPercent'
            ? percentage120min(a)
            : Number(a[sortKey]);
      const bValue =
        sortKey === 'appg'
          ? averagePointsPerGame(b)
          : sortKey === 'achievements120minPercent'
            ? percentage120min(b)
            : Number(b[sortKey]);
      const result = bValue - aValue;
      if (result !== 0) return sortDirection === 'asc' ? -result : result;
      return a.teamName.localeCompare(b.teamName, undefined, { sensitivity: 'base' });
    });

    return rows;
  }, [appgMatchQuota, scoringMode, sortDirection, sortKey, standings]);

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
  const qualifiedAppgCount = showAppgScoring
    ? sortedStandings.filter((standing) => reachesAppgQuota(standing)).length
    : sortedStandings.length;

  const forumTeamName = (standing: TeamStanding) => standing.teamName.replace(/\[/g, '(').replace(/\]/g, ')');
  const signedGoalDifference = (value: number) => (value > 0 ? `+${value}` : String(value));
  const appgClassificationTooltip = (standing: TeamStanding) =>
    `Pts ${standing.appgPoints} · ET3 ${standing.appgClassifications.ET3} · ET2 ${standing.appgClassifications.ET2} · PS1 ${standing.appgClassifications.PS1} · RT0 ${standing.appgClassifications.RT0} · OPW ${standing.appgClassifications.OPW}`;
  const forumRow = (values: Array<string | number>) =>
    `[tr]${values.map((value) => `[td]${value}[/td]`).join('')}[/tr]`;
  const forumHeader = (values: string[]) => `[tr]${values.map((value) => `[th]${value}[/th]`).join('')}[/tr]`;

  const copyStandingsForForum = () => {
    const tournamentName = tournament?.name || 'Tournament';
    const categorySuffix = tournament?.league_category === 'hfi' ? ' (HFI)' : '';
    const tournamentLink = tournament?.slug ? `[link=https://ht-120min.vercel.app/t/${tournament.slug}]` : '';
    const heading = `[b]${tournamentName}${categorySuffix}[/b] – ${activeScoringConfig.label} Standings${
      tournamentLink ? `\n${tournamentLink}` : ''
    }`;
    const buildTable = (rows: TeamStanding[], includePlacement: boolean) => {
      if (showAppgScoring) {
        const header = includePlacement
          ? ['#', 'Team', 'Pld', 'ET3', 'ET2', 'PS1', 'RT0', 'OPW', 'Pts', 'AVG']
          : ['Team', 'Pld', 'ET3', 'ET2', 'PS1', 'RT0', 'OPW', 'Pts', 'AVG'];
        return `[table]\n${forumHeader(header)}\n${rows
          .map((standing, index) => {
            const values = [
              forumTeamName(standing),
              standing.played,
              standing.appgClassifications.ET3,
              standing.appgClassifications.ET2,
              standing.appgClassifications.PS1,
              standing.appgClassifications.RT0,
              standing.appgClassifications.OPW,
              standing.appgPoints,
              averagePointsPerGame(standing).toFixed(2),
            ];
            return forumRow(includePlacement ? [index + 1, ...values] : values);
          })
          .join('\n')}\n[/table]`;
      }

      if (show120minScoring) {
        return `[table]\n${forumHeader(['#', 'Team', '120m', '120m%', 'Mins', 'Dif', 'Goals'])}\n${rows
          .map((standing, index) =>
            forumRow([
              index + 1,
              forumTeamName(standing),
              standing.achievements120min,
              `${percentage120min(standing).toFixed(0)}%`,
              standing.totalMinutes,
              signedGoalDifference(standing.gd),
              standing.gf,
            ]),
          )
          .join('\n')}\n[/table]`;
      }

      return `[table]\n${forumHeader(['#', 'Team', 'Pld', 'W', 'D', 'L', 'GD', 'Pts'])}\n${rows
        .map((standing, index) =>
          forumRow([
            index + 1,
            forumTeamName(standing),
            standing.played,
            standing.won,
            standing.drawn,
            standing.lost,
            signedGoalDifference(standing.gd),
            standing.pts,
          ]),
        )
        .join('\n')}\n[/table]`;
    };

    let forumText = `${heading}\n${buildTable(sortedStandings.slice(0, qualifiedAppgCount), true)}`;
    if (showAppgScoring && qualifiedAppgCount < sortedStandings.length) {
      forumText += `\n[b]Did not reach the ${appgMatchQuota}-match quota[/b]\n${buildTable(sortedStandings.slice(qualifiedAppgCount), false)}`;
      forumText += `\n[i]Order: APPG average descending, total APPG points descending, team name ascending. A team must play at least ${appgMatchQuota} matches to qualify (50% of most played).[/i]`;
    }

    void navigator.clipboard.writeText(forumText);
    setStandingsCopied(true);
    window.setTimeout(() => setStandingsCopied(false), 2000);
  };
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
            <button
              type="button"
              className={styles.refreshBtn}
              onClick={copyStandingsForForum}
              data-tooltip-id="standings-copy-tooltip"
              aria-label="Copy standings for HT forums"
            >
              {standingsCopied ? <Check size={18} color="green" /> : <CopySimple size={18} />}
            </button>
            <Tooltip
              id="standings-copy-tooltip"
              content={standingsCopied ? 'HT forum table copied!' : 'Copy standings for HT forums'}
              className="tooltip"
            />
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
                    {sortableHeader(
                      '120m%',
                      'achievements120minPercent',
                      styles.center,
                      '120-minute matches as a percentage of played matches',
                    )}
                    {sortableHeader('Mins', 'totalMinutes', styles.center)}
                    {sortableHeader('Dif', 'gd', styles.center)}
                    {sortableHeader('Goals', 'gf', styles.center)}
                  </>
                ) : showAppgScoring ? (
                  <>
                    {sortableHeader('APPG', 'appg', `${styles.center} ${styles.pointsHeader}`)}
                    {sortableHeader(
                      '120m%',
                      'achievements120minPercent',
                      styles.center,
                      '120-minute matches as a percentage of played matches',
                    )}
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
                      <td className={styles.center}>0%</td>
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
                const reachesQuota = reachesAppgQuota(s);
                const placement = reachesQuota
                  ? sortedStandings.slice(0, idx).filter(reachesAppgQuota).length + 1
                  : null;
                return (
                  <React.Fragment key={s.teamId}>
                    {showAppgScoring && idx === qualifiedAppgCount && qualifiedAppgCount < sortedStandings.length && (
                      <tr>
                        <th colSpan={7} className={styles.appgQuotaLabel}>
                          Does not reach quota
                        </th>
                      </tr>
                    )}
                    <tr className={isMyTeam ? styles.myTeamRow : ''}>
                      <td className={styles.muted}>{placement ?? ''}</td>
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
                          <td className={styles.center}>{percentage120min(s).toFixed(0)}%</td>
                          <td className={styles.center}>{s.totalMinutes}</td>
                          <td className={styles.center}>{s.gd > 0 ? `+${s.gd}` : s.gd}</td>
                          <td className={styles.center}>{s.gf}</td>
                        </>
                      ) : showAppgScoring ? (
                        <>
                          <td
                            className={`${styles.highlight} ${styles.center}`}
                            data-tooltip-id="appg-breakdown-tooltip"
                            data-tooltip-content={appgClassificationTooltip(s)}
                            title={appgClassificationTooltip(s)}
                          >
                            {averagePointsPerGame(s).toFixed(2)}
                          </td>
                          <td className={styles.center}>{percentage120min(s).toFixed(0)}%</td>
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
                  </React.Fragment>
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
                    <td colSpan={show120minScoring ? 5 : showAppgScoring ? 5 : 6} />
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Tooltip id="appg-breakdown-tooltip" className="tooltip" />
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
