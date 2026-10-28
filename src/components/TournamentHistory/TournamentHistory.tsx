import { useTranslations } from 'next-intl';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Cards,
  Check,
  ChartLine,
  ChartLineUp,
  Clock,
  CopySimple,
  FirstAid,
  Handshake,
  Medal,
  Recycle,
  SoccerBall,
  Trophy,
  UsersThree,
} from 'phosphor-react';
import { Tooltip } from '../Tooltip/Tooltip';
import { Button } from '../Button/Button';
import { Modal } from '../Modal/Modal';
import { TeamByline } from '../TeamByline/TeamByline';
import {
  normalizeSeasonHistorySnapshot,
  type SeasonAward,
  type SeasonAwardKey,
  type SeasonHistorySnapshot,
  type SeasonHistorySnapshotV2,
  type SeasonMatchSnapshot,
  type SeasonParticipant,
} from '../../utils/season-history';
import { getHattrickCalendarContext } from '../../utils/hattrick-calendar';
import { average120Stat, compareAverage120Standings, getAppgStandingsQuota, meetsAppgStandingsQuota } from '../../utils/standings';
import { isAppg120ScoringMode } from '../../../shared/scoring-profile';
import styles from './TournamentHistory.module.sass';

const DEFAULT_TEAM_LOGO = '/matchKitLarge.png';
const MAX_COMMENT_LENGTH = 480;

const getCommentDraftStorageKey = (seasonId: string, currentHtUserId: number) =>
  `ht-120min:season-comment-drafts:${currentHtUserId}:${seasonId}`;

const readCommentDrafts = (seasonId: string, currentHtUserId: number): Record<string, string> => {
  if (typeof window === 'undefined') return {};

  try {
    const stored = sessionStorage.getItem(getCommentDraftStorageKey(seasonId, currentHtUserId));
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
};

export interface TournamentHistorySeason {
  id: string;
  seasonNumber: number;
  status: 'planned' | 'ongoing' | 'finished';
  plannedStartSlot: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  snapshot: SeasonHistorySnapshot | null;
}

export interface TournamentSeasonComment {
  id: string;
  season_id: string;
  team_id: string;
  team_name: string;
  manager_name: string | null;
  comment: string;
  created_at: string;
}

interface SeasonYearbookProps {
  seasonNumber: number;
  comments: TournamentSeasonComment[];
  totalTeams?: number;
  commentsLoading: boolean;
  commentsLoadError?: string;
  commentsSubmitError?: string;
  teamLogoById?: Record<string, string | null | undefined>;
  title?: string;
  subtitle?: React.ReactNode;
  showProgress?: boolean;
  showComments?: boolean;
  emptyMessage?: React.ReactNode;
  scrollTargetRef?: React.RefObject<HTMLElement | null>;
  children?: React.ReactNode;
}

export const SeasonYearbook: React.FC<SeasonYearbookProps> = ({
  seasonNumber,
  comments,
  totalTeams,
  commentsLoading,
  commentsLoadError = '',
  commentsSubmitError = '',
  teamLogoById = {},
  title,
  subtitle,
  showProgress = true,
  showComments = true,
  emptyMessage,
  scrollTargetRef,
  children,
}) => {
  const uiText = useTranslations('PublicUI.SeasonYearbook');
  return <section className={`${styles.standingsCard} ${styles.yearbookCard}`} ref={scrollTargetRef}>
    <h2>{title || uiText('yearbookTitle', { season: seasonNumber })}</h2>
    {subtitle && <p className={styles.yearbookIntro}>{subtitle}</p>}
    {commentsLoading && <p className={styles.mutedText}>{uiText('commentsLoading')}</p>}
    {!commentsLoadError && showComments && (
      <div className={styles.commentsList}>
        {!commentsLoading && comments.length === 0 && emptyMessage !== null && (
          <p className={styles.mutedText}>{emptyMessage || uiText('beTheFirstToAddAFinalThoughtTo')}</p>
        )}
        {comments.map((comment) => (
          <blockquote key={comment.id}>
            <div className={styles.commentAuthorRow}>
              <img
                src={teamLogoById[comment.team_id] || DEFAULT_TEAM_LOGO}
                alt=""
                onError={(event) => {
                  event.currentTarget.src = DEFAULT_TEAM_LOGO;
                }}
              />
              <span className={styles.commentAuthor}>
                <strong>{comment.team_name}</strong>
                {comment.manager_name && <small>{comment.manager_name}</small>}
              </span>
            </div>
            <p>{comment.comment}</p>
            <time className={styles.commentDate} dateTime={comment.created_at}>
              {formatDate(comment.created_at)}
              {comment.created_at ? ` • ${getCurrentHattrickSeasonWeekLabel()}` : ''}
            </time>
          </blockquote>
        ))}
        {showProgress && !commentsLoading && !commentsLoadError && typeof totalTeams === 'number' && (
          <p className={styles.yearbookProgress}>
            {uiText('commentsProgress', { count: comments.length, total: totalTeams })}
          </p>
        )}
      </div>
    )}
    {!showComments && !commentsLoading && !commentsLoadError && emptyMessage && (
      <p className={styles.yearbookIntro}>{emptyMessage}</p>
    )}
    {commentsLoadError && <p className={styles.mutedText}>{uiText('commentsUnavailable')}</p>}
    {commentsSubmitError && <p className={styles.commentError}>{commentsSubmitError}</p>}
    {children}
  </section>;
};

const formatAverage120 = (value: number | null) => value === null ? '0' : Number(value.toFixed(2)).toString();

const HISTORY_SCORING_MODES = {
  '120min': { label: '120min', tooltip: '120-minute scoring' },
  average120: { label: 'Avg120', tooltip: 'Average 120 min scoring' },
  '90min': { label: '90min', tooltip: 'Regular 90-minute scoring' },
  appg: { label: 'APPG', tooltip: 'Average Points Per Game' },
} as const;

type HistoryScoringMode = keyof typeof HISTORY_SCORING_MODES;

interface TournamentHistoryProps {
  seasons: TournamentHistorySeason[];
  currentHtUserId: number | null;
  currentOwnedTeamIds?: string[];
  selectedSeasonNumber?: number | null;
  onSelectSeason?: (seasonNumber: number) => void;
  loadComments?: (seasonId: string) => Promise<TournamentSeasonComment[]>;
  submitComment?: (seasonId: string, teamId: string, comment: string) => Promise<TournamentSeasonComment>;
  canGenerateReport?: boolean;
  isGeneratingReport?: boolean;
  onGenerateReport?: () => void;
  scoringMode?: '120m' | '120min' | 'average120' | 'points' | 'appg';
  autoScrollToYearbook?: boolean;
  onCommentsLoaded?: (seasonId: string, commentCount: number) => void;
  onCommentSubmitted?: (seasonId: string, comment: TournamentSeasonComment) => void;
  forceCommentConfirmOpen?: boolean;
  tournamentSlug?: string;
}

const AWARD_DETAILS: Record<SeasonAwardKey, { label: string; icon: React.ReactNode }> = {
  champions: { label: 'Champions', icon: <Trophy size={20} weight="regular" /> },
  'most-120-matches': { label: 'Most 120-minute matches', icon: <Medal size={20} weight="regular" /> },
  'top-scorers': { label: 'Top scorers', icon: <SoccerBall size={20} weight="regular" /> },
  'best-goal-difference': { label: 'Best goal difference', icon: <ChartLineUp size={20} weight="bold" /> },
  'least-goals-allowed': { label: 'Least goals allowed', icon: <ChartLine size={20} weight="bold" /> },
  'fair-play': { label: 'Fair Play', icon: <Handshake size={20} weight="regular" /> },
  'most-cards': { label: 'Most cards', icon: <Cards size={20} weight="regular" /> },
  'most-injuries': { label: 'Most injuries', icon: <FirstAid size={20} weight="regular" /> },
  'most-matches-played': { label: 'Most matches played', icon: <UsersThree size={20} weight="regular" /> },
  'every-fixture-completed': { label: 'Every fixture completed', icon: <UsersThree size={20} weight="regular" /> },
  'total-minute-specialists': { label: 'Total minute specialists', icon: <Clock size={20} weight="regular" /> },
};

const AWARD_PRIORITY: SeasonAwardKey[] = [
  'champions',
  'top-scorers',
  'best-goal-difference',
  'least-goals-allowed',
  'fair-play',
  'most-cards',
  'most-injuries',
  'most-matches-played',
  'every-fixture-completed',
  'total-minute-specialists',
];

const formatDate = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'Europe/Riga',
      }).format(new Date(value))
    : null;

const getCurrentHattrickSeasonWeekLabel = () => {
  const { htSeason, htWeek } = getHattrickCalendarContext();
  return `HT S${htSeason} W${htWeek}`;
};

const defaultLoadComments = async (seasonId: string) => {
  const response = await fetch(`/api/app?route=history&seasonId=${encodeURIComponent(seasonId)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load season comments.');
  return (data.comments || []) as TournamentSeasonComment[];
};

const defaultSubmitComment = async (seasonId: string, teamId: string, comment: string) => {
  const response = await fetch('/api/app?route=history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seasonId, teamId, comment }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not save your season comment.');
  return data.comment as TournamentSeasonComment;
};

function findParticipant(snapshot: SeasonHistorySnapshotV2, teamId?: string | null) {
  return teamId ? snapshot.participants.find((participant) => participant.teamId === teamId) || null : null;
}

function TeamIdentity({
  participant,
  compact = false,
  detail,
}: {
  participant: SeasonParticipant;
  compact?: boolean;
  detail?: React.ReactNode;
}) {
  return (
    <div className={`${styles.teamIdentity} ${compact ? styles.compactTeam : ''}`}>
      <img
        className={styles.teamLogo}
        src={participant.logoUrl || DEFAULT_TEAM_LOGO}
        alt=""
        onError={(event) => {
          event.currentTarget.src = DEFAULT_TEAM_LOGO;
        }}
      />
      <div className={styles.teamInfo}>
        <strong className={styles.teamName}>{participant.teamName}</strong>
        {detail && <div className={styles.detailText}>{detail}</div>}
        {!compact && (
          <div className={styles.teamByline}>
            <TeamByline
              countryName={participant.countryName}
              countryId={participant.countryId}
              leagueId={participant.leagueId}
              teamId={participant.htTeamId}
              managerName={participant.managerName}
              managerHtId={participant.hattrickUserId}
              mode="standings"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function getAwardStat(
  award: SeasonAward,
  snapshot: SeasonHistorySnapshotV2,
  scoringMode: '120m' | '120min' | 'average120' | 'points' | 'appg',
  teamId?: string,
) {
  const standing = teamId ? snapshot.standings.find((item) => item.teamId === teamId) : null;
  const games = standing ? ` (${standing.played} games)` : '';
  if (award.key === 'top-scorers') return `${award.value || 0} goals${isAppg120ScoringMode(scoringMode) ? games : ''}`;
  if (award.key === 'most-120-matches') {
    const percentage = standing?.played ? Math.round(((award.value || 0) / standing.played) * 100) : 0;
    return `${award.value || 0} × 120m (${percentage}%)`;
  }
  if (award.key === 'best-goal-difference') {
    const goalDifference = `${(award.value || 0) > 0 ? '+' : ''}${award.value || 0}`;
    return `${goalDifference} (${standing?.gf || 0} scored)`;
  }
  if (award.key === 'least-goals-allowed') return `${award.value || 0} conceded${games}`;
  if (award.key === 'total-minute-specialists') return `${award.value || 0} mins`;
  if (award.key === 'most-cards') {
    const teamStat = teamId ? snapshot.teamStats.find((stat) => stat.teamId === teamId) : null;
    const cardCount = teamStat ? teamStat.yellowCards + teamStat.redCards : award.value || 0;
    const redCards = teamStat?.redCards || 0;
    return isAppg120ScoringMode(scoringMode)
      ? `${cardCount} card${cardCount === 1 ? '' : 's'} (${standing?.played || 0} games, ${redCards} red)`
      : `${cardCount} card${cardCount === 1 ? '' : 's'}`;
  }
  if (award.key === 'most-injuries') {
    const injuryCount = teamId ? (award.recipientValues?.[teamId] ?? award.value ?? 0) : award.value || 0;
    const injuryWeeks = teamId ? (award.recipientSecondaryValues?.[teamId] ?? 0) : 0;
    return `${injuryCount} injur${injuryCount === 1 ? 'y' : 'ies'}${injuryWeeks ? ` (${injuryWeeks} weeks)` : ''}`;
  }
  if (award.key === 'most-matches-played') return `${award.value || 0} games`;
  if (award.key === 'every-fixture-completed') return 'Full season completed';
  if (award.key === 'fair-play') {
    const cardCount = award.value || 0;
    return `${cardCount} card${cardCount === 1 ? '' : 's'}${games}`;
  }
  return 'Season winners';
}

function getParticipantHighlight(participant: SeasonParticipant, snapshot: SeasonHistorySnapshotV2) {
  const award = AWARD_PRIORITY.map((key) => snapshot.awards.find((item) => item.key === key)).find((item) =>
    item?.recipientTeamIds.includes(participant.teamId),
  );
  if (award) return AWARD_DETAILS[award.key].label;
  const standing = snapshot.standings.find((item) => item.teamId === participant.teamId);
  if (!standing) return 'Season participant';
  if (standing.totalMinutes > 0) return `${standing.totalMinutes} total minutes`;
  return `${standing.gf} goals scored`;
}

function MatchRecord({ match, snapshot }: { match: SeasonMatchSnapshot; snapshot: SeasonHistorySnapshotV2 }) {
  const uiText = useTranslations('PublicUI.MatchRecord');
  const home = findParticipant(snapshot, match.homeTeamId);
  const away = findParticipant(snapshot, match.awayTeamId);
  return (
    <div className={styles.memorableMatch}>
      <div className={styles.memorableTeam}>
        <img src={home?.logoUrl || DEFAULT_TEAM_LOGO} alt="" />
        <span>{match.homeTeamName}</span>
      </div>
      <div className={styles.memorableScore}>
        <strong>
          {match.homeGoals} - {match.awayGoals}
        </strong>
        {match.went120 && <span>{match.totalMinutes}{uiText('m')}</span>}
        {match.roundNumber && <small>{uiText('round')} {match.roundNumber}</small>}
      </div>
      <div className={styles.memorableTeam}>
        <img src={away?.logoUrl || DEFAULT_TEAM_LOGO} alt="" />
        <span>{match.awayTeamName}</span>
      </div>
    </div>
  );
}

export const TournamentHistory: React.FC<TournamentHistoryProps> = ({
  seasons,
  currentHtUserId,
  currentOwnedTeamIds = [],
  selectedSeasonNumber,
  onSelectSeason,
  loadComments = defaultLoadComments,
  submitComment = defaultSubmitComment,
  canGenerateReport = false,
  isGeneratingReport = false,
  onGenerateReport,
  scoringMode = '120min',
  autoScrollToYearbook = false,
  onCommentsLoaded,
  onCommentSubmitted,
  forceCommentConfirmOpen = false,
  tournamentSlug,
}) => {
  const uiText = useTranslations('PublicUI.TournamentHistory');
  const standingsText = useTranslations('PublicUI.StandingsView');
  const yearbookRef = useRef<HTMLElement | null>(null);
  const finishedSeasons = useMemo(
    () => seasons.filter((season) => season.status === 'finished' && season.snapshot),
    [seasons],
  );
  const selectedSeason =
    finishedSeasons.find((season) => season.seasonNumber === selectedSeasonNumber) || finishedSeasons.at(-1) || null;
  const selectedSeasonId = selectedSeason?.id ?? null;
  const snapshot = selectedSeason?.snapshot ? normalizeSeasonHistorySnapshot(selectedSeason.snapshot) : null;
  const [comments, setComments] = useState<TournamentSeasonComment[]>([]);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [loadedCommentDraftStorageKey, setLoadedCommentDraftStorageKey] = useState<string | null>(null);
  const [loadedCommentsSeasonId, setLoadedCommentsSeasonId] = useState<string | null>(null);
  const [commentsLoadError, setCommentsLoadError] = useState('');
  const [commentsSubmitError, setCommentsSubmitError] = useState('');
  const [submittingTeamId, setSubmittingTeamId] = useState<string | null>(null);
  const [pendingCommentParticipant, setPendingCommentParticipant] = useState<SeasonParticipant | null>(null);
  const [historyReportCopied, setHistoryReportCopied] = useState(false);
  const historyMode = snapshot?.scoringMode || (scoringMode === 'average120' ? '120min' : scoringMode);
  const defaultHistoryScoringMode: HistoryScoringMode = historyMode === 'average120' ? 'average120' : isAppg120ScoringMode(historyMode)
    ? 'appg'
    : historyMode === 'points'
      ? '90min'
      : '120min';
  const [historyScoringSelection, setHistoryScoringSelection] = useState<{
    seasonId: string | null;
    mode: HistoryScoringMode;
  } | null>(null);
  const historyScoringMode = historyScoringSelection?.seasonId === selectedSeasonId &&
    (historyMode === 'average120' || historyScoringSelection.mode !== 'average120')
    ? historyScoringSelection.mode : defaultHistoryScoringMode;

  useEffect(() => {
    if (!selectedSeasonId) return;
    let cancelled = false;
    loadComments(selectedSeasonId)
      .then((items) => {
        if (!cancelled) {
          setComments(items);
          setLoadedCommentsSeasonId(selectedSeasonId);
          setCommentsLoadError('');
          onCommentsLoaded?.(selectedSeasonId, items.length);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setComments([]);
          setLoadedCommentsSeasonId(selectedSeasonId);
          setCommentsLoadError(error instanceof Error ? error.message : 'Season comments are unavailable.');
          onCommentsLoaded?.(selectedSeasonId, 0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadComments, onCommentsLoaded, selectedSeasonId]);

  useEffect(() => {
    if (!autoScrollToYearbook || !yearbookRef.current || !selectedSeasonId) return;
    yearbookRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [autoScrollToYearbook, selectedSeasonId]);

  useEffect(() => {
    const id = setTimeout(() => {
      if (!selectedSeason || !currentHtUserId) {
        // Session storage is an external draft source; clear stale local state when its scope changes.
        setLoadedCommentDraftStorageKey(null);
        setCommentDrafts({});
        return;
      }
      const storageKey = getCommentDraftStorageKey(selectedSeason.id, currentHtUserId);
      setLoadedCommentDraftStorageKey(storageKey);
      setCommentDrafts(readCommentDrafts(selectedSeason.id, currentHtUserId));
    }, 0);

    return () => clearTimeout(id);
  }, [currentHtUserId, selectedSeason]);

  useEffect(() => {
    if (!selectedSeason || !currentHtUserId) return;
    const storageKey = getCommentDraftStorageKey(selectedSeason.id, currentHtUserId);
    if (loadedCommentDraftStorageKey !== storageKey) return;
    try {
      if (Object.keys(commentDrafts).length === 0) {
        sessionStorage.removeItem(storageKey);
      } else {
        sessionStorage.setItem(storageKey, JSON.stringify(commentDrafts));
      }
    } catch {
      // Draft persistence is best effort when session storage is unavailable.
    }
  }, [commentDrafts, currentHtUserId, loadedCommentDraftStorageKey, selectedSeason]);

  if (finishedSeasons.length === 0 || !selectedSeason || !snapshot) {
    const finishedSeasonWithoutReport = [...seasons]
      .reverse()
      .find((season) => season.status === 'finished' && !season.snapshot);

    if (finishedSeasonWithoutReport) {
      return (
        <div className={styles.emptyHistoryReport}>
          <p>
            {uiText('season')} {finishedSeasonWithoutReport.seasonNumber} {uiText('isFinishedTheAdminCanNowGenerateAFull')}
          </p>
          {canGenerateReport && onGenerateReport && (
            <Button size="sm" onClick={onGenerateReport} disabled={isGeneratingReport}>
              {isGeneratingReport ? uiText('generating') : uiText('generateSeasonReport')}
            </Button>
          )}
        </div>
      );
    }

    return <p className={styles.emptyHistory}>{uiText('noFinishedSeasonsYet')}</p>;
  }

  const isAppgHistory = isAppg120ScoringMode(historyMode);
  const historyAppgQuota = isAppgHistory ? getAppgStandingsQuota(snapshot.standings) : 0;
  const historyAverage120Quota = historyScoringMode === 'average120' ? getAppgStandingsQuota(snapshot.standings) : 0;
  const sortedHistoryStandings = [...snapshot.standings].sort((a, b) => {
    if (historyScoringMode === 'average120') return compareAverage120Standings(a, b, historyAverage120Quota);
    if (historyScoringMode === 'appg') {
      const aQualified = meetsAppgStandingsQuota(a, historyAppgQuota);
      const bQualified = meetsAppgStandingsQuota(b, historyAppgQuota);
      if (aQualified !== bQualified) return aQualified ? -1 : 1;
      const averageDifference =
        (b.appgPlayed ? b.appgPoints / b.appgPlayed : 0) - (a.appgPlayed ? a.appgPoints / a.appgPlayed : 0);
      if (averageDifference !== 0) return averageDifference;
      if (b.appgPoints !== a.appgPoints) return b.appgPoints - a.appgPoints;
      if (b.appgPlayed !== a.appgPlayed) return b.appgPlayed - a.appgPlayed;
      return a.teamName.localeCompare(b.teamName, undefined, { sensitivity: 'base' });
    }
    if (historyScoringMode === '120min') {
      if (b.achievements120min !== a.achievements120min) return b.achievements120min - a.achievements120min;
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (b.gd !== a.gd) return b.gd - a.gd;
      if (b.gf !== a.gf) return b.gf - a.gf;
      return a.played - b.played;
    }
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.gd !== a.gd) return b.gd - a.gd;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return a.teamName.localeCompare(b.teamName, undefined, { sensitivity: 'base' });
  });
  const qualifiedHistoryStandings =
    historyScoringMode === 'appg'
      ? sortedHistoryStandings.filter((standing) => meetsAppgStandingsQuota(standing, historyAppgQuota))
      : sortedHistoryStandings;
  const belowQuotaHistoryStandings =
    historyScoringMode === 'appg'
      ? sortedHistoryStandings.filter((standing) => !meetsAppgStandingsQuota(standing, historyAppgQuota))
      : [];
  const displayedHistoryStandings = historyScoringMode === 'average120' ? sortedHistoryStandings : qualifiedHistoryStandings;
  const qualifiedAverage120Count = historyScoringMode === 'average120'
    ? sortedHistoryStandings.filter((standing) => meetsAppgStandingsQuota(standing, historyAverage120Quota)).length
    : 0;
  const enabledHistoryScoringModes: HistoryScoringMode[] = historyMode === 'average120' ? ['average120', '120min', '90min'] : isAppgHistory
    ? ['appg', '120min', '90min']
    : ['120min', '90min'];
  const activeHistoryScoringConfig = HISTORY_SCORING_MODES[historyScoringMode];
  const toggleHistoryScoringMode = () => {
    const currentIndex = enabledHistoryScoringModes.indexOf(historyScoringMode);
    setHistoryScoringSelection({ seasonId: selectedSeasonId, mode: enabledHistoryScoringModes[(currentIndex + 1) % enabledHistoryScoringModes.length] });
  };
  const historyEligibleTeamIds = new Set(
    snapshot.standings
      .filter((standing) => meetsAppgStandingsQuota(standing, historyAppgQuota))
      .map((standing) => standing.teamId),
  );
  const displayableAwards = snapshot.awards
    .map((award) =>
      isAppgHistory
        ? { ...award, recipientTeamIds: award.recipientTeamIds.filter((teamId) => historyEligibleTeamIds.has(teamId)) }
        : award,
    )
    .filter((award) => award.recipientTeamIds.length > 0);
  const winner = findParticipant(snapshot, snapshot.winner?.teamId);
  const winnerStanding = snapshot.winner
    ? snapshot.standings.find((standing) => standing.teamId === snapshot.winner?.teamId)
    : null;
  const runnerUpStanding = qualifiedHistoryStandings[1];
  const runnerUp = findParticipant(snapshot, runnerUpStanding?.teamId);
  const thirdPlaceStanding = qualifiedHistoryStandings[2];
  const thirdPlace = findParticipant(snapshot, thirdPlaceStanding?.teamId);
  const most120RecordDetails = snapshot.records.most120TeamIds
    .map((teamId) => {
      const teamName = findParticipant(snapshot, teamId)?.teamName;
      const standing = snapshot.standings.find((item) => item.teamId === teamId);
      if (!teamName) return null;
      const percentage = standing?.played ? Math.round((snapshot.records.most120Value / standing.played) * 100) : 0;
      return `${teamName} ${snapshot.records.most120Value} × 120m (${percentage}%)`;
    })
    .filter(Boolean)
    .join(', ');
  const memorableMatch = snapshot.matches.find((match) => match.id === snapshot.records.memorableMatchId) || null;
  const highestScoringMatch =
    snapshot.matches.find((match) => match.id === snapshot.records.highestScoringMatchId) || null;
  const longestMatch = snapshot.matches.find((match) => match.id === snapshot.records.longestMatchId) || null;
  const commentTeamIds = new Set(comments.map((comment) => comment.team_id));
  const currentOwnedTeamIdSet = new Set(currentOwnedTeamIds);
  const eligibleTeams = snapshot.participants.filter(
    (participant) =>
      currentHtUserId && currentOwnedTeamIdSet.has(participant.teamId) && !commentTeamIds.has(participant.teamId),
  );
  const commentsLoading = loadedCommentsSeasonId !== selectedSeasonId;
  const seasonStartedAt =
    selectedSeason.startedAt ||
    snapshot.matches
      .map((match) => match.scheduledFor)
      .filter((value): value is string => !!value)
      .sort()[0] ||
    null;
  const roundsPlayed = new Set(
    snapshot.matches.map((match) => match.roundNumber).filter((value): value is number => typeof value === 'number'),
  ).size;
  const storedMost120Award = displayableAwards.find((award) => award.key === 'most-120-matches');
  const fallbackMost120Standings = isAppgHistory ? qualifiedHistoryStandings : snapshot.standings;
  const fallbackMost120Value = Math.max(0, ...fallbackMost120Standings.map((standing) => standing.achievements120min));
  const most120Award: SeasonAward = storedMost120Award || {
    key: 'most-120-matches',
    recipientTeamIds: fallbackMost120Standings
      .filter((standing) => standing.achievements120min === fallbackMost120Value)
      .map((standing) => standing.teamId),
    value: fallbackMost120Value,
  };
  const fairPlayAward = snapshot.awards.find((award) => award.key === 'fair-play') || null;
  const displayAwards = [
    most120Award,
    ...displayableAwards.filter(
      (award) =>
        award.key !== 'champions' &&
        award.key !== 'most-120-matches' &&
        award.key !== 'fair-play' &&
        !(isAppgHistory && award.key === 'every-fixture-completed'),
    ),
    ...(fairPlayAward ? [fairPlayAward] : []),
  ].sort((a, b) => {
    const order: SeasonAwardKey[] = [
      'most-120-matches',
      'top-scorers',
      'best-goal-difference',
      'least-goals-allowed',
      'fair-play',
      'most-cards',
      'most-injuries',
      'most-matches-played',
      'every-fixture-completed',
      'total-minute-specialists',
    ];
    return order.indexOf(a.key) - order.indexOf(b.key);
  });

  const forumCell = (value: string | number) => `[td]${value}[/td]`;
  const forumHeaderCell = (value: string) => `[th]${value}[/th]`;
  const forumRow = (values: Array<string | number>) => `[tr]${values.map(forumCell).join('')}[/tr]`;
  const forumTable = (header: string[], rows: Array<Array<string | number>>) =>
    `[table]\n${[`[tr]${header.map(forumHeaderCell).join('')}[/tr]`, ...rows.map(forumRow)].join('\n')}\n[/table]`;
  const forumKeyValueTable = (rows: Array<[string, string | number]>) =>
    `[table]\n${rows.map(([label, value]) => `[tr]${forumHeaderCell(label)}${forumCell(value)}[/tr]`).join('\n')}\n[/table]`;
  const forumTeamName = (name: string) => name.replace(/\[/g, '(').replace(/\]/g, ')');

  const copyHistoryReport = () => {
    const title = `[b]🏆 Season ${selectedSeason.seasonNumber} Report[/b]`;
    const link = tournamentSlug ? `[link=https://120min.vercel.app/t/${tournamentSlug}?tab=history]` : null;
    const finishedDate = `[i]Finished ${formatDate(selectedSeason.finishedAt) || '-'}[/i]`;
    const podiumRows = [
      winner ? `🥇 [b]${forumTeamName(winner.teamName)}[/b] — Champions` : null,
      runnerUp ? `🥈 [b]${forumTeamName(runnerUp.teamName)}[/b] — Runner-up` : null,
      thirdPlace ? `🥉 [b]${forumTeamName(thirdPlace.teamName)}[/b] — Third place` : null,
    ].filter((row): row is string => !!row);
    const glanceTable = forumKeyValueTable([
      ['Season dates', `${formatDate(seasonStartedAt) || '-'}–${formatDate(selectedSeason.finishedAt) || '-'}`],
      ['Teams', snapshot.summary.teams],
      ['Rounds', roundsPlayed],
      ['Completed matches', snapshot.summary.completedMatches],
      [
        '120-minute matches',
        `${snapshot.summary.achievements120min} (${snapshot.summary.completedMatches > 0 ? Math.round((snapshot.summary.achievements120min / snapshot.summary.completedMatches) * 100) : 0}%)`,
      ],
      ['Total goals', snapshot.summary.goals],
    ]);
    const awardRows = displayAwards.map((award) => {
      const recipients = award.recipientTeamIds
        .map((teamId) => findParticipant(snapshot, teamId))
        .filter((participant): participant is SeasonParticipant => !!participant);
      const firstRecipient = recipients[0];
      return [
        AWARD_DETAILS[award.key].label,
        recipients.map((participant) => forumTeamName(participant.teamName)).join(', '),
        firstRecipient ? getAwardStat(award, snapshot, scoringMode, firstRecipient.teamId) : '',
      ];
    });
    const awardTable = forumTable(['Award', 'Team', 'Result'], awardRows);
    const standingRows = snapshot.standings.map((standing, index) => [
      index + 1,
      forumTeamName(standing.teamName),
      isAppgHistory
        ? standing.appgPlayed > 0
          ? (standing.appgPoints / standing.appgPlayed).toFixed(2)
          : '0.00'
        : standing.achievements120min,
      ...(isAppgHistory
        ? []
        : [`${standing.played > 0 ? Math.round((standing.achievements120min / standing.played) * 100) : 0}%`]),
      ...(isAppgHistory ? [standing.played] : [standing.totalMinutes, standing.played]),
      standing.gd > 0 ? `+${standing.gd}` : standing.gd,
      standing.gf,
    ]);
    const standingsTable = forumTable(
      isAppgHistory
        ? ['#', 'Team', 'APPG', 'Pld', 'Dif', 'Goals']
        : ['#', 'Team', '120m', '120m%', 'Mins', 'Pld', 'Dif', 'Goals'],
      standingRows,
    );
    const reportSections = [
      title,
      link,
      finishedDate,
      '',
      '[b]Season podium[/b]',
      ...podiumRows,
      '',
      '[b]Season at a glance[/b]',
      glanceTable,
      '[b]Awards & distinctions[/b]',
      awardTable,
      '[b]Final standings[/b]',
      standingsTable,
      '[b]Season story[/b]',
      '',
      snapshot.story,
      '',
      `[b]📔 Season ${selectedSeason.seasonNumber} Yearbook[/b]`,
      '',
      ...comments.flatMap((comment) => [
        `[q]\n[b]${forumTeamName(comment.team_name)}${comment.manager_name ? ` — ${forumTeamName(comment.manager_name)}` : ''}[/b]\n\n${comment.comment}\n\n[i]${formatDate(comment.created_at)} • ${getCurrentHattrickSeasonWeekLabel()}[/i]\n[/q]`,
        '',
      ]),
      `[i]${comments.length} of ${snapshot.participants.length} teams submitted a season comment.[/i]`,
    ].filter((section): section is string => section !== null && section !== undefined);

    void navigator.clipboard.writeText(reportSections.join('\n'));
    setHistoryReportCopied(true);
    window.setTimeout(() => setHistoryReportCopied(false), 2000);
  };

  const handleSubmit = async (participant: SeasonParticipant) => {
    const draft = commentDrafts[participant.teamId] || '';
    if (!draft.trim()) return;

    setSubmittingTeamId(participant.teamId);
    setCommentsSubmitError('');
    try {
      const saved = await submitComment(selectedSeason.id, participant.teamId, draft);
      setComments((current) => [...current, saved]);
      onCommentSubmitted?.(selectedSeason.id, saved);
      setCommentDrafts((current) => ({ ...current, [participant.teamId]: '' }));
    } catch (error) {
      setCommentsSubmitError(error instanceof Error ? error.message : 'Could not save your season comment.');
    } finally {
      setSubmittingTeamId(null);
      setPendingCommentParticipant(null);
    }
  };

  const yearbookSection = (
    <SeasonYearbook
      seasonNumber={selectedSeason.seasonNumber}
      comments={comments}
      totalTeams={snapshot.participants.length}
      commentsLoading={commentsLoading}
      commentsLoadError={commentsLoadError}
      commentsSubmitError={commentsSubmitError}
      emptyMessage={eligibleTeams.length > 0 ? null : "Season participants' final comments will appear here."}
      teamLogoById={Object.fromEntries(
        snapshot.participants.map((participant) => [participant.teamId, participant.logoUrl]),
      )}
      scrollTargetRef={yearbookRef}
    >
      {!commentsLoading &&
        !commentsLoadError &&
        eligibleTeams.map((participant) => (
          <div key={participant.teamId} className={styles.commentForm}>
            <label htmlFor={`season-comment-${participant.teamId}`}>
              {uiText('postYourFinalCommentAs')} {participant.teamName}
            </label>
            <textarea
              id={`season-comment-${participant.teamId}`}
              value={commentDrafts[participant.teamId] || ''}
              maxLength={MAX_COMMENT_LENGTH}
              rows={4}
              placeholder={uiText('yourSeasonSComment')}
              onChange={(event) =>
                setCommentDrafts((current) => ({ ...current, [participant.teamId]: event.target.value }))
              }
            />
            <div>
              <small>
                {(commentDrafts[participant.teamId] || '').length}/{MAX_COMMENT_LENGTH}
              </small>
              <Button
                size="sm"
                variant="primaryDanger"
                onClick={() => setPendingCommentParticipant(participant)}
                disabled={!commentDrafts[participant.teamId]?.trim() || submittingTeamId === participant.teamId}
              >
                {uiText('postFinalComment')}
              </Button>
            </div>
            <p>{uiText('thisCanBePostedOnceAndCannotBeChanged')}</p>
          </div>
        ))}
    </SeasonYearbook>
  );

  return (
    <div className={styles.history}>
      <div className={styles.seasonSelector} aria-label={uiText('tournamentSeasons')}>
        {seasons.map((season) => {
          const selectable = season.status === 'finished' && !!season.snapshot;
          return (
            <div key={season.id} className={styles.seasonSelectorItem}>
              <button
                type="button"
                disabled={!selectable}
                className={season.id === selectedSeason.id ? styles.selectedSeason : ''}
                onClick={() => selectable && onSelectSeason?.(season.seasonNumber)}
              >
                <strong>{uiText('season')} {season.seasonNumber} {uiText('report')}</strong>
                <span>
                  {season.status === 'finished' ? `Finished ${formatDate(season.finishedAt) || ''}` : uiText('upcoming')}
                </span>
              </button>
              {season.id === selectedSeason.id && snapshot && (
                <button
                  type="button"
                  className={styles.seasonCopyButton}
                  onClick={copyHistoryReport}
                  data-tooltip-id="history-report-copy-tooltip"
                  aria-label={uiText('copySeasonReportForHTForums')}
                >
                  {historyReportCopied ? <Check size={18} color="green" /> : <CopySimple size={18} />}
                </button>
              )}
            </div>
          );
        })}
        <Tooltip
          id="history-report-copy-tooltip"
          content={historyReportCopied ? 'HT forum report copied!' : 'Copy season report for HT forums'}
          className="tooltip"
        />
      </div>

      <div className={styles.historyColumns} data-testid="history-columns">
        <main className={styles.mainColumn}>
          <section className={styles.championCard}>
            <div className={styles.championWinners}>
              <div className={`${styles.championContainer} ${styles.championFirst}`}>
                <div className={styles.championHeadline}>
                  <h2>{uiText('season2')} {selectedSeason.seasonNumber} {uiText('champions')}</h2>
                </div>
                <div className={styles.winner}>
                  {winner && (
                    <div className={styles.winnerFirstIdentity}>
                      <img
                        className={styles.winnerFirstLogo}
                        src={winner.logoUrl || DEFAULT_TEAM_LOGO}
                        alt=""
                        onError={(event) => {
                          event.currentTarget.src = DEFAULT_TEAM_LOGO;
                        }}
                      />
                      <div className={styles.winnerFirstInfo}>
                        <h3 className={styles.winnerFirstName}>{winner.teamName}</h3>
                        <div className={styles.winnerFirstByline}>
                          <TeamByline
                            countryName={winner.countryName}
                            countryId={winner.countryId}
                            leagueId={winner.leagueId}
                            teamId={winner.htTeamId}
                            managerName={winner.managerName}
                            managerHtId={winner.hattrickUserId}
                            mode="standings"
                          />
                          {isAppg120ScoringMode(scoringMode) && winnerStanding && (
                            <div className={styles.winnerStats}>
                              {uiText('aPPG')}{' '}
                              {winnerStanding.appgPlayed > 0
                                ? (winnerStanding.appgPoints / winnerStanding.appgPlayed).toFixed(2)
                                : '0.00'}
                              {' · '}{uiText('pld')} {winnerStanding.played}
                              {' · '}{uiText('120m')} {winnerStanding.achievements120min}
                              {' · '}
                              {winnerStanding.played > 0
                                ? `${Math.round((winnerStanding.achievements120min / winnerStanding.played) * 100)}%`
                                : '0%'}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className={styles.championPlacings}>
                {runnerUp && (
                  <div className={`${styles.placementCard} ${styles.championSecond}`}>
                    <div className={styles.placementHeader}>{uiText('runnerUp')}</div>
                    <div className={styles.placementBody}>
                      <div className={styles.winnerSecondIdentity}>
                        <img
                          className={styles.winnerSecondLogo}
                          src={runnerUp.logoUrl || DEFAULT_TEAM_LOGO}
                          alt=""
                          onError={(event) => {
                            event.currentTarget.src = DEFAULT_TEAM_LOGO;
                          }}
                        />
                        <div className={styles.winnerSecondInfo}>
                          <h3 className={styles.winnerSecondName}>{runnerUp.teamName}</h3>
                          <div className={styles.winnerSecondByline}>
                            <TeamByline
                              countryName={runnerUp.countryName}
                              countryId={runnerUp.countryId}
                              leagueId={runnerUp.leagueId}
                              teamId={runnerUp.htTeamId}
                              managerName={runnerUp.managerName}
                              managerHtId={runnerUp.hattrickUserId}
                              mode="standings"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {thirdPlace && (
                  <div className={`${styles.placementCard} ${styles.championThird}`}>
                    <div className={styles.placementHeaderThird}>{uiText('thirdPlace')}</div>
                    <div className={styles.placementBody}>
                      <div className={styles.winnerThirdIdentity}>
                        <img
                          className={styles.winnerThirdLogo}
                          src={thirdPlace.logoUrl || DEFAULT_TEAM_LOGO}
                          alt=""
                          onError={(event) => {
                            event.currentTarget.src = DEFAULT_TEAM_LOGO;
                          }}
                        />
                        <div className={styles.winnerThirdInfo}>
                          <h3 className={styles.winnerThirdName}>{thirdPlace.teamName}</h3>
                          <div className={styles.winnerThirdByline}>
                            <TeamByline
                              countryName={thirdPlace.countryName}
                              countryId={thirdPlace.countryId}
                              leagueId={thirdPlace.leagueId}
                              teamId={thirdPlace.htTeamId}
                              managerName={thirdPlace.managerName}
                              managerHtId={thirdPlace.hattrickUserId}
                              mode="standings"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <dl className={styles.seasonNumbers}>
              <div>
                <dt>{uiText('seasonDates')}</dt>
                <dd>
                  {formatDate(seasonStartedAt) || '-'} - {formatDate(selectedSeason.finishedAt) || '-'}
                </dd>
              </div>
              <div>
                <dt>{uiText('tournamentTeams')}</dt>
                <dd>{snapshot.summary.teams}</dd>
              </div>
              <div>
                <dt>{uiText('totalRounds')}</dt>
                <dd>{roundsPlayed}</dd>
              </div>
              <div>
                <dt>{uiText('120mMatches')}</dt>
                <dd>
                  {snapshot.summary.achievements120min} (
                  {snapshot.summary.completedMatches > 0
                    ? Math.round((snapshot.summary.achievements120min / snapshot.summary.completedMatches) * 100)
                    : 0}
                  %)
                </dd>
              </div>
              <div>
                <dt>{uiText('totalGoals')}</dt>
                <dd>{snapshot.summary.goals}</dd>
              </div>
              <div>
                <dt>{uiText('matchesCompleted')}</dt>
                <dd>{snapshot.summary.completedMatches}</dd>
              </div>
            </dl>
          </section>

          <section className={styles.contentSection}>
            <h2 className={styles.awards}>{uiText('awardsAndDistinctions')}</h2>
            <div className={styles.awardsGrid} data-testid="history-awards">
              {displayAwards.map((award) => {
                const recipients = award.recipientTeamIds
                  .map((teamId) => findParticipant(snapshot, teamId))
                  .filter((participant): participant is SeasonParticipant => !!participant);
                const isSingleRecipient = recipients.length === 1;
                return (
                  <article key={award.key} className={styles.awardCard}>
                    <div className={styles.awardLabel}>
                      {AWARD_DETAILS[award.key].icon}
                      <span>{AWARD_DETAILS[award.key].label}</span>
                    </div>
                    {isSingleRecipient ? (
                      <TeamIdentity
                        key={recipients[0].teamId}
                        participant={recipients[0]}
                        compact
                        detail={getAwardStat(award, snapshot, scoringMode, recipients[0].teamId)}
                      />
                    ) : (
                      <>
                        <div className={styles.awardRecipients}>
                          {recipients.map((participant) => (
                            <TeamIdentity
                              key={participant.teamId}
                              participant={participant}
                              compact
                              detail={getAwardStat(award, snapshot, scoringMode, participant.teamId)}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          <section className={styles.contentSection}>
            <h2>{uiText('season')} {selectedSeason.seasonNumber} {uiText('achievementsPerTeam')}</h2>
            <div className={styles.participantsGrid}>
              {[...snapshot.participants]
                .sort((a, b) => (a.finalPosition || 999) - (b.finalPosition || 999))
                .map((participant) => (
                  <article key={participant.teamId} className={styles.participantCard}>
                    <TeamIdentity
                      participant={participant}
                      compact
                      detail={getParticipantHighlight(participant, snapshot)}
                    />
                  </article>
                ))}
            </div>
          </section>

          {yearbookSection}

          <section className={styles.standingsCard}>
            <div className={styles.standingsHeading}>
              <h2>{uiText('finalStandingsSeason')} {selectedSeason.seasonNumber}</h2>
              <div className={styles.scoringControl}>
                <span>{uiText('scoring')}</span>
                <button
                  type="button"
                  className={styles.scoringToggle}
                  onClick={toggleHistoryScoringMode}
                  title={activeHistoryScoringConfig.tooltip}
                  aria-label={`Switch scoring display from ${activeHistoryScoringConfig.label}`}
                >
                  <span>{activeHistoryScoringConfig.label}</span>
                  <Recycle size={16} weight="regular" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className={styles.tableWrapper}>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{uiText('team')}</th>
                    {historyScoringMode === 'average120' ? (
                      <>
                        <th title="Hattrick Power Rating">PwrR</th>
                        <th title={standingsText('avg120Tooltip')}>{standingsText('avg120Column')}</th>
                        <th title={standingsText('gamesTooltip')}>{standingsText('gamesColumn')}</th>
                        <th title={standingsText('avgPointsTooltip')}>{standingsText('avgPointsColumn')}</th>
                        <th title={standingsText('avgMinutesTooltip')}>{standingsText('avgMinutesColumn')}</th>
                        <th title={standingsText('avgDifferenceTooltip')}>{standingsText('avgDifferenceColumn')}</th>
                        <th title={standingsText('avgGoalsTooltip')}>{standingsText('avgGoalsColumn')}</th>
                      </>
                    ) : historyScoringMode === 'appg' ? (
                      <>
                        <th>{uiText('aPPG')}</th>
                        <th>{uiText('pld')}</th>
                        <th>{uiText('dif')}</th>
                        <th>{uiText('goals')}</th>
                      </>
                    ) : historyScoringMode === '120min' ? (
                      <>
                        <th>{uiText('120m2')}</th>
                        <th>{uiText('pts')}</th>
                        <th>{uiText('mins')}</th>
                        <th>{uiText('pld')}</th>
                        <th>{uiText('dif')}</th>
                        <th>{uiText('goals')}</th>
                      </>
                    ) : (
                      <>
                        <th>{uiText('pld')}</th>
                        <th>{uiText('w')}</th>
                        <th>{uiText('d')}</th>
                        <th>{uiText('l')}</th>
                        <th>{uiText('gD')}</th>
                        <th>{uiText('pts')}</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {displayedHistoryStandings.map((standing, index) => {
                    const participant = findParticipant(snapshot, standing.teamId);
                    return (
                      <React.Fragment key={standing.teamId}>
                        {historyScoringMode === 'average120' && index === qualifiedAverage120Count && (
                          <tr>
                            <th colSpan={9} className={styles.appgQuotaLabel}>
                              {uiText('didNotReachQuota')}{historyAverage120Quota} {uiText('matches')}
                            </th>
                          </tr>
                        )}
                        <tr>
                          <td>{historyScoringMode === 'average120' && index >= qualifiedAverage120Count ? '-' : index + 1}</td>
                        <td>{participant ? <TeamIdentity participant={participant} compact /> : standing.teamName}</td>
                        {historyScoringMode === 'average120' ? (
                          <>
                            <td>{standing.powerRating ?? '—'}</td>
                            <td className={styles.accentStat}>{formatAverage120(average120Stat(standing, 'achievements120min'))}</td>
                            <td>{standing.played}</td>
                            <td>{formatAverage120(average120Stat(standing, 'pts'))}</td>
                            <td>{formatAverage120(average120Stat(standing, 'totalMinutes'))}</td>
                            <td>{formatAverage120(average120Stat(standing, 'gd'))}</td>
                            <td>{formatAverage120(average120Stat(standing, 'gf'))}</td>
                          </>
                        ) : historyScoringMode === 'appg' ? (
                          <>
                            <td className={styles.accentStat}>
                              {standing.appgPlayed ? (standing.appgPoints / standing.appgPlayed).toFixed(2) : '0.00'}
                            </td>
                            <td>{standing.played}</td>
                            <td>{standing.gd > 0 ? `+${standing.gd}` : standing.gd}</td>
                            <td>{standing.gf}</td>
                          </>
                        ) : historyScoringMode === '120min' ? (
                          <>
                            <td className={styles.accentStat}>{standing.achievements120min}</td>
                            <td>{standing.pts}</td>
                            <td>{standing.totalMinutes}</td>
                            <td>{standing.played}</td>
                            <td>{standing.gd > 0 ? `+${standing.gd}` : standing.gd}</td>
                            <td>{standing.gf}</td>
                          </>
                        ) : (
                          <>
                            <td>{standing.played}</td>
                            <td>{standing.won}</td>
                            <td>{standing.drawn}</td>
                            <td>{standing.lost}</td>
                            <td>{standing.gd > 0 ? `+${standing.gd}` : standing.gd}</td>
                            <td className={styles.accentStat}>{standing.pts}</td>
                          </>
                        )}
                        </tr>
                      </React.Fragment>
                    );
                  })}
                  {historyScoringMode === 'appg' && belowQuotaHistoryStandings.length > 0 && (
                    <>
                      <tr>
                        <th colSpan={6} className={styles.appgQuotaLabel}>
                          {uiText('didNotReachQuota')}{historyAppgQuota} {uiText('matches')}
                        </th>
                      </tr>
                      {belowQuotaHistoryStandings.map((standing) => {
                        const participant = findParticipant(snapshot, standing.teamId);
                        return (
                          <tr key={standing.teamId}>
                            <td>-</td>
                            <td>
                              {participant ? <TeamIdentity participant={participant} compact /> : standing.teamName}
                            </td>
                            <td className={styles.accentStat}>
                              {standing.appgPlayed ? (standing.appgPoints / standing.appgPlayed).toFixed(2) : '0.00'}
                            </td>
                            <td>{standing.played}</td>
                            <td>{standing.gd > 0 ? `+${standing.gd}` : standing.gd}</td>
                            <td>{standing.gf}</td>
                          </tr>
                        );
                      })}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </main>

        <aside className={styles.sideColumn}>
          <section className={styles.sideCard}>
            <h2>{uiText('seasonStory')}</h2>
            <p>{snapshot.story}</p>
          </section>

          <section className={styles.sideCard}>
            <h2>{uiText('seasonRecords')}</h2>
            <dl className={styles.recordsList}>
              <div>
                <dt>
                  <Medal size={18} /> {uiText('most120MinuteMatches')}
                </dt>
                <dd>{most120RecordDetails || '-'}</dd>
              </div>
              <div>
                <dt>
                  <SoccerBall size={18} /> {uiText('highestScoringMatch')}
                </dt>
                <dd>
                  {highestScoringMatch
                    ? `${highestScoringMatch.homeTeamName} ${highestScoringMatch.homeGoals} - ${highestScoringMatch.awayGoals} ${highestScoringMatch.awayTeamName}`
                    : '-'}
                </dd>
              </div>
              <div>
                <dt>
                  <ChartLineUp size={18} /> {uiText('closestFinish')}
                </dt>
                <dd>
                  {snapshot.records.closestFinish
                    ? `${findParticipant(snapshot, snapshot.records.closestFinish.leaderTeamId)?.teamName || 'Champions'} finished ${snapshot.records.closestFinish.margin} ${snapshot.records.closestFinish.metric === 'points' ? `point${snapshot.records.closestFinish.margin === 1 ? '' : 's'}` : snapshot.records.closestFinish.metric === 'average120' ? 'Avg120 per match' : '120-minute result'} ahead of ${findParticipant(snapshot, snapshot.records.closestFinish.runnerUpTeamId)?.teamName || 'the runner-up'}`
                    : '-'}
                </dd>
              </div>
              <div>
                <dt>
                  <Cards size={18} /> {uiText('totalCards')}
                </dt>
                <dd>{snapshot.summary.yellowCards + snapshot.summary.redCards}</dd>
              </div>
              <div>
                <dt>
                  <FirstAid size={18} /> {uiText('totalInjuries')}
                </dt>
                <dd>{snapshot.summary.injuries}</dd>
              </div>
              <div>
                <dt>
                  <Clock size={18} /> {uiText('longestMatch')}
                </dt>
                <dd>
                  {longestMatch
                    ? `${longestMatch.homeTeamName} ${longestMatch.homeGoals} - ${longestMatch.awayGoals} ${longestMatch.awayTeamName} · ${longestMatch.totalMinutes} minutes`
                    : '-'}
                </dd>
              </div>
            </dl>
          </section>

          {memorableMatch && (
            <section className={styles.sideCard}>
              <h2>{uiText('memorableMatch')}</h2>
              <p className={styles.recordReason}>
                {uiText('chosenForReaching')} {memorableMatch.totalMinutes} {uiText('minutesWith')}{' '}
                {memorableMatch.homeGoals + memorableMatch.awayGoals} {uiText('goals2')}
              </p>
              <MatchRecord match={memorableMatch} snapshot={snapshot} />
            </section>
          )}
        </aside>
      </div>
      <Modal
        isOpen={pendingCommentParticipant !== null || forceCommentConfirmOpen}
        onClose={() => setPendingCommentParticipant(null)}
        title={uiText('postFinalComment2')}
        maxWidth="520px"
        modalClassName={styles.commentConfirmModal}
        headerClassName={styles.commentConfirmHeader}
        closeButtonClassName={styles.commentConfirmClose}
      >
        <p className={styles.commentConfirmText}>
          {uiText('thisWillPublishYourFinalSeasonCommentAs')} <strong>{pendingCommentParticipant?.teamName}</strong>{uiText('itCannotBeChangedAfterwards')}
        </p>
        <div className={styles.commentConfirmActions}>
          <Button
            variant="primaryDanger"
            size="md"
            onClick={() => pendingCommentParticipant && handleSubmit(pendingCommentParticipant)}
            disabled={pendingCommentParticipant ? !commentDrafts[pendingCommentParticipant.teamId]?.trim() : true}
          >
            {uiText('postComment')}
          </Button>
          <Button variant="action" size="md" onClick={() => setPendingCommentParticipant(null)}>
            {uiText('cancel')}
          </Button>
        </div>
      </Modal>
    </div>
  );
};
