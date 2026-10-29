import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import {
  ArrowClockwise,
  ArrowSquareOut,
  CaretDown,
  ChartLineUp,
  ChatCircleDots,
  Flask,
  House,
  Globe,
  SoccerBall,
  ClipboardText,
  GearSix,
  SignOut,
  User,
  Users,
} from 'phosphor-react';
import { Button } from '../../components/Button/Button';
import { SectionCard } from '../../components/Card/SectionCard';
import { Tooltip } from '../../components/Tooltip/Tooltip';
import { AuthorTooltip, type ChatAuthorProfile } from '../../components/TournamentTabs/ChatView';
import { Switch } from '../../components/Switch/Switch';
import { faqPublished, faqSections, type FaqSection } from '../../constants/faq-essential';
import { supabase } from '../../lib/supabase';
import { useForgeAuth } from '../../hooks/useForgeAuth';
import faqStyles from '../../components/Faq/FaqRenderer.module.sass';
import { HATTRICK_WORLD_DETAILS } from '../../../shared/worlddetails';
import styles from './Forge.module.sass';
import { ForgeMatchesSection } from './ForgeMatches';
import { ForgeScheduling } from './ForgeScheduling';
import { ForgeLeagues } from './ForgeLeagues';
import { FlagHunters } from './FlagHunters';
import { ForgeLocales } from './ForgeLocales';
import { ForgeSurveys } from './ForgeSurveys';
import { mostViewedTournament, tournamentActivityRoute } from '../../utils/forge-activity-routes';
import { mergeForgeDirectoryUsers, type ChallengeableDirectoryUser } from '../../utils/forge-team-directory';
import { getCountryFlagUrl, getLeagueFlagUrl } from '../../utils/ht-data';

interface DashboardUser {
  hattrick_user_id: number;
  manager_name: string;
  created_at: string;
  last_seen_at: string | null;
  country_name: string | null;
}

interface DashboardTournament {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

interface DashboardChat {
  id: string;
  content: string;
  author_name: string;
  author_ht_id: number;
  created_at: string;
  tournament_id: string;
  country_name: string | null;
  profiles?: ChatAuthorProfile | null;
  teamName?: string | null;
  teamCountryName?: string | null;
  teamCountryId?: number | null;
  tournaments?: { id: string; name: string; slug: string } | null;
}

interface VisitorTournament {
  id: string;
  name: string;
  slug: string;
}

interface DashboardChatPage {
  messages: DashboardChat[];
  hasMore: boolean;
  nextOffset: number;
}

interface ForgeStatsUser {
  userId: number;
  managerName: string;
  visits: number;
  events: number;
  firstSeen: string;
  lastSeen: string;
  tournaments: number;
  teams: number;
}

interface ForgeStatsEvent {
  id: string;
  occurred_at: string;
  visitor_id: string;
  visit_id: string | null;
  hattrick_user_id: number | null;
  resolved_user_id: number | null;
  manager_name: string | null;
  resolved_manager_name: string | null;
  event_type: string;
  route: string | null;
  referrer: string | null;
  country_code: string | null;
  language: string | null;
  platform: string | null;
  browser: string | null;
  metadata?: Record<string, unknown> | null;
}

interface ForgeStatsVisitPage {
  route: string;
  visitedAt: string;
  theme: string | null;
  durationSeconds: number | null;
  maxScrollPercent: number | null;
}

interface ForgeStatsVisit {
  visitId: string;
  visitorId: string;
  userId: number | null;
  managerName: string | null;
  firstSeen: string;
  lastSeen: string;
  countryCode: string | null;
  language: string | null;
  platform: string | null;
  browser: string | null;
  referrer: string | null;
  pages: ForgeStatsVisitPage[];
  actions: string[];
}

interface ForgeStatsVisitor {
  visitorId: string;
  userId: number | null;
  managerName: string | null;
  visits: number;
  events: number;
  firstSeen: string;
  lastSeen: string;
  countries: string[];
  platforms: string[];
  browsers: string[];
  routes: string[];
}

interface ForgeStatsBreakdown {
  value: string;
  count: number;
  uniqueCount?: number;
}

interface ForgeStatsDaily {
  activity_date: string;
  event_type: string;
  route: string;
  event_count: number;
}

interface ForgeStatsUniqueVisitors {
  activity_date: string;
  event_type: string;
  visitor_count: number;
}

interface ForgeUniqueTournamentViews {
  activity_date: string;
  route: string;
  visitor_count: number;
}

interface ForgeStatsResponse {
  summary: {
    events: number;
    visits: number;
    pageViews: number;
    actions: number;
    uniqueVisitors: number;
    identifiedUsers: number;
  };
  users: ForgeStatsUser[];
  visitors: ForgeStatsVisitor[];
  visits: ForgeStatsVisit[];
  recentActivity: ForgeStatsEvent[];
  hasMoreActivity: boolean;
  nextActivityCursor: string | null;
  hasMore: boolean;
  nextCursor: string | null;
  breakdowns: Record<string, ForgeStatsBreakdown[]>;
  daily: ForgeStatsDaily[];
  uniqueVisitors: ForgeStatsUniqueVisitors[];
  uniqueTournamentViews: ForgeUniqueTournamentViews[];
  rawUniqueStart: string;
}

type ForgePeriod = '12h' | '24h' | '3d' | '7d' | '1m' | '3m';

const FORGE_PERIOD_STORAGE_KEY = 'forge-analytics-period';
const FORGE_PERIODS: Array<{ value: ForgePeriod; label: string; durationMs: number }> = [
  { value: '12h', label: 'Last 12 hours', durationMs: 12 * 60 * 60 * 1000 },
  { value: '24h', label: 'Last 24 hours', durationMs: 24 * 60 * 60 * 1000 },
  { value: '3d', label: 'Last 3 days', durationMs: 3 * 24 * 60 * 60 * 1000 },
  { value: '7d', label: 'Last 7 days', durationMs: 7 * 24 * 60 * 60 * 1000 },
  { value: '1m', label: 'Last month', durationMs: 30 * 24 * 60 * 60 * 1000 },
  { value: '3m', label: 'Last 3 months', durationMs: 90 * 24 * 60 * 60 * 1000 },
];

function useForgePeriod() {
  const [period, setPeriodState] = useState<ForgePeriod>('24h');
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = window.localStorage.getItem(FORGE_PERIOD_STORAGE_KEY);
      if (FORGE_PERIODS.some((option) => option.value === saved)) setPeriodState(saved as ForgePeriod);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const setPeriod = (next: ForgePeriod) => {
    window.localStorage.setItem(FORGE_PERIOD_STORAGE_KEY, next);
    setPeriodState(next);
  };
  return [period, setPeriod] as const;
}

function getPeriodSince(clock: number | null, period: ForgePeriod) {
  if (clock === null) return '';
  const duration = FORGE_PERIODS.find((option) => option.value === period)?.durationMs || 24 * 60 * 60 * 1000;
  return new Date(clock - duration).toISOString();
}

type ForgeTrendInterval = '7d' | '30d' | '3m' | '1y';
type ForgeTrendUnit = 'day' | 'week' | 'month';

const FORGE_TREND_INTERVALS: Array<{
  value: ForgeTrendInterval;
  label: string;
  shortLabel: string;
  durationMs: number;
  unit: ForgeTrendUnit;
}> = [
  { value: '7d', label: '7 days · daily', shortLabel: '7d', durationMs: 7 * 24 * 60 * 60 * 1000, unit: 'day' },
  { value: '30d', label: '30 days · daily', shortLabel: '30d', durationMs: 30 * 24 * 60 * 60 * 1000, unit: 'day' },
  { value: '3m', label: '3 months · weekly', shortLabel: '3m', durationMs: 90 * 24 * 60 * 60 * 1000, unit: 'week' },
  { value: '1y', label: '1 year · monthly', shortLabel: '1y', durationMs: 365 * 24 * 60 * 60 * 1000, unit: 'month' },
];

interface ForgeTrendResponse {
  daily: ForgeStatsDaily[];
  uniqueVisitors: ForgeStatsUniqueVisitors[];
  uniqueTournamentViews: ForgeUniqueTournamentViews[];
  coverageStart: string;
  rawUniqueStart: string;
}

function trendBucketKey(dateValue: string | Date, unit: ForgeTrendUnit) {
  const date =
    typeof dateValue === 'string' ? new Date(`${dateValue.slice(0, 10)}T00:00:00.000Z`) : new Date(dateValue);
  if (unit === 'month') return date.toISOString().slice(0, 7);
  if (unit === 'week') date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function hasFullRawVisitorCoverage(bucketKey: string, rawStart: string, unit: ForgeTrendUnit) {
  if (unit === 'day') return bucketKey >= rawStart;
  if (unit === 'month') {
    const startMonth = rawStart.slice(0, 7);
    return bucketKey > startMonth || (bucketKey === startMonth && rawStart.slice(8, 10) === '01');
  }
  const rawWeek = trendBucketKey(rawStart, 'week');
  return bucketKey > rawWeek || (bucketKey === rawWeek && rawStart === rawWeek);
}

function trendBucketLabel(key: string, unit: ForgeTrendUnit) {
  const date = new Date(`${key}${unit === 'month' ? '-01' : ''}T00:00:00.000Z`);
  if (unit === 'month')
    return date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'Europe/Riga' });
  if (unit === 'week')
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/Riga' });
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', timeZone: 'Europe/Riga' });
}

function getTrendSince(clock: number | null, interval: ForgeTrendInterval) {
  if (clock === null) return '';
  const config = FORGE_TREND_INTERVALS.find((option) => option.value === interval) || FORGE_TREND_INTERVALS[0];
  const start = new Date(clock);
  start.setUTCHours(0, 0, 0, 0);
  if (config.unit === 'day') start.setUTCDate(start.getUTCDate() - (interval === '7d' ? 6 : 29));
  if (config.unit === 'week') {
    start.setTime(clock - config.durationMs);
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  }
  if (config.unit === 'month') {
    start.setUTCDate(1);
    start.setUTCMonth(start.getUTCMonth() - 11);
  }
  return start.toISOString();
}

const sidebarItems = [
  { to: '/', label: 'Dashboard', icon: <House size={18} weight="bold" /> },
  { to: '/scheduling', label: 'Scheduling', icon: <SoccerBall size={18} weight="bold" /> },
  { to: '/matches', label: 'Match booking', icon: <SoccerBall size={18} weight="bold" /> },
  { to: '/stats', label: 'Statistics', icon: <ChartLineUp size={18} weight="bold" /> },
  { to: '/surveys', label: 'Surveys', icon: <ClipboardText size={18} weight="bold" /> },
  { to: '/locales', label: 'Locales', icon: <Globe size={18} weight="bold" /> },
  { to: '/leagues', label: 'Leagues', icon: <Globe size={18} weight="bold" /> },
  { to: '/flag-hunters', label: 'Flag Hunters', icon: <Globe size={18} weight="bold" /> },
  { to: '/testing', label: 'Testing', icon: <Flask size={18} weight="bold" /> },
  { to: '/admins', label: 'Admins', icon: <Users size={18} weight="bold" /> },
];

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('lv-LV', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('lv-LV', { hour: '2-digit', minute: '2-digit' });
}

function countryFlag(countryCode: string) {
  const normalized = countryCode.toUpperCase();
  return (
    Object.values(HATTRICK_WORLD_DETAILS).find(
      (entry) =>
        entry.isoCode === normalized ||
        entry.countryName?.toUpperCase() === normalized ||
        entry.countryNameEn?.toUpperCase() === normalized,
    )?.emoji || '🌐'
  );
}

function activityEventLabel(eventType: string) {
  if (eventType === 'page_view') return 'Page views';
  if (eventType === 'page_exit') return 'Page exits';
  return eventType.replace(/[_-]+/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());
}

function ActivityBarTooltip({
  id,
  label,
  eventCounts,
  uniqueVisitorCounts,
  popularRoute,
  rawUniqueAvailable = true,
  available = true,
}: {
  id: string;
  label: string;
  eventCounts: Record<string, number>;
  uniqueVisitorCounts: Record<string, number>;
  popularRoute: { route: string; count: number; uniqueCount?: number } | null;
  rawUniqueAvailable?: boolean;
  available?: boolean;
}) {
  const entries = Object.entries(eventCounts)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  return (
    <Tooltip
      id={id}
      className="tooltip"
      content={
        <div className={styles.activityTooltip}>
          <h3>{label}</h3>
          {available ? (
            <>
              <strong>{total} events</strong>
              {entries.length > 0 ? (
                <ul>
                  {entries.map(([eventType, count]) => (
                    <li key={eventType}>
                      <span>{activityEventLabel(eventType)}</span>
                      <span>
                        {count}
                        {rawUniqueAvailable && uniqueVisitorCounts[eventType] !== undefined
                          ? ` · ${uniqueVisitorCounts[eventType]} unique`
                          : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span>No tracked events.</span>
              )}
              {entries.length > 0 && !rawUniqueAvailable && (
                <small>Unique visitor counts are available for the last 90 days of raw events.</small>
              )}
              {popularRoute && (
                <p>
                  Most viewed: {popularRoute.route} · {popularRoute.count}
                  {popularRoute.uniqueCount !== undefined ? `(${popularRoute.uniqueCount})` : ''} views
                </p>
              )}
              <p>Trend counts include page views and tracked actions. Page exits remain in recent activity.</p>
            </>
          ) : (
            <small>History unavailable for this period.</small>
          )}
        </div>
      }
    />
  );
}

async function loadAuthorProfiles(userIds: number[]) {
  const ids = Array.from(new Set(userIds.filter((id) => Number.isSafeInteger(id) && id > 0)));
  if (ids.length === 0) return {} as Record<number, ChatAuthorProfile>;

  const { data, error } = await supabase
    .from('profiles')
    .select('hattrick_user_id, avatar_json, country_name, country_id')
    .in('hattrick_user_id', ids);
  if (error || !data) return {} as Record<number, ChatAuthorProfile>;

  return Object.fromEntries(
    data.map((profile) => [
      profile.hattrick_user_id,
      {
        avatar_json: profile.avatar_json,
        country_name: profile.country_name,
        country_id: profile.country_id,
      },
    ]),
  ) as Record<number, ChatAuthorProfile>;
}

async function loadVisitorTournaments(userIds: number[]) {
  const ids = Array.from(new Set(userIds.filter((id) => Number.isSafeInteger(id) && id > 0)));
  if (ids.length === 0) return {} as Record<number, VisitorTournament[]>;

  const { data, error } = await supabase
    .from('teams')
    .select('hattrick_user_id, tournaments!teams_tournament_id_fkey!inner(id, name, slug, status, is_archived)')
    .in('hattrick_user_id', ids)
    .eq('active', true)
    .eq('reserve_active', false);
  if (error || !data) return {} as Record<number, VisitorTournament[]>;

  const result: Record<number, VisitorTournament[]> = {};
  for (const row of data as Array<{
    hattrick_user_id: number;
    tournaments:
      | (VisitorTournament & { status: string | null; is_archived: boolean | null })
      | Array<VisitorTournament & { status: string | null; is_archived: boolean | null }>
      | null;
  }>) {
    const tournament = Array.isArray(row.tournaments) ? row.tournaments[0] : row.tournaments;
    if (!tournament?.slug || tournament.is_archived || !['active', 'open', 'paused'].includes(tournament.status || ''))
      continue;
    const userTournaments = result[row.hattrick_user_id] || [];
    if (!userTournaments.some((item) => item.id === tournament.id)) {
      userTournaments.push({ id: tournament.id, name: tournament.name, slug: tournament.slug });
    }
    result[row.hattrick_user_id] = userTournaments;
  }
  return result;
}

async function loadManagerRegistrationDates(userIds: number[]) {
  const ids = Array.from(new Set(userIds.filter((id) => Number.isSafeInteger(id) && id > 0)));
  if (ids.length === 0) return {} as Record<number, string>;
  const { data, error } = await supabase
    .from('profiles')
    .select('hattrick_user_id, created_at')
    .in('hattrick_user_id', ids);
  if (error || !data) return {} as Record<number, string>;
  return Object.fromEntries(data.map((profile) => [profile.hattrick_user_id, profile.created_at])) as Record<
    number,
    string
  >;
}

function formatRegistrationDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function ForgeAuthorLink({
  id,
  authorName,
  userId,
  profile,
  teamName,
  teamCountryName,
  teamCountryId,
  className,
}: {
  id: string;
  authorName: string;
  userId: number | null;
  profile?: ChatAuthorProfile | null;
  teamName?: string | null;
  teamCountryName?: string | null;
  teamCountryId?: number | null;
  className?: string;
}) {
  if (!userId) return <span className={className}>{authorName}</span>;

  const tooltipId = `forge-author-${id}`;
  return (
    <>
      <a
        href={`/en?profileId=${userId}`}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        data-tooltip-id={tooltipId}
      >
        {authorName}
      </a>
      <AuthorTooltip
        id={tooltipId}
        authorName={authorName}
        teamName={teamName}
        countryName={teamCountryName}
        countryId={teamCountryId}
        managerCountryName={profile?.country_name}
        managerCountryId={profile?.country_id}
        avatar={profile?.avatar_json || null}
      />
    </>
  );
}

function VisitorTournamentLinks({ tournaments }: { tournaments: VisitorTournament[] }) {
  if (tournaments.length === 0) return null;
  return (
    <div className={styles.visitorTournaments}>
      {tournaments.map((tournament) => (
        <a key={tournament.id} href={`/en/t/${tournament.slug}`} target="_blank" rel="noopener noreferrer">
          /t/{tournament.slug}
        </a>
      ))}
    </div>
  );
}

async function loadDashboardChatPage(
  since: string,
  offset: number,
  adminUserId: number | null,
  adminManagerName: string | null,
): Promise<DashboardChatPage> {
  const pageSize = 8;
  let nextOffset = offset;
  let hasMore = false;
  const messages: Array<Omit<DashboardChat, 'country_name'>> = [];
  while (messages.length < pageSize) {
    const { data, error } = await supabase
      .from('tournament_chat')
      .select('id, content, author_name, author_ht_id, created_at, tournament_id, tournaments (id, name, slug)')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .range(nextOffset, nextOffset + pageSize);
    if (error) throw error;

    const rows = (data as Omit<DashboardChat, 'country_name'>[] | null) || [];
    hasMore = rows.length > pageSize;
    messages.push(
      ...rows
        .slice(0, pageSize)
        .filter(
          (message) =>
            message.author_ht_id !== adminUserId && (!adminManagerName || message.author_name !== adminManagerName),
        ),
    );
    nextOffset += pageSize;
    if (!hasMore) break;
  }
  const authorIds = Array.from(new Set(messages.map((message) => message.author_ht_id).filter((id) => id > 0)));
  const tournamentIds = Array.from(new Set(messages.map((message) => message.tournament_id)));
  const [profilesByUserId, teamsResult] = await Promise.all([
    loadAuthorProfiles(authorIds),
    authorIds.length > 0 && tournamentIds.length > 0
      ? supabase
          .from('teams')
          .select('hattrick_user_id, tournament_id, name, country_name, country_id')
          .in('hattrick_user_id', authorIds)
          .in('tournament_id', tournamentIds)
          .eq('active', true)
          .eq('reserve_active', false)
      : Promise.resolve({ data: [] }),
  ]);
  const teamByChatAuthor = new Map(
    (
      (teamsResult.data || []) as Array<{
        hattrick_user_id: number;
        tournament_id: string;
        name: string;
        country_name: string | null;
        country_id: number | null;
      }>
    ).map((team) => [`${team.tournament_id}:${team.hattrick_user_id}`, team]),
  );

  return {
    messages: messages.slice(0, pageSize).map((message) => ({
      ...message,
      country_name: profilesByUserId[message.author_ht_id]?.country_name || null,
      profiles: profilesByUserId[message.author_ht_id] || null,
      teamName: teamByChatAuthor.get(`${message.tournament_id}:${message.author_ht_id}`)?.name || null,
      teamCountryName: teamByChatAuthor.get(`${message.tournament_id}:${message.author_ht_id}`)?.country_name || null,
      teamCountryId: teamByChatAuthor.get(`${message.tournament_id}:${message.author_ht_id}`)?.country_id || null,
    })),
    hasMore,
    nextOffset,
  };
}

function safeRouteHref(route: string) {
  if (!route.startsWith('/') || route.startsWith('//') || route.includes('\\')) return null;
  return route;
}

function activityEventTitle(event: ForgeStatsEvent) {
  const labels: Record<string, string> = {
    login: 'Signed in',
    tournament_created: 'Created a tournament',
    tournament_joined: 'Joined a tournament',
    team_added_by_admin: 'Added a team',
    sandbox_team_added: 'Added a training team',
  };
  return labels[event.event_type] || event.event_type.replace(/[_-]+/g, ' ');
}

function activityEventDetails(event: ForgeStatsEvent) {
  const metadata = event.metadata || {};
  const details = [
    event.country_code ? countryFlag(event.country_code) : null,
    event.referrer ? `From ${event.referrer}` : null,
    event.route,
    typeof metadata.registrationType === 'string' ? metadata.registrationType : null,
    metadata.isSandbox === true ? 'Training tournament' : null,
    metadata.isJoin === true ? 'Self-joined' : null,
    typeof metadata.teamId === 'number' ? `Team ${metadata.teamId}` : null,
  ];
  return details.filter(Boolean).join(' · ');
}

function ActivityVisitCard({ visit }: { visit: ForgeStatsVisit }) {
  return (
    <article className={styles.visitCard}>
      <div className={styles.visitHeader}>
        <div>
          <div className={styles.listTitle}>{visit.managerName || 'Anonymous visitor'}</div>
          <div className={styles.listMeta}>
            {visit.managerName && visit.userId ? `Hattrick ID ${visit.userId} · ` : ''}
            {visit.countryCode ? `${countryFlag(visit.countryCode)} ` : ''}
            {formatDateTime(visit.lastSeen)}
          </div>
        </div>
        <span className={styles.visitSystem}>
          {[visit.platform, visit.browser].filter(Boolean).join(' · ') || 'System unknown'}
        </span>
      </div>
      {visit.referrer && <div className={styles.listMeta}>From {visit.referrer}</div>}
      <div className={styles.visitPages}>
        {visit.pages.map((page, index) => {
          const href = safeRouteHref(page.route);
          const details = [
            formatTime(page.visitedAt),
            page.theme ? `Theme ${page.theme}` : null,
            page.durationSeconds !== null ? `${page.durationSeconds}s` : 'Time not recorded',
            page.maxScrollPercent !== null ? `Scroll ${page.maxScrollPercent}%` : null,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <div key={`${visit.visitId}:${index}:${page.visitedAt}`} className={styles.visitPage}>
              <div>
                <div className={styles.visitRoute}>{href ? page.route : 'Unknown page'}</div>
                <div className={styles.listMeta}>{details || 'Page details unavailable'}</div>
              </div>
              {href && (
                <a
                  className={styles.openVisitLink}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${page.route}`}
                >
                  <ArrowSquareOut size={17} weight="bold" />
                </a>
              )}
            </div>
          );
        })}
        {visit.pages.length === 0 && <div className={styles.listMeta}>No page views were recorded for this visit.</div>}
      </div>
      <div className={styles.visitFooter}>
        <span>
          {visit.pages.length} page {visit.pages.length === 1 ? 'view' : 'views'}
        </span>
        <span>
          {visit.actions.length} {visit.actions.length === 1 ? 'action' : 'actions'}
        </span>
        {visit.actions.length > 0 && <span>{visit.actions.join(', ')}</span>}
        {visit.language && <span>{visit.language}</span>}
      </div>
    </article>
  );
}

const statsBreakdownCards = [
  { key: 'countries', title: 'Countries', flags: true },
  { key: 'themes', title: 'Themes', flags: false },
  { key: 'browsers', title: 'Browsers', flags: false },
  { key: 'platforms', title: 'OS', flags: false },
  { key: 'screens', title: 'Screens', flags: false },
  { key: 'routes', title: 'Pages', flags: false },
  { key: 'referrers', title: 'Sources', flags: false },
  { key: 'times', title: 'Visit times', flags: false },
  { key: 'languages', title: 'Languages', flags: false },
] as const;

function ForgeStatsSidebar({
  summary,
  breakdowns,
  period,
  onPeriodChange,
  loading,
  chatActivity,
  chatActivityLoading = false,
  hasMoreChat = false,
  loadingMoreChat = false,
  onLoadMoreChat,
  latestUsers,
  hasMoreUsers = false,
  loadingMoreUsers = false,
  onLoadMoreUsers,
  latestTournament,
}: {
  summary: ForgeStatsResponse['summary'] | null;
  breakdowns: ForgeStatsResponse['breakdowns'] | null;
  period: ForgePeriod;
  onPeriodChange: (period: ForgePeriod) => void;
  loading: boolean;
  chatActivity?: Array<{
    id: string;
    at: string;
    title: string;
    who: string;
    authorHtId: number;
    profile?: ChatAuthorProfile | null;
    teamName?: string | null;
    teamCountryName?: string | null;
    teamCountryId?: number | null;
    details: string;
    href?: string;
    countryName?: string | null;
  }>;
  chatActivityLoading?: boolean;
  hasMoreChat?: boolean;
  loadingMoreChat?: boolean;
  onLoadMoreChat?: () => void;
  latestUsers?: DashboardUser[];
  hasMoreUsers?: boolean;
  loadingMoreUsers?: boolean;
  onLoadMoreUsers?: () => void;
  latestTournament?: DashboardTournament | null;
}) {
  return (
    <aside className={styles.statsSidebar}>
      <select
        className={styles.statsPeriodSelect}
        aria-label="Analytics period"
        value={period}
        onChange={(event) => onPeriodChange(event.target.value as ForgePeriod)}
      >
        {FORGE_PERIODS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <div className={styles.statsMetricGrid}>
        {[
          { label: 'Visits', value: summary?.visits },
          { label: 'Page views', value: summary?.pageViews },
          { label: 'Unique visitors', value: summary?.uniqueVisitors },
          { label: 'Actions', value: summary?.actions },
        ].map((metric) => (
          <div key={metric.label} className={styles.metricCard}>
            <span className={styles.metricLabel}>{metric.label}</span>
            <span className={styles.metricValue}>
              {loading && metric.value === undefined ? '—' : (metric.value ?? 0)}
            </span>
          </div>
        ))}
      </div>

      {chatActivity && (
        <SectionCard
          title={`Chat`}
          subtitle={`${FORGE_PERIODS.find((option) => option.value === period)?.label.toLowerCase()}`}
          className={`${styles.surfaceCard} ${styles.dashboardActivity}`}
        >
          {chatActivityLoading && <p className={styles.smallNote}>Loading chat...</p>}
          {!chatActivityLoading && chatActivity.length === 0 && (
            <p className={styles.smallNote}>No chat in this period.</p>
          )}
          <div className={styles.activityFeed}>
            {chatActivity.map((item) => (
              <article key={item.id} className={styles.activityFeedItem}>
                <div className={styles.activityFeedHeading}>
                  <strong>{item.title}</strong>
                  <time>{formatDateTime(item.at)}</time>
                </div>
                <div className={styles.chatAuthor}>
                  {item.countryName && <span>{countryFlag(item.countryName)}</span>}
                  <ForgeAuthorLink
                    id={`chat-${item.id}`}
                    authorName={item.who}
                    userId={item.authorHtId}
                    profile={item.profile}
                    teamName={item.teamName}
                    teamCountryName={item.teamCountryName}
                    teamCountryId={item.teamCountryId}
                    className={styles.chatAuthorLink}
                  />
                </div>
                <p className={styles.chatMessage}>{item.details}</p>
                {item.href && (
                  <a href={item.href} target="_blank" rel="noopener noreferrer" className={styles.chatTournamentLink}>
                    {item.href}
                  </a>
                )}
              </article>
            ))}
          </div>
          {hasMoreChat && onLoadMoreChat && (
            <Button variant="showMore" disabled={loadingMoreChat} onClick={onLoadMoreChat}>
              {loadingMoreChat ? 'Loading...' : 'View more'}
            </Button>
          )}
        </SectionCard>
      )}

      {latestUsers && (
        <SectionCard
          title="Most recent registered users"
          subtitle={`${FORGE_PERIODS.find((option) => option.value === period)?.label.toLowerCase()}`}
          className={`${styles.surfaceCard} ${styles.dashboardActivity}`}
        >
          {loading && latestUsers.length === 0 && <p className={styles.smallNote}>Loading registered users...</p>}
          {!loading && latestUsers.length === 0 && <p className={styles.smallNote}>No registrations in this period.</p>}
          <div className={styles.activityFeed}>
            {latestUsers.map((user) => (
              <article key={user.hattrick_user_id} className={styles.activityFeedItem}>
                <div className={styles.activityFeedHeading}>
                  <strong>{user.manager_name}</strong>
                  <time>{formatDateTime(user.created_at)}</time>
                </div>
                <p className={styles.activityFeedDetails}>
                  {[user.country_name, `Hattrick ID ${user.hattrick_user_id}`].filter(Boolean).join(' · ')}
                </p>
              </article>
            ))}
          </div>
          {hasMoreUsers && onLoadMoreUsers && (
            <Button variant="showMore" disabled={loadingMoreUsers} onClick={onLoadMoreUsers}>
              {loadingMoreUsers ? 'Loading...' : 'Show 10 more'}
            </Button>
          )}
        </SectionCard>
      )}

      {latestUsers && (
        <SectionCard
          title="Most recent tournament created"
          subtitle={`${FORGE_PERIODS.find((option) => option.value === period)?.label.toLowerCase()}`}
          className={`${styles.surfaceCard} ${styles.dashboardActivity}`}
        >
          {loading && !latestTournament && <p className={styles.smallNote}>Loading tournaments...</p>}
          {!loading && !latestTournament && <p className={styles.smallNote}>No tournaments created in this period.</p>}
          {latestTournament && (
            <article className={styles.activityFeedItem}>
              <div className={styles.activityFeedHeading}>
                <a href={`/en/t/${latestTournament.slug}`}>{latestTournament.name}</a>
                <time>{formatDateTime(latestTournament.created_at)}</time>
              </div>
            </article>
          )}
        </SectionCard>
      )}

      {statsBreakdownCards.map((card) => {
        const rows = breakdowns?.[card.key] || [];
        return (
          <SectionCard
            key={card.key}
            title={card.title}
            className={`${styles.surfaceCard} ${styles.statsSidebarBreakdown}`}
          >
            {rows.length === 0 ? (
              <p className={styles.smallNote}>{loading ? 'Loading…' : 'No data yet.'}</p>
            ) : (
              <div className={styles.breakdownList}>
                {rows.map((row) => (
                  <div key={row.value} className={styles.breakdownRow}>
                    <span className={styles.breakdownName}>
                      {card.flags && <span className={styles.countryFlag}>{countryFlag(row.value)}</span>}
                      {row.value}
                    </span>
                    <span className={styles.breakdownCount}>
                      {row.count}
                      {card.key === 'themes' && row.uniqueCount !== undefined ? ` (${row.uniqueCount} unique)` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        );
      })}
    </aside>
  );
}

function ForgeGate({ onLogin, loading = false }: { onLogin: () => void; loading?: boolean }) {
  return (
    <div className={styles.gate}>
      <SectionCard title="Forge admin login" className={`${styles.gateCard} ${styles.surfaceCard}`}>
        <p className={styles.gateText}>
          {loading
            ? 'Checking your Forge session...'
            : 'This area is for Forge site administration. Sign in with the dedicated CHPP flow to continue.'}
        </p>
        {!loading && (
          <div className={styles.gateActions}>
            <Button variant="secondaryYellow" size="lg" onClick={onLogin}>
              <GearSix size={18} weight="bold" />
              Login with CHPP
            </Button>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function ForgeHeader({
  managerName,
  onLogoutMain,
  onLogoutForge,
  onLogin,
}: {
  managerName: string | null;
  onLogoutMain: () => void;
  onLogoutForge: () => void;
  onLogin: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link to="/" className={styles.brand}>
          <GearSix size={26} weight="bold" />
          <span>Forge</span>
        </Link>

        <div className={styles.headerActions} ref={ref}>
          {managerName ? (
            <>
              <Button variant="zero" size="sm" className={styles.userBtn} onClick={() => setOpen((v) => !v)}>
                <User size={18} weight="bold" />
                <span className={styles.hideMobile}>{managerName}</span>
                <CaretDown size={14} weight="bold" />
              </Button>

              {open && (
                <div className={styles.dropdown}>
                  <button
                    type="button"
                    className={styles.dropdownItem}
                    onClick={() => {
                      onLogoutMain();
                      setOpen(false);
                    }}
                  >
                    <SignOut size={18} />
                    Logout HT-120min
                  </button>
                  <button
                    type="button"
                    className={styles.dropdownItem}
                    onClick={() => {
                      onLogoutForge();
                      setOpen(false);
                    }}
                  >
                    <SignOut size={18} />
                    Logout Forge
                  </button>
                  <button
                    type="button"
                    className={styles.dropdownItem}
                    onClick={() => {
                      onLogin();
                      setOpen(false);
                    }}
                  >
                    <GearSix size={18} />
                    Re-authenticate
                  </button>
                </div>
              )}
            </>
          ) : (
            <Button variant="secondaryYellow" size="sm" onClick={onLogin}>
              <GearSix size={18} weight="bold" />
              Login with CHPP
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

function ForgeShell({
  children,
  managerName,
  onLogoutMain,
  onLogoutForge,
  onLogin,
  localeEditorOnly = false,
}: {
  children: React.ReactNode;
  managerName: string | null;
  onLogoutMain: () => void;
  onLogoutForge: () => void;
  onLogin: () => void;
  localeEditorOnly?: boolean;
}) {
  return (
    <div className={styles.page}>
      <ForgeHeader
        managerName={managerName}
        onLogoutMain={onLogoutMain}
        onLogoutForge={onLogoutForge}
        onLogin={onLogin}
      />
      <div className={styles.shell}>
        <aside className={styles.sidebar}>
          {sidebarItems
            .filter((item) => !localeEditorOnly || item.to === '/locales')
            .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
              >
                <span className={styles.navIcon}>{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            ))}
        </aside>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}

function ForgeDashboard({
  adminUserId,
  adminManagerName,
}: {
  adminUserId: number | null;
  adminManagerName: string | null;
}) {
  const [period, setPeriod] = useForgePeriod();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [latestUsers, setLatestUsers] = useState<DashboardUser[]>([]);
  const [hasMoreUsers, setHasMoreUsers] = useState(false);
  const [loadingMoreUsers, setLoadingMoreUsers] = useState(false);
  const [latestTournament, setLatestTournament] = useState<DashboardTournament | null>(null);
  const [latestChat, setLatestChat] = useState<DashboardChat[]>([]);
  const [chatOffset, setChatOffset] = useState(0);
  const [hasMoreChat, setHasMoreChat] = useState(false);
  const [loadingMoreChat, setLoadingMoreChat] = useState(false);
  const [stats, setStats] = useState<ForgeStatsResponse | null>(null);
  const [statsSearch, setStatsSearch] = useState('');
  const [searchedVisits, setSearchedVisits] = useState<ForgeStatsVisit[]>([]);
  const [searchedVisitCursor, setSearchedVisitCursor] = useState<string | null>(null);
  const [searchedVisitsHaveMore, setSearchedVisitsHaveMore] = useState(false);
  const [searchingVisits, setSearchingVisits] = useState(false);
  const [visitorProfiles, setVisitorProfiles] = useState<Record<number, ChatAuthorProfile>>({});
  const [visitorTournaments, setVisitorTournaments] = useState<Record<number, VisitorTournament[]>>({});
  const [visitCursor, setVisitCursor] = useState<string | null>(null);
  const [hasMoreVisits, setHasMoreVisits] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [clock, setClock] = useState<number | null>(null);
  const [recentVisitorLimit, setRecentVisitorLimit] = useState(12);
  const [trendInterval, setTrendInterval] = useState<ForgeTrendInterval>('7d');
  const [trendData, setTrendData] = useState<ForgeTrendResponse | null>(null);
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendError, setTrendError] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setClock(Date.now()), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const since = getPeriodSince(clock, period);
  const latestUsersSinceRef = useRef(since);
  useEffect(() => {
    latestUsersSinceRef.current = since;
  }, [since]);
  const trendConfig =
    FORGE_TREND_INTERVALS.find((option) => option.value === trendInterval) || FORGE_TREND_INTERVALS[0];
  const trendSince = getTrendSince(clock, trendInterval);

  useEffect(() => {
    if (!trendSince) return;
    let cancelled = false;
    const load = async () => {
      setTrendLoading(true);
      setTrendError('');
      try {
        const params = new URLSearchParams({
          route: 'forge-stats',
          trend: '1',
          since: trendSince,
          unit: trendConfig.unit,
        });
        const response = await fetch(`/api/app?${params.toString()}`, { credentials: 'include' });
        const payload = (await response.json()) as ForgeTrendResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || 'Could not load activity trend.');
        if (!cancelled) setTrendData(payload);
      } catch (loadError) {
        if (!cancelled)
          setTrendError(loadError instanceof Error ? loadError.message : 'Could not load activity trend.');
      } finally {
        if (!cancelled) setTrendLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [trendSince, trendConfig.unit]);

  useEffect(() => {
    if (!since) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      setLatestUsers([]);
      setHasMoreUsers(false);
      setLoadingMoreUsers(false);
      try {
        let usersQuery = supabase
          .from('profiles')
          .select('hattrick_user_id, manager_name, created_at, last_seen_at, country_name')
          .gte('created_at', since)
          .not('hattrick_user_id', 'is', null)
          .order('created_at', { ascending: false })
          .order('hattrick_user_id', { ascending: true });
        if (adminUserId !== null) usersQuery = usersQuery.neq('hattrick_user_id', adminUserId);
        const [usersRes, tournamentRes, chatPage, statsRes] = await Promise.all([
          usersQuery.range(0, 9),
          supabase
            .from('tournaments')
            .select('id, name, slug, created_at')
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          loadDashboardChatPage(since, 0, adminUserId, adminManagerName),
          fetch(`/api/app?route=forge-stats&since=${encodeURIComponent(since)}`, { credentials: 'include' }),
        ]);
        const payload = (await statsRes.json()) as ForgeStatsResponse & { error?: string };
        if (!statsRes.ok) throw new Error(payload.error || 'Could not load recent visits.');
        if (cancelled) return;
        const visitorIds = payload.visitors.map((visitor) => visitor.userId).filter((id): id is number => id !== null);
        const [visitorProfileMap, tournaments] = await Promise.all([
          loadAuthorProfiles(visitorIds),
          loadVisitorTournaments(visitorIds),
        ]);
        if (cancelled) return;
        setStats(payload);
        setVisitorProfiles(visitorProfileMap);
        setVisitorTournaments(tournaments);
        setVisitCursor(payload.nextCursor);
        setHasMoreVisits(payload.hasMore);
        setLatestChat(chatPage.messages);
        setChatOffset(chatPage.nextOffset);
        setHasMoreChat(chatPage.hasMore);
        const profiles = (usersRes.data as DashboardUser[] | null) || [];
        setLatestUsers(profiles);
        setHasMoreUsers(profiles.length === 10);
        setLatestTournament((tournamentRes.data as DashboardTournament | null) || null);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load dashboard activity.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [adminManagerName, adminUserId, since]);

  const loadMoreUsers = async () => {
    if (!since || loadingMoreUsers || !hasMoreUsers) return;
    const requestedSince = since;
    const from = latestUsers.length;
    setLoadingMoreUsers(true);
    try {
      let usersQuery = supabase
        .from('profiles')
        .select('hattrick_user_id, manager_name, created_at, last_seen_at, country_name')
        .gte('created_at', requestedSince)
        .not('hattrick_user_id', 'is', null)
        .order('created_at', { ascending: false })
        .order('hattrick_user_id', { ascending: true });
      if (adminUserId !== null) usersQuery = usersQuery.neq('hattrick_user_id', adminUserId);
      const { data, error: usersError } = await usersQuery.range(from, from + 9);
      if (usersError) throw usersError;
      if (latestUsersSinceRef.current !== requestedSince) return;
      const nextUsers = (data as DashboardUser[] | null) || [];
      setLatestUsers((current) => [...current, ...nextUsers]);
      setHasMoreUsers(nextUsers.length === 10);
    } catch (loadError) {
      if (latestUsersSinceRef.current === requestedSince) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load more registered users.');
      }
    } finally {
      setLoadingMoreUsers(false);
    }
  };

  const searchTerm = statsSearch.trim().toLocaleLowerCase();
  const searchUserId = searchTerm
    ? ((stats?.visitors || []).find(
        (visitor) =>
          visitor.userId !== null &&
          (visitor.managerName?.toLocaleLowerCase().includes(searchTerm) ||
            String(visitor.userId).includes(searchTerm)),
      )?.userId ?? null)
    : null;

  useEffect(() => {
    if (!since || !searchUserId) return;
    let cancelled = false;
    const load = async () => {
      setSearchingVisits(true);
      setSearchedVisits([]);
      setSearchedVisitCursor(null);
      try {
        const params = new URLSearchParams({
          route: 'forge-stats',
          since,
          userId: String(searchUserId),
        });
        const response = await fetch(`/api/app?${params.toString()}`, { credentials: 'include' });
        const payload = (await response.json()) as ForgeStatsResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || 'Could not search visits.');
        if (!cancelled) {
          setSearchedVisits(payload.visits);
          setSearchedVisitCursor(payload.nextCursor);
          setSearchedVisitsHaveMore(payload.hasMore);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not search visits.');
      } finally {
        if (!cancelled) setSearchingVisits(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [searchUserId, since]);

  const loadMoreVisits = async () => {
    const cursor = searchUserId ? searchedVisitCursor : visitCursor;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ route: 'forge-stats', since, cursor });
      if (searchUserId) params.set('userId', String(searchUserId));
      const response = await fetch(`/api/app?${params.toString()}`, { credentials: 'include' });
      const payload = (await response.json()) as ForgeStatsResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Could not load more visits.');
      if (searchUserId) {
        setSearchedVisits((current) => [...current, ...payload.visits]);
        setSearchedVisitCursor(payload.nextCursor);
        setSearchedVisitsHaveMore(payload.hasMore);
      } else {
        setStats((current) => (current ? { ...current, visits: [...current.visits, ...payload.visits] } : payload));
        setVisitCursor(payload.nextCursor);
        setHasMoreVisits(payload.hasMore);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load more visits.');
    } finally {
      setLoadingMore(false);
    }
  };

  const loadMoreChat = async () => {
    if (loadingMoreChat || !hasMoreChat) return;
    setLoadingMoreChat(true);
    try {
      const page = await loadDashboardChatPage(since, chatOffset, adminUserId, adminManagerName);
      setLatestChat((current) => [...current, ...page.messages]);
      setChatOffset(page.nextOffset);
      setHasMoreChat(page.hasMore);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load more chat.');
    } finally {
      setLoadingMoreChat(false);
    }
  };

  const trendBuckets = useMemo(() => {
    if (clock === null) return [];
    const today = new Date(clock);
    const first = new Date(trendSince);
    const keys: string[] = [];
    const cursor = new Date(first);
    while (cursor <= today) {
      keys.push(trendBucketKey(cursor, trendConfig.unit));
      if (trendConfig.unit === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      else if (trendConfig.unit === 'week') cursor.setUTCDate(cursor.getUTCDate() + 7);
      else cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    const counts = new Map<string, number>();
    const eventBreakdowns = new Map<string, Map<string, number>>();
    const uniqueBreakdowns = new Map<string, Map<string, number>>();
    const popularRoutes = new Map<string, Map<string, number>>();
    const uniqueTournamentRoutes = new Map<string, Map<string, number>>();
    for (const row of trendData?.daily || []) {
      if (row.event_type === 'page_exit') continue;
      const key = trendBucketKey(row.activity_date, trendConfig.unit);
      counts.set(key, (counts.get(key) || 0) + row.event_count);
      const eventCounts = eventBreakdowns.get(key) || new Map<string, number>();
      eventCounts.set(row.event_type, (eventCounts.get(row.event_type) || 0) + row.event_count);
      eventBreakdowns.set(key, eventCounts);
      const route = row.event_type === 'page_view' ? tournamentActivityRoute(row.route) : null;
      if (route) {
        const routes = popularRoutes.get(key) || new Map<string, number>();
        routes.set(route, (routes.get(route) || 0) + row.event_count);
        popularRoutes.set(key, routes);
      }
    }
    for (const row of trendData?.uniqueVisitors || []) {
      const key = row.activity_date;
      const eventCounts = uniqueBreakdowns.get(key) || new Map<string, number>();
      eventCounts.set(row.event_type, row.visitor_count);
      uniqueBreakdowns.set(key, eventCounts);
    }
    for (const row of trendData?.uniqueTournamentViews || []) {
      const routes = uniqueTournamentRoutes.get(row.activity_date) || new Map<string, number>();
      routes.set(row.route, row.visitor_count);
      uniqueTournamentRoutes.set(row.activity_date, routes);
    }
    const coverageKey = trendData ? trendBucketKey(trendData.coverageStart, trendConfig.unit) : '';
    return keys.map((key) => ({
      key,
      label: trendBucketLabel(key, trendConfig.unit),
      count: counts.get(key) || 0,
      eventCounts: Object.fromEntries(eventBreakdowns.get(key) || []),
      uniqueVisitorCounts: Object.fromEntries(uniqueBreakdowns.get(key) || []),
      popularRoute: mostViewedTournament(
        popularRoutes.get(key),
        trendData && hasFullRawVisitorCoverage(key, trendData.rawUniqueStart, trendConfig.unit)
          ? uniqueTournamentRoutes.get(key)
          : undefined,
      ),
      rawUniqueAvailable: Boolean(
        trendData && hasFullRawVisitorCoverage(key, trendData.rawUniqueStart, trendConfig.unit),
      ),
      available: Boolean(trendData && key >= coverageKey),
    }));
  }, [clock, trendConfig.unit, trendSince, trendData]);
  const maxTrend = Math.max(1, ...trendBuckets.filter((bucket) => bucket.available).map((bucket) => bucket.count));

  const feed = useMemo(() => {
    const items: Array<{ id: string; at: string; title: string; who: string; details: string; href?: string }> = [];
    for (const user of latestUsers) {
      const arrival = stats?.recentActivity.find((event) => event.resolved_user_id === user.hattrick_user_id);
      items.push({
        id: `registered:${user.hattrick_user_id}`,
        at: user.created_at,
        title: 'Registered',
        who: user.manager_name,
        details: [user.country_name, arrival?.referrer ? `From ${arrival.referrer}` : 'Arrival source unavailable']
          .filter(Boolean)
          .join(' · '),
      });
    }
    for (const event of stats?.recentActivity || []) {
      items.push({
        id: `event:${event.id}`,
        at: event.occurred_at,
        title: activityEventTitle(event),
        who: event.resolved_manager_name || event.manager_name || 'Anonymous visitor',
        details: activityEventDetails(event),
      });
    }
    return items.sort((left, right) => right.at.localeCompare(left.at));
  }, [latestUsers, stats?.recentActivity]);

  const visibleVisitors = (stats?.visitors || []).filter(
    (visitor) =>
      !searchTerm ||
      [
        visitor.managerName,
        visitor.userId,
        visitor.visitorId,
        visitor.firstSeen,
        visitor.lastSeen,
        ...visitor.countries,
        ...visitor.platforms,
        ...visitor.browsers,
        ...visitor.routes,
        ...(visitor.userId ? (visitorTournaments[visitor.userId] || []).map((tournament) => tournament.name) : []),
      ].some((value) =>
        String(value ?? '')
          .toLocaleLowerCase()
          .includes(searchTerm),
      ),
  );
  const managerNameById = new Map(
    (stats?.visitors || [])
      .filter((visitor) => visitor.userId !== null && visitor.managerName)
      .map((visitor) => [visitor.userId as number, visitor.managerName as string]),
  );
  const visitsForSearch = searchUserId ? searchedVisits : stats?.visits || [];
  const visibleVisits = visitsForSearch.filter(
    (visit) =>
      !searchTerm ||
      (searchUserId !== null && visit.userId === searchUserId) ||
      [
        visit.managerName,
        visit.userId,
        visit.visitorId,
        visit.countryCode,
        visit.language,
        visit.platform,
        visit.browser,
        visit.referrer,
        visit.firstSeen,
        visit.lastSeen,
        ...visit.pages.map((page) => page.route),
        ...visit.pages.map((page) => page.visitedAt),
        ...visit.actions,
      ].some((value) =>
        String(value ?? '')
          .toLocaleLowerCase()
          .includes(searchTerm),
      ),
  );
  const visibleFeed = searchTerm
    ? feed.filter((item) =>
        [item.title, item.who, item.details, item.at].some((value) => value.toLocaleLowerCase().includes(searchTerm)),
      )
    : feed.slice(0, 30);

  const chatFeed = useMemo(
    () =>
      latestChat.map((message) => {
        const tournament = message.tournaments;
        return {
          id: message.id,
          at: message.created_at,
          title: `In: ${tournament?.name || 'Tournament'}`,
          who: message.author_name,
          authorHtId: message.author_ht_id,
          profile: message.profiles,
          teamName: message.teamName,
          teamCountryName: message.teamCountryName,
          teamCountryId: message.teamCountryId,
          details: message.content,
          href: tournament ? `/en/t/${tournament.slug}` : undefined,
          countryName: message.country_name,
        };
      }),
    [latestChat],
  );

  return (
    <section className={styles.sectionStack}>
      <div className={styles.dashboardHeading}>
        <h1 className={styles.pageTitle}>Dashboard</h1>
      </div>
      <div className={styles.analyticsLayout}>
        <div className={styles.analyticsMain}>
          <SectionCard title="Activity trend" className={`${styles.surfaceCard} ${styles.dashboardTrend}`}>
            <div className={styles.trendToolbar} role="group" aria-label="Activity trend interval">
              {FORGE_TREND_INTERVALS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`${styles.trendInterval} ${trendInterval === option.value ? styles.trendIntervalActive : ''}`}
                  aria-label={option.label}
                  aria-pressed={trendInterval === option.value}
                  title={option.label}
                  onClick={() => setTrendInterval(option.value)}
                >
                  {option.shortLabel}
                </button>
              ))}
            </div>
            {trendLoading && <p className={styles.smallNote}>Loading trend...</p>}
            {trendError && <p className={styles.errorText}>{trendError}</p>}
            {!trendLoading && !trendError && trendBuckets.length > 0 && (
              <>
                {trendData && trendData.coverageStart > trendSince.slice(0, 10) && (
                  <p className={styles.smallNote}>
                    Available filtered history starts {trendData.coverageStart}. Earlier intervals are unavailable, not
                    zero.
                  </p>
                )}
                <div className={styles.activityBars}>
                  {trendBuckets.map((bucket) => (
                    <div
                      key={bucket.key}
                      className={styles.activityBarItem}
                      data-tooltip-id={`forge-dashboard-trend-${bucket.key}`}
                      aria-label={`${bucket.label}: ${bucket.count} tracked events`}
                      tabIndex={0}
                    >
                      <ActivityBarTooltip
                        id={`forge-dashboard-trend-${bucket.key}`}
                        label={bucket.label}
                        eventCounts={bucket.eventCounts}
                        uniqueVisitorCounts={bucket.uniqueVisitorCounts}
                        popularRoute={bucket.popularRoute}
                        rawUniqueAvailable={bucket.rawUniqueAvailable}
                        available={bucket.available}
                      />
                      <span
                        className={`${styles.activityBar} ${bucket.available ? '' : styles.activityBarUnavailable}`}
                        style={{ height: bucket.available ? `${Math.max(4, (bucket.count / maxTrend) * 100)}%` : '0%' }}
                      />
                      <span>{bucket.label}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </SectionCard>

          <div className={styles.dashboardListToolbar}>
            <input
              type="search"
              className={styles.dashboardSearch}
              aria-label="Search dashboard lists"
              placeholder="Search..."
              value={statsSearch}
              onChange={(event) => setStatsSearch(event.target.value)}
            />
            <Button variant="outline" size="sm" disabled={loading || trendLoading} onClick={() => setClock(Date.now())}>
              <ArrowClockwise size={16} />
              {loading || trendLoading ? 'Refreshing...' : 'Refresh data'}
            </Button>
          </div>

          <SectionCard title="Recent visitors" className={`${styles.surfaceCard} ${styles.dashboardRecentVisitors}`}>
            {loading && <p className={styles.smallNote}>Loading visitors...</p>}
            {!loading && visibleVisitors.length === 0 && (
              <p className={styles.smallNote}>
                {searchTerm ? 'No visitors match this search.' : 'No visitors in this period.'}
              </p>
            )}
            <div className={styles.dashboardVisitorList}>
              {visibleVisitors.slice(0, recentVisitorLimit).map((visitor) => (
                <div key={visitor.visitorId} className={styles.dashboardVisitorRow}>
                  <div>
                    <strong>
                      {visitor.countries[0] && (
                        <span className={styles.countryFlag}>{countryFlag(visitor.countries[0])}</span>
                      )}
                      <ForgeAuthorLink
                        id={`dashboard-visitor-${visitor.visitorId}`}
                        authorName={visitor.managerName || 'Anonymous visitor'}
                        userId={visitor.userId}
                        profile={visitor.userId ? visitorProfiles[visitor.userId] : undefined}
                        className={styles.visitorProfileLink}
                      />
                    </strong>
                    {visitor.userId && (
                      <VisitorTournamentLinks tournaments={visitorTournaments[visitor.userId] || []} />
                    )}
                    <small>
                      {visitor.managerName
                        ? `Hattrick ID ${visitor.userId}`
                        : `Visitor ${visitor.visitorId.slice(0, 8)}`}
                      {' · '}
                      {[visitor.platforms.join(', '), visitor.browsers.join(', ')].filter(Boolean).join(' · ') ||
                        'System unknown'}
                    </small>
                  </div>
                  <span>
                    {visitor.visits} {visitor.visits === 1 ? 'page view' : 'page views'}
                  </span>
                  <time>{formatDateTime(visitor.lastSeen)}</time>
                </div>
              ))}
            </div>
            {visibleVisitors.length > recentVisitorLimit && (
              <Button variant="showMore" onClick={() => setRecentVisitorLimit((limit) => limit + 12)}>
                Load 12 more visitors
              </Button>
            )}
          </SectionCard>

          <SectionCard
            title={`Visits · ${FORGE_PERIODS.find((option) => option.value === period)?.label.toLowerCase()}`}
            className={`${styles.surfaceCard} ${styles.dashboardVisits}`}
          >
            {(loading || (searchUserId && searchingVisits)) && <p className={styles.smallNote}>Loading visits...</p>}
            {error && <p className={styles.errorText}>{error}</p>}
            {!loading && !(searchUserId && searchingVisits) && visibleVisits.length === 0 && (
              <p className={styles.smallNote}>
                {searchTerm ? 'No visits match this search.' : 'No visits in this period.'}
              </p>
            )}
            <div className={styles.visitList}>
              {visibleVisits.map((visit) => (
                <ActivityVisitCard
                  key={visit.visitId}
                  visit={{
                    ...visit,
                    managerName: visit.managerName || (visit.userId ? managerNameById.get(visit.userId) || null : null),
                  }}
                />
              ))}
            </div>
            {(searchUserId ? searchedVisitsHaveMore : hasMoreVisits) && (
              <Button variant="showMore" disabled={loadingMore} onClick={() => void loadMoreVisits()}>
                {loadingMore ? 'Loading...' : 'Load 30 more visits'}
              </Button>
            )}
          </SectionCard>

          <SectionCard
            title={`Community activity · ${FORGE_PERIODS.find((option) => option.value === period)?.label.toLowerCase()}`}
            className={`${styles.surfaceCard} ${styles.dashboardActivity}`}
          >
            {loading && <p className={styles.smallNote}>Loading activity...</p>}
            {!loading && visibleFeed.length === 0 && (
              <p className={styles.smallNote}>
                {searchTerm ? 'No community activity matches this search.' : 'No community activity in this period.'}
              </p>
            )}
            <div className={styles.activityFeed}>
              {visibleFeed.map((item) => (
                <article key={item.id} className={styles.activityFeedItem}>
                  <div className={styles.activityFeedHeading}>
                    <strong>{item.title}</strong>
                    <time>{formatDateTime(item.at)}</time>
                  </div>
                  <div className={styles.listTitle}>{item.who}</div>
                  <p className={styles.activityFeedDetails}>{item.details}</p>
                </article>
              ))}
            </div>
          </SectionCard>
        </div>
        <ForgeStatsSidebar
          summary={stats?.summary || null}
          breakdowns={stats?.breakdowns || null}
          period={period}
          onPeriodChange={(nextPeriod) => {
            setPeriod(nextPeriod);
            setRecentVisitorLimit(12);
          }}
          loading={loading}
          chatActivity={chatFeed}
          chatActivityLoading={loading}
          hasMoreChat={hasMoreChat}
          loadingMoreChat={loadingMoreChat}
          onLoadMoreChat={() => void loadMoreChat()}
          latestUsers={latestUsers}
          hasMoreUsers={hasMoreUsers}
          loadingMoreUsers={loadingMoreUsers}
          onLoadMoreUsers={() => void loadMoreUsers()}
          latestTournament={latestTournament}
        />
      </div>
    </section>
  );
}

function ForgeStatsSection() {
  const [period, setPeriod] = useForgePeriod();
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [selectedVisitorId, setSelectedVisitorId] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<'day' | 'week'>('day');
  const [visitorLimit, setVisitorLimit] = useState(30);
  const [userLimit, setUserLimit] = useState(30);
  const [data, setData] = useState<ForgeStatsResponse | null>(null);
  const [visitorProfiles, setVisitorProfiles] = useState<Record<number, ChatAuthorProfile>>({});
  const [visitorTournaments, setVisitorTournaments] = useState<Record<number, VisitorTournament[]>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingMoreActivity, setLoadingMoreActivity] = useState(false);
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);
  const [clock, setClock] = useState<number | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setClock(Date.now()), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const since = getPeriodSince(clock, period);

  useEffect(() => {
    if (!since) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ route: 'forge-stats' });
        params.set('since', since);
        params.set('trendUnit', grouping);
        if (selectedUserId) params.set('userId', String(selectedUserId));
        if (selectedVisitorId) params.set('visitorId', selectedVisitorId);
        const response = await fetch(`/api/app?${params.toString()}`, { credentials: 'include' });
        const next = (await response.json()) as ForgeStatsResponse & { error?: string };
        if (!response.ok) throw new Error(next.error || 'Could not load Forge statistics.');
        const visitorIds = next.visitors.map((visitor) => visitor.userId).filter((id): id is number => id !== null);
        const [profiles, tournaments] = await Promise.all([
          loadAuthorProfiles(visitorIds),
          loadVisitorTournaments(visitorIds),
        ]);
        if (!cancelled) {
          setData(next);
          setVisitorProfiles(profiles);
          setVisitorTournaments(tournaments);
          setCursor(next.nextCursor);
          setActivityCursor(next.nextActivityCursor);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load Forge statistics.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [grouping, selectedUserId, selectedVisitorId, since]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const params = new URLSearchParams({ route: 'forge-stats', cursor });
      params.set('since', since);
      if (selectedUserId) params.set('userId', String(selectedUserId));
      if (selectedVisitorId) params.set('visitorId', selectedVisitorId);
      const response = await fetch(`/api/app?${params.toString()}`, { credentials: 'include' });
      const next = (await response.json()) as ForgeStatsResponse & { error?: string };
      if (!response.ok) throw new Error(next.error || 'Could not load more visits.');
      setData((current) =>
        current
          ? {
              ...current,
              visits: [...current.visits, ...next.visits],
              hasMore: next.hasMore,
              nextCursor: next.nextCursor,
            }
          : next,
      );
      setCursor(next.nextCursor);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load more visits.');
    } finally {
      setLoadingMore(false);
    }
  };

  const loadMoreActivity = async () => {
    if (!activityCursor || loadingMoreActivity) return;
    setLoadingMoreActivity(true);
    setError('');
    try {
      const params = new URLSearchParams({ route: 'forge-stats', since, activityCursor });
      const response = await fetch(`/api/app?${params.toString()}`, { credentials: 'include' });
      const next = (await response.json()) as ForgeStatsResponse & { error?: string };
      if (!response.ok) throw new Error(next.error || 'Could not load more activity.');
      setData((current) =>
        current
          ? {
              ...current,
              recentActivity: [...current.recentActivity, ...next.recentActivity],
              hasMoreActivity: next.hasMoreActivity,
              nextActivityCursor: next.nextActivityCursor,
            }
          : next,
      );
      setActivityCursor(next.nextActivityCursor);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load more activity.');
    } finally {
      setLoadingMoreActivity(false);
    }
  };

  const rawUniqueStart = data?.rawUniqueStart || '';
  const dailyTotals = useMemo(() => {
    const totals = new Map<string, number>();
    const eventBreakdowns = new Map<string, Map<string, number>>();
    const popularRoutes = new Map<string, Map<string, number>>();
    const uniqueTournamentRoutes = new Map<string, Map<string, number>>();
    for (const row of data?.daily || []) {
      if (row.event_type === 'page_exit') continue;
      let key = row.activity_date;
      if (grouping === 'week') {
        const monday = new Date(`${key}T00:00:00Z`);
        monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
        key = monday.toISOString().slice(0, 10);
      }
      totals.set(key, (totals.get(key) || 0) + row.event_count);
      const eventCounts = eventBreakdowns.get(key) || new Map<string, number>();
      eventCounts.set(row.event_type, (eventCounts.get(row.event_type) || 0) + row.event_count);
      eventBreakdowns.set(key, eventCounts);
      const route = row.event_type === 'page_view' ? tournamentActivityRoute(row.route) : null;
      if (route) {
        const routes = popularRoutes.get(key) || new Map<string, number>();
        routes.set(route, (routes.get(route) || 0) + row.event_count);
        popularRoutes.set(key, routes);
      }
    }
    const uniqueBreakdowns = new Map<string, Map<string, number>>();
    for (const row of data?.uniqueVisitors || []) {
      const eventCounts = uniqueBreakdowns.get(row.activity_date) || new Map<string, number>();
      eventCounts.set(row.event_type, row.visitor_count);
      uniqueBreakdowns.set(row.activity_date, eventCounts);
    }
    for (const row of data?.uniqueTournamentViews || []) {
      const routes = uniqueTournamentRoutes.get(row.activity_date) || new Map<string, number>();
      routes.set(row.route, row.visitor_count);
      uniqueTournamentRoutes.set(row.activity_date, routes);
    }
    return Array.from(totals.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, count]) => ({
        key,
        count,
        eventCounts: Object.fromEntries(eventBreakdowns.get(key) || []),
        uniqueVisitorCounts: Object.fromEntries(uniqueBreakdowns.get(key) || []),
        popularRoute: mostViewedTournament(
          popularRoutes.get(key),
          rawUniqueStart && hasFullRawVisitorCoverage(key, rawUniqueStart, grouping)
            ? uniqueTournamentRoutes.get(key)
            : undefined,
        ),
        rawUniqueAvailable: Boolean(rawUniqueStart && hasFullRawVisitorCoverage(key, rawUniqueStart, grouping)),
      }));
  }, [data?.daily, data?.uniqueVisitors, data?.uniqueTournamentViews, grouping, rawUniqueStart]);
  const maxDaily = Math.max(1, ...dailyTotals.map((bucket) => bucket.count));
  const selectedVisitor = data?.visitors.find((visitor) => visitor.visitorId === selectedVisitorId) || null;
  const selectedLabel =
    selectedVisitor?.managerName ||
    (selectedUserId ? data?.users.find((user) => user.userId === selectedUserId)?.managerName : null) ||
    'everyone';
  return (
    <section className={styles.sectionStack}>
      <div className={styles.dashboardHeading}>
        <div>
          <h1 className={styles.pageTitle}>Statistics</h1>
          <p className={styles.smallNote}>Activity, visitors, and journeys. Raw events are retained for 90 days.</p>
        </div>
      </div>
      <div className={styles.analyticsLayout}>
        <div className={styles.analyticsMain}>
          {loading && <p className={styles.smallNote}>Loading statistics...</p>}
          {error && <p className={styles.errorText}>{error}</p>}
          {data && !loading && (
            <>
              <SectionCard title="Activity trends" className={styles.surfaceCard}>
                <div className={styles.statsToolbar}>
                  <label className={styles.testingField}>
                    <span>Trend</span>
                    <select value={grouping} onChange={(event) => setGrouping(event.target.value as 'day' | 'week')}>
                      <option value="day">Daily totals</option>
                      <option value="week">Weekly totals</option>
                    </select>
                  </label>
                  <span className={styles.smallNote}>Localhost traffic and your admin activity are excluded.</span>
                </div>
                <div className={styles.activityBars}>
                  {dailyTotals.length === 0 && <span className={styles.smallNote}>No activity in this period.</span>}
                  {dailyTotals.map((bucket) => (
                    <div
                      key={bucket.key}
                      className={styles.activityBarItem}
                      data-tooltip-id={`forge-stats-trend-${bucket.key}`}
                      aria-label={`${bucket.key}: ${bucket.count} tracked events`}
                      tabIndex={0}
                    >
                      <ActivityBarTooltip
                        id={`forge-stats-trend-${bucket.key}`}
                        label={bucket.key}
                        eventCounts={bucket.eventCounts}
                        uniqueVisitorCounts={bucket.uniqueVisitorCounts}
                        popularRoute={bucket.popularRoute}
                        rawUniqueAvailable={bucket.rawUniqueAvailable}
                      />
                      <span
                        className={styles.activityBar}
                        style={{ height: `${Math.max(4, (bucket.count / maxDaily) * 100)}%` }}
                      />
                      <span>{bucket.key.slice(5)}</span>
                    </div>
                  ))}
                </div>
              </SectionCard>

              <SectionCard title="Recent visitors" className={`${styles.surfaceCard} ${styles.statsUsers}`}>
                <div className={styles.statsHeadingRow}>
                  <p className={styles.smallNote}>Select a visitor to filter their journeys.</p>
                  {(selectedVisitorId || selectedUserId) && (
                    <button
                      type="button"
                      className={styles.clearSelection}
                      onClick={() => {
                        setSelectedVisitorId(null);
                        setSelectedUserId(null);
                      }}
                    >
                      Show everyone
                    </button>
                  )}
                </div>
                {data.visitors.length === 0 ? (
                  <p className={styles.smallNote}>No visitors in this period.</p>
                ) : (
                  <div className={styles.statsTableWrap}>
                    <table className={styles.statsTable}>
                      <thead>
                        <tr>
                          <th>Visitor</th>
                          <th>Page views</th>
                          <th>Country</th>
                          <th>Device</th>
                          <th>Last seen</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.visitors.slice(0, visitorLimit).map((visitor) => (
                          <tr
                            key={visitor.visitorId}
                            className={selectedVisitorId === visitor.visitorId ? styles.selectedRow : ''}
                          >
                            <td>
                              <div className={styles.statsVisitorIdentity}>
                                <span className={styles.visitorName}>
                                  {visitor.countries[0] && (
                                    <span className={styles.countryFlag}>{countryFlag(visitor.countries[0])}</span>
                                  )}
                                  <ForgeAuthorLink
                                    id={`stats-visitor-${visitor.visitorId}`}
                                    authorName={visitor.managerName || 'Anonymous visitor'}
                                    userId={visitor.userId}
                                    profile={visitor.userId ? visitorProfiles[visitor.userId] : undefined}
                                    className={styles.visitorProfileLink}
                                  />
                                </span>
                                {visitor.userId && (
                                  <VisitorTournamentLinks tournaments={visitorTournaments[visitor.userId] || []} />
                                )}
                                <button
                                  type="button"
                                  className={styles.tableButton}
                                  onClick={() => {
                                    setSelectedUserId(null);
                                    setSelectedVisitorId(
                                      selectedVisitorId === visitor.visitorId ? null : visitor.visitorId,
                                    );
                                  }}
                                >
                                  <small>
                                    {visitor.managerName
                                      ? `Hattrick ID ${visitor.userId} · Filter journeys`
                                      : `Visitor ${visitor.visitorId.slice(0, 8)} · Filter journeys`}
                                  </small>
                                </button>
                              </div>
                            </td>
                            <td>{visitor.visits}</td>
                            <td>{visitor.countries.join(', ') || 'Unknown'}</td>
                            <td>
                              {visitor.platforms.join(', ') || 'Unknown'} · {visitor.browsers.join(', ') || 'Unknown'}
                            </td>
                            <td>{formatDateTime(visitor.lastSeen)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {data.visitors.length > visitorLimit && (
                  <Button variant="outline" onClick={() => setVisitorLimit((limit) => limit + 30)}>
                    Load 30 more visitors
                  </Button>
                )}
              </SectionCard>

              <SectionCard title="Identified users" className={`${styles.surfaceCard} ${styles.statsUsers}`}>
                <p className={styles.smallNote}>Select a user to filter their journeys.</p>
                {data.users.length === 0 ? (
                  <p className={styles.smallNote}>No identified users in this period.</p>
                ) : (
                  <div className={styles.statsTableWrap}>
                    <table className={styles.statsTable}>
                      <thead>
                        <tr>
                          <th>Manager</th>
                          <th>Page views</th>
                          <th>Events</th>
                          <th>Tournaments</th>
                          <th>Last seen</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.users.slice(0, userLimit).map((user) => (
                          <tr key={user.userId} className={selectedUserId === user.userId ? styles.selectedRow : ''}>
                            <td>
                              <button
                                type="button"
                                className={styles.tableButton}
                                onClick={() => {
                                  setSelectedVisitorId(null);
                                  setSelectedUserId(selectedUserId === user.userId ? null : user.userId);
                                }}
                              >
                                {user.managerName}
                                <small>ID {user.userId}</small>
                              </button>
                            </td>
                            <td>{user.visits}</td>
                            <td>{user.events}</td>
                            <td>{user.tournaments}</td>
                            <td>{formatDateTime(user.lastSeen)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {data.users.length > userLimit && (
                  <Button variant="outline" onClick={() => setUserLimit((limit) => limit + 30)}>
                    Load 30 more users
                  </Button>
                )}
              </SectionCard>

              <SectionCard
                title={selectedVisitorId || selectedUserId ? `Journey: ${selectedLabel}` : 'Visits and journeys'}
                className={`${styles.surfaceCard} ${styles.statsEvents}`}
              >
                <div className={styles.statsHeadingRow}>
                  {(selectedVisitor || selectedUserId) && (
                    <p className={styles.smallNote}>
                      Nickname is captured from the authenticated Hattrick profile when available.
                    </p>
                  )}
                  {(selectedVisitorId || selectedUserId) && (
                    <button
                      type="button"
                      className={styles.clearSelection}
                      onClick={() => {
                        setSelectedVisitorId(null);
                        setSelectedUserId(null);
                      }}
                    >
                      Show everyone
                    </button>
                  )}
                </div>
                {data.visits.length === 0 ? (
                  <p className={styles.smallNote}>No visits in this period.</p>
                ) : (
                  <div className={styles.visitList}>
                    {data.visits.map((visit) => (
                      <ActivityVisitCard key={visit.visitId} visit={visit} />
                    ))}
                  </div>
                )}
                {data.hasMore && (
                  <Button variant="showMore" disabled={loadingMore} onClick={() => void loadMore()}>
                    {loadingMore ? 'Loading...' : 'Load 30 more visits'}
                  </Button>
                )}
              </SectionCard>

              <SectionCard title="Recent activity" className={`${styles.surfaceCard} ${styles.statsUsers}`}>
                {data.recentActivity.length === 0 ? (
                  <p className={styles.smallNote}>No activity in this period.</p>
                ) : (
                  <div className={styles.activityFeed}>
                    {data.recentActivity.map((event) => (
                      <article key={event.id} className={styles.activityFeedItem}>
                        <div className={styles.activityFeedHeading}>
                          <strong>{activityEventTitle(event)}</strong>
                          <time>{formatDateTime(event.occurred_at)}</time>
                        </div>
                        <div className={styles.listTitle}>
                          {event.resolved_manager_name || event.manager_name || 'Anonymous visitor'}
                        </div>
                        <p className={styles.activityFeedDetails}>{activityEventDetails(event)}</p>
                      </article>
                    ))}
                  </div>
                )}
                {data.hasMoreActivity && (
                  <Button variant="showMore" disabled={loadingMoreActivity} onClick={() => void loadMoreActivity()}>
                    {loadingMoreActivity ? 'Loading...' : 'Load 30 more activities'}
                  </Button>
                )}
              </SectionCard>
            </>
          )}
        </div>
        <ForgeStatsSidebar
          summary={data?.summary || null}
          breakdowns={data?.breakdowns || null}
          period={period}
          onPeriodChange={setPeriod}
          loading={loading}
        />
      </div>
    </section>
  );
}

function cloneFaqSections(sections: FaqSection[]): FaqSection[] {
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) => ({ ...item })),
  }));
}

function escapeTemplateLiteral(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

function tsString(value: string) {
  return JSON.stringify(value);
}

function generateFaqSource(globalPublished: boolean, sections: FaqSection[]) {
  const sectionBlocks = sections
    .map((section) => {
      const sectionProps = [
        `    id: ${tsString(section.id)},`,
        `    title: ${tsString(section.title)},`,
        `    order: ${section.order},`,
        `    published: ${section.published !== false},`,
        `    items: [`,
        ...section.items.flatMap((item) => [
          `      {`,
          `        id: ${tsString(item.id)},`,
          `        question: ${tsString(item.question)},`,
          `        answer: \`${escapeTemplateLiteral(item.answer)}\`,`,
          `        status: ${tsString(item.status)},`,
          `        published: ${item.published !== false},`,
          `      },`,
        ]),
        `    ],`,
      ].filter(Boolean);

      return ['  {', ...sectionProps, '  },'].join('\n');
    })
    .join('\n');

  return `export type FaqItemStatus = 'current' | 'policy' | 'coming-soon';

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  status: FaqItemStatus;
  featured?: boolean;
  published?: boolean;
}

export interface FaqSection {
  id: string;
  title: string;
  description?: string;
  order: number;
  published?: boolean;
  items: FaqItem[];
}

/**
 * HT-120min FAQ content.
 *
 * The structure is deliberately shallow:
 * section -> questions.
 *
 * Answers support Markdown. Keep item IDs stable because they may be used for
 * anchors, deep links and search results.
 */
export const faqPublished = ${globalPublished};

export const faqSections: FaqSection[] = [
${sectionBlocks}
];

export const getPublishedFaqSections = (): FaqSection[] => {
  if (!faqPublished) return [];

  return faqSections
    .filter((section) => section.published !== false)
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.published !== false),
    }))
    .filter((section) => section.items.length > 0);
};

export const featuredFaqItems = getPublishedFaqSections()
  .flatMap((section) => section.items)
  .filter((item) => item.featured);

export const getFaqItemById = (id: string): FaqItem | undefined =>
  getPublishedFaqSections()
    .flatMap((section) => section.items)
    .find((item) => item.id === id);

export const searchFaqItems = (query: string): FaqItem[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) {
    return [];
  }

  return getPublishedFaqSections()
    .flatMap((section) => section.items)
    .filter((item) =>
      \`\${item.question} \${item.answer}\`
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    );
};
`;
}

function getAnswerRows(answer: string) {
  const estimatedRows = answer.split('\n').reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / 92)), 0);
  return Math.max(3, estimatedRows + 1);
}

function getFaqContentSignature(sections: FaqSection[]) {
  return JSON.stringify(
    sections.map((section) => ({
      id: section.id,
      title: section.title,
      items: section.items.map((item) => ({
        id: item.id,
        question: item.question,
        answer: item.answer,
      })),
    })),
  );
}

function ForgeFaqEditor() {
  const [globalPublished, setGlobalPublished] = useState(faqPublished);
  const [draftSections, setDraftSections] = useState<FaqSection[]>(() => cloneFaqSections(faqSections));
  const [savedSections, setSavedSections] = useState<FaqSection[]>(() => cloneFaqSections(faqSections));
  const [exportState, setExportState] = useState<'idle' | 'downloaded' | 'error'>('idle');
  const [expandedItemId, setExpandedItemId] = useState(() => faqSections[0]?.items[0]?.id ?? '');

  const generatedSource = useMemo(
    () => generateFaqSource(globalPublished, draftSections),
    [draftSections, globalPublished],
  );
  const currentContentSignature = useMemo(() => getFaqContentSignature(draftSections), [draftSections]);
  const savedContentSignature = useMemo(() => getFaqContentSignature(savedSections), [savedSections]);
  const fileDirty = currentContentSignature !== savedContentSignature;

  const isItemDirty = (sectionId: string, item: FaqSection['items'][number]) => {
    const savedItem = savedSections
      .find((section) => section.id === sectionId)
      ?.items.find((candidate) => candidate.id === item.id);
    if (!savedItem) return true;
    return savedItem.question !== item.question || savedItem.answer !== item.answer;
  };

  const updateSection = (sectionId: string, update: (section: FaqSection) => FaqSection) => {
    setDraftSections((current) => current.map((section) => (section.id === sectionId ? update(section) : section)));
    setExportState('idle');
  };

  const updateItem = (
    sectionId: string,
    itemId: string,
    update: (item: FaqSection['items'][number]) => FaqSection['items'][number],
  ) => {
    setDraftSections((current) =>
      current.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              items: section.items.map((item) => (item.id === itemId ? update(item) : item)),
            }
          : section,
      ),
    );
    setExportState('idle');
  };

  const restoreItem = (sectionId: string, itemId: string) => {
    const originalItem = savedSections
      .find((section) => section.id === sectionId)
      ?.items.find((item) => item.id === itemId);
    if (!originalItem) return;
    updateItem(sectionId, itemId, () => ({ ...originalItem }));
  };

  const handleReset = () => {
    setGlobalPublished(faqPublished);
    const restored = cloneFaqSections(faqSections);
    setDraftSections(restored);
    setSavedSections(cloneFaqSections(faqSections));
    setExpandedItemId(restored[0]?.items[0]?.id ?? '');
    setExportState('idle');
  };

  const handleDownload = () => {
    try {
      const blob = new Blob([generatedSource], { type: 'text/typescript;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'faq-essential.ts';
      link.click();
      URL.revokeObjectURL(url);
      setSavedSections(cloneFaqSections(draftSections));
      setExportState('downloaded');
    } catch (err) {
      console.error('Failed to generate FAQ file:', err);
      setExportState('error');
    }
  };

  return (
    <section className={`${faqStyles.faqSurface} ${styles.faqPage}`}>
      <div className={faqStyles.faqTop}>
        <div className={faqStyles.faqTitleWrap}>
          <ChatCircleDots size={56} weight="regular" className={faqStyles.faqTitleIcon} />
          <h2 className={faqStyles.faqTitle}>FAQ</h2>
        </div>
        <div className={faqStyles.forgeActions}>
          <button
            type="button"
            className={`${faqStyles.fileButton} ${fileDirty ? faqStyles.buttonDirty : ''}`}
            onClick={handleDownload}
          >
            Save file
          </button>
          <button type="button" className={faqStyles.fileButton} onClick={handleReset}>
            Reset all
          </button>
        </div>
      </div>

      {exportState !== 'idle' && (
        <p className={exportState === 'error' ? styles.errorText : styles.successText}>
          {exportState === 'downloaded' && 'Generated faq-essential.ts download.'}
          {exportState === 'error' && 'Could not generate the FAQ source.'}
        </p>
      )}

      {draftSections.map((section) => (
        <section key={section.id} className={faqStyles.section}>
          <div className={styles.faqSectionHeadingRow}>
            <input
              className={faqStyles.editableSectionTitle}
              value={section.title}
              onChange={(event) => updateSection(section.id, (current) => ({ ...current, title: event.target.value }))}
            />
          </div>

          <div className={faqStyles.items}>
            {section.items.map((item) => {
              const isExpanded = expandedItemId === item.id;
              const itemDirty = isItemDirty(section.id, item);
              return (
                <article key={item.id} className={`${faqStyles.item} ${isExpanded ? faqStyles.itemExpanded : ''}`}>
                  <div className={faqStyles.summary}>
                    <input
                      className={faqStyles.editableQuestion}
                      value={item.question}
                      onChange={(event) =>
                        updateItem(section.id, item.id, (current) => ({ ...current, question: event.target.value }))
                      }
                    />
                    <button
                      type="button"
                      className={faqStyles.chevronButton}
                      onClick={() => setExpandedItemId(isExpanded ? '' : item.id)}
                      aria-label={isExpanded ? `Collapse ${item.question}` : `Expand ${item.question}`}
                    >
                      <CaretDown size={26} weight="bold" className={faqStyles.chevron} />
                    </button>
                  </div>

                  {isExpanded && (
                    <>
                      <textarea
                        className={`${faqStyles.answer} ${faqStyles.editableAnswer}`}
                        value={item.answer}
                        rows={getAnswerRows(item.answer)}
                        onChange={(event) =>
                          updateItem(section.id, item.id, (current) => ({ ...current, answer: event.target.value }))
                        }
                      />

                      <div className={faqStyles.itemActions}>
                        <button
                          type="button"
                          className={`${faqStyles.itemButton} ${itemDirty ? faqStyles.buttonDirty : ''}`}
                          onClick={handleDownload}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className={faqStyles.itemButton}
                          onClick={() => restoreItem(section.id, item.id)}
                        >
                          Cancel
                        </button>
                        <Switch
                          size="sm"
                          checked={item.published !== false}
                          onChange={(checked) =>
                            updateItem(section.id, item.id, (current) => ({ ...current, published: checked }))
                          }
                          label="Published"
                        />
                      </div>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </section>
  );
}

interface ChallengeableDirectoryIssue {
  managerId: number;
  managerName: string;
  reason: string;
}

interface ChallengeableDirectoryProgress {
  scanned: number;
  checkedManagers: number;
  checkedTeams: number;
  skipped: number;
  failed: number;
  unavailableTeams: number;
  managersWithNoTeams: number;
  managersWithoutAvailableTeams: number;
}

interface ChallengeableDirectoryState {
  users: ChallengeableDirectoryUser[];
  issues: ChallengeableDirectoryIssue[];
  cursor: number;
  hasMore: boolean;
  started: boolean;
  scanStartedAt?: string;
  challengeManagerId?: string;
  challengeTeamId?: string;
  progress: ChallengeableDirectoryProgress;
}

const CHALLENGEABLE_DIRECTORY_STORAGE_KEY = 'forge-challengeable-directory';
const EMPTY_CHALLENGEABLE_PROGRESS: ChallengeableDirectoryProgress = {
  scanned: 0,
  checkedManagers: 0,
  checkedTeams: 0,
  skipped: 0,
  failed: 0,
  unavailableTeams: 0,
  managersWithNoTeams: 0,
  managersWithoutAvailableTeams: 0,
};

function readChallengeableDirectoryState(): ChallengeableDirectoryState {
  if (typeof window === 'undefined') {
    return { users: [], issues: [], cursor: 0, hasMore: false, started: false, progress: EMPTY_CHALLENGEABLE_PROGRESS };
  }
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(CHALLENGEABLE_DIRECTORY_STORAGE_KEY) || 'null',
    ) as Partial<ChallengeableDirectoryState> | null;
    if (!parsed || !Array.isArray(parsed.users) || !Number.isSafeInteger(parsed.cursor)) {
      return {
        users: [],
        issues: [],
        cursor: 0,
        hasMore: false,
        started: false,
        progress: EMPTY_CHALLENGEABLE_PROGRESS,
      };
    }
    return {
      users: parsed.users,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      cursor: parsed.cursor || 0,
      hasMore: Boolean(parsed.hasMore),
      started: Boolean(parsed.started),
      scanStartedAt: typeof parsed.scanStartedAt === 'string' ? parsed.scanStartedAt : undefined,
      challengeManagerId: typeof parsed.challengeManagerId === 'string' ? parsed.challengeManagerId : undefined,
      challengeTeamId: typeof parsed.challengeTeamId === 'string' ? parsed.challengeTeamId : undefined,
      progress: { ...EMPTY_CHALLENGEABLE_PROGRESS, ...parsed.progress },
    };
  } catch {
    return { users: [], issues: [], cursor: 0, hasMore: false, started: false, progress: EMPTY_CHALLENGEABLE_PROGRESS };
  }
}

function ForgeTestingSection() {
  const digitsOnly = (value: string) => value.replace(/\D/g, '');
  const [managerId, setManagerId] = useState(() =>
    typeof window !== 'undefined' ? digitsOnly(window.localStorage.getItem('forge_ht_user_id') || '') : '',
  );
  const [teamId, setTeamId] = useState('');
  const [opponentTeamId, setOpponentTeamId] = useState('');
  const [acceptFromTeamId, setAcceptFromTeamId] = useState('');
  const [weekend, setWeekend] = useState(false);
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [directory, setDirectory] = useState(readChallengeableDirectoryState);
  const [directoryTournaments, setDirectoryTournaments] = useState<Record<number, VisitorTournament[]>>({});
  const [directoryRegistrationDates, setDirectoryRegistrationDates] = useState<Record<number, string>>({});
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryRefreshing, setDirectoryRefreshing] = useState(false);
  const [directoryError, setDirectoryError] = useState('');
  const [directoryRefreshSummary, setDirectoryRefreshSummary] = useState('');
  const directoryPauseRequested = useRef(false);
  const directoryCancelRequested = useRef(false);
  const directoryTournamentLookups = useRef(new Set<number>());

  useEffect(() => {
    const managerIds = directory.users
      .map((manager) => manager.managerId)
      .filter((id) => id > 0 && !directoryTournamentLookups.current.has(id));
    if (managerIds.length === 0) return;
    managerIds.forEach((id) => directoryTournamentLookups.current.add(id));
    void Promise.all([loadVisitorTournaments(managerIds), loadManagerRegistrationDates(managerIds)]).then(
      ([tournaments, registrationDates]) => {
        setDirectoryTournaments((current) => ({ ...current, ...tournaments }));
        setDirectoryRegistrationDates((current) => ({ ...current, ...registrationDates }));
      },
    );
  }, [directory.users]);

  useEffect(() => {
    if (!directory.started) return;
    try {
      window.sessionStorage.setItem(CHALLENGEABLE_DIRECTORY_STORAGE_KEY, JSON.stringify(directory));
    } catch {
      // Keep the current scan results usable if session storage is unavailable.
    }
  }, [directory]);

  const clearDirectoryChallengeability = (nextManagerId: string, nextTeamId: string) => {
    setDirectory((current) =>
      current.started
        ? {
            ...current,
            challengeManagerId: nextManagerId,
            challengeTeamId: nextTeamId,
            users: current.users.map((manager) => ({
              ...manager,
              teams: manager.teams.map((candidate) => ({
                ...candidate,
                challengeableMidweek: null,
                challengeableWeekend: null,
              })),
            })),
          }
        : current,
    );
  };

  const runTool = async (tool: string, sideEffect = false) => {
    if (sideEffect) {
      const message =
        tool === 'challenge-accept'
          ? `This will accept a real Hattrick challenge from team ${acceptFromTeamId} for team ${teamId}. Continue?`
          : 'This can send a real Hattrick challenge. Continue?';
      if (!window.confirm(message)) return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ tool, managerId, teamId, opponentTeamId, acceptFromTeamId, format: 'json' });
      if (weekend) params.set('isWeekendFriendly', '1');
      if (sideEffect) params.set('confirm', '1');
      const response = await fetch(`/api/testing?${params.toString()}`, { credentials: 'include' });
      const json = await response.json();
      setOutput(JSON.stringify(json, null, 2));
      if (tool === 'challenge-send' && json.success === true) setAcceptFromTeamId(teamId);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : 'Testing request failed.');
    } finally {
      setLoading(false);
    }
  };

  const scanChallengeableDirectory = async (restart = false) => {
    if (directoryLoading || directoryRefreshing || (directory.started && !directory.hasMore && !restart)) return;
    const shouldRestart = restart || !directory.started;
    let cursor = shouldRestart ? 0 : directory.cursor;
    const scanStartedAt = shouldRestart
      ? new Date().toISOString()
      : directory.scanStartedAt || new Date().toISOString();
    let firstBatch = true;
    if (shouldRestart) {
      directoryTournamentLookups.current.clear();
      setDirectoryTournaments({});
      setDirectoryRegistrationDates({});
      setDirectory({
        users: [],
        issues: [],
        cursor: 0,
        hasMore: true,
        started: true,
        scanStartedAt,
        challengeManagerId: managerId,
        challengeTeamId: teamId,
        progress: EMPTY_CHALLENGEABLE_PROGRESS,
      });
    }
    directoryPauseRequested.current = false;
    directoryCancelRequested.current = false;
    setDirectoryLoading(true);
    setDirectoryError('');
    try {
      while (!directoryPauseRequested.current) {
        const params = new URLSearchParams({
          tool: 'challengeable-directory',
          cursor: String(cursor),
          managerId,
          teamId,
        });
        const response = await fetch(`/api/testing?${params.toString()}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        const payload = (await response.json()) as {
          error?: string;
          users?: ChallengeableDirectoryUser[];
          refreshedManagerIds?: number[];
          scannedManagerIds?: number[];
          issues?: ChallengeableDirectoryIssue[];
          scannedProfiles?: number;
          checkedManagers?: number;
          checkedTeams?: number;
          unavailableCredentials?: number;
          failedChecks?: number;
          unavailableTeams?: number;
          managersWithNoTeams?: number;
          managersWithoutAvailableTeams?: number;
          nextCursor?: number | null;
          hasMore?: boolean;
        };
        if (!response.ok) throw new Error(payload.error || 'Could not scan challengeable teams.');
        const resetProgress = firstBatch && shouldRestart;
        firstBatch = false;
        setDirectory((current) => {
          const scanned = new Set(payload.scannedManagerIds || []);
          const issuesByKey = new Map(
            current.issues
              .filter((issue) => !scanned.has(issue.managerId))
              .map((issue) => [`${issue.managerId}:${issue.reason}`, issue]),
          );
          for (const issue of payload.issues || []) issuesByKey.set(`${issue.managerId}:${issue.reason}`, issue);
          const progress = resetProgress ? EMPTY_CHALLENGEABLE_PROGRESS : current.progress;
          return {
            users: mergeForgeDirectoryUsers(current.users, payload.users || [], payload.refreshedManagerIds || []),
            issues: Array.from(issuesByKey.values()),
            cursor: payload.nextCursor ?? cursor,
            hasMore: directoryCancelRequested.current ? false : Boolean(payload.hasMore),
            started: true,
            scanStartedAt,
            challengeManagerId: managerId,
            challengeTeamId: teamId,
            progress: {
              scanned: progress.scanned + (payload.scannedProfiles || 0),
              checkedManagers: progress.checkedManagers + (payload.checkedManagers || 0),
              checkedTeams: progress.checkedTeams + (payload.checkedTeams || 0),
              skipped: progress.skipped + (payload.unavailableCredentials || 0),
              failed: progress.failed + (payload.failedChecks || 0),
              unavailableTeams: progress.unavailableTeams + (payload.unavailableTeams || 0),
              managersWithNoTeams: progress.managersWithNoTeams + (payload.managersWithNoTeams || 0),
              managersWithoutAvailableTeams:
                progress.managersWithoutAvailableTeams + (payload.managersWithoutAvailableTeams || 0),
            },
          };
        });
        if (
          directoryCancelRequested.current ||
          !payload.hasMore ||
          payload.nextCursor === null ||
          payload.nextCursor === undefined
        )
          break;
        cursor = payload.nextCursor;
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
      }
    } catch (error) {
      setDirectoryError(error instanceof Error ? error.message : 'Could not scan challengeable teams.');
    } finally {
      setDirectoryLoading(false);
    }
  };

  const refreshListedDirectoryTeams = async () => {
    if (directoryLoading || directoryRefreshing) return;
    const teams = directory.users.flatMap((manager) =>
      manager.teams.map((candidate) => ({
        managerId: manager.managerId,
        teamId: candidate.teamId,
      })),
    );
    if (teams.length === 0) return;
    setDirectoryRefreshing(true);
    setDirectoryError('');
    setDirectoryRefreshSummary('');
    try {
      let checkedTeams = 0;
      let unavailableTeams = 0;
      let failedChecks = 0;
      for (let start = 0; start < teams.length; start += 50) {
        const response = await fetch(`/api/testing?tool=challengeable-directory-refresh`, {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teams: teams.slice(start, start + 50), managerId, teamId }),
        });
        const payload = (await response.json()) as {
          error?: string;
          users?: ChallengeableDirectoryUser[];
          refreshedTeamIds?: string[];
          checkedTeams?: number;
          unavailableTeams?: number;
          failedChecks?: number;
          issues?: ChallengeableDirectoryIssue[];
        };
        if (!response.ok) throw new Error(payload.error || 'Could not refresh listed teams.');
        checkedTeams += payload.checkedTeams || 0;
        unavailableTeams += payload.unavailableTeams || 0;
        failedChecks += payload.failedChecks || 0;
        const refreshed = new Set(payload.refreshedTeamIds || []);
        const currentAvailable = new Map(
          (payload.users || []).flatMap((manager) =>
            manager.teams.map((candidate) => [`${manager.managerId}:${candidate.teamId}`, candidate] as const),
          ),
        );
        setDirectory((current) => ({
          ...current,
          users: current.users.map((manager) => {
            const teamsById = new Map(manager.teams.map((candidate) => [candidate.teamId, candidate]));
            for (const key of refreshed) {
              const [ownerId, checkedTeamId] = key.split(':').map(Number);
              if (ownerId !== manager.managerId) continue;
              teamsById.delete(checkedTeamId);
              const updated = currentAvailable.get(key);
              if (updated) teamsById.set(checkedTeamId, updated);
            }
            return { ...manager, teams: [...teamsById.values()] };
          }),
          issues: [...current.issues, ...(payload.issues || [])],
        }));
      }
      setDirectoryRefreshSummary(
        `Rechecked ${checkedTeams} listed teams · ${unavailableTeams} no longer available · ${failedChecks} checks need review`,
      );
    } catch (error) {
      setDirectoryError(error instanceof Error ? error.message : 'Could not refresh listed teams.');
    } finally {
      setDirectoryRefreshing(false);
    }
  };

  const visibleDirectoryUsers = directory.users.filter((manager) => manager.teams.length > 0);

  return (
    <section className={styles.sectionStack}>
      <SectionCard
        title="Testing hub"
        subtitle="Direct CHPP checks for challenge management and friendly booking."
        className={styles.surfaceCard}
      >
        <div className={styles.testingGrid}>
          <label className={styles.testingField}>
            <span>Manager ID</span>
            <input
              type="text"
              inputMode="numeric"
              value={managerId}
              disabled={directoryLoading || directoryRefreshing}
              onChange={(event) => {
                const nextValue = digitsOnly(event.target.value);
                setManagerId(nextValue);
                setOutput('');
                clearDirectoryChallengeability(nextValue, teamId);
              }}
            />
          </label>
          <label className={styles.testingField}>
            <span>My team ID</span>
            <input
              type="text"
              inputMode="numeric"
              value={teamId}
              disabled={directoryLoading || directoryRefreshing}
              onChange={(event) => {
                const nextValue = digitsOnly(event.target.value);
                setTeamId(nextValue);
                setOutput('');
                clearDirectoryChallengeability(managerId, nextValue);
              }}
            />
          </label>
          <label className={styles.testingField}>
            <span>Opponent team ID</span>
            <input
              type="text"
              inputMode="numeric"
              value={opponentTeamId}
              onChange={(event) => {
                setOpponentTeamId(digitsOnly(event.target.value));
                setOutput('');
              }}
            />
          </label>
          {acceptFromTeamId.trim() && (
            <label className={styles.testingField}>
              <span>Accept from team ID</span>
              <input
                type="text"
                inputMode="numeric"
                value={acceptFromTeamId}
                onChange={(event) => setAcceptFromTeamId(digitsOnly(event.target.value))}
              />
            </label>
          )}
        </div>
        <label className={styles.testingCheckbox}>
          <input type="checkbox" checked={weekend} onChange={(event) => setWeekend(event.target.checked)} /> Weekend
          friendly
        </label>
        <div className={styles.editorActions}>
          <Button variant="outline" disabled={loading} onClick={() => void runTool('credentials-check')}>
            Credentials check
          </Button>
          <Button variant="outline" disabled={loading} onClick={() => void runTool('challenges-view')}>
            Challenges view
          </Button>
          <Button variant="outline" disabled={loading} onClick={() => void runTool('challengeable')}>
            Challengeable
          </Button>
          <Button variant="outline" disabled={loading} onClick={() => void runTool('booking-status')}>
            Booking status
          </Button>
          <Button variant="secondaryYellow" disabled={loading} onClick={() => void runTool('challenge-send', true)}>
            Send challenge
          </Button>
          {acceptFromTeamId.trim() && (
            <Button variant="secondaryYellow" disabled={loading} onClick={() => void runTool('challenge-accept', true)}>
              Accept from {acceptFromTeamId.trim()}
            </Button>
          )}
        </div>
        <p className={styles.smallNote}>
          Send and accept have real Hattrick side effects and require confirmation. For acceptance, set Manager ID and
          My team ID to the receiving manager and team. After sending, Accept from is filled with the challenger team
          ID.
        </p>
        {output && <pre className={styles.testingOutput}>{output}</pre>}
      </SectionCard>
      <SectionCard
        title="Friendly availability"
        subtitle="Teams without a booked friendly or cup tie. Challengeability is checked against the selected team above; no challenge is sent."
        className={styles.surfaceCard}
      >
        <p className={styles.smallNote}>
          Enter Manager ID and My team ID above for pair-specific challengeability. Unknown means CHPP did not confirm
          either friendly window.
        </p>
        <div className={styles.editorActions}>
          <Button
            variant="outline"
            disabled={directoryLoading || directoryRefreshing}
            onClick={() => void scanChallengeableDirectory(directory.started && !directory.hasMore)}
          >
            {directoryLoading
              ? 'Scanning users…'
              : !directory.started
                ? 'Start full scan'
                : directory.hasMore
                  ? 'Continue scan'
                  : 'Restart full scan'}
          </Button>
          {directory.started && (
            <Button
              variant="outline"
              disabled={
                directoryLoading ||
                directoryRefreshing ||
                directory.users.every((manager) => manager.teams.length === 0)
              }
              onClick={() => void refreshListedDirectoryTeams()}
            >
              {directoryRefreshing ? 'Refreshing listed teams…' : 'Refresh listed teams'}
            </Button>
          )}
          {(directoryLoading || (directory.started && directory.hasMore)) && (
            <Button
              variant="outline"
              onClick={() => {
                directoryPauseRequested.current = true;
                directoryCancelRequested.current = true;
                setDirectory((current) => ({ ...current, hasMore: false }));
              }}
            >
              Cancel scan
            </Button>
          )}
          {directory.started && (
            <span className={styles.smallNote}>
              Scanned {directory.progress.scanned} users · {directory.progress.checkedManagers} had CHPP access ·{' '}
              {directory.progress.checkedTeams} teams checked · {directory.progress.unavailableTeams} booked, in cup or
              unverified
            </span>
          )}
          {directoryRefreshSummary && <span className={styles.smallNote}>{directoryRefreshSummary}</span>}
        </div>
        {directoryError && <p className={styles.errorText}>{directoryError}</p>}
        {directoryLoading && (
          <p className={styles.smallNote}>
            The next batch starts three seconds after each completed batch. Completed results are saved in this tab’s
            session storage.
          </p>
        )}
        {directory.started && (
          <details className={styles.challengeableScanDetails}>
            <summary>Scan diagnostics</summary>
            <p className={styles.smallNote}>
              {directory.progress.skipped} users lacked stored CHPP credentials · {directory.progress.failed} CHPP or
              team checks failed · {directory.progress.managersWithNoTeams} users had no current teams ·{' '}
              {directory.progress.managersWithoutAvailableTeams} users had no team confirmed unbooked and out of cup
            </p>
            {directory.issues.length > 0 && (
              <ul>
                {directory.issues.slice(0, 30).map((issue) => (
                  <li key={`${issue.managerId}:${issue.reason}`}>
                    {issue.managerName} ·{' '}
                    {issue.managerId > 0 && (
                      <>
                        <a
                          href={`https://www.hattrick.org/goto.ashx?path=/Club/Manager/?userId=${issue.managerId}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {issue.managerId}
                        </a>
                        :{' '}
                      </>
                    )}
                    {issue.reason}
                  </li>
                ))}
              </ul>
            )}
            {directory.issues.length > 30 && <span>Showing first 30 diagnostic entries.</span>}
          </details>
        )}
        {directory.started && visibleDirectoryUsers.length === 0 && !directoryLoading && !directory.hasMore && (
          <p className={styles.smallNote}>No teams confirmed unbooked and out of cup were found.</p>
        )}
        {directory.users.length > 0 && (
          <div className={styles.challengeableDirectory}>
            {visibleDirectoryUsers.map((manager) => (
              <article key={manager.managerId}>
                <h3>{manager.managerName}</h3>
                <a
                  href={`https://www.hattrick.org/goto.ashx?path=/Club/Manager/?userId=${manager.managerId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {manager.managerId}
                </a>
                {formatRegistrationDate(directoryRegistrationDates[manager.managerId]) && (
                  <span className={styles.challengeableManagerRegistrationDate}>
                    Registered {formatRegistrationDate(directoryRegistrationDates[manager.managerId])}
                  </span>
                )}
                {(directoryTournaments[manager.managerId] || []).length > 0 && (
                  <div className={styles.challengeableManagerTournaments}>
                    {(directoryTournaments[manager.managerId] || []).map((tournament) => (
                      <a
                        key={tournament.id}
                        href={`/en/t/${tournament.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {tournament.name}
                      </a>
                    ))}
                  </div>
                )}
                <ul>
                  {manager.teams.map((team) => {
                    const leagueFlagUrl = getLeagueFlagUrl(team.leagueId);
                    const countryFlagUrl = getCountryFlagUrl(team.countryId, team.countryName);
                    const challengeabilityIsCurrent =
                      Boolean(directory.scanStartedAt && team.checkedAt >= directory.scanStartedAt) &&
                      directory.challengeManagerId === managerId &&
                      directory.challengeTeamId === teamId;
                    const challengeable = challengeabilityIsCurrent
                      ? team.challengeableMidweek === true || team.challengeableWeekend === true
                        ? true
                        : team.challengeableMidweek === false && team.challengeableWeekend === false
                          ? false
                          : null
                      : null;
                    const challengeabilityClass =
                      challengeable === true
                        ? styles.challengeableTrue
                        : challengeable === false
                          ? styles.challengeableFalse
                          : styles.challengeableUnknown;

                    return (
                      <li key={team.teamId}>
                        {(leagueFlagUrl || countryFlagUrl) && (
                          <span className={styles.challengeableTeamFlags} aria-hidden="true">
                            {leagueFlagUrl && <img src={leagueFlagUrl} alt="" />}
                            {countryFlagUrl && <img src={countryFlagUrl} alt="" />}
                          </span>
                        )}
                        <strong>{team.teamName}</strong>
                        <a
                          href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${team.teamId}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {team.teamId}
                        </a>
                        <span className={styles.availableTeamStatus}>Not booked / Not in cup</span>
                        <span className={challengeabilityClass}>
                          Challengeable: {challengeable === null ? 'unknown' : String(challengeable)}
                        </span>
                        <span>
                          {team.checkedAt
                            ? `Checked ${new Date(team.checkedAt).toLocaleString()}`
                            : 'Saved result — not yet rechecked'}
                          {team.checkedAt && directory.scanStartedAt && team.checkedAt < directory.scanStartedAt
                            ? ' · Previous scan; not yet refreshed'
                            : ''}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </article>
            ))}
          </div>
        )}
      </SectionCard>
    </section>
  );
}

function ForgeAdminsSection() {
  return (
    <section className={styles.sectionStack}>
      <SectionCard title="Forge access" subtitle="Access is verified on the server." className={styles.surfaceCard}>
        <p className={styles.smallNote}>
          Administrative access is intentionally not listed in the browser. The server verifies every Forge request.
        </p>
      </SectionCard>
    </section>
  );
}

export const ForgePage: React.FC = () => {
  const auth = useForgeAuth();

  if (auth.loading) {
    return <ForgeGate onLogin={auth.login} loading />;
  }

  if (!auth.isAuthorized) {
    return <ForgeGate onLogin={auth.login} />;
  }

  return (
    <ForgeShell
      managerName={auth.managerName || (auth.isDevBypass ? 'Superadmin' : null)}
      onLogin={auth.login}
      onLogoutMain={auth.logoutMain}
      onLogoutForge={auth.role === 'locale-editor' ? auth.logoutLocaleEditor : auth.logoutForge}
      localeEditorOnly={auth.role === 'locale-editor'}
    >
      <Routes>
        {auth.role === 'admin' && (
          <Route index element={<ForgeDashboard adminUserId={auth.userId} adminManagerName={auth.managerName} />} />
        )}
        {auth.role === 'admin' && <Route path="stats" element={<ForgeStatsSection />} />}
        {auth.role === 'admin' && <Route path="surveys" element={<ForgeSurveys />} />}
        {auth.role === 'admin' && <Route path="scheduling" element={<ForgeScheduling />} />}
        {auth.role === 'admin' && <Route path="matches" element={<ForgeMatchesSection />} />}
        {auth.role === 'admin' && <Route path="faq" element={<ForgeFaqEditor />} />}
        <Route path="locales" element={<ForgeLocales isAdmin={auth.role === 'admin'} />} />
        {auth.role === 'admin' && <Route path="leagues" element={<ForgeLeagues />} />}
        {auth.role === 'admin' && <Route path="flag-hunters" element={<FlagHunters />} />}
        {auth.role === 'admin' && <Route path="testing" element={<ForgeTestingSection />} />}
        {auth.role === 'admin' && <Route path="admins" element={<ForgeAdminsSection />} />}
        <Route path="*" element={<Navigate to={auth.role === 'locale-editor' ? '/locales' : '/'} replace />} />
      </Routes>
    </ForgeShell>
  );
};
