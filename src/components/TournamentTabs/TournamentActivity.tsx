import React, { useEffect, useMemo, useState } from 'react';
import { getCountryWorldDetails } from '../../../shared/worlddetails';
import type {
  TournamentActivityStory,
  TournamentJoinStory,
  TournamentMatchArrangeStorySnapshot,
} from '../../types/tournament-activity';
import { getCanonicalCountryName } from '../../utils/ht-data';
import { useClientNow } from '../../hooks/useHydratedBrowserState';
import { buildMisarrangedFixtureStory, type FixtureStoryTeam } from '../../utils/fixture-story';
import { supabase } from '../../lib/supabase';
import styles from './TournamentActivity.module.sass';

export interface TournamentActivityTeam {
  id: string;
  name: string;
  created_at: string;
  active: boolean;
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
  type: 'join' | 'arranged' | 'misarranged' | 'season-start' | 'round-start' | 'round-finish' | 'round-report';
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
const MAX_ACTIVITY_ENTRIES = 7;

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

function buildJoinStory(team: TournamentActivityTeam): React.ReactNode {
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
  const managerLabel = managerName && team.hattrick_user_id ? (
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

  if (managerLabel) {
    return (
      <>
        {managerLabel} joined the tournament with {teamLabel}.
        {countryLabel && <> The team is based in {countryLabel}.</>}
      </>
    );
  }

  return (
    <>
      {teamLabel} joined the tournament.
      {countryLabel && <> The team is based in {countryLabel}.</>}
    </>
  );
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
  if (!isTournamentStory(team.join_story)) return buildJoinStory(team);

  return renderStory(team.join_story);
}

function isArrangeStorySnapshot(value: unknown): value is TournamentMatchArrangeStorySnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as { eventAt?: unknown; story?: unknown };
  return (
    (snapshot.eventAt === null || typeof snapshot.eventAt === 'string') &&
    isTournamentStory(snapshot.story)
  );
}

function toFixtureStoryTeam(team: { name: string; ht_team_id: number } | null): FixtureStoryTeam | null {
  if (!team) return null;
  return { name: team.name, htTeamId: team.ht_team_id };
}

function buildMisarrangedStory(
  match: TournamentActivityMatch,
  warnings: TournamentActivityWarning[],
): { story: TournamentActivityStory; createdAt: number } | null {
  const matchWarnings = warnings.filter(
    (warning) =>
      warning.round_id === match.round_id &&
      (warning.team_id === match.home_team_id || warning.team_id === match.away_team_id),
  );
  if (match.status !== 'misarranged' || matchWarnings.length === 0) return null;

  const homeTeam = toFixtureStoryTeam(match.home_team);
  const awayTeam = toFixtureStoryTeam(match.away_team);
  if (!homeTeam || !awayTeam) return null;

  const offendingIds = new Set(
    matchWarnings
      .map((warning) => warning.team_id)
      .filter((teamId) => teamId === match.home_team_id || teamId === match.away_team_id),
  );
  const offendingTeams = [
    offendingIds.has(match.home_team_id || '') ? homeTeam : null,
    offendingIds.has(match.away_team_id || '') ? awayTeam : null,
  ].filter((team): team is FixtureStoryTeam => Boolean(team));
  if (offendingTeams.length === 0) return null;

  const opponentTeams = [
    match.home_team_id && !offendingIds.has(match.home_team_id) ? homeTeam : null,
    match.away_team_id && !offendingIds.has(match.away_team_id) ? awayTeam : null,
  ].filter((team): team is FixtureStoryTeam => Boolean(team));
  const createdAt = Math.max(...matchWarnings.map((warning) => Date.parse(warning.created_at)));
  if (!Number.isFinite(createdAt)) return null;

  return {
    story: buildMisarrangedFixtureStory({
      roundNumber: match.round_number,
      offendingTeams,
      opponentTeams,
    }),
    createdAt,
  };
}

export const TournamentActivity: React.FC<TournamentActivityProps> = ({
  teams,
  matches = [],
  warnings = [],
  tournamentId = null,
  seasonId = null,
  seasonNumber = 1,
  seasonStartedAt = null,
  fixturesHref,
  newsHref,
  canPublishAnnouncements = false,
}) => {
  const now = useClientNow(60_000);
  const [roundReports, setRoundReports] = useState<RoundReportActivity[]>([]);
  const [roundReportsLoaded, setRoundReportsLoaded] = useState(!tournamentId);

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
      .filter((team) => team.active && !team.is_placeholder)
      .map((team) => ({ team, createdAt: Date.parse(team.created_at) }))
      .filter(({ createdAt }) => Number.isFinite(createdAt) && createdAt >= cutoff && createdAt <= now)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_ACTIVITY_ENTRIES)
      .map(({ team, createdAt }) => ({
        type: 'join',
        id: team.id,
        createdAt,
        story: renderJoinStory(team),
      }));
    const arrangedEntries = matches.flatMap((match) => {
      if (!isArrangeStorySnapshot(match.next_match_arrange_story)) return [];
      const createdAt = match.next_match_arrange_story.eventAt ? Date.parse(match.next_match_arrange_story.eventAt) : NaN;
      if (!Number.isFinite(createdAt) || createdAt < cutoff || createdAt > now) return [];
      return [{
        type: 'arranged' as const,
        id: match.id,
        createdAt,
        story: renderStory(match.next_match_arrange_story.story),
      }];
    });
    const misarrangedEntries = matches.flatMap((match) => {
      const built = buildMisarrangedStory(match, warnings);
      if (!built || built.createdAt < cutoff || built.createdAt > now) return [];
      return [{ type: 'misarranged' as const, id: match.id, createdAt: built.createdAt, story: renderStory(built.story) }];
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
            <>Round {roundNumber} matches are now being played! Follow them live from {renderActionLink('the Fixtures page', fixturesHref)}.</>
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
              Round {roundNumber} matches are now finished! Check the results on {renderActionLink('the Fixtures page', fixturesHref)}.
              {canPublishAnnouncements && roundReportsLoaded && !reportExists && newsHref && (
                <>
                  <br />
                  <a href={newsHref}>You can now publish a Round {roundNumber} press report.</a>
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
                <>Season {seasonNumber} has started! The tournament schedule has been published and the first fixtures are ready. Check them on {renderActionLink('the Fixtures page', fixturesHref)}.</>
              ),
            },
          ]
        : [];

    const reportEntries = roundReports.flatMap((report) => {
      const createdAt = Date.parse(report.created_at);
      if (report.season_number !== seasonNumber || !Number.isFinite(createdAt) || createdAt < cutoff || createdAt > now) return [];
      return [
        {
          type: 'round-report' as const,
          id: `round-report:${report.id}`,
          createdAt,
          story: (
            <>Round {report.round_number} full press report has been published{newsHref ? <>! Read it on <a href={newsHref}>the News page</a>.</> : '!'}</>
          ),
        },
      ];
    });

    return [...joinEntries, ...arrangedEntries, ...misarrangedEntries, ...seasonEntries, ...roundEntries, ...reportEntries]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_ACTIVITY_ENTRIES);
  }, [canPublishAnnouncements, fixturesHref, matches, newsHref, now, roundReports, roundReportsLoaded, seasonId, seasonNumber, seasonStartedAt, teams, warnings]);

  if (entries.length === 0) return null;

  const groupedEntries = entries.reduce<Array<{ key: string; date: number; entries: TournamentActivityEntry[] }>>((groups, entry) => {
    const key = activityDayKey(entry.createdAt);
    const existingGroup = groups[groups.length - 1];
    if (existingGroup?.key === key) {
      existingGroup.entries.push(entry);
    } else {
      groups.push({ key, date: entry.createdAt, entries: [entry] });
    }
    return groups;
  }, []);

  return (
    <section className={styles.activity} aria-labelledby="tournament-activity-title">
      <h2 id="tournament-activity-title">Tournament activity</h2>
      <ul className={styles.entries}>
        {groupedEntries.map((group) => (
          <React.Fragment key={group.key}>
            <li className={styles.dateGroup}>
              <time className={styles.date} dateTime={new Date(group.date).toISOString()}>
                {formatActivityDay(group.date)}
              </time>
            </li>
            {group.entries.map((entry) => (
              <li key={`${entry.type}-${entry.id}`} className={styles.entry}>
                <time className={styles.time} dateTime={new Date(entry.createdAt).toISOString()}>
                  {formatActivityTime(entry.createdAt)}
                </time>
                <p>{entry.story}</p>
              </li>
            ))}
          </React.Fragment>
        ))}
      </ul>
    </section>
  );
};
