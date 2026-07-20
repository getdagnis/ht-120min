import React from 'react';
import { SectionCard } from '../../components/Card/SectionCard';
import { Button } from '../../components/Button/Button';
import { FixtureCard } from '../../components/FixtureCard/FixtureCard';
import { ArrowClockwise, ArrowRight, CopySimple, Check } from 'phosphor-react';
import { Tooltip } from 'react-tooltip';
import { calculateMatchDate } from '../../utils/ht-data';
import { getHattrickWeekDetails } from '../../utils/hattrick-calendar';
import type { MatchEventDetails } from '../../../shared/match-events';
import styles from '../../pages/Public/TournamentView.module.sass';

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
  home_team: {
    name: string;
    ht_team_id: number;
    logo_url?: string;
    country_name?: string;
    country_id?: number;
    manager_name?: string;
    hattrick_user_id?: number;
  } | null;
  away_team: {
    name: string;
    ht_team_id: number;
    logo_url?: string;
    country_name?: string;
    country_id?: number;
    manager_name?: string;
    hattrick_user_id?: number;
  } | null;
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
  onViewPreviousSeason?: () => void;
  onViewNextSeason?: () => void;
  emptyStateMessage?: string;
}

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
  onViewPreviousSeason,
  onViewNextSeason,
  emptyStateMessage,
}) => {
  const [manualVisibleRoundsCount, setManualVisibleRoundsCount] = React.useState<number | null>(null);
  const currentRound = !isHistorical && upcomingRoundIndex >= 0 ? (rounds[upcomingRoundIndex] ?? null) : null;
  const currentRoundScrollTargetRef = React.useRef<HTMLDivElement | null>(null);
  const hasAutoScrolledToCurrentRoundRef = React.useRef(false);
  const visibleRoundsCount = manualVisibleRoundsCount ?? defaultVisibleRoundsCount;
  const lastFinishedRoundNumber = React.useMemo(() => {
    let latestFinishedRoundNumber: number | null = null;

    for (const round of rounds) {
      const isFinished = round.matches.every((match) => match.completed || match.status === 'misarranged');
      if (isFinished) latestFinishedRoundNumber = round.round_number;
    }

    return latestFinishedRoundNumber;
  }, [rounds]);

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
      match.match_date ??
      (match.scheduled_for
        ? new Date(match.scheduled_for)
        : calculateMatchDate(round.created_at, round.round_number, match.home_team?.country_name)),
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
          <div className={styles.emptyFixtures}>
            <p>
              {emptyStateMessage ||
                'Fixtures have not yet been generated. Tournament is open for registration. You can join with another team.'}
            </p>
            {canJoinAnotherTeam && (
              <Button variant="primary" size="sm" onClick={onJoinWithHattrick} disabled={isConnecting}>
                <ArrowRight size={18} weight="bold" /> Join with Hattrick
              </Button>
            )}
          </div>
        </SectionCard>
      )}

      {rounds.slice(0, visibleRoundsCount).map((round) => {
        const isNextRound = round.id === rounds[upcomingRoundIndex]?.id;

        const isExpanded =
          expandedRounds[round.id] ??
          (lastFinishedRoundNumber === null ? true : round.round_number >= lastFinishedRoundNumber);

        const allFinished = round.matches.every((m) => m.completed || m.status === 'misarranged');

        const nextRound = rounds[rounds.findIndex((r) => r.id === round.id) + 1];

        const roundDate = round.matches[0] ? resolveMatchDate(round, round.matches[0]) : null;
        const roundWeek = roundDate ? getHattrickWeekDetails(roundDate) : null;

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
              })}`
            : m.completed
              ? `${m.home_goals} : ${m.away_goals}${hasPenaltyShootout ? ` (${m.penalty_shootout_home_goals}:${m.penalty_shootout_away_goals})` : ''}${m.went_120 ? " 🎯 120'!" : ''}`
              : m.status === 'misarranged'
                ? 'DNP'
                : `${matchDate.toLocaleDateString('lv-LV', {
                    day: '2-digit',
                    month: '2-digit',
                  })}.`;

          return `[tr][td]${m.home_team?.name}[/td][td][b]${value}[/b][/td][td]${m.away_team?.name}[/td][/tr]`;
        };

        const handleCopy = () => {
          let table = `[b]${tournament?.name}[/b]\n[link=http://ht-120min.vercel.app/t/${tournament?.slug}]\n\n[b]ROUND ${round.round_number}, ${allFinished ? 'final results:[/b]' : 'Fixtures:[/b]'}\n[table]${round.matches
            .map((m) => formatMatch(m, !m.completed && m.status !== 'misarranged'))
            .join(' ')}[/table]`;

          table += `\n[b]Next: ROUND ${nextRound.round_number}, fixtures:[/b]\n[table]${nextRound.matches.map((m) => formatMatch(m, true)).join(' ')}[/table]`;
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
                        HT Week {roundWeek.htWeek} •{' '}
                        {roundDate.toLocaleDateString('lv-LV', {
                          timeZone: 'Europe/Stockholm',
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
                    {allFinished ? (
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
                        <Tooltip id="refresh-tooltip" content="Refresh fixtures" className="tooltip" />
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

                    const day = matchDate.toLocaleString('en-GB', { weekday: 'short' }).toUpperCase();
                    const datePart = matchDate.toLocaleDateString('lv-LV', {
                      day: '2-digit',
                      month: '2-digit',
                    });
                    const timePart = matchDate.toLocaleTimeString('en-GB', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
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
                    const now = new Date();
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
                        homeTeam={{
                          name: match.home_team?.name || 'BYE',
                          managerName: match.home_team?.manager_name || 'UNKNOWN',
                          managerHtId: match.home_team?.hattrick_user_id,
                          htTeamId: match.home_team?.ht_team_id || 0,
                          logoUrl: match.home_team?.logo_url,
                          warning: homeWarning?.type,
                          countryName: match.home_team?.country_name,
                          countryId: match.home_team?.country_id,
                          matchSummary: homeSummary,
                        }}
                        awayTeam={{
                          name: match.away_team?.name || 'BYE',
                          managerName: match.away_team?.manager_name || 'UNKNOWN',
                          managerHtId: match.away_team?.hattrick_user_id,
                          htTeamId: match.away_team?.ht_team_id || 0,
                          logoUrl: match.away_team?.logo_url,
                          warning: awayWarning?.type,
                          countryName: match.away_team?.country_name,
                          countryId: match.away_team?.country_id,
                          matchSummary: awaySummary,
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
      {visibleRoundsCount < rounds.length && (
        <div className={styles.formActionRow}>
          <Button
            variant="action"
            onClick={() =>
              setManualVisibleRoundsCount((prev) => {
                const base = prev ?? defaultVisibleRoundsCount;
                return Math.min(rounds.length, base + 4);
              })
            }
          >
            Show More
          </Button>
        </div>
      )}
      {!isHistorical && canUpdateFixtures && rounds.length > 0 && (
        <div className={styles.fixturesUpdateAction}>
          <Button variant="secondary" size="sm" onClick={handleRefreshFixtures} disabled={isRefreshingFixtures}>
            <ArrowClockwise size={18} className={isRefreshingFixtures ? styles.spinning : undefined} />
            {isRefreshingFixtures ? 'Updating fixtures...' : 'Update fixtures'}
          </Button>
        </div>
      )}
    </div>
  );
};
