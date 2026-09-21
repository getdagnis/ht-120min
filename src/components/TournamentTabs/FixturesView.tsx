import React from 'react';
import { SectionCard } from '../../components/Card/SectionCard';
import { Button } from '../../components/Button/Button';
import { FixtureCard } from '../../components/FixtureCard/FixtureCard';
import { Modal } from '../../components/Modal/Modal';
import { ArrowClockwise, ArrowRight, CopySimple, Check } from 'phosphor-react';
import { Tooltip } from 'react-tooltip';
import { calculateMatchDate } from '../../utils/ht-data';
import { getHattrickWeekDetails } from '../../utils/hattrick-calendar';
import { getImportedFixtureRoundPeriod } from '../../utils/manual-rounds';
import { getMatchDateForRound } from '../../utils/match-schedule';
import { useClientNow } from '../../hooks/useHydratedBrowserState';
import type { AppgOutcome } from '../../utils/appg';
import type { MatchEventDetails } from '../../../shared/match-events';
import styles from '../../legacy-pages/Public/TournamentView.module.sass';

export interface FixtureMatch {
  id: string;
  round_id: string;
  home_team_id: string | null;
  away_team_id: string | null;
  home_goals: number | null;
  away_goals: number | null;
  completed: boolean;
  went_120: boolean;
  total_minutes: number;
  penalty_shootout_home_goals?: number | null;
  penalty_shootout_away_goals?: number | null;
  home_yellow_cards?: number;
  home_red_cards?: number;
  home_injuries?: number;
  away_yellow_cards?: number;
  away_red_cards?: number;
  away_injuries?: number;
  match_event_details?: MatchEventDetails | null;
  status: 'not_arranged' | 'arranged' | 'ongoing' | 'misarranged' | 'finished';
  ht_match_id: number | null;
  match_type: number | null;
  match_date?: Date;
  scheduled_for?: string | null;
  schedule_slot_type?: string | null;
  fixture_source?: string | null;
  appg_outcome?: AppgOutcome | null;
  home_team: {
    name: string;
    active?: boolean;
    ht_team_id: number;
    logo_url?: string;
    country_name?: string;
    country_id?: number;
    manager_name?: string;
    hattrick_user_id?: number;
  } | null;
  away_team: {
    name: string;
    active?: boolean;
    ht_team_id: number;
    logo_url?: string;
    country_name?: string;
    country_id?: number;
    manager_name?: string;
    hattrick_user_id?: number;
  } | null;
}

function getFixtureDisplayTimeZone(
  match: Pick<FixtureMatch, 'ht_match_id' | 'schedule_slot_type' | 'fixture_source'>,
) {
  const isGeneratedFixture = match.fixture_source === 'generated' || Boolean(match.schedule_slot_type);
  return match.ht_match_id && !isGeneratedFixture ? 'Europe/Stockholm' : undefined;
}

interface FixturesViewProps {
  rounds: {
    id: string;
    round_number: number;
    created_at: string;
    matches: FixtureMatch[];
  }[];
  season: number;
  upcomingRoundIndex: number;
  defaultVisibleRoundsCount: number;
  expandedRounds: Record<string, boolean>;
  toggleRound: (roundId: string) => void;
  onExpandAllRounds: () => void;
  onCollapseAllRounds: () => void;
  tournament: {
    id: string;
    scoring_mode?: string;
    name: string;
    slug: string;
    created_at: string;
    status?: string | null;
    last_fixtures_refresh: string | null;
  } | null;
  isRefreshingFixtures: boolean;
  handleRefreshFixtures: () => Promise<void>;
  copied: Record<string, boolean>;
  setCopied: (val: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  warnings: {
    team_id: string;
    round_id: string;
    type?: 'yellow' | 'red';
  }[];
  liveData: Record<
    string,
    {
      status: 'arranged' | 'ongoing' | 'finished';
      homeGoals: number;
      awayGoals: number;
      venue_mismatch?: boolean;
      home_yellow_cards?: number;
      home_red_cards?: number;
      home_injuries?: number;
      away_yellow_cards?: number;
      away_red_cards?: number;
      away_injuries?: number;
      match_event_details?: MatchEventDetails;
    }
  >;
  canJoinTournament: boolean;
  canJoinAnotherTeam?: boolean;
  isConnecting: boolean;
  canUpdateFixtures?: boolean;
  onJoinWithHattrick: () => void;
  isHistorical?: boolean;
  currentHtUserId?: number | null;
  onViewPreviousSeason?: () => void;
  onViewNextSeason?: () => void;
  emptyStateMessage?: string;
}

const FIXTURE_CHALLENGE_PREVIEW_MATCH_ID = 'fixture-challenge-preview-match';
const HATTRICK_CHALLENGES_URL = 'https://www.hattrick.org/goto.ashx?path=/Club/Challenges/';
const fixtureChallengePreviewMode =
  process.env.NODE_ENV !== 'production' &&
  (process.env.NEXT_PUBLIC_FIXTURE_CHALLENGE_PREVIEW === '1' ||
    process.env.NEXT_PUBLIC_FIXTURE_CHALLENGE_PREVIEW === '2')
    ? process.env.NEXT_PUBLIC_FIXTURE_CHALLENGE_PREVIEW
    : null;

export const FixturesView: React.FC<FixturesViewProps> = ({
  rounds,
  season,
  upcomingRoundIndex,
  defaultVisibleRoundsCount,
  expandedRounds,
  toggleRound,
  onExpandAllRounds,
  onCollapseAllRounds,
  tournament,
  isRefreshingFixtures,
  handleRefreshFixtures,
  copied,
  setCopied,
  warnings,
  liveData,
  canJoinTournament,
  canJoinAnotherTeam = canJoinTournament,
  isConnecting,
  canUpdateFixtures = false,
  onJoinWithHattrick,
  isHistorical = false,
  currentHtUserId,
  onViewPreviousSeason,
  onViewNextSeason,
  emptyStateMessage,
}) => {
  type FixtureChallengeAvailability = {
    available: boolean;
    side?: 'home' | 'away';
    opponent?: { name: string; htTeamId: number };
    matchType?: 'cup_rules' | 'normal';
    venue?: 'home' | 'away';
    reason?: string;
    sent?: boolean;
  };
  type FixtureChallengeSelection = {
    matchType: 'cup_rules' | 'normal';
    venue: 'home' | 'away';
  };

  const nowMs = useClientNow(30_000);
  const [manualVisibleRoundsCount, setManualVisibleRoundsCount] = React.useState<number | null>(null);
  const [selectedTeamId, setSelectedTeamId] = React.useState<string | null>(null);
  const [isTeamFilterOpen, setIsTeamFilterOpen] = React.useState(false);
  const [challengeAvailability, setChallengeAvailability] = React.useState<
    Record<string, FixtureChallengeAvailability>
  >(() =>
    fixtureChallengePreviewMode
      ? {
          [FIXTURE_CHALLENGE_PREVIEW_MATCH_ID]: {
            available: true,
            side: 'home',
            opponent: { name: 'Preview Opponent FC', htTeamId: 900002 },
            matchType: 'cup_rules',
            venue: 'away',
          },
        }
      : {},
  );
  const [challengeMatchId, setChallengeMatchId] = React.useState<string | null>(null);
  const [challengeError, setChallengeError] = React.useState<string | null>(null);
  const [isSendingChallenge, setIsSendingChallenge] = React.useState(false);
  const [challengeSuccess, setChallengeSuccess] = React.useState<string | null>(null);
  const [challengeSelection, setChallengeSelection] = React.useState<FixtureChallengeSelection | null>(null);
  const currentRound = !isHistorical && upcomingRoundIndex >= 0 ? (rounds[upcomingRoundIndex] ?? null) : null;
  const tournamentId = tournament?.id;
  const currentRoundScrollTargetRef = React.useRef<HTMLDivElement | null>(null);
  const hasAutoScrolledToCurrentRoundRef = React.useRef(false);
  const visibleRoundsCount = manualVisibleRoundsCount ?? defaultVisibleRoundsCount;
  const fixtureTeams = React.useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>();
    rounds.forEach((round) => {
      round.matches.forEach((match) => {
        if (match.home_team_id && match.home_team)
          byId.set(match.home_team_id, { id: match.home_team_id, name: match.home_team.name });
        if (match.away_team_id && match.away_team)
          byId.set(match.away_team_id, { id: match.away_team_id, name: match.away_team.name });
      });
    });
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rounds]);
  const filteredRounds = React.useMemo(
    () =>
      selectedTeamId
        ? rounds
            .map((round) => ({
              ...round,
              matches: round.matches.filter(
                (match) => match.home_team_id === selectedTeamId || match.away_team_id === selectedTeamId,
              ),
            }))
            .filter((round) => round.matches.length > 0)
        : rounds,
    [rounds, selectedTeamId],
  );
  const selectedTeamName = fixtureTeams.find((team) => team.id === selectedTeamId)?.name;
  const lastFinishedRoundNumber = React.useMemo(() => {
    let latestFinishedRoundNumber: number | null = null;

    for (const round of rounds) {
      const isFinished = round.matches.every((match) => match.completed || match.status === 'misarranged');
      if (isFinished) latestFinishedRoundNumber = round.round_number;
    }

    return latestFinishedRoundNumber;
  }, [rounds]);

  const challengeCandidateMatches = React.useMemo(
    () =>
      currentRound?.matches.filter((match) => {
        if (match.completed || (match.status && match.status !== 'not_arranged') || !currentHtUserId) return false;
        return (
          Number(match.home_team?.hattrick_user_id) === currentHtUserId ||
          Number(match.away_team?.hattrick_user_id) === currentHtUserId
        );
      }) || [],
    [currentHtUserId, currentRound],
  );
  const challengeCandidateKey = challengeCandidateMatches.map((match) => match.id).join(',');

  React.useEffect(() => {
    if (!tournamentId || !currentHtUserId || challengeCandidateMatches.length === 0) return;

    let cancelled = false;
    const loadChallengeAvailability = async () => {
      const results = await Promise.all(
        challengeCandidateMatches.map(async (match) => {
          try {
            const params = new URLSearchParams({ tournamentId, matchId: match.id });
            const response = await fetch(`/api/app?route=fixture-challenge&${params.toString()}`, {
              credentials: 'include',
            });
            const payload = (await response.json()) as FixtureChallengeAvailability;
            return [match.id, payload] as const;
          } catch {
            return [match.id, { available: false }] as const;
          }
        }),
      );
      if (cancelled) return;
      setChallengeAvailability((previous) => ({ ...previous, ...Object.fromEntries(results) }));
    };

    void loadChallengeAvailability();
    return () => {
      cancelled = true;
    };
  }, [challengeCandidateKey, challengeCandidateMatches, currentHtUserId, tournamentId]);

  const openChallengeConfirmation = React.useCallback((matchId: string) => {
    const challenge = challengeAvailability[matchId];
    setChallengeError(null);
    setChallengeSuccess(null);
    setChallengeSelection({
      matchType: challenge?.matchType === 'normal' ? 'normal' : 'cup_rules',
      venue: challenge?.venue === 'away' ? 'away' : 'home',
    });
    setChallengeMatchId(matchId);
  }, [challengeAvailability]);

  const closeChallengeConfirmation = React.useCallback(() => {
    if (isSendingChallenge) return;
    setChallengeMatchId(null);
    setChallengeError(null);
    setChallengeSuccess(null);
    setChallengeSelection(null);
  }, [isSendingChallenge]);

  const submitChallenge = React.useCallback(async () => {
    if (!tournamentId || !challengeMatchId || isSendingChallenge) return;

    if (challengeMatchId === FIXTURE_CHALLENGE_PREVIEW_MATCH_ID) {
      if (fixtureChallengePreviewMode === '1') {
        setChallengeSuccess('Challenge sent. Wait for Preview Opponent FC to accept.');
      } else {
        setChallengeError('Preview only: Hattrick rejected this challenge.');
      }
      return;
    }

    setIsSendingChallenge(true);
    setChallengeError(null);
    try {
      const response = await fetch('/api/app?route=fixture-challenge', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId,
          matchId: challengeMatchId,
          matchType: challengeSelection?.matchType,
          venue: challengeSelection?.venue,
        }),
      });
      const payload = (await response.json()) as FixtureChallengeAvailability & { error?: string; message?: string };
      if (!response.ok || !payload.sent) {
        setChallengeError(payload.error || payload.reason || 'Hattrick could not send this challenge.');
        return;
      }
      setChallengeAvailability((previous) => ({
        ...previous,
        [challengeMatchId]: { ...previous[challengeMatchId], ...payload, sent: true },
      }));
      setChallengeSuccess(
        `Challenge sent. Wait for ${payload.opponent?.name || challengeAvailability[challengeMatchId]?.opponent?.name || 'your opponent'} to accept.`,
      );
    } catch {
      setChallengeError('Could not contact Hattrick. Please try again.');
    } finally {
      setIsSendingChallenge(false);
    }
  }, [challengeAvailability, challengeMatchId, challengeSelection, isSendingChallenge, tournamentId]);

  const selectedChallenge = challengeMatchId ? challengeAvailability[challengeMatchId] : null;
  const selectedChallengeSelection: FixtureChallengeSelection =
    challengeSelection || {
      matchType: selectedChallenge?.matchType === 'normal' ? 'normal' : 'cup_rules',
      venue: selectedChallenge?.venue === 'away' ? 'away' : 'home',
    };

  const scrollToCurrentRound = React.useCallback(() => {
    if (!currentRound || currentRound.round_number < 3) return false;

    const target =
      currentRoundScrollTargetRef.current ??
      document.querySelector<HTMLElement>(`[data-round-id="${currentRound.id}"]`);

    if (!target) return false;

    const offsetPx = 160;
    const top = Math.max(window.scrollY + target.getBoundingClientRect().top - offsetPx, 0);

    window.scrollTo({ top, behavior: 'smooth' });
    return true;
  }, [currentRound]);

  React.useEffect(() => {
    if (!currentRound || currentRound.round_number < 3) return;
    if (hasAutoScrolledToCurrentRoundRef.current) return;

    let cancelled = false;
    let attempts = 0;
    let timerId: number | undefined;

    const attemptScroll = () => {
      if (cancelled || hasAutoScrolledToCurrentRoundRef.current) return;

      if (scrollToCurrentRound()) {
        hasAutoScrolledToCurrentRoundRef.current = true;
        return;
      }

      if (attempts < 12) {
        attempts += 1;
        timerId = window.setTimeout(attemptScroll, 50);
      }
    };

    timerId = window.setTimeout(attemptScroll, 50);

    return () => {
      cancelled = true;
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, [currentRound, currentRound?.id, currentRound?.round_number, scrollToCurrentRound]);

  const resolveMatchDate = React.useCallback(
    (round: { created_at: string; round_number: number }, match: FixtureMatch) =>
      getMatchDateForRound(round, match, match.home_team?.country_name) ||
      match.match_date ||
      calculateMatchDate(round.created_at, round.round_number, match.home_team?.country_name),
    [],
  );

  return (
    <div className={styles.rounds}>
      <div className={styles.fixturesHeader}>
        <h3 className={styles.fixturesTitle}>Season {season} Fixtures</h3>
        {(onViewPreviousSeason || onViewNextSeason || rounds.length > 0) && (
          <div className={styles.fixturesHeaderActions}>
            {onViewPreviousSeason && (
              <button type="button" className={styles.fixturesHeaderAction} onClick={onViewPreviousSeason}>
                <span>PREVIOUS</span>
              </button>
            )}
            {onViewNextSeason && (
              <button type="button" className={styles.fixturesHeaderAction} onClick={onViewNextSeason}>
                <span>NEXT</span>
              </button>
            )}
            {rounds.length > 0 && (
              <div className={styles.fixturesFilterMenu}>
                <button
                  type="button"
                  className={styles.fixturesHeaderAction}
                  onClick={() => setIsTeamFilterOpen((open) => !open)}
                  aria-expanded={isTeamFilterOpen}
                  aria-haspopup="listbox"
                >
                  <span>FILTER: {selectedTeamName || 'ALL TEAMS'}</span>
                </button>
                {isTeamFilterOpen && (
                  <div className={styles.fixturesFilterDropdown} role="listbox" aria-label="Filter fixtures by team">
                    <button
                      type="button"
                      className={styles.fixturesFilterOption}
                      onClick={() => {
                        setSelectedTeamId(null);
                        setIsTeamFilterOpen(false);
                      }}
                    >
                      ALL TEAMS
                    </button>
                    {fixtureTeams.map((team) => (
                      <button
                        key={team.id}
                        type="button"
                        className={styles.fixturesFilterOption}
                        onClick={() => {
                          setSelectedTeamId(team.id);
                          setIsTeamFilterOpen(false);
                        }}
                      >
                        {team.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {rounds.length > 0 && (
              <button type="button" className={styles.fixturesHeaderAction} onClick={onExpandAllRounds}>
                <span>EXPAND ALL</span>
              </button>
            )}
            {rounds.length > 0 && (
              <button type="button" className={styles.fixturesHeaderAction} onClick={onCollapseAllRounds}>
                <span>COLLAPSE ALL</span>
              </button>
            )}
          </div>
        )}
      </div>

      {rounds.length === 0 && (
        <SectionCard title="Fixtures & Results">
          <div className={`${styles.emptyFixtures} ${styles.registrationStatus}`}>
            <p>{emptyStateMessage || 'Fixtures have not yet been generated. Tournament is open for registration.'}</p>
            {canJoinAnotherTeam && <span>You can join with another team.</span>}
            {(canJoinTournament || canJoinAnotherTeam) && (
              <Button
                variant="primary"
                size="sm"
                className={styles.joinButton}
                onClick={onJoinWithHattrick}
                disabled={isConnecting}
              >
                <ArrowRight size={18} weight="bold" /> Join with Hattrick
              </Button>
            )}
          </div>
        </SectionCard>
      )}

      {filteredRounds.slice(0, visibleRoundsCount).map((round) => {
        const isNextRound = round.id === currentRound?.id;

        const isExpanded =
          expandedRounds[round.id] ??
          (upcomingRoundIndex < 0 || lastFinishedRoundNumber === null
            ? true
            : round.round_number >= lastFinishedRoundNumber);

        const allFinished = round.matches.every((m) => m.completed || m.status === 'misarranged');

        const nextRound = filteredRounds[filteredRounds.findIndex((r) => r.id === round.id) + 1];

        const roundDate = round.matches[0] ? resolveMatchDate(round, round.matches[0]) : null;
        const roundTimeZone = round.matches[0] ? getFixtureDisplayTimeZone(round.matches[0]) : undefined;
        const roundWeek = roundDate ? getHattrickWeekDetails(roundDate) : null;
        const roundPeriod = roundDate ? getImportedFixtureRoundPeriod(roundDate) : null;

        const formatMatch = (m: FixtureMatch, isNext: boolean) => {
          const hasPenaltyShootout =
            m.completed &&
            m.went_120 &&
            m.penalty_shootout_home_goals !== null &&
            m.penalty_shootout_away_goals !== null;
          const matchDate = resolveMatchDate(round, m);
          const value = isNext
            ? `${matchDate.toLocaleDateString('lv-LV', {
                day: '2-digit',
                month: '2-digit',
                timeZone: getFixtureDisplayTimeZone(m),
              })}`
            : m.completed
              ? `${m.home_goals} : ${m.away_goals}${hasPenaltyShootout ? ` (${m.penalty_shootout_home_goals}:${m.penalty_shootout_away_goals})` : ''}${m.went_120 ? " 🎯 120'!" : ''}`
              : m.status === 'misarranged'
                ? 'DNP'
                : `${matchDate.toLocaleDateString('lv-LV', {
                    day: '2-digit',
                    month: '2-digit',
                    timeZone: getFixtureDisplayTimeZone(m),
                  })}.`;

          return `[tr][td]${m.home_team?.name}[/td][td][b]${value}[/b][/td][td]${m.away_team?.name}[/td][/tr]`;
        };

        const handleCopy = () => {
          let table = `[b]${tournament?.name}[/b]\n[link=http://ht-120min.vercel.app/t/${tournament?.slug}]\n\n[b]ROUND ${round.round_number}, ${allFinished ? 'final results:[/b]' : 'Fixtures:[/b]'}\n[table]${round.matches
            .map((m) => formatMatch(m, !m.completed && m.status !== 'misarranged'))
            .join(' ')}[/table]`;

          if (nextRound) {
            table += `\n[b]Next: ROUND ${nextRound.round_number}, fixtures:[/b]\n[table]${nextRound.matches.map((m) => formatMatch(m, true)).join(' ')}[/table]`;
          }
          table += `\nFull fixtures: [link=http://ht-120min.vercel.app/t/${tournament?.slug}?tab=fixtures]`;
          navigator.clipboard.writeText(table);
          setCopied((prev) => ({ ...prev, [round.id]: true }));
          setTimeout(() => setCopied((prev) => ({ ...prev, [round.id]: false })), 2000);
        };

        return (
          <div key={round.id} ref={isNextRound ? currentRoundScrollTargetRef : null} data-round-id={round.id}>
            <SectionCard
              className={isNextRound ? styles.upcomingRound : ''}
              collapsible
              isCollapsed={!isExpanded}
              onToggleCollapse={() => toggleRound(round.id)}
              title={
                <div className={styles.roundHeader}>
                  <>
                    <span>Round {round.round_number}</span>
                    {roundDate && roundWeek && (
                      <span className={styles.roundDate}>
                        HT Week {roundWeek.htWeek}
                        {roundPeriod !== 'full_week' ? ` • ${roundPeriod === 'weekend' ? 'Weekend' : 'Midweek'}` : ''} •{' '}
                        {roundDate.toLocaleDateString('lv-LV', {
                          timeZone: roundTimeZone,
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })}
                      </span>
                    )}
                  </>
                </div>
              }
              headerRight={
                !isHistorical && (allFinished || isNextRound) ? (
                  <div className={styles.fixturesControls} onClick={(e) => e.stopPropagation()}>
                    {allFinished || tournament?.status === 'finished' ? (
                      <>
                        <span className={styles.lastRefresh}>
                          <div className="hideOnMobile">Copy for HT forums:</div>
                        </span>
                        <button
                          className={styles.refreshBtn}
                          onClick={handleCopy}
                          data-tooltip-id={`copy-tooltip-${round.id}`}
                        >
                          {copied[round.id] ? <Check size={18} color="green" /> : <CopySimple size={18} />}
                        </button>
                        <Tooltip
                          id={`copy-tooltip-${round.id}`}
                          content={copied[round.id] ? 'HT forum table copied!' : 'Copy for HT forums'}
                          className="tooltip"
                        />
                      </>
                    ) : (
                      <>
                        {isNextRound && tournament?.last_fixtures_refresh && (
                          <span className={styles.lastRefresh}>
                            <span className="hideOnMobile">
                              {isRefreshingFixtures ? 'Checking...' : 'Last checked: '}
                              {!isRefreshingFixtures &&
                                  new Date(tournament.last_fixtures_refresh).toLocaleTimeString('en-GB', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    timeZone: 'Europe/Riga',
                                })}
                            </span>
                          </span>
                        )}
                        <button
                          className={`${styles.refreshBtn} ${isRefreshingFixtures ? styles.spinning : ''}`}
                          onClick={handleRefreshFixtures}
                          disabled={isRefreshingFixtures}
                          data-tooltip-id="refresh-tooltip"
                        >
                          <ArrowClockwise size={18} />
                        </button>
                        <Tooltip
                          id="refresh-tooltip"
                          content="Re-fetches linked Hattrick fixtures and result/event data, updates match statuses and warnings, reclassifies eligible APPG results, recalculates standings, and refreshes this view. It does not change schedule pairings."
                          className="tooltip"
                        />
                        <button className={styles.refreshBtn} onClick={handleCopy} data-tooltip-id="copy-tooltip">
                          {copied[round.id] ? <Check size={18} color="green" /> : <CopySimple size={18} />}
                        </button>
                        <Tooltip
                          id="copy-tooltip"
                          content={copied[round.id] ? 'HT forum table copied!' : 'Copy for HT forums'}
                          className="tooltip"
                        />
                      </>
                    )}
                  </div>
                ) : undefined
              }
            >
              {isExpanded && (
                <div className={styles.matchesGrid}>
                  {round.matches.map((match) => {
                    const matchDate = resolveMatchDate(round, match);

                    const day = matchDate
                      .toLocaleString('en-GB', {
                        weekday: 'short',
                          timeZone: getFixtureDisplayTimeZone(match),
                      })
                      .toUpperCase();
                    const datePart = matchDate.toLocaleDateString('lv-LV', {
                      day: '2-digit',
                      month: '2-digit',
                      timeZone: getFixtureDisplayTimeZone(match),
                    });
                    const timePart = matchDate.toLocaleTimeString('en-GB', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                      timeZone: getFixtureDisplayTimeZone(match),
                    });
                    const formattedDate = `${day} / ${datePart} / ${timePart}`;

                    const homeWarning = warnings.find(
                      (w) => w.team_id === match.home_team_id && w.round_id === round.id,
                    );
                    const awayWarning = warnings.find(
                      (w) => w.team_id === match.away_team_id && w.round_id === round.id,
                    );

                    // Use status from DB, fallback to simple detection
                    const liveMatch =
                      !isHistorical && match.ht_match_id ? liveData[match.ht_match_id.toString()] : null;
                    let status = match.status || 'not_arranged';
                    const isMisarranged = status === 'misarranged' || !!homeWarning || !!awayWarning;
                    const now = new Date(nowMs);
                    const isPastStartTime = match.match_date && now >= match.match_date;
                    const isWithinLiveWindow =
                      match.match_date && now.getTime() < match.match_date.getTime() + 4 * 60 * 60 * 1000;

                    if (isMisarranged) {
                      status = 'misarranged';
                    } else if (match.completed) {
                      status = 'finished';
                    } else if (liveMatch) {
                      status = liveMatch.status;
                    } else if (!isHistorical && status === 'ongoing' && !isWithinLiveWindow) {
                      status = 'arranged';
                    } else if (!isHistorical && isPastStartTime && isWithinLiveWindow && status === 'arranged') {
                      status = 'ongoing';
                    }

                    const currentScore = liveMatch
                      ? { home: liveMatch.homeGoals, away: liveMatch.awayGoals }
                      : match.completed
                        ? { home: match.home_goals || 0, away: match.away_goals || 0 }
                        : !isHistorical && isPastStartTime && isWithinLiveWindow
                          ? { home: 0, away: 0 }
                          : undefined;
                    const isPostponed =
                      !isHistorical && tournament?.status === 'paused' && !match.completed && status !== 'misarranged';
                    const homeSummary = liveMatch
                      ? {
                          yellowCards: liveMatch.home_yellow_cards ?? match.home_yellow_cards ?? 0,
                          redCards: liveMatch.home_red_cards ?? match.home_red_cards ?? 0,
                          injuries: liveMatch.home_injuries ?? match.home_injuries ?? 0,
                          eventDetails: liveMatch.match_event_details?.home ?? match.match_event_details?.home ?? null,
                        }
                      : {
                          yellowCards: match.home_yellow_cards ?? 0,
                          redCards: match.home_red_cards ?? 0,
                          injuries: match.home_injuries ?? 0,
                          eventDetails: match.match_event_details?.home ?? null,
                        };
                    const awaySummary = liveMatch
                      ? {
                          yellowCards: liveMatch.away_yellow_cards ?? match.away_yellow_cards ?? 0,
                          redCards: liveMatch.away_red_cards ?? match.away_red_cards ?? 0,
                          injuries: liveMatch.away_injuries ?? match.away_injuries ?? 0,
                          eventDetails: liveMatch.match_event_details?.away ?? match.match_event_details?.away ?? null,
                        }
                      : {
                          yellowCards: match.away_yellow_cards ?? 0,
                          redCards: match.away_red_cards ?? 0,
                          injuries: match.away_injuries ?? 0,
                          eventDetails: match.match_event_details?.away ?? null,
                        };
                    const penaltyShootout =
                      match.penalty_shootout_home_goals !== null && match.penalty_shootout_away_goals !== null
                        ? {
                            home: match.penalty_shootout_home_goals ?? 0,
                            away: match.penalty_shootout_away_goals ?? 0,
                          }
                        : null;
                      const homeIsBye = !match.home_team || match.home_team.active === false;
                      const awayIsBye = !match.away_team || match.away_team.active === false;
                      const availableChallenge = challengeAvailability[match.id];
                      const fixtureChallengeAction =
                        !isHistorical &&
                        status === 'not_arranged' &&
                        availableChallenge?.available &&
                        !availableChallenge.sent
                          ? {
                              direction: availableChallenge.side === 'away' ? ('left' as const) : ('right' as const),
                              onClick: () => openChallengeConfirmation(match.id),
                            }
                          : undefined;

                    return (
                      <FixtureCard
                        key={match.id}
                        date={status === 'misarranged' ? '' : isPostponed ? 'POSTPONED' : formattedDate}
                        status={status}
                        htMatchId={match.ht_match_id || undefined}
                        score={currentScore}
                        penaltyShootout={penaltyShootout}
                        matchType={match.match_type || undefined}
                        is120minMode={tournament?.scoring_mode === '120min'}
                        went_120={match.went_120}
                        completed={match.completed}
                        totalMinutes={match.total_minutes}
                        appgOutcome={match.appg_outcome}
                        challengeAction={fixtureChallengeAction}
                        homeTeam={{
                          name: homeIsBye ? 'BYE' : match.home_team?.name || 'BYE',
                          managerName: homeIsBye ? '' : match.home_team?.manager_name || 'UNKNOWN',
                          managerHtId: homeIsBye ? undefined : match.home_team?.hattrick_user_id,
                          htTeamId: homeIsBye ? 0 : match.home_team?.ht_team_id || 0,
                          logoUrl: homeIsBye ? undefined : match.home_team?.logo_url,
                          warning: homeIsBye ? undefined : homeWarning?.type,
                          countryName: homeIsBye ? undefined : match.home_team?.country_name,
                          countryId: homeIsBye ? undefined : match.home_team?.country_id,
                          matchSummary: homeSummary,
                          isBye: homeIsBye,
                        }}
                        awayTeam={{
                          name: awayIsBye ? 'BYE' : match.away_team?.name || 'BYE',
                          managerName: awayIsBye ? '' : match.away_team?.manager_name || 'UNKNOWN',
                          managerHtId: awayIsBye ? undefined : match.away_team?.hattrick_user_id,
                          htTeamId: awayIsBye ? 0 : match.away_team?.ht_team_id || 0,
                          logoUrl: awayIsBye ? undefined : match.away_team?.logo_url,
                          warning: awayIsBye ? undefined : awayWarning?.type,
                          countryName: awayIsBye ? undefined : match.away_team?.country_name,
                          countryId: awayIsBye ? undefined : match.away_team?.country_id,
                          matchSummary: awaySummary,
                          isBye: awayIsBye,
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </SectionCard>
          </div>
        );
      })}
      {visibleRoundsCount < filteredRounds.length && (
        <div className={styles.formActionRow}>
          <Button
            variant="action"
            onClick={() =>
              setManualVisibleRoundsCount((prev) => {
                const base = prev ?? defaultVisibleRoundsCount;
                return Math.min(filteredRounds.length, base + 4);
              })
            }
          >
            Show More
          </Button>
        </div>
      )}
      {fixtureChallengePreviewMode && (
        <SectionCard title="Fixture challenge preview">
          <p className={styles.fixtureChallengePreviewNote}>
            Local preview only. It does not read tournament data or contact Hattrick.
          </p>
          <FixtureCard
            date="WED / 30.09. / 05:15"
            status="not_arranged"
            is120minMode
            challengeAction={{
              direction: 'right',
              onClick: () => openChallengeConfirmation(FIXTURE_CHALLENGE_PREVIEW_MATCH_ID),
            }}
            homeTeam={{
              name: 'Preview Home United',
              htTeamId: 900001,
              countryName: 'Latvia',
              countryId: 54,
              managerName: 'Preview manager',
            }}
            awayTeam={{
              name: 'Preview Opponent FC',
              htTeamId: 900002,
              countryName: 'Guam',
              countryId: 117,
              managerName: 'Preview opponent',
            }}
          />
        </SectionCard>
      )}
      {!isHistorical && tournament?.status !== 'finished' && canUpdateFixtures && rounds.length > 0 && (
        <div className={styles.fixturesUpdateAction}>
          <Button variant="action" size="sm" onClick={handleRefreshFixtures} disabled={isRefreshingFixtures}>
            <ArrowClockwise size={18} className={isRefreshingFixtures ? styles.spinning : undefined} />
            {isRefreshingFixtures ? 'Updating fixtures...' : 'Update fixtures'}
          </Button>
        </div>
      )}
      <Modal
        isOpen={Boolean(selectedChallenge)}
        onClose={closeChallengeConfirmation}
        title={challengeSuccess ? '✅ Challenge sent' : '⚽️ Send a challenge'}
        maxWidth="520px"
      >
        <div className={styles.fixtureChallengeModal}>
          {challengeSuccess ? (
            <>
              <p>{challengeSuccess}</p>
              <Button
                variant="outlineWhite"
                fullWidth
                onClick={() => window.open(HATTRICK_CHALLENGES_URL, '_blank', 'noopener,noreferrer')}
              >
                View on Hattrick
              </Button>
            </>
          ) : (
            <>
              <p>
                Send a challenge to <strong>{selectedChallenge?.opponent?.name || 'this team'}</strong>:
              </p>
              <div className={styles.fixtureChallengeOptions}>
                <div>
                  <h3>Type</h3>
                  <div className={styles.fixtureChallengeRadioGroup} role="radiogroup" aria-label="Challenge type">
                    <label
                      className={`${styles.fixtureChallengeRadio} ${
                        selectedChallengeSelection.matchType === 'cup_rules' ? styles.selected : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name="fixture-challenge-type"
                        checked={selectedChallengeSelection.matchType === 'cup_rules'}
                        onChange={() => setChallengeSelection((current) => ({ ...(current || selectedChallengeSelection), matchType: 'cup_rules' }))}
                      />
                      <span className={styles.fixtureChallengeRadioMark} aria-hidden="true" /> Cup rules (120 min)
                    </label>
                    <label
                      className={`${styles.fixtureChallengeRadio} ${
                        selectedChallengeSelection.matchType === 'normal' ? styles.selected : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name="fixture-challenge-type"
                        checked={selectedChallengeSelection.matchType === 'normal'}
                        onChange={() => setChallengeSelection((current) => ({ ...(current || selectedChallengeSelection), matchType: 'normal' }))}
                      />
                      <span className={styles.fixtureChallengeRadioMark} aria-hidden="true" /> Normal rules
                    </label>
                  </div>
                </div>
                <div>
                  <h3>Venue</h3>
                  <div className={styles.fixtureChallengeRadioGroup} role="radiogroup" aria-label="Scheduled venue">
                    <label
                      className={`${styles.fixtureChallengeRadio} ${
                        selectedChallengeSelection.venue === 'home' ? styles.selected : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name="fixture-challenge-venue"
                        checked={selectedChallengeSelection.venue === 'home'}
                        onChange={() => setChallengeSelection((current) => ({ ...(current || selectedChallengeSelection), venue: 'home' }))}
                      />
                      <span className={styles.fixtureChallengeRadioMark} aria-hidden="true" /> Home
                    </label>
                    <label
                      className={`${styles.fixtureChallengeRadio} ${
                        selectedChallengeSelection.venue === 'away' ? styles.selected : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name="fixture-challenge-venue"
                        checked={selectedChallengeSelection.venue === 'away'}
                        onChange={() => setChallengeSelection((current) => ({ ...(current || selectedChallengeSelection), venue: 'away' }))}
                      />
                      <span className={styles.fixtureChallengeRadioMark} aria-hidden="true" /> Away (scheduled)
                    </label>
                  </div>
                </div>
              </div>
              {challengeError && <p className={styles.fixtureChallengeError}>{challengeError}</p>}
              <div className={styles.fixtureChallengeActions}>
                <Button variant="outlineWhite" fullWidth onClick={submitChallenge} disabled={isSendingChallenge}>
                  {isSendingChallenge ? 'Sending…' : 'Send'}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
};
