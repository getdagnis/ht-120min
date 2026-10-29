import { useTranslations } from 'next-intl';
import React, { useEffect, useMemo, useState } from 'react';
import { getCountryWorldDetails } from '../../../shared/worlddetails';
import type {
  TournamentActivityStory,
  TournamentJoinStory,
  TournamentMatchArrangeStorySnapshot,
  TournamentReserveStorySnapshot,
} from '../../types/tournament-activity';
import { getCanonicalCountryName } from '../../utils/ht-data';
import { isCurrentParticipantTeam } from '../../utils/team-state';
import { isSuppressedJoinStory } from '../../utils/tournament-activity';
import { useClientNow } from '../../hooks/useHydratedBrowserState';
import { supabase } from '../../lib/supabase';
import { Button } from '../Button/Button';
import styles from './TournamentActivity.module.sass';

export interface TournamentActivityTeam {
  id: string;
  name: string;
  created_at: string;
  active: boolean;
  reserve_active?: boolean | null;
  is_placeholder?: boolean;
  manager_name?: string | null;
  hattrick_user_id?: number | null;
  ht_team_id?: number | null;
  country_name?: string | null;
  country_id?: number | null;
  join_story?: TournamentJoinStory | null;
}

export interface TournamentActivityMatch {
  id: string;
  round_id: string;
  round_number: number;
  status: 'not_arranged' | 'arranged' | 'ongoing' | 'misarranged' | 'finished';
  completed?: boolean;
  scheduled_for?: string | null;
  finished_at?: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_team: { name: string; ht_team_id: number } | null;
  away_team: { name: string; ht_team_id: number } | null;
  next_match_arrange_story?: TournamentMatchArrangeStorySnapshot | null;
  reserve_story?: TournamentReserveStorySnapshot | null;
}

export interface TournamentActivityWarning {
  id: string;
  round_id: string;
  team_id: string;
  created_at: string;
}

interface TournamentActivityProps {
  teams: TournamentActivityTeam[];
  matches?: TournamentActivityMatch[];
  warnings?: TournamentActivityWarning[];
  tournamentId?: string | null;
  seasonId?: string | null;
  seasonNumber?: number;
  seasonStartedAt?: string | null;
  fixturesHref?: string;
  newsHref?: string;
  canPublishAnnouncements?: boolean;
}

interface TournamentActivityEntry {
  type:
    | 'join'
    | 'reserve-arranged'
    | 'season-start'
    | 'round-start'
    | 'round-finish'
    | 'round-report';
  id: string;
  createdAt: number;
  story: React.ReactNode;
}

interface RoundReportActivity {
  id: string;
  season_number: number | null;
  round_number: number;
  created_at: string;
}

const ACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const INITIAL_ACTIVITY_ENTRIES = 5;

function formatActivityDay(createdAt: number) {
  return new Date(createdAt).toLocaleDateString('lv-LV', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatActivityTime(createdAt: number) {
  return new Date(createdAt).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function activityDayKey(createdAt: number) {
  const date = new Date(createdAt);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function JoinActivityStory({ team }: { team: TournamentActivityTeam }) {
  const uiText = useTranslations('PublicUI.TournamentActivity');
  const managerName = team.manager_name?.trim();
  const countryName = getCanonicalCountryName(team.country_name, team.country_id);
  const countryDetails = getCountryWorldDetails(team.country_id);
  const countryLabel = countryName ? (
    <>
      {team.country_id ? (
        <a
          href={`https://www.hattrick.org/goto.ashx?path=/World/Leagues/League.aspx?LeagueID=${team.country_id}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {countryName}
        </a>
      ) : (
        countryName
      )}{' '}
      {countryDetails?.emoji}
    </>
  ) : null;
  const managerLabel =
    managerName && team.hattrick_user_id ? (
      <a
        href={`https://www.hattrick.org/goto.ashx?path=/Club/Manager/?userId=${team.hattrick_user_id}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        {managerName}
      </a>
    ) : (
      managerName
    );
  const teamLabel = team.ht_team_id ? (
    <a
      href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${team.ht_team_id}`}
      target="_blank"
      rel="noopener noreferrer"
    >
      {team.name}
    </a>
  ) : (
    team.name
  );

  if (managerLabel && countryLabel) {
    return uiText.rich('joinWithManagerAndCountry', {
      manager: () => managerLabel,
      team: () => teamLabel,
      country: () => countryLabel,
    });
  }
  if (managerLabel) {
    return uiText.rich('joinWithManager', {
      manager: () => managerLabel,
      team: () => teamLabel,
    });
  }
  if (countryLabel) {
    return uiText.rich('joinWithCountry', {
      team: () => teamLabel,
      country: () => countryLabel,
    });
  }
  return uiText.rich('joinWithoutCountry', { team: () => teamLabel });
}

function isTournamentStory(value: unknown): value is TournamentActivityStory {
  return (
    Array.isArray(value) &&
    value.every(
      (part) =>
        part &&
        typeof part === 'object' &&
        typeof (part as { text?: unknown }).text === 'string' &&
        ((part as { href?: unknown }).href === undefined || typeof (part as { href?: unknown }).href === 'string'),
    )
  );
}

function renderStory(story: TournamentActivityStory): React.ReactNode {
  return story.map((part, index) =>
    part.href ? (
      <a
        key={`${part.text}-${index}`}
        href={part.href}
        target={part.href.startsWith('/') ? undefined : '_blank'}
        rel={part.href.startsWith('/') ? undefined : 'noopener noreferrer'}
      >
        {part.text}
      </a>
    ) : (
      <React.Fragment key={`${part.text}-${index}`}>{part.text}</React.Fragment>
    ),
  );
}

function renderActionLink(label: string, href?: string) {
  return href ? <a href={href}>{label}</a> : label;
}

function isPlayableMatch(match: TournamentActivityMatch) {
  return Boolean(match.home_team_id && match.away_team_id);
}

function isTerminalMatch(match: TournamentActivityMatch) {
  return Boolean(match.completed || match.status === 'finished' || match.status === 'misarranged');
}

function renderJoinStory(team: TournamentActivityTeam): React.ReactNode {
  if (!isTournamentStory(team.join_story)) return <JoinActivityStory team={team} />;

  return renderStory(team.join_story);
}

function isArrangeStorySnapshot(value: unknown): value is TournamentMatchArrangeStorySnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as { eventAt?: unknown; story?: unknown };
  return (snapshot.eventAt === null || typeof snapshot.eventAt === 'string') && isTournamentStory(snapshot.story);
}

function isReserveStorySnapshot(value: unknown): value is TournamentReserveStorySnapshot {
  return isArrangeStorySnapshot(value);
}

export const TournamentActivity: React.FC<TournamentActivityProps> = ({
  teams,
  matches = [],
  tournamentId = null,
  seasonId = null,
  seasonNumber = 1,
  seasonStartedAt = null,
  fixturesHref,
  newsHref,
  canPublishAnnouncements = false,
}) => {
  const uiText = useTranslations('PublicUI.TournamentActivity');
  const now = useClientNow(60_000);
  const [roundReports, setRoundReports] = useState<RoundReportActivity[]>([]);
  const [roundReportsLoaded, setRoundReportsLoaded] = useState(!tournamentId);
  const [showAllEntries, setShowAllEntries] = useState(false);

  useEffect(() => {
    if (!tournamentId) return;
    let cancelled = false;
    const loadReports = async () => {
      const { data } = await supabase
        .from('news_posts')
        .select('id, season_number, round_number, created_at')
        .eq('tournament_id', tournamentId)
        .eq('is_round_report', true)
        .order('created_at', { ascending: false });
      if (!cancelled) {
        setRoundReports((data || []) as RoundReportActivity[]);
        setRoundReportsLoaded(true);
      }
    };
    void loadReports();

    const channel = supabase
      .channel(`tournament-activity-reports:${tournamentId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'news_posts', filter: `tournament_id=eq.${tournamentId}` },
        (payload) => {
          const post = payload.new as RoundReportActivity & { is_round_report?: boolean };
          if (!post.is_round_report) return;
          setRoundReports((current) => [post, ...current.filter((item) => item.id !== post.id)]);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [tournamentId]);

  const entries = useMemo<TournamentActivityEntry[]>(() => {
    if (!now) return [];

    const cutoff = now - ACTIVITY_WINDOW_MS;
    const joinEntries = teams
      .filter((team) => isCurrentParticipantTeam(team) && !isSuppressedJoinStory(team.join_story))
      .map((team) => ({ team, createdAt: Date.parse(team.created_at) }))
      .filter(({ createdAt }) => Number.isFinite(createdAt) && createdAt >= cutoff && createdAt <= now)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ team, createdAt }) => ({
        type: 'join',
        id: team.id,
        createdAt,
        story: renderJoinStory(team),
      }));
    const reserveEntries = matches.flatMap((match) => {
      if (!isReserveStorySnapshot(match.reserve_story)) return [];
      const createdAt = match.reserve_story.eventAt ? Date.parse(match.reserve_story.eventAt) : NaN;
      if (!Number.isFinite(createdAt) || createdAt < cutoff || createdAt > now) return [];
      return [
        { type: 'reserve-arranged' as const, id: match.id, createdAt, story: renderStory(match.reserve_story.story) },
      ];
    });

    const roundGroups = new Map<string, { roundNumber: number; matches: TournamentActivityMatch[] }>();
    matches.forEach((match) => {
      const group = roundGroups.get(match.round_id) || { roundNumber: match.round_number, matches: [] };
      group.matches.push(match);
      roundGroups.set(match.round_id, group);
    });

    const roundEntries = Array.from(roundGroups.entries()).flatMap(([roundId, round]) => {
      const roundNumber = round.roundNumber;
      const roundMatches = round.matches;
      const playableMatches = roundMatches.filter(isPlayableMatch);
      if (playableMatches.length === 0) return [];

      const scheduledTimes = playableMatches
        .map((match) => (match.scheduled_for ? Date.parse(match.scheduled_for) : NaN))
        .filter((value) => Number.isFinite(value));
      const earliestScheduledAt = scheduledTimes.length > 0 ? Math.min(...scheduledTimes) : NaN;
      const roundStarted = Number.isFinite(earliestScheduledAt) && earliestScheduledAt <= now;

      const playedMatches = playableMatches.filter(
        (match) => (match.completed || match.status === 'finished') && match.status !== 'misarranged',
      );
      const roundFinished = playableMatches.every(isTerminalMatch) && playedMatches.length > 0;
      const finishTimes = playedMatches
        .map((match) => {
          const finishedAt = match.finished_at ? Date.parse(match.finished_at) : NaN;
          if (Number.isFinite(finishedAt)) return finishedAt;
          return match.scheduled_for ? Date.parse(match.scheduled_for) : NaN;
        })
        .filter((value) => Number.isFinite(value));
      const finishedAt = finishTimes.length > 0 ? Math.max(...finishTimes) : NaN;
      const reportExists = roundReports.some(
        (report) => report.season_number === seasonNumber && report.round_number === roundNumber,
      );
      const next: TournamentActivityEntry[] = [];

      if (roundStarted && earliestScheduledAt >= cutoff && earliestScheduledAt <= now) {
        next.push({
          type: 'round-start',
          id: `round-start:${roundId}`,
          createdAt: earliestScheduledAt,
          story: (
            <>
              ⚽️ <strong>{uiText('round')} {roundNumber} {uiText('matchesAreNowBeingPlayed')}</strong> {uiText('followThemLiveFrom')}{' '}
              {renderActionLink('the Fixtures page', fixturesHref)}.
            </>
          ),
        });
      }
      if (roundFinished && Number.isFinite(finishedAt) && finishedAt >= cutoff && finishedAt <= now) {
        next.push({
          type: 'round-finish',
          id: `round-finish:${roundId}`,
          createdAt: finishedAt,
          story: (
            <>
              🏁 <strong>{uiText('round')} {roundNumber} {uiText('matchesAreNowFinished')}</strong> {uiText('checkTheResultsOn')}{' '}
              {renderActionLink('the Fixtures page', fixturesHref)}.
              {canPublishAnnouncements && roundReportsLoaded && !reportExists && newsHref && (
                <>
                  <br />
                  <a href={newsHref}>{uiText('youCanNowPublishARound')} {roundNumber} {uiText('pressReport')}</a>
                </>
              )}
            </>
          ),
        });
      }
      return next;
    });

    const seasonStartAt = seasonStartedAt ? Date.parse(seasonStartedAt) : NaN;
    const seasonEntries: TournamentActivityEntry[] =
      Number.isFinite(seasonStartAt) && seasonStartAt >= cutoff && seasonStartAt <= now
        ? [
            {
              type: 'season-start',
              id: `season-start:${seasonId || seasonNumber}`,
              createdAt: seasonStartAt,
              story: (
                <>
                  {uiText('season')} {seasonNumber} {uiText('hasStartedThe')} <strong>{uiText('tournamentScheduleHasBeenPublished')}</strong> {uiText('andTheFirstFixturesAreReadyCheckThemOn')} {renderActionLink('the Fixtures page', fixturesHref)}.
                </>
              ),
            },
          ]
        : [];

    const reportEntries = roundReports.flatMap((report) => {
      const createdAt = Date.parse(report.created_at);
      if (report.season_number !== seasonNumber || !Number.isFinite(createdAt) || createdAt < cutoff || createdAt > now)
        return [];
      return [
        {
          type: 'round-report' as const,
          id: `round-report:${report.id}`,
          createdAt,
          story: (
            <>
              📰 <strong>{uiText('round')} {report.round_number} {uiText('pressReportHasBeenPublished')}</strong>
              {newsHref ? (
                <>
                  {uiText('readItBelowOrOn')} <a href={newsHref}>{uiText('theNewsPage')}</a>.
                </>
              ) : (
                '!'
              )}
            </>
          ),
        },
      ];
    });

    return [
      ...joinEntries,
      ...reserveEntries,
      ...seasonEntries,
      ...roundEntries,
      ...reportEntries,
    ]
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [
    canPublishAnnouncements,
    fixturesHref,
    matches,
    newsHref,
    now,
    roundReports,
    roundReportsLoaded,
    seasonId,
    seasonNumber,
    seasonStartedAt,
    teams,
    uiText,
  ]);

  if (entries.length === 0) return null;

  const visibleEntries = showAllEntries ? entries : entries.slice(0, INITIAL_ACTIVITY_ENTRIES);

  const groupedEntries = visibleEntries.reduce<Array<{ key: string; date: number; entries: TournamentActivityEntry[] }>>(
    (groups, entry) => {
      const key = activityDayKey(entry.createdAt);
      const existingGroup = groups[groups.length - 1];
      if (existingGroup?.key === key) {
        existingGroup.entries.push(entry);
      } else {
        groups.push({ key, date: entry.createdAt, entries: [entry] });
      }
      return groups;
    },
    [],
  );

  return (
    <section className={styles.activity} aria-labelledby="tournament-activity-title">
      <h2 id="tournament-activity-title">{uiText('tournamentActivity')}</h2>
      <ul className={styles.entries}>
        {groupedEntries.map((group) => (
          <React.Fragment key={group.key}>
            {group.entries.length > 1 ? (
              <li className={styles.dateGroup}>
                <time className={styles.date} dateTime={new Date(group.date).toISOString()}>
                  {formatActivityDay(group.date)}
                </time>
              </li>
            ) : null}
            {group.entries.map((entry) => (
              <li
                key={`${entry.type}-${entry.id}`}
                className={`${styles.entry}${group.entries.length > 1 ? ` ${styles.inline}` : ''}`}
              >
                {group.entries.length === 1 ? (
                  <time className={styles.time} dateTime={new Date(entry.createdAt).toISOString()}>
                    {formatActivityDay(entry.createdAt)}
                    <span aria-hidden="true">, </span>
                    {formatActivityTime(entry.createdAt)}
                  </time>
                ) : (
                  <time className={styles.time} dateTime={new Date(entry.createdAt).toISOString()}>
                    {formatActivityTime(entry.createdAt)}
                  </time>
                )}
                <p>{entry.story}</p>
              </li>
            ))}
          </React.Fragment>
        ))}
      </ul>
      {entries.length > INITIAL_ACTIVITY_ENTRIES && (
        <Button
          type="button"
          variant="showMore"
          onClick={() => setShowAllEntries((current) => !current)}
          aria-expanded={showAllEntries}
        >
          {showAllEntries ? uiText('showLess') : uiText('showMore')}
        </Button>
      )}
    </section>
  );
};
