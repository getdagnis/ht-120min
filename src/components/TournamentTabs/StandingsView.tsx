import React, { useEffect, useMemo, useState } from 'react';
import { SectionCard } from '../../components/Card/SectionCard';
import { Button } from '../../components/Button/Button';
import { Modal } from '../../components/Modal/Modal';
import { ArrowRight, Check, CopySimple, Recycle, ShieldCheck } from 'phosphor-react';
import { Tooltip } from '../Tooltip/Tooltip';
import { TeamByline } from '../TeamByline/TeamByline';
import { SeasonYearbook, type TournamentSeasonComment } from '../TournamentHistory/TournamentHistory';
import { NewsArticle, type NewsPost, type NewsReaction } from './NewsTab';
import { supabase } from '../../lib/supabase';
import historyStyles from '../TournamentHistory/TournamentHistory.module.sass';
import newsStyles from './NewsTab.module.sass';

import { getAppgStandingsQuota, meetsAppgStandingsQuota, type TeamStanding } from '../../utils/standings';
import { isAppg120ScoringMode } from '../../../shared/scoring-profile';

import styles from '../../legacy-pages/Public/TournamentView.module.sass';

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
    image_url?: string | null;
    scoring_mode?: string | null;
  } | null;
  seasonStatus?: 'planned' | 'ongoing' | 'finished';
  lastSeenMap?: Record<number, string | null>;
  onRefreshPresence?: () => void;
  canJoinTournament?: boolean;
  isConnecting?: boolean;
  onJoinWithHattrick?: () => void;
  onVisitHistory?: () => void;
  onVisitNews?: () => void;
  reactionAuthorNames?: Record<string, string>;
  canAddSeasonComment?: boolean;
  onCommentsLoaded?: (seasonId: string, commentCount: number) => void;
  onCommentSubmitted?: (seasonId: string, comment: TournamentSeasonComment) => void;
  loadComments?: (seasonId: string) => Promise<TournamentSeasonComment[]>;
  seasonId?: string | null;
  seasonNumber?: number;
  seasonParticipantIds?: string[];
  reapplySuggestions?: {
    id: string;
    name: string;
    htTeamId: number;
    hattrickUserId: number | null;
    logoUrl: string | null;
  }[];
  canLeaveTournament?: boolean;
  onReapplySuggestion?: (teamId: string) => void;
  onRemoveReapplySuggestion?: (teamId: string) => void;
  onLeaveTournament?: (teamId: string) => void;
}

const DEFAULT_TEAM_LOGO = '/default-logo.png';
const defaultLoadComments = async (seasonId: string) => {
  const response = await fetch(`/api/app?route=history&seasonId=${encodeURIComponent(seasonId)}`);
  const data = (await response.json()) as { comments?: TournamentSeasonComment[]; error?: string };
  if (!response.ok) throw new Error(data.error || 'Could not load season comments.');
  return data.comments || [];
};
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
  onVisitNews,
  reactionAuthorNames = {},
  canAddSeasonComment = false,
  onCommentsLoaded,
  onCommentSubmitted,
  loadComments = defaultLoadComments,
  seasonId = null,
  seasonNumber = 0,
  seasonParticipantIds = [],
  reapplySuggestions = [],
  canLeaveTournament = false,
  onReapplySuggestion,
  onRemoveReapplySuggestion,
  onLeaveTournament,
}) => {
  const [presencePulse, setPresencePulse] = useState(0);
  const isAppgSupported = isAppg120ScoringMode(tournament?.scoring_mode);
  const [scoringMode, setScoringMode] = useState<StandingsScoringMode>(
    isAppgSupported ? 'appg' : is120minMode ? '120min' : '90min',
  );
  const [sortKey, setSortKey] = useState<StandingsSortKey>('default');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [seasonComments, setSeasonComments] = useState<TournamentSeasonComment[]>([]);
  const [latestNewsPosts, setLatestNewsPosts] = useState<NewsPost[]>([]);
  const [latestNewsReactions, setLatestNewsReactions] = useState<Record<string, NewsReaction[]>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [pendingCommentStanding, setPendingCommentStanding] = useState<TeamStanding | null>(null);
  const [submittingTeamId, setSubmittingTeamId] = useState<string | null>(null);
  const [commentsSubmitError, setCommentsSubmitError] = useState('');
  const [standingsCopied, setStandingsCopied] = useState(false);
  const [loadedSeasonCommentsId, setLoadedSeasonCommentsId] = useState<string | null>(null);
  const seasonCommentsLoading = Boolean(seasonId && loadedSeasonCommentsId !== seasonId);
  const eligibleCommentStandings = useMemo(() => {
    if (seasonStatus !== 'finished' || !myHtUserId) return [];
    const participantIds = new Set(seasonParticipantIds);
    const commentedIds = new Set(seasonComments.map((comment) => comment.team_id));
    return standings.filter(
      (standing) =>
        participantIds.has(standing.teamId) &&
        Number(standing.hattrickUserId) === Number(myHtUserId) &&
        !commentedIds.has(standing.teamId),
    );
  }, [myHtUserId, seasonComments, seasonParticipantIds, seasonStatus, standings]);
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
        if (b.pts !== a.pts) return b.pts - a.pts;
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

  useEffect(() => {
    if (!tournament?.id || !seasonNumber) return;

    const fetchLatestNews = async () => {
      const { data } = await supabase
        .from('news_posts')
        .select('*')
        .eq('tournament_id', tournament.id)
        .eq('season_number', seasonNumber)
        .order('created_at', { ascending: false })
        .limit(3);

      const posts = (data as NewsPost[] | null) || [];
      setLatestNewsPosts(posts);

      if (posts.length > 0) {
        const { data: reactionRows } = await supabase
          .from('news_reactions')
          .select('post_id, user_id, reaction')
          .in(
            'post_id',
            posts.map((post) => post.id),
          );

        setLatestNewsReactions(
          Object.groupBy((reactionRows as NewsReaction[] | null) || [], (reaction) => reaction.post_id),
        );
      } else {
        setLatestNewsReactions({});
      }
    };
    void fetchLatestNews();

    const channel = supabase
      .channel(`standings-news:${tournament.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'news_posts',
          filter: `tournament_id=eq.${tournament.id}`,
        },
        (payload) => {
          const post = payload.new as NewsPost & { season_number?: number | null };

          if (post.season_number === seasonNumber) {
            setLatestNewsPosts((current) => [post, ...current].slice(0, 3));
            setLatestNewsReactions((current) => ({ ...current, [post.id]: [] }));
          }
        },
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'news_reactions' }, (payload) => {
        const reaction = payload.new as NewsReaction;
        if (!reaction.post_id) return;

        setLatestNewsReactions((current) => {
          if (!current[reaction.post_id]) return current;

          const existing = current[reaction.post_id] || [];
          return {
            ...current,
            [reaction.post_id]: [...existing.filter((item) => item.user_id !== reaction.user_id), reaction],
          };
        });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [seasonNumber, tournament?.id]);

  const handleNewsReaction = async (postId: string, reaction: string) => {
    if (!myHtUserId) return;

    const { error } = await supabase
      .from('news_reactions')
      .upsert({ post_id: postId, user_id: myHtUserId, reaction }, { onConflict: 'post_id,user_id' });

    if (error) return;

    setLatestNewsReactions((current) => ({
      ...current,
      [postId]: [
        ...(current[postId] || []).filter((item) => item.user_id !== myHtUserId),
        { post_id: postId, user_id: myHtUserId, reaction },
      ],
    }));
  };

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
    const tournamentLink = tournament?.slug ? `[link=https://ht-120min.vercel.app/t/${tournament.slug}]` : '';
    const heading = `[b]🏆 ${tournamentName}[/b] – ${activeScoringConfig.label} Standings${
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
        return `[table]\n${forumHeader(['#', 'Team', '120m', 'Pts', '120m%', 'Mins', 'Dif', 'Goals'])}\n${rows
          .map((standing, index) =>
            forumRow([
              index + 1,
              forumTeamName(standing),
              standing.achievements120min,
              standing.pts,
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
    loadComments(seasonId)
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
  }, [loadComments, onCommentsLoaded, seasonId]);

  const handleSubmitSeasonComment = async (standing: TeamStanding) => {
    const draft = commentDrafts[standing.teamId] || '';
    if (!seasonId || !draft.trim()) return;

    setSubmittingTeamId(standing.teamId);
    setCommentsSubmitError('');
    try {
      const response = await fetch('/api/app?route=history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seasonId, teamId: standing.teamId, comment: draft }),
      });
      const data = (await response.json()) as { comment?: TournamentSeasonComment; error?: string };
      if (!response.ok || !data.comment) throw new Error(data.error || 'Could not save your season comment.');
      setSeasonComments((current) => [...current.filter((item) => item.team_id !== standing.teamId), data.comment!]);
      onCommentSubmitted?.(seasonId, data.comment);
      setCommentDrafts((current) => ({ ...current, [standing.teamId]: '' }));
      setPendingCommentStanding(null);
    } catch (error) {
      setCommentsSubmitError(error instanceof Error ? error.message : 'Could not save your season comment.');
    } finally {
      setSubmittingTeamId(null);
    }
  };

  return (
    <div className={styles.mainColumn} data-presence-pulse={presencePulse}>
      <SectionCard
        title={`🏆 Standings • Season ${seasonNumber || 1}`}
        thumbnailSeed={tournament?.id}
        thumbnailImageUrl={tournament?.image_url}
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
                          <div className={styles.nameRowFirst}>
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
                const isMyTeam = s.hattrickUserId === Number(myHtUserId);
                const isOpenSpot = s.isOpenSpot;
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
                        <div className={styles.standingsTeamEntry}>
                          <div className={styles.teamInfo}>
                            {!isOpenSpot && (
                              <img
                                src={s.logoUrl || DEFAULT_TEAM_LOGO}
                                alt={s.teamName}
                                className={styles.standingLogo}
                                onError={(event) => {
                                  event.currentTarget.src = DEFAULT_TEAM_LOGO;
                                }}
                              />
                            )}
                            <div className={styles.teamTextContainer}>
                              {isOpenSpot ? (
                                <div className={styles.canJoinButton}>
                                  <Button
                                    type="button"
                                    variant="secondaryAction"
                                    size="xs"
                                    onClick={onJoinWithHattrick}
                                    disabled={!canJoinTournament || isConnecting}
                                  >
                                    Join with CHPP <ArrowRight size={15} weight="bold" />
                                  </Button>
                                </div>
                              ) : (
                                <>
                                  <a
                                    href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${s.htTeamId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={styles.idLink}
                                  >
                                    <div className={styles.nameRow}>
                                      <span className={styles.teamName}>{s.teamName}</span>
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
                                    lastSeenAt={
                                      s.hattrickUserId != null ? (lastSeenMap[s.hattrickUserId] ?? null) : null
                                    }
                                  />
                                </>
                              )}
                            </div>
                          </div>
                          {isMyTeam && canLeaveTournament && (
                            <div className={styles.reapplyActions}>
                              <Button variant="grey" size="xxs" onClick={() => onLeaveTournament?.(s.teamId)}>
                                Leave
                              </Button>
                            </div>
                          )}
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
                            <Button variant="primaryAction" size="xs" onClick={() => onReapplySuggestion?.(team.id)}>
                              Re-join
                            </Button>
                            <Button variant="danger" size="xs" onClick={() => onRemoveReapplySuggestion?.(team.id)}>
                              Leave
                            </Button>
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
        {canJoinTournament && onJoinWithHattrick && (
          <div className={styles.standingsJoinCta}>
            <Button
              type="button"
              variant="primary"
              size="sm"
              className={styles.joinButton}
              onClick={onJoinWithHattrick}
              disabled={isConnecting}
            >
              <ArrowRight size={18} weight="bold" /> Join with Hattrick
            </Button>
          </div>
        )}
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
          commentsSubmitError={commentsSubmitError}
          emptyMessage={
            eligibleCommentStandings.length > 0 ? null : "Season participants' final comments will appear here."
          }
        >
          {!seasonCommentsLoading &&
            eligibleCommentStandings.map((standing) => (
              <div key={standing.teamId} className={historyStyles.commentForm}>
                <label htmlFor={`standings-season-comment-${standing.teamId}`}>
                  Post your final comment as {standing.teamName}
                </label>
                <textarea
                  id={`standings-season-comment-${standing.teamId}`}
                  value={commentDrafts[standing.teamId] || ''}
                  maxLength={480}
                  rows={4}
                  placeholder="Your season's comment..."
                  onChange={(event) =>
                    setCommentDrafts((current) => ({ ...current, [standing.teamId]: event.target.value }))
                  }
                />
                <div>
                  <small>{(commentDrafts[standing.teamId] || '').length}/480</small>
                  <Button
                    size="sm"
                    variant="primaryDanger"
                    onClick={() => setPendingCommentStanding(standing)}
                    disabled={!commentDrafts[standing.teamId]?.trim() || submittingTeamId === standing.teamId}
                  >
                    Post final comment
                  </Button>
                </div>
                <p>This can be posted once and cannot be changed.</p>
              </div>
            ))}
        </SeasonYearbook>
      )}
      {pendingCommentStanding && (
        <Modal isOpen onClose={() => setPendingCommentStanding(null)} title="Post final comment?" maxWidth="500px">
          <p>
            This will publish your final season comment as <strong>{pendingCommentStanding.teamName}</strong>. It cannot
            be changed later.
          </p>
          <div className={styles.historyReportActions}>
            <Button variant="secondaryYellow" size="sm" onClick={() => setPendingCommentStanding(null)}>
              Cancel
            </Button>
            <Button
              variant="primaryDanger"
              size="sm"
              onClick={() => void handleSubmitSeasonComment(pendingCommentStanding)}
              disabled={!commentDrafts[pendingCommentStanding.teamId]?.trim() || submittingTeamId !== null}
            >
              {submittingTeamId ? 'Posting...' : 'Post comment'}
            </Button>
          </div>
        </Modal>
      )}
      {latestNewsPosts.length > 0 && (
        <div className={newsStyles.weeklyPanels}>
          {latestNewsPosts.map((post) => {
            const authorStanding = post.author_team_id
              ? standings.find((standing) => standing.teamId === post.author_team_id)
              : null;

            const authorTeam = authorStanding
              ? {
                  id: authorStanding.teamId,
                  name: authorStanding.teamName,
                  logo_url: authorStanding.logoUrl || DEFAULT_TEAM_LOGO,
                }
              : null;

            return (
              <SectionCard key={post.id} title="🗞 120min Weekly" className={newsStyles.weeklyPanel}>
                <NewsArticle
                  post={post}
                  authorTeam={authorTeam}
                  reactions={latestNewsReactions[post.id] || []}
                  currentUserId={myHtUserId}
                  reactionAuthorNames={reactionAuthorNames}
                  onReaction={handleNewsReaction}
                  tournamentImageUrl={tournament?.image_url}
                />
              </SectionCard>
            );
          })}
          {onVisitNews && (
            <Button variant="zero" onClick={onVisitNews}>
              All press releases
            </Button>
          )}
        </div>
      )}

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
