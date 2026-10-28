import { useTranslations } from 'next-intl';
import React, { useEffect, useMemo, useState } from 'react';
import { SectionCard } from '../../components/Card/SectionCard';
import { Button } from '../../components/Button/Button';
import { Modal } from '../../components/Modal/Modal';
import { ArrowClockwise, ArrowRight, Check, CopySimple, Recycle, ShieldCheck } from 'phosphor-react';
import { Tooltip } from '../Tooltip/Tooltip';
import { TeamByline } from '../TeamByline/TeamByline';
import type { ChatAuthorProfile } from './ChatView';
import { SeasonYearbook, type TournamentSeasonComment } from '../TournamentHistory/TournamentHistory';
import { NewsArticle, type NewsPost, type NewsReaction } from './NewsTab';
import { useNewsComments } from './useNewsComments';
import { supabase } from '../../lib/supabase';
import historyStyles from '../TournamentHistory/TournamentHistory.module.sass';
import newsStyles from './NewsTab.module.sass';
import type { TournamentEmojiContext } from '../../utils/tournament-emoji-options';

import {
  average120Stat,
  compareAverage120Standings,
  getAppgStandingsQuota,
  meetsAppgStandingsQuota,
  type TeamStanding,
} from '../../utils/standings';
import { isAppg120ScoringMode, isAverage120ScoringMode } from '../../../shared/scoring-profile';
import { StandingsRoundPreview, type StandingsPreviewRound } from './StandingsRoundPreview';
import { TournamentShareMenu } from '../TournamentShareMenu/TournamentShareMenu';
import { ScoringHelp } from './ScoringHelp';
import {
  TournamentActivity,
  type TournamentActivityMatch,
  type TournamentActivityTeam,
  type TournamentActivityWarning,
} from './TournamentActivity';

import styles from '../../legacy-pages/Public/TournamentView.module.sass';

interface StandingsViewProps {
  standings: TeamStanding[];
  is120minMode: boolean;
  myHtUserId: string | null;
  myManagerName?: string | null;
  managerProfiles?: Record<number, ChatAuthorProfile>;
  tournament: {
    id?: string;
    name?: string;
    slug?: string;
    league_category?: string | null;
    country_limit?: string | number | null;
    country_limit_format?: 'country_id' | 'league_id' | null;
    thumbnail_index?: number;
    image_url?: string | null;
    scoring_mode?: string | null;
  } | null;
  seasonStatus?: 'planned' | 'ongoing' | 'finished';
  lastSeenMap?: Record<number, string | null>;
  onRefreshPresence?: () => void;
  onRefreshRoster?: () => Promise<void>;
  isRefreshingRoster?: boolean;
  canJoinTournament?: boolean;
  isConnecting?: boolean;
  onJoinWithHattrick?: () => void;
  onVisitHistory?: () => void;
  onVisitNews?: () => void;
  onVisitFixtures?: () => void;
  ongoingMatchCount?: number;
  onFollowLive?: () => void;
  rounds?: StandingsPreviewRound[];
  warningTeamIds?: ReadonlySet<string>;
  activityTeams?: TournamentActivityTeam[];
  activityMatches?: TournamentActivityMatch[];
  activityWarnings?: TournamentActivityWarning[];
  activityTournamentId?: string | null;
  activitySeasonId?: string | null;
  activitySeasonStartedAt?: string | null;
  activityFixturesHref?: string;
  activityNewsHref?: string;
  canPublishAnnouncements?: boolean;
  mobileChat?: React.ReactNode;
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

const DEFAULT_TEAM_LOGO = '/matchKitLarge.png';
const defaultLoadComments = async (seasonId: string) => {
  const response = await fetch(`/api/app?route=history&seasonId=${encodeURIComponent(seasonId)}`);
  const data = (await response.json()) as { comments?: TournamentSeasonComment[]; error?: string };
  if (!response.ok) throw new Error(data.error || 'Could not load season comments.');
  return data.comments || [];
};
const STANDINGS_SCORING_MODES = {
  '120min': { enabled: true, label: '120min', tooltip: '120-minute scoring' },
  average120: { enabled: true, label: 'Avg120', tooltip: 'Average 120 min scoring' },
  '90min': { enabled: true, label: '90min', tooltip: 'Regular 90-minute scoring' },
  appg: { enabled: true, label: 'APPG', tooltip: 'Average Points Per Game' },
} as const;

type StandingsScoringMode = keyof typeof STANDINGS_SCORING_MODES;
type StandingsSortKey =
  | 'default'
  | 'team'
  | 'teamRank'
  | 'powerRating'
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
  | 'appg'
  | 'averagePoints'
  | 'averageMinutes'
  | 'averageDifference'
  | 'averageGoals';
type SortDirection = 'asc' | 'desc';

export const StandingsView: React.FC<StandingsViewProps> = ({
  standings,
  is120minMode,
  myHtUserId,
  myManagerName = null,
  managerProfiles: managerProfilesById = {},
  tournament,
  seasonStatus,
  lastSeenMap = {},
  onRefreshPresence,
  onRefreshRoster,
  isRefreshingRoster = false,
  canJoinTournament = false,
  isConnecting = false,
  onJoinWithHattrick,
  onVisitHistory,
  onVisitNews,
  onVisitFixtures,
  ongoingMatchCount = 0,
  onFollowLive,
  rounds = [],
  warningTeamIds = new Set<string>(),
  activityTeams = [],
  activityMatches = [],
  activityWarnings = [],
  activityTournamentId = null,
  activitySeasonId = null,
  activitySeasonStartedAt = null,
  activityFixturesHref,
  activityNewsHref,
  canPublishAnnouncements = false,
  mobileChat,
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
  const uiText = useTranslations('PublicUI.StandingsView');
  const [presencePulse, setPresencePulse] = useState(0);
  const isAppgSupported = isAppg120ScoringMode(tournament?.scoring_mode);
  const isAverage120Supported = isAverage120ScoringMode(tournament?.scoring_mode);
  const [scoringMode, setScoringMode] = useState<StandingsScoringMode>(
    isAppgSupported ? 'appg' : isAverage120Supported ? 'average120' : is120minMode ? '120min' : '90min',
  );
  const [sortKey, setSortKey] = useState<StandingsSortKey>('default');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [seasonComments, setSeasonComments] = useState<TournamentSeasonComment[]>([]);
  const [latestNewsPosts, setLatestNewsPosts] = useState<NewsPost[]>([]);
  const [latestNewsReactions, setLatestNewsReactions] = useState<Record<string, NewsReaction[]>>({});
  const {
    commentsByPost: newsCommentsByPost,
    currentAuthor: newsCommentAuthor,
    submitComment: submitNewsComment,
    submittingPostId: submittingNewsCommentPostId,
  } = useNewsComments(
    latestNewsPosts.map((post) => post.id),
    myHtUserId,
    myManagerName,
  );
  const managerTeamNames = Object.fromEntries(
    standings.flatMap((standing) =>
      standing.hattrickUserId ? [[standing.hattrickUserId, standing.teamName] as const] : [],
    ),
  );
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [pendingCommentStanding, setPendingCommentStanding] = useState<TeamStanding | null>(null);
  const [submittingTeamId, setSubmittingTeamId] = useState<string | null>(null);
  const [commentsSubmitError, setCommentsSubmitError] = useState('');
  const [standingsCopied, setStandingsCopied] = useState(false);
  const [loadedSeasonCommentsId, setLoadedSeasonCommentsId] = useState<string | null>(null);
  const seasonCommentsLoading = Boolean(seasonId && loadedSeasonCommentsId !== seasonId);
  const myHtTeamIds = useMemo(() => {
    if (!myHtUserId) return new Set<number>();

    return new Set(
      standings
        .filter((standing) => Number(standing.hattrickUserId) === Number(myHtUserId))
        .map((standing) => standing.htTeamId)
        .filter((htTeamId): htTeamId is number => typeof htTeamId === 'number'),
    );
  }, [myHtUserId, standings]);
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
  const showAverage120Scoring = scoringMode === 'average120';
  const showAppgScoring = isAppg120ScoringMode(scoringMode);
  const enabledScoringModes = (Object.keys(STANDINGS_SCORING_MODES) as StandingsScoringMode[]).filter(
    (mode) =>
      STANDINGS_SCORING_MODES[mode].enabled &&
      (mode !== 'appg' || isAppgSupported) &&
      (mode !== 'average120' || isAverage120Supported),
  );
  const activeScoringConfig = STANDINGS_SCORING_MODES[scoringMode];

  const averagePointsPerGame = (standing: TeamStanding) =>
    standing.appgPlayed > 0 ? standing.appgPoints / standing.appgPlayed : 0;
  const percentage120min = (standing: TeamStanding) =>
    standing.played > 0 ? (standing.achievements120min / standing.played) * 100 : 0;
  const averageMatchQuota = useMemo(() => {
    return showAppgScoring || showAverage120Scoring ? getAppgStandingsQuota(standings) : 0;
  }, [showAppgScoring, showAverage120Scoring, standings]);
  const reachesAverageQuota = (standing: TeamStanding) => meetsAppgStandingsQuota(standing, averageMatchQuota);

  const sortedStandings = useMemo(() => {
    const rows = [...standings];
    const compareDefault = (a: TeamStanding, b: TeamStanding) => {
      if (scoringMode === 'average120') return compareAverage120Standings(a, b, averageMatchQuota);
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
      if (isAppg120ScoringMode(scoringMode) || showAverage120Scoring) {
        const aReachesQuota = meetsAppgStandingsQuota(a, averageMatchQuota);
        const bReachesQuota = meetsAppgStandingsQuota(b, averageMatchQuota);
        if (aReachesQuota !== bReachesQuota) return aReachesQuota ? -1 : 1;
      }
      if (sortKey === 'default') return compareDefault(a, b);
      if (sortKey === 'team') {
        const result = a.teamName.localeCompare(b.teamName, undefined, { sensitivity: 'base' });
        return sortDirection === 'asc' ? result : -result;
      }

      if (sortKey === 'teamRank' || sortKey === 'powerRating') {
        const aMissing = a[sortKey] == null;
        const bMissing = b[sortKey] == null;
        if (aMissing !== bMissing) return aMissing ? 1 : -1;
      }

      const averageKey = {
        averagePoints: 'pts',
        averageMinutes: 'totalMinutes',
        averageDifference: 'gd',
        averageGoals: 'gf',
      } as const;
      if (showAverage120Scoring && sortKey in averageKey && (a.played === 0 || b.played === 0)) {
        const missingDifference = Number(b.played > 0) - Number(a.played > 0);
        if (missingDifference) return missingDifference;
      }
      const aValue =
        showAverage120Scoring && sortKey in averageKey
          ? (average120Stat(a, averageKey[sortKey as keyof typeof averageKey]) ?? 0)
          : sortKey === 'appg'
            ? averagePointsPerGame(a)
            : sortKey === 'achievements120minPercent'
              ? percentage120min(a)
              : sortKey === 'teamRank'
                ? (a.teamRank ?? 0)
                : sortKey === 'powerRating'
                  ? (a.powerRating ?? 0)
                  : Number(a[sortKey]);
      const bValue =
        showAverage120Scoring && sortKey in averageKey
          ? (average120Stat(b, averageKey[sortKey as keyof typeof averageKey]) ?? 0)
          : sortKey === 'appg'
            ? averagePointsPerGame(b)
            : sortKey === 'achievements120minPercent'
              ? percentage120min(b)
              : sortKey === 'teamRank'
                ? (b.teamRank ?? 0)
                : sortKey === 'powerRating'
                  ? (b.powerRating ?? 0)
                  : Number(b[sortKey]);
      const result = bValue - aValue;
      if (result !== 0) return sortDirection === 'asc' ? -result : result;
      return a.teamName.localeCompare(b.teamName, undefined, { sensitivity: 'base' });
    });

    return rows;
  }, [averageMatchQuota, scoringMode, showAverage120Scoring, sortDirection, sortKey, standings]);
  const showHfiRank = tournament?.league_category === 'hfi' && !showAverage120Scoring;

  useEffect(() => {
    const defaultMode: StandingsScoringMode = isAppgSupported
      ? 'appg'
      : isAverage120Supported
        ? 'average120'
        : is120minMode
          ? '120min'
          : '90min';
    const resetTimer = window.setTimeout(() => {
      setScoringMode(defaultMode);
      setSortKey('default');
      setSortDirection('desc');
    }, 0);
    return () => window.clearTimeout(resetTimer);
  }, [is120minMode, isAppgSupported, isAverage120Supported]);

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
    setSortDirection(nextKey === 'team' || nextKey === 'teamRank' ? 'asc' : 'desc');
  };

  const sortIndicator = (key: StandingsSortKey) => (sortKey === key ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : '');
  const qualifiedAverageCount = showAppgScoring || showAverage120Scoring
    ? sortedStandings.filter((standing) => reachesAverageQuota(standing)).length
    : sortedStandings.length;

  const forumTeamName = (standing: TeamStanding) => standing.teamName.replace(/\[/g, '(').replace(/\]/g, ')');
  const displayTeamName = (name: string) => (name.length > 27 ? `${name.slice(0, 25)}...` : name);
  const formatAverage = (value: number | null) => (value === null ? '0' : Number(value.toFixed(2)).toString());
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

      if (showAverage120Scoring) {
        const header = ['Team', 'Power', '120m%', 'Games', '120m', 'AvPts', 'AvMin', 'Dif', 'AvGls'];
        return `[table]\n${forumHeader(includePlacement ? ['#', ...header] : header)}\n${rows
          .map((standing, index) =>
            forumRow([
              ...(includePlacement ? [index + 1] : []),
              forumTeamName(standing),
              standing.powerRating ?? '—',
              `${percentage120min(standing).toFixed(0)}%`,
              standing.played,
              standing.achievements120min,
              ...(['pts', 'totalMinutes', 'gd', 'gf'] as const).map((key) =>
                formatAverage(average120Stat(standing, key)),
              ),
            ]),
          )
          .join('\n')}\n[/table]`;
      }
      if (show120minScoring) {
        return `[table]\n${forumHeader(['#', 'Team', '120m', 'Pts*', '120m%', 'Mins', 'Dif', 'Goals*'])}\n${rows
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

    let forumText = `${heading}\n${buildTable(sortedStandings.slice(0, qualifiedAverageCount), true)}`;
    if ((showAppgScoring || showAverage120Scoring) && qualifiedAverageCount < sortedStandings.length) {
      forumText += `\n[b]Did not reach the ${averageMatchQuota}-match quota[/b]\n${buildTable(sortedStandings.slice(qualifiedAverageCount), false)}`;
    }
    if (showAppgScoring) {
      forumText += `\n[i]Order: APPG average descending, total APPG points descending, team name ascending. A team must play at least ${averageMatchQuota} matches to qualify (50% of most played).[/i]`;
    } else if (showAverage120Scoring) {
      forumText += `\n[i]Order: 120m% descending, then 120-minute achievements and average tie-break points. A team must play at least ${averageMatchQuota} matches to qualify (50% of most played).[/i]`;
    }

    void navigator.clipboard.writeText(forumText);
    setStandingsCopied(true);
    window.setTimeout(() => setStandingsCopied(false), 2000);
  };
  const sortableHeader = (label: string, key: StandingsSortKey, className = '', tooltip?: string) => {
    const button = (
      <button type="button" className={styles.sortHeader} onClick={() => handleSort(key)}>
        {label}
        <span aria-hidden="true">{sortIndicator(key)}</span>
      </button>
    );

    return (
      <th
        className={className}
        aria-sort={sortKey === key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {tooltip ? (
          <Tooltip id={`standings-header-${key}`} content={tooltip} className="tooltip">
            {button}
          </Tooltip>
        ) : (
          button
        )}
      </th>
    );
  };

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

    const interval = setInterval(refresh, 10 * 60 * 1000);
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
      {ongoingMatchCount > 0 && onFollowLive && (
        <div className={styles.liveMatchesBanner} role="status">
          <strong className={styles.liveMatchesMessage}>{uiText('ongoingMatches', { count: ongoingMatchCount })}</strong>
          <Button type="button" size="sm" variant="zero" className={styles.liveMatchesButton} onClick={onFollowLive}>
            {uiText('followLive')} <ArrowRight size={16} weight="bold" aria-hidden="true" />
          </Button>
        </div>
      )}
      <SectionCard
        title={`🏆 ${uiText('standingsSeason', { season: seasonNumber || 1 })}`}
        thumbnailSeed={tournament?.id}
        thumbnailImageUrl={tournament?.image_url}
        headerRight={
          <div className={styles.scoringControl}>
            {onRefreshRoster && (
              <button
                type="button"
                className={styles.refreshBtn}
                disabled={isRefreshingRoster}
                onClick={() => void onRefreshRoster()}
                aria-label={uiText(isRefreshingRoster ? 'refreshingRoster' : 'refreshRoster')}
                data-tooltip-id="standings-roster-refresh-tooltip"
              >
                <ArrowClockwise size={18} aria-hidden="true" />
              </button>
            )}
            {onRefreshRoster && (
              <Tooltip
                id="standings-roster-refresh-tooltip"
                content={uiText(isRefreshingRoster ? 'refreshingRoster' : 'refreshRoster')}
              />
            )}
            <span>{uiText('scoring')}</span>
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
              aria-label={uiText('copyStandingsForHTForums')}
            >
              {standingsCopied ? <Check size={18} color="green" /> : <CopySimple size={18} />}
            </button>
            <TournamentShareMenu name={tournament?.name ?? ''} slug={tournament?.slug ?? ''} variant="mobile" />
            <Tooltip
              id="standings-copy-tooltip"
              content={standingsCopied ? 'HT forum table copied!' : 'Copy standings for HT forums'}
              className="tooltip"
            />
          </div>
        }
      >
        <div className={styles.tableWrapper}>
          <table className={showAverage120Scoring ? styles.averageStandingsTable : undefined}>
            <thead>
              <tr>
                <th>#</th>
                {sortableHeader(uiText('teamColumn'), 'team', '', 'Tournament team')}
                {showHfiRank
                  ? sortableHeader('HFI', 'teamRank', styles.rankColumn, 'HFI league rank')
                  : sortableHeader(
                      uiText('powerRatingColumn'),
                      'powerRating',
                      styles.rankColumn,
                      'Hattrick Power Rating',
                    )}
                {showAverage120Scoring ? (
                  <>
                    {sortableHeader(
                      uiText('percentage120Column'),
                      'achievements120minPercent',
                      styles.center120,
                      uiText('percentage120Tooltip'),
                    )}
                    {sortableHeader(
                      uiText('matches120PerGamesColumn'),
                      'achievements120min',
                      styles.center,
                      uiText('matches120PerGamesTooltip'),
                    )}
                    {sortableHeader(
                      uiText('avgPointsColumn'),
                      'averagePoints',
                      styles.center,
                      uiText('avgPointsTooltip'),
                    )}
                    {sortableHeader(
                      uiText('avgMinutesColumn'),
                      'averageMinutes',
                      styles.center,
                      uiText('avgMinutesTooltip'),
                    )}
                    {sortableHeader(
                      uiText('avgDifferenceColumn'),
                      'averageDifference',
                      styles.center,
                      uiText('avgDifferenceTooltip'),
                    )}
                    {sortableHeader(uiText('avgGoalsColumn'), 'averageGoals', styles.center, uiText('avgGoalsTooltip'))}
                  </>
                ) : show120minScoring ? (
                  <>
                    {sortableHeader(
                      uiText('matches120Column'),
                      'achievements120min',
                      styles.center120,
                      uiText('matches120Tooltip'),
                    )}
                    {sortableHeader(
                      uiText('tieBreakPointsColumn'),
                      'pts',
                      `${styles.center} ${styles.pointsHeader}`,
                      uiText('tieBreakPointsTooltip'),
                    )}
                    {sortableHeader(
                      uiText('percentage120Column'),
                      'achievements120minPercent',
                      styles.center,
                      'Percentage of matches that reached 120 minutes',
                    )}
                    {sortableHeader(uiText('minutesColumn'), 'totalMinutes', styles.center, 'Total minutes played')}
                    {sortableHeader(
                      uiText('differenceColumn'),
                      'gd',
                      styles.center,
                      'Goal difference in 120 min matches',
                    )}
                    {sortableHeader(uiText('goalsColumn'), 'gf', styles.center, 'Goals scored in 120 min matches')}
                  </>
                ) : showAppgScoring ? (
                  <>
                    {sortableHeader(
                      'APPG',
                      'appg',
                      `${styles.center} ${styles.pointsHeader}`,
                      'Average points per game',
                    )}
                    {sortableHeader(
                      uiText('percentage120Column'),
                      'achievements120minPercent',
                      styles.center,
                      'Percentage of completed matches that reached 120 minutes',
                    )}
                    {sortableHeader(uiText('playedColumn'), 'played', styles.center, 'Completed matches played')}
                    {sortableHeader(uiText('differenceColumn'), 'gd', styles.center, 'Goal difference')}
                    {sortableHeader(uiText('goalsColumn'), 'gf', styles.center, 'Goals scored')}
                  </>
                ) : (
                  <>
                    {sortableHeader(uiText('playedColumn'), 'played', styles.center, 'Completed matches played')}
                    {sortableHeader(uiText('wonColumn'), 'won', styles.center, 'Matches won')}
                    {sortableHeader(uiText('drawnColumn'), 'drawn', styles.center, 'Matches drawn')}
                    {sortableHeader(uiText('lostColumn'), 'lost', styles.center, 'Matches lost')}
                    {sortableHeader(uiText('goalDifferenceColumn'), 'gd', styles.center, 'Goal difference')}
                    {sortableHeader(
                      uiText('pointsColumn'),
                      'pts',
                      `${styles.center} ${styles.pointsHeader}`,
                      'League points',
                    )}
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
                            <span className={styles.teamName}>{uiText('beTheFIRSTTeamToJoin')}</span>
                            <ArrowRight size={15} weight="bold" className={styles.placeholderArrow} />
                          </div>
                        </button>
                        <span className={styles.placeholderByline}>
                          {uiText('inviteOthersToGetThisTournamentStarted')}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className={styles.rankColumn}>—</td>
                  {showAverage120Scoring ? (
                    <>
                      {Array.from({ length: 6 }, (_, index) => (
                        <td key={index} className={styles.center}>
                          0
                        </td>
                      ))}
                    </>
                  ) : show120minScoring ? (
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
                const reachesQuota = reachesAverageQuota(s);
                const placement = reachesQuota
                  ? sortedStandings.slice(0, idx).filter(reachesAverageQuota).length + 1
                  : null;
                return (
                  <React.Fragment key={s.teamId}>
                    {(showAppgScoring || showAverage120Scoring) && idx === qualifiedAverageCount && qualifiedAverageCount < sortedStandings.length && (
                      <tr>
                        <th colSpan={showAverage120Scoring ? 9 : 8} className={styles.appgQuotaLabel}>
                          {showAverage120Scoring
                            ? uiText('average120QuotaDivider', { count: averageMatchQuota })
                            : uiText('doesNotReachQuota')}
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
                                    {uiText('joinWithCHPP')} <ArrowRight size={15} weight="bold" />
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
                                      <span className={styles.teamName} title={s.teamName}>
                                        {displayTeamName(s.teamName)}
                                      </span>
                                      {s.joinedViaOauth && (
                                        <span title={uiText('hattrickValidatedTeam')}>
                                          <ShieldCheck size={14} weight="bold" className={styles.validatedIcon} />
                                        </span>
                                      )}
                                      {warningTeamIds.has(s.teamId) && (
                                        <span title={uiText('misarrangedMatchThisRound')}>
                                          <img
                                            src="/warn-red.png"
                                            alt={uiText('warningIssued')}
                                            className={styles.standingWarningIcon}
                                          />
                                        </span>
                                      )}
                                    </div>
                                  </a>
                                  <TeamByline
                                    countryName={s.countryName}
                                    countryId={s.countryId}
                                    leagueId={s.leagueId}
                                    teamId={s.htTeamId}
                                    teamName={s.teamName}
                                    managerName={s.managerName}
                                    managerHtId={s.hattrickUserId}
                                    managerProfile={
                                      s.hattrickUserId != null ? managerProfilesById[s.hattrickUserId] || null : null
                                    }
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
                                {uiText('leave')}
                              </Button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className={styles.rankColumn}>{(showHfiRank ? s.teamRank : s.powerRating) ?? '—'}</td>
                      {showAverage120Scoring ? (
                        <>
                          <td className={`${styles.highlight} ${styles.center}`}>
                            {percentage120min(s).toFixed(0)}%
                          </td>
                          <td className={styles.center}>{s.achievements120min}/{s.played}</td>
                          <td className={styles.center}>{formatAverage(average120Stat(s, 'pts'))}</td>
                          <td className={styles.center}>{formatAverage(average120Stat(s, 'totalMinutes'))}</td>
                          <td className={styles.center}>{formatAverage(average120Stat(s, 'gd'))}</td>
                          <td className={styles.center}>{formatAverage(average120Stat(s, 'gf'))}</td>
                        </>
                      ) : show120minScoring ? (
                        <>
                          <td className={`${styles.highlight} ${styles.center}`}>{s.achievements120min}</td>
                          <td className={styles.center}>{s.pts}</td>
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
                          <span className={styles.teamName} title={team.name}>
                            {displayTeamName(team.name)}
                          </span>
                        </div>
                        {isOwner && (
                          <div className={styles.reapplyActions}>
                            <Button variant="primaryAction" size="xs" onClick={() => onReapplySuggestion?.(team.id)}>
                              {uiText('reJoin')}
                            </Button>
                            <Button variant="danger" size="xs" onClick={() => onRemoveReapplySuggestion?.(team.id)}>
                              {uiText('leave')}
                            </Button>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className={styles.rankColumn}>—</td>
                    <td colSpan={showAppgScoring ? 5 : 6} />
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Tooltip id="appg-breakdown-tooltip" className="tooltip" />
        </div>
        <ScoringHelp scoringMode={tournament?.scoring_mode} className={styles.standingsScoringHelp} isSmall />
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
              <ArrowRight size={18} weight="bold" />{' '}
              {isConnecting ? uiText('connectingToHattrick') : uiText('joinWithHattrick')}
            </Button>
          </div>
        )}
      </SectionCard>
      {mobileChat}
      <StandingsRoundPreview
        rounds={rounds}
        seasonStatus={seasonStatus}
        onVisitFixtures={onVisitFixtures}
        myHtTeamIds={myHtTeamIds}
      />
      <TournamentActivity
        teams={activityTeams}
        matches={activityMatches}
        warnings={activityWarnings}
        tournamentId={activityTournamentId}
        seasonId={activitySeasonId}
        seasonNumber={seasonNumber}
        seasonStartedAt={activitySeasonStartedAt}
        fixturesHref={activityFixturesHref}
        newsHref={activityNewsHref}
        canPublishAnnouncements={canPublishAnnouncements}
      />
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
                  {uiText('postYourFinalCommentAs')} {standing.teamName}
                </label>
                <textarea
                  id={`standings-season-comment-${standing.teamId}`}
                  value={commentDrafts[standing.teamId] || ''}
                  maxLength={480}
                  rows={4}
                  placeholder={uiText('yourSeasonSComment')}
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
                    {uiText('postFinalComment')}
                  </Button>
                </div>
                <p>{uiText('thisCanBePostedOnceAndCannotBeChanged')}</p>
              </div>
            ))}
        </SeasonYearbook>
      )}
      {pendingCommentStanding && (
        <Modal
          isOpen
          onClose={() => setPendingCommentStanding(null)}
          title={uiText('postFinalComment2')}
          maxWidth="500px"
        >
          <p>
            {uiText('thisWillPublishYourFinalSeasonCommentAs')} <strong>{pendingCommentStanding.teamName}</strong>
            {uiText('itCannotBeChangedLater')}
          </p>
          <div className={styles.historyReportActions}>
            <Button variant="secondaryYellow" size="sm" onClick={() => setPendingCommentStanding(null)}>
              {uiText('cancel')}
            </Button>
            <Button
              variant="primaryDanger"
              size="sm"
              onClick={() => void handleSubmitSeasonComment(pendingCommentStanding)}
              disabled={!commentDrafts[pendingCommentStanding.teamId]?.trim() || submittingTeamId !== null}
            >
              {submittingTeamId ? uiText('posting') : uiText('postComment')}
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
              <SectionCard key={post.id} title={uiText('120minWeekly')} className={newsStyles.weeklyPanel}>
                <NewsArticle
                  post={post}
                  authorTeam={authorTeam}
                  managerTeamNames={managerTeamNames}
                  reactions={latestNewsReactions[post.id] || []}
                  currentUserId={myHtUserId}
                  reactionAuthorNames={reactionAuthorNames}
                  onReaction={handleNewsReaction}
                  comments={newsCommentsByPost[post.id] || []}
                  commentAuthor={newsCommentAuthor}
                  onCommentSubmit={submitNewsComment}
                  commentSubmitting={submittingNewsCommentPostId === post.id}
                  tournamentImageUrl={tournament?.image_url}
                  tournamentEmojiContext={
                    {
                      leagueCategory: tournament?.league_category,
                      countryLimit: tournament?.country_limit,
                      countryLimitFormat: tournament?.country_limit_format,
                    } satisfies TournamentEmojiContext
                  }
                />
              </SectionCard>
            );
          })}
          {onVisitNews && (
            <Button variant="zero" onClick={onVisitNews}>
              {uiText('allPressReleases')}
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
              {uiText('theSeasonYearbookWillOpenOnceTheSeasonConcludes')}
              {canAddSeasonComment && onVisitHistory && (
                <>
                  {' '}
                  <button type="button" className={styles.yearbookHistoryLink} onClick={onVisitHistory}>
                    {uiText('visitHistoryToAddYours')}
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
