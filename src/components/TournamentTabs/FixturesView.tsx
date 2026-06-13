import React from 'react';
import { SectionCard } from '../../components/Card/SectionCard';
import { FixtureCard } from '../../components/FixtureCard/FixtureCard';
import { ArrowClockwise, CopySimple, CaretDown, CaretUp, Check } from 'phosphor-react';
import { Tooltip } from 'react-tooltip';
import { calculateMatchDate } from '../../utils/ht-data';
import styles from '../../pages/Public/TournamentView.module.sass';

interface FixtureMatch {
  id: string;
  round_id: string;
  home_team_id: string;
  away_team_id: string;
  home_goals: number | null;
  away_goals: number | null;
  completed: boolean;
  status: 'not_arranged' | 'arranged' | 'ongoing' | 'misarranged' | 'finished';
  ht_match_id: number | null;
  match_type: number | null;
  match_date?: Date;
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
    matches: FixtureMatch[];
  }[];
  visibleRoundsCount: number;
  setVisibleRoundsCount: React.Dispatch<React.SetStateAction<number>>;
  upcomingRoundIndex: number;
  expandedRounds: Record<string, boolean>;
  toggleRound: (roundId: string) => void;
  tournament: {
    id: string;
    scoring_mode?: string;
    name: string;
    slug: string;
    created_at: string;
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
  liveData: Record<string, { status: 'arranged' | 'ongoing' | 'finished'; homeGoals: number; awayGoals: number }>;
}

export const FixturesView: React.FC<FixturesViewProps> = ({
  rounds,
  visibleRoundsCount,
  setVisibleRoundsCount,
  upcomingRoundIndex,
  expandedRounds,
  toggleRound,
  tournament,
  isRefreshingFixtures,
  handleRefreshFixtures,
  copied,
  setCopied,
  warnings,
  liveData,
}) => {
  return (
    <div className={styles.rounds}>
      {rounds.slice(0, visibleRoundsCount).map((round) => {
        const isNextRound = round.id === rounds[upcomingRoundIndex]?.id;
        const isOneAfter = upcomingRoundIndex < rounds.length - 1 && round.id === rounds[upcomingRoundIndex + 1].id;

        const isExpanded = expandedRounds[round.id] ?? (isNextRound || isOneAfter);

        const allFinished = round.matches.every((m) => m.completed || m.status === 'misarranged');

        const nextRound = rounds[rounds.findIndex((r) => r.id === round.id) + 1];

        const roundDate = round.matches[0]
          ? calculateMatchDate(
              tournament?.created_at || '',
              round.round_number,
              round.matches[0].home_team?.country_name,
            )
          : null;

        const formatMatch = (m: FixtureMatch, isNext: boolean, roundNum: number) =>
          `[tr][td]${m.home_team?.name}[/td][td][b]${
            isNext
              ? calculateMatchDate(
                  tournament?.created_at || '',
                  roundNum,
                  m.home_team?.country_name,
                ).toLocaleDateString('lv-LV', {
                  day: '2-digit',
                  month: '2-digit',
                })
              : m.completed
                ? `${m.home_goals} : ${m.away_goals}`
                : m.status === 'misarranged'
                  ? 'DNP'
                  : '..:..'
          }[/b][/td][td]${m.away_team?.name}[/td][/tr]`;

        const handleCopy = () => {
          let table = `[b]${tournament?.name}[/b]\n[link=http://ht120-min.vercel.app/t/${tournament?.slug}]\n\n[b]ROUND ${round.round_number}, ${allFinished ? 'final results:[/b]' : 'Fixtures:[/b]'}\n[table]${round.matches.map((m) => formatMatch(m, false, round.round_number)).join(' ')}[/table]`;
          if (isNextRound && nextRound) {
            table += `\n[b]Next: ROUND ${nextRound.round_number}, fixtures:[/b]\n[table]${nextRound.matches.map((m) => formatMatch(m, true, nextRound.round_number)).join(' ')}[/table]`;
          }
          table += `\nFull fixtures: [link=http://ht120-min.vercel.app/t/${tournament?.slug}?tab=fixtures]`;
          navigator.clipboard.writeText(table);
          setCopied((prev) => ({ ...prev, [round.id]: true }));
          setTimeout(() => setCopied((prev) => ({ ...prev, [round.id]: false })), 2000);
        };

        return (
          <SectionCard
            key={round.id}
            className={isNextRound ? styles.upcomingRound : ''}
            collapsible
            isCollapsed={!isExpanded}
            onToggleCollapse={() => toggleRound(round.id)}
            title={
              <div className={styles.roundHeader}>
                <>
                  <span>Round {round.round_number}</span>
                  {roundDate && (
                    <span className={styles.roundDate}>
                      {roundDate.toLocaleDateString('lv-LV', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </span>
                  )}
                </>
              </div>
            }
            headerRight={
              allFinished || isNextRound ? (
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
                        <span className="hideOnMobile">
                          <span className={styles.lastRefresh}>
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
                      <Tooltip id="refresh-tooltip" content="Refresh fixtures" />
                      <button className={styles.refreshBtn} onClick={handleCopy} data-tooltip-id="copy-tooltip">
                        {copied[round.id] ? <Check size={18} color="green" /> : <CopySimple size={18} />}
                      </button>
                      <Tooltip
                        id="copy-tooltip"
                        content={copied[round.id] ? 'HT forum table copied!' : 'Copy for HT forums'}
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
                  const matchDate = calculateMatchDate(
                    tournament?.created_at || '',
                    round.round_number,
                    match.home_team?.country_name,
                  );

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

                  const homeWarning = warnings.find((w) => w.team_id === match.home_team_id && w.round_id === round.id);
                  const awayWarning = warnings.find((w) => w.team_id === match.away_team_id && w.round_id === round.id);

                  // Use status from DB, fallback to simple detection
                  const liveMatch = match.ht_match_id ? liveData[match.ht_match_id.toString()] : null;
                  let status = match.status || 'not_arranged';
                  const now = new Date();
                  const isPastStartTime = match.match_date && now >= match.match_date;
                  const isWithinLiveWindow =
                    match.match_date && now.getTime() < match.match_date.getTime() + 4 * 60 * 60 * 1000;

                  if (match.completed) {
                    status = 'finished';
                  } else if (liveMatch) {
                    status = liveMatch.status;
                  } else if (isPastStartTime && isWithinLiveWindow && status === 'arranged') {
                    status = 'ongoing';
                  } else if (homeWarning || awayWarning) {
                    status = 'misarranged';
                  }

                  const currentScore = liveMatch
                    ? { home: liveMatch.homeGoals, away: liveMatch.awayGoals }
                    : match.completed
                      ? { home: match.home_goals || 0, away: match.away_goals || 0 }
                      : isPastStartTime && isWithinLiveWindow
                        ? { home: 0, away: 0 }
                        : undefined;

                  return (
                    <FixtureCard
                      key={match.id}
                      date={status === 'misarranged' ? '' : formattedDate}
                      status={status}
                      htMatchId={match.ht_match_id || undefined}
                      score={currentScore}
                      matchType={match.match_type || undefined}
                      is120minMode={tournament?.scoring_mode === '120min'}
                      homeTeam={{
                        name: match.home_team?.name || 'BYE',
                        managerName: match.home_team?.manager_name || 'UNKNOWN',
                        managerHtId: match.home_team?.hattrick_user_id,
                        htTeamId: match.home_team?.ht_team_id || 0,
                        logoUrl: match.home_team?.logo_url,
                        warning: homeWarning?.type,
                        countryName: match.home_team?.country_name,
                        countryId: match.home_team?.country_id,
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
                      }}
                    />
                  );
                })}
              </div>
            )}
          </SectionCard>
        );
      })}
      {visibleRoundsCount < rounds.length && (
        <div className={styles.formActionRow}>
          <button onClick={() => setVisibleRoundsCount((prev: number) => prev + 4)} className={styles.refreshBtn}>
            Show More
          </button>
        </div>
      )}
    </div>
  );
};
