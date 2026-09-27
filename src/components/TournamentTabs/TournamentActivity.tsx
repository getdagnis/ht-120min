import React, { useMemo } from 'react';
import { getCountryWorldDetails } from '../../../shared/worlddetails';
import type {
  TournamentActivityStory,
  TournamentJoinStory,
  TournamentMatchArrangeStorySnapshot,
} from '../../types/tournament-activity';
import { getCanonicalCountryName } from '../../utils/ht-data';
import { useClientNow } from '../../hooks/useHydratedBrowserState';
import { buildMisarrangedFixtureStory, type FixtureStoryTeam } from '../../utils/fixture-story';
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
}

interface TournamentActivityEntry {
  type: 'join' | 'arranged' | 'misarranged';
  id: string;
  createdAt: number;
  story: React.ReactNode;
}

const ACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ACTIVITY_ENTRIES = 7;

function formatActivityDate(createdAt: number) {
  return new Date(createdAt).toLocaleDateString('lv-LV', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
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
      <a key={`${part.text}-${index}`} href={part.href} target="_blank" rel="noopener noreferrer">
        {part.text}
      </a>
    ) : (
      <React.Fragment key={`${part.text}-${index}`}>{part.text}</React.Fragment>
    ),
  );
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

export const TournamentActivity: React.FC<TournamentActivityProps> = ({ teams, matches = [], warnings = [] }) => {
  const now = useClientNow(60_000);
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

    return [...joinEntries, ...arrangedEntries, ...misarrangedEntries]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_ACTIVITY_ENTRIES);
  }, [matches, now, teams, warnings]);

  if (entries.length === 0) return null;

  return (
    <section className={styles.activity} aria-labelledby="tournament-activity-title">
      <h2 id="tournament-activity-title">Tournament activity</h2>
      <ul className={styles.entries}>
        {entries.map((entry) => (
          <li key={`${entry.type}-${entry.id}`} className={styles.entry}>
            <time className={styles.date} dateTime={new Date(entry.createdAt).toISOString()}>
              {formatActivityDate(entry.createdAt)}
            </time>
            <p>{entry.story}</p>
          </li>
        ))}
      </ul>
    </section>
  );
};
