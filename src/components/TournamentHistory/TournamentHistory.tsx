import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Cards,
  ChartLine,
  ChartLineUp,
  Clock,
  FirstAid,
  Handshake,
  Medal,
  SoccerBall,
  Trophy,
  UsersThree,
} from 'phosphor-react';
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
import styles from './TournamentHistory.module.sass';

const DEFAULT_TEAM_LOGO = '/default-logo.png';
const MAX_COMMENT_LENGTH = 480;

const getCommentDraftStorageKey = (seasonId: string, currentHtUserId: number) =>
  `ht-120min:season-comment-drafts:${currentHtUserId}:${seasonId}`;

const readCommentDrafts = (seasonId: string, currentHtUserId: number): Record<string, string> => {
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
}) => (
  <section className={`${styles.standingsCard} ${styles.yearbookCard}`} ref={scrollTargetRef}>
    <h2>{title || `📔 Season ${seasonNumber} Yearbook`}</h2>
    {subtitle && <p className={styles.yearbookIntro}>{subtitle}</p>}
    {commentsLoading && <p className={styles.mutedText}>Season yearbook comments loading...</p>}
    {!commentsLoadError && showComments && (
      <div className={styles.commentsList}>
        {!commentsLoading && comments.length === 0 && (
          <p className={styles.mutedText}>{emptyMessage || 'Be the first to add a final thought to this Yearbook!'}</p>
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
            {comments.length} of {totalTeams} teams have written their season comments
          </p>
        )}
      </div>
    )}
    {!showComments && !commentsLoading && !commentsLoadError && emptyMessage && (
      <p className={styles.yearbookIntro}>{emptyMessage}</p>
    )}
    {commentsLoadError && <p className={styles.mutedText}>Season comments are unavailable right now.</p>}
    {commentsSubmitError && <p className={styles.commentError}>{commentsSubmitError}</p>}
    {children}
  </section>
);

interface TournamentHistoryProps {
  seasons: TournamentHistorySeason[];
  currentHtUserId: number | null;
  selectedSeasonNumber?: number | null;
  onSelectSeason?: (seasonNumber: number) => void;
  loadComments?: (seasonId: string) => Promise<TournamentSeasonComment[]>;
  submitComment?: (seasonId: string, teamId: string, comment: string) => Promise<TournamentSeasonComment>;
  canGenerateReport?: boolean;
  isGeneratingReport?: boolean;
  onGenerateReport?: () => void;
  scoringMode?: '120m' | '120min' | 'points' | 'appg';
  autoScrollToYearbook?: boolean;
  onCommentsLoaded?: (seasonId: string, commentCount: number) => void;
  forceCommentConfirmOpen?: boolean;
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
    ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value))
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
  scoringMode: '120m' | '120min' | 'points' | 'appg',
  teamId?: string,
) {
  const standing = teamId ? snapshot.standings.find((item) => item.teamId === teamId) : null;
  const games = standing ? ` (${standing.played} games)` : '';
  if (award.key === 'top-scorers') return `${award.value || 0} goals${scoringMode === 'appg' ? games : ''}`;
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
    return scoringMode === 'appg'
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
        {match.went120 && <span>{match.totalMinutes}m</span>}
        {match.roundNumber && <small>Round {match.roundNumber}</small>}
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
  forceCommentConfirmOpen = false,
}) => {
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
            Season {finishedSeasonWithoutReport.seasonNumber} is finished. The admin can now generate a full season
            history report.
          </p>
          {canGenerateReport && onGenerateReport && (
            <Button size="sm" onClick={onGenerateReport} disabled={isGeneratingReport}>
              {isGeneratingReport ? 'Generating...' : 'Generate season report'}
            </Button>
          )}
        </div>
      );
    }

    return <p className={styles.emptyHistory}>No finished seasons yet.</p>;
  }

  const winner = findParticipant(snapshot, snapshot.winner?.teamId);
  const runnerUpStanding = snapshot.standings[1];
  const runnerUp = findParticipant(snapshot, runnerUpStanding?.teamId);
  const thirdPlaceStanding = snapshot.standings[2];
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
  const eligibleTeams = snapshot.participants.filter(
    (participant) =>
      currentHtUserId && participant.hattrickUserId === currentHtUserId && !commentTeamIds.has(participant.teamId),
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
  const isAppgHistory = scoringMode === 'appg';
  const most120Award: SeasonAward = {
    key: 'most-120-matches',
    recipientTeamIds: snapshot.records.most120TeamIds,
    value: snapshot.records.most120Value,
  };
  const fairPlayAward = snapshot.awards.find((award) => award.key === 'fair-play') || null;
  const displayAwards = [
    most120Award,
    ...snapshot.awards.filter(
      (award) =>
        award.key !== 'champions' &&
        award.key !== 'most-120-matches' &&
        award.key !== 'fair-play' &&
        !(scoringMode === 'appg' && award.key === 'every-fixture-completed'),
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

  const handleSubmit = async (participant: SeasonParticipant) => {
    const draft = commentDrafts[participant.teamId] || '';
    if (!draft.trim()) return;

    setSubmittingTeamId(participant.teamId);
    setCommentsSubmitError('');
    try {
      const saved = await submitComment(selectedSeason.id, participant.teamId, draft);
      setComments((current) => [...current, saved]);
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
              Post your final comment as {participant.teamName}
            </label>
            <textarea
              id={`season-comment-${participant.teamId}`}
              value={commentDrafts[participant.teamId] || ''}
              maxLength={MAX_COMMENT_LENGTH}
              rows={4}
              placeholder="Your season's comment..."
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
                Post final comment
              </Button>
            </div>
            <p>This can be posted once and cannot be changed.</p>
          </div>
        ))}
    </SeasonYearbook>
  );

  return (
    <div className={styles.history}>
      <div className={styles.seasonSelector} aria-label="Tournament seasons">
        {seasons.map((season) => {
          const selectable = season.status === 'finished' && !!season.snapshot;
          return (
            <button
              key={season.id}
              type="button"
              disabled={!selectable}
              className={season.id === selectedSeason.id ? styles.selectedSeason : ''}
              onClick={() => selectable && onSelectSeason?.(season.seasonNumber)}
            >
              <strong>Season {season.seasonNumber} Report</strong>
              <span>
                {season.status === 'finished' ? `Finished ${formatDate(season.finishedAt) || ''}` : 'Upcoming'}
              </span>
            </button>
          );
        })}
      </div>

      <div className={styles.historyColumns} data-testid="history-columns">
        <main className={styles.mainColumn}>
          <section className={styles.championCard}>
            <div className={styles.championWinners}>
              <div className={`${styles.championContainer} ${styles.championFirst}`}>
                <div className={styles.championHeadline}>
                  <h2>🏆 Season {selectedSeason.seasonNumber} champions</h2>
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
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className={styles.championPlacings}>
                {runnerUp && (
                  <div className={`${styles.placementCard} ${styles.championSecond}`}>
                    <div className={styles.placementHeader}>Runner-up</div>
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
                    <div className={styles.placementHeaderThird}>Third place</div>
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
                <dt>Season dates</dt>
                <dd>
                  {formatDate(seasonStartedAt) || '-'} - {formatDate(selectedSeason.finishedAt) || '-'}
                </dd>
              </div>
              <div>
                <dt>Tournament Teams</dt>
                <dd>{snapshot.summary.teams}</dd>
              </div>
              <div>
                <dt>Total Rounds</dt>
                <dd>{roundsPlayed}</dd>
              </div>
              <div>
                <dt>120m Matches</dt>
                <dd>
                  {snapshot.summary.achievements120min} (
                  {snapshot.summary.completedMatches > 0
                    ? Math.round((snapshot.summary.achievements120min / snapshot.summary.completedMatches) * 100)
                    : 0}
                  %)
                </dd>
              </div>
              <div>
                <dt>Total Goals</dt>
                <dd>{snapshot.summary.goals}</dd>
              </div>
              <div>
                <dt>Matches Completed</dt>
                <dd>{snapshot.summary.completedMatches}</dd>
              </div>
            </dl>
          </section>

          <section className={styles.contentSection}>
            <h2>Awards & Distinctions</h2>
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
            <h2>Season {selectedSeason.seasonNumber} achievements per team</h2>
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
            <h2>Final standings - Season {selectedSeason.seasonNumber}</h2>
            <div className={styles.tableWrapper}>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Team</th>
                    {isAppgHistory ? (
                      <>
                        <th>APPG</th>
                        <th>Pld</th>
                        <th>Dif</th>
                        <th>Goals</th>
                      </>
                    ) : (
                      <>
                        <th>120m</th>
                        <th>Mins</th>
                        <th>Pld</th>
                        <th>Dif</th>
                        <th>Goals</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {snapshot.standings.map((standing, index) => {
                    const participant = findParticipant(snapshot, standing.teamId);
                    return (
                      <tr key={standing.teamId}>
                        <td>{index + 1}</td>
                        <td>{participant ? <TeamIdentity participant={participant} compact /> : standing.teamName}</td>
                        {isAppgHistory ? (
                          <>
                            <td className={styles.accentStat}>
                              {standing.appgPlayed ? (standing.appgPoints / standing.appgPlayed).toFixed(2) : '0.00'}
                            </td>
                            <td>{standing.played}</td>
                            <td>{standing.gd > 0 ? `+${standing.gd}` : standing.gd}</td>
                            <td>{standing.gf}</td>
                          </>
                        ) : (
                          <>
                            <td className={styles.accentStat}>{standing.achievements120min}</td>
                            <td>{standing.totalMinutes}</td>
                            <td>{standing.played}</td>
                            <td>{standing.gd > 0 ? `+${standing.gd}` : standing.gd}</td>
                            <td>{standing.gf}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </main>

        <aside className={styles.sideColumn}>
          <section className={styles.sideCard}>
            <h2>Season story</h2>
            <p>{snapshot.story}</p>
          </section>

          <section className={styles.sideCard}>
            <h2>Season records</h2>
            <dl className={styles.recordsList}>
              <div>
                <dt>
                  <Medal size={18} /> Most 120-minute matches
                </dt>
                <dd>{most120RecordDetails || '-'}</dd>
              </div>
              <div>
                <dt>
                  <SoccerBall size={18} /> Highest-scoring match
                </dt>
                <dd>
                  {highestScoringMatch
                    ? `${highestScoringMatch.homeTeamName} ${highestScoringMatch.homeGoals} - ${highestScoringMatch.awayGoals} ${highestScoringMatch.awayTeamName}`
                    : '-'}
                </dd>
              </div>
              <div>
                <dt>
                  <ChartLineUp size={18} /> Closest finish
                </dt>
                <dd>
                  {snapshot.records.closestFinish
                    ? `${findParticipant(snapshot, snapshot.records.closestFinish.leaderTeamId)?.teamName || 'Champions'} finished ${snapshot.records.closestFinish.margin} ${snapshot.records.closestFinish.metric === 'points' ? `point${snapshot.records.closestFinish.margin === 1 ? '' : 's'}` : '120-minute result'} ahead of ${findParticipant(snapshot, snapshot.records.closestFinish.runnerUpTeamId)?.teamName || 'the runner-up'}`
                    : '-'}
                </dd>
              </div>
              <div>
                <dt>
                  <Cards size={18} /> Total cards
                </dt>
                <dd>{snapshot.summary.yellowCards + snapshot.summary.redCards}</dd>
              </div>
              <div>
                <dt>
                  <FirstAid size={18} /> Total injuries
                </dt>
                <dd>{snapshot.summary.injuries}</dd>
              </div>
              <div>
                <dt>
                  <Clock size={18} /> Longest match
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
              <h2>Memorable match</h2>
              <p className={styles.recordReason}>
                Chosen for reaching {memorableMatch.totalMinutes} minutes with{' '}
                {memorableMatch.homeGoals + memorableMatch.awayGoals} goals.
              </p>
              <MatchRecord match={memorableMatch} snapshot={snapshot} />
            </section>
          )}
        </aside>
      </div>
      <Modal
        isOpen={pendingCommentParticipant !== null || forceCommentConfirmOpen}
        onClose={() => setPendingCommentParticipant(null)}
        title="Post final comment?"
        maxWidth="520px"
        modalClassName={styles.commentConfirmModal}
        headerClassName={styles.commentConfirmHeader}
        closeButtonClassName={styles.commentConfirmClose}
      >
        <p className={styles.commentConfirmText}>
          This will publish your final season comment as <strong>{pendingCommentParticipant?.teamName}</strong>. It
          cannot be changed afterwards.
        </p>
        <div className={styles.commentConfirmActions}>
          <Button
            variant="primaryDanger"
            size="md"
            onClick={() => pendingCommentParticipant && handleSubmit(pendingCommentParticipant)}
            disabled={pendingCommentParticipant ? !commentDrafts[pendingCommentParticipant.teamId]?.trim() : true}
          >
            Post comment
          </Button>
          <Button variant="action" size="md" onClick={() => setPendingCommentParticipant(null)}>
            Cancel
          </Button>
        </div>
      </Modal>
    </div>
  );
};
