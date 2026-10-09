import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import {
  ArrowSquareOut,
  CaretDown,
  ChartLineUp,
  ChatCircleDots,
  Flask,
  House,
  ListBullets,
  SoccerBall,
  Shield,
  SignOut,
  User,
  Users,
} from 'phosphor-react';
import { Button } from '../../components/Button/Button';
import { SectionCard } from '../../components/Card/SectionCard';
import { Switch } from '../../components/Switch/Switch';
import { faqPublished, faqSections, type FaqSection } from '../../constants/faq-essential';
import { supabase } from '../../lib/supabase';
import { useForgeAuth } from '../../hooks/useForgeAuth';
import faqStyles from '../../components/Faq/FaqRenderer.module.sass';
import { HATTRICK_WORLD_DETAILS } from '../../../shared/worlddetails';
import styles from './Forge.module.sass';
import { ForgeMatchesSection } from './ForgeMatches';

interface DashboardUser {
  hattrick_user_id: number;
  manager_name: string;
  created_at: string;
  last_seen_at: string | null;
  country_name: string | null;
}

interface DashboardChat {
  id: string;
  content: string;
  author_name: string;
  author_ht_id: number;
  created_at: string;
  tournament_id: string;
  country_name: string | null;
  tournaments?: { id: string; name: string; slug: string } | null;
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
}

interface ForgeStatsDaily {
  activity_date: string;
  event_type: string;
  route: string;
  event_count: number;
}

interface ForgeStatsResponse {
  summary: { events: number; visits: number; pageViews: number; actions: number; uniqueVisitors: number; identifiedUsers: number };
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
}

type ForgePeriod = '12h' | '24h' | '7d' | '1m' | '3m';

const FORGE_PERIOD_STORAGE_KEY = 'forge-analytics-period';
const FORGE_PERIODS: Array<{ value: ForgePeriod; label: string; durationMs: number }> = [
  { value: '12h', label: 'Last 12 hours', durationMs: 12 * 60 * 60 * 1000 },
  { value: '24h', label: 'Last 24 hours', durationMs: 24 * 60 * 60 * 1000 },
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

const FORGE_TREND_INTERVALS: Array<{ value: ForgeTrendInterval; label: string; shortLabel: string; durationMs: number; unit: ForgeTrendUnit }> = [
  { value: '7d', label: '7 days · daily', shortLabel: '7d', durationMs: 7 * 24 * 60 * 60 * 1000, unit: 'day' },
  { value: '30d', label: '30 days · daily', shortLabel: '30d', durationMs: 30 * 24 * 60 * 60 * 1000, unit: 'day' },
  { value: '3m', label: '3 months · weekly', shortLabel: '3m', durationMs: 90 * 24 * 60 * 60 * 1000, unit: 'week' },
  { value: '1y', label: '1 year · monthly', shortLabel: '1y', durationMs: 365 * 24 * 60 * 60 * 1000, unit: 'month' },
];

interface ForgeTrendResponse {
  daily: ForgeStatsDaily[];
  coverageStart: string;
}

function trendBucketKey(dateValue: string | Date, unit: ForgeTrendUnit) {
  const date = typeof dateValue === 'string' ? new Date(`${dateValue.slice(0, 10)}T00:00:00.000Z`) : new Date(dateValue);
  if (unit === 'month') return date.toISOString().slice(0, 7);
  if (unit === 'week') date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function trendBucketLabel(key: string, unit: ForgeTrendUnit) {
  const date = new Date(`${key}${unit === 'month' ? '-01' : ''}T00:00:00.000Z`);
  if (unit === 'month') return date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  if (unit === 'week') return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', timeZone: 'UTC' });
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
  { to: '/matches', label: 'Match booking', icon: <SoccerBall size={18} weight="bold" /> },
  { to: '/stats', label: 'Statistics', icon: <ChartLineUp size={18} weight="bold" /> },
  { to: '/faq', label: 'FAQ', icon: <ListBullets size={18} weight="bold" /> },
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
  return Object.values(HATTRICK_WORLD_DETAILS).find((entry) =>
    entry.isoCode === normalized
    || entry.countryName?.toUpperCase() === normalized
    || entry.countryNameEn?.toUpperCase() === normalized,
  )?.emoji || '🌐';
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
    messages.push(...rows.slice(0, pageSize).filter((message) =>
      message.author_ht_id !== adminUserId && (!adminManagerName || message.author_name !== adminManagerName),
    ));
    nextOffset += pageSize;
    if (!hasMore) break;
  }
  const authorIds = Array.from(new Set(messages.map((message) => message.author_ht_id).filter((id) => id > 0)));
  const { data: profiles } = authorIds.length > 0
    ? await supabase.from('profiles').select('hattrick_user_id, country_name').in('hattrick_user_id', authorIds)
    : { data: [] };
  const countryByUserId = new Map(
    ((profiles || []) as Array<{ hattrick_user_id: number; country_name: string | null }>)
      .map((profile) => [profile.hattrick_user_id, profile.country_name]),
  );

  return {
    messages: messages.slice(0, pageSize).map((message) => ({
      ...message,
      country_name: countryByUserId.get(message.author_ht_id) || null,
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
          ].filter(Boolean).join(' · ');
          return (
            <div key={`${visit.visitId}:${index}:${page.visitedAt}`} className={styles.visitPage}>
              <div>
                <div className={styles.visitRoute}>{href ? page.route : 'Unknown page'}</div>
                <div className={styles.listMeta}>{details || 'Page details unavailable'}</div>
              </div>
              {href && (
                <a className={styles.openVisitLink} href={href} target="_blank" rel="noopener noreferrer" aria-label={`Open ${page.route}`}>
                  <ArrowSquareOut size={17} weight="bold" />
                </a>
              )}
            </div>
          );
        })}
        {visit.pages.length === 0 && <div className={styles.listMeta}>No page views were recorded for this visit.</div>}
      </div>
      <div className={styles.visitFooter}>
        <span>{visit.pages.length} page {visit.pages.length === 1 ? 'view' : 'views'}</span>
        <span>{visit.actions.length} {visit.actions.length === 1 ? 'action' : 'actions'}</span>
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
}: {
  summary: ForgeStatsResponse['summary'] | null;
  breakdowns: ForgeStatsResponse['breakdowns'] | null;
  period: ForgePeriod;
  onPeriodChange: (period: ForgePeriod) => void;
  loading: boolean;
  chatActivity?: Array<{ id: string; at: string; title: string; who: string; details: string; href?: string; countryName?: string | null }>;
  chatActivityLoading?: boolean;
  hasMoreChat?: boolean;
  loadingMoreChat?: boolean;
  onLoadMoreChat?: () => void;
}) {
  return (
    <aside className={styles.statsSidebar}>
      <select
        className={styles.statsPeriodSelect}
        aria-label="Analytics period"
        value={period}
        onChange={(event) => onPeriodChange(event.target.value as ForgePeriod)}
      >
        {FORGE_PERIODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
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
            <span className={styles.metricValue}>{loading && metric.value === undefined ? '—' : metric.value ?? 0}</span>
          </div>
        ))}
      </div>

      {chatActivity && (
        <SectionCard
          title={`Chat · ${FORGE_PERIODS.find((option) => option.value === period)?.label.toLowerCase()}`}
          subtitle="Recent tournament chat messages."
          className={`${styles.surfaceCard} ${styles.dashboardActivity}`}
        >
          {chatActivityLoading && <p className={styles.smallNote}>Loading chat...</p>}
          {!chatActivityLoading && chatActivity.length === 0 && <p className={styles.smallNote}>No chat in this period.</p>}
          <div className={styles.activityFeed}>
            {chatActivity.map((item) => (
              <article key={item.id} className={styles.activityFeedItem}>
                <div className={styles.activityFeedHeading}>
                  <strong>{item.title}</strong>
                  <time>{formatDateTime(item.at)}</time>
                </div>
                <div className={styles.listTitle}>{item.who}</div>
                <p className={styles.activityFeedDetails}>{item.details}</p>
                {item.href && (
                  <a href={item.href} target="_blank" rel="noopener noreferrer" className={styles.chatTournamentLink}>
                    {item.countryName ? `${countryFlag(item.countryName)} · ` : ''}{item.href}
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

      {statsBreakdownCards.map((card) => {
        const rows = breakdowns?.[card.key] || [];
        return (
          <SectionCard key={card.key} title={card.title} className={`${styles.surfaceCard} ${styles.statsSidebarBreakdown}`}>
            {rows.length === 0 ? <p className={styles.smallNote}>{loading ? 'Loading…' : 'No data yet.'}</p> : (
              <div className={styles.breakdownList}>
                {rows.map((row) => (
                  <div key={row.value} className={styles.breakdownRow}>
                    <span className={styles.breakdownName}>
                      {card.flags && <span className={styles.countryFlag}>{countryFlag(row.value)}</span>}
                      {row.value}
                    </span>
                    <span className={styles.breakdownCount}>{row.count}</span>
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
              <Shield size={18} weight="bold" />
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
          <Shield size={26} weight="bold" />
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
                    <Shield size={18} />
                    Re-authenticate
                  </button>
                </div>
              )}
            </>
          ) : (
            <Button variant="secondaryYellow" size="sm" onClick={onLogin}>
              <Shield size={18} weight="bold" />
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
}: {
  children: React.ReactNode;
  managerName: string | null;
  onLogoutMain: () => void;
  onLogoutForge: () => void;
  onLogin: () => void;
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
          {sidebarItems.map((item) => (
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

function ForgeDashboard({ adminUserId, adminManagerName }: { adminUserId: number | null; adminManagerName: string | null }) {
  const [period, setPeriod] = useForgePeriod();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [latestUsers, setLatestUsers] = useState<DashboardUser[]>([]);
  const [latestChat, setLatestChat] = useState<DashboardChat[]>([]);
  const [chatOffset, setChatOffset] = useState(0);
  const [hasMoreChat, setHasMoreChat] = useState(false);
  const [loadingMoreChat, setLoadingMoreChat] = useState(false);
  const [stats, setStats] = useState<ForgeStatsResponse | null>(null);
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
  const trendConfig = FORGE_TREND_INTERVALS.find((option) => option.value === trendInterval) || FORGE_TREND_INTERVALS[0];
  const trendSince = getTrendSince(clock, trendInterval);

  useEffect(() => {
    if (!trendSince) return;
    let cancelled = false;
    const load = async () => {
      setTrendLoading(true);
      setTrendError('');
      try {
        const params = new URLSearchParams({ route: 'forge-stats', trend: '1', since: trendSince });
        const response = await fetch(`/api/app?${params.toString()}`, { credentials: 'include' });
        const payload = (await response.json()) as ForgeTrendResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || 'Could not load activity trend.');
        if (!cancelled) setTrendData(payload);
      } catch (loadError) {
        if (!cancelled) setTrendError(loadError instanceof Error ? loadError.message : 'Could not load activity trend.');
      } finally {
        if (!cancelled) setTrendLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [trendSince]);

  useEffect(() => {
    if (!since) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      const [usersRes, chatPage, statsRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('hattrick_user_id, manager_name, created_at, last_seen_at, country_name')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(30),
        loadDashboardChatPage(since, 0, adminUserId, adminManagerName),
        fetch(`/api/app?route=forge-stats&since=${encodeURIComponent(since)}`, { credentials: 'include' }),
      ]);
      try {
        const payload = (await statsRes.json()) as ForgeStatsResponse & { error?: string };
        if (!statsRes.ok) throw new Error(payload.error || 'Could not load recent visits.');
        if (cancelled) return;
        setStats(payload);
        setVisitCursor(payload.nextCursor);
        setHasMoreVisits(payload.hasMore);
        setLatestChat(chatPage.messages);
        setChatOffset(chatPage.nextOffset);
        setHasMoreChat(chatPage.hasMore);
        const profiles = (usersRes.data as DashboardUser[] | null) || [];
        setLatestUsers(profiles.filter((user) => user.hattrick_user_id !== adminUserId));
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load dashboard activity.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [adminManagerName, adminUserId, since]);

  const loadMoreVisits = async () => {
    if (!visitCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ route: 'forge-stats', since, cursor: visitCursor });
      const response = await fetch(`/api/app?${params.toString()}`, { credentials: 'include' });
      const payload = (await response.json()) as ForgeStatsResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Could not load more visits.');
      setStats((current) => current ? { ...current, visits: [...current.visits, ...payload.visits] } : payload);
      setVisitCursor(payload.nextCursor);
      setHasMoreVisits(payload.hasMore);
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
    for (const row of trendData?.daily || []) {
      const key = trendBucketKey(row.activity_date, trendConfig.unit);
      counts.set(key, (counts.get(key) || 0) + row.event_count);
    }
    const coverageKey = trendData ? trendBucketKey(trendData.coverageStart, trendConfig.unit) : '';
    return keys.map((key) => ({
      key,
      label: trendBucketLabel(key, trendConfig.unit),
      count: counts.get(key) || 0,
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
        details: [user.country_name, arrival?.referrer ? `From ${arrival.referrer}` : 'Arrival source unavailable'].filter(Boolean).join(' · '),
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
    return items.sort((left, right) => right.at.localeCompare(left.at)).slice(0, 30);
  }, [latestUsers, stats?.recentActivity]);

  const chatFeed = useMemo(() => latestChat.map((message) => {
    const tournament = message.tournaments;
    return {
      id: message.id,
      at: message.created_at,
      title: `Chat – ${tournament?.name || 'Tournament'}`,
      who: message.author_name,
      details: message.content,
      href: tournament ? `/en/t/${tournament.slug}?tab=news` : undefined,
      countryName: message.country_name,
    };
  }), [latestChat]);

  return (
    <section className={styles.sectionStack}>
      <div className={styles.dashboardHeading}>
        <div>
          <h1 className={styles.pageTitle}>Dashboard</h1>
          <p className={styles.smallNote}>Visitor journeys and community activity, with your own admin traffic excluded.</p>
        </div>
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
                    Available filtered history starts {trendData.coverageStart}. Earlier intervals are unavailable, not zero.
                  </p>
                )}
                <div className={styles.activityBars}>
                  {trendBuckets.map((bucket) => (
                    <div key={bucket.key} className={styles.activityBarItem} title={bucket.available ? `${bucket.label}: ${bucket.count} events` : `${bucket.label}: history unavailable`}>
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

          <SectionCard title="Recent visitors" subtitle="Most recently active in the selected period." className={`${styles.surfaceCard} ${styles.dashboardRecentVisitors}`}>
            {loading && <p className={styles.smallNote}>Loading visitors...</p>}
            {!loading && stats?.visitors.length === 0 && <p className={styles.smallNote}>No visitors in this period.</p>}
            <div className={styles.dashboardVisitorList}>
              {stats?.visitors.slice(0, recentVisitorLimit).map((visitor) => (
                <div key={visitor.visitorId} className={styles.dashboardVisitorRow}>
                  <div>
                    <strong>
                      {visitor.countries[0] && <span className={styles.countryFlag}>{countryFlag(visitor.countries[0])}</span>}
                      {visitor.managerName || 'Anonymous visitor'}
                    </strong>
                    <small>
                      {visitor.managerName ? `Hattrick ID ${visitor.userId}` : `Visitor ${visitor.visitorId.slice(0, 8)}`}
                      {' · '}{[visitor.platforms.join(', '), visitor.browsers.join(', ')].filter(Boolean).join(' · ') || 'System unknown'}
                    </small>
                  </div>
                  <span>{visitor.visits} {visitor.visits === 1 ? 'page view' : 'page views'}</span>
                  <time>{formatDateTime(visitor.lastSeen)}</time>
                </div>
              ))}
            </div>
            {(stats?.visitors.length || 0) > recentVisitorLimit && (
              <Button variant="outline" onClick={() => setRecentVisitorLimit((limit) => limit + 12)}>Load 12 more visitors</Button>
            )}
          </SectionCard>

          <SectionCard title={`Visits · ${FORGE_PERIODS.find((option) => option.value === period)?.label.toLowerCase()}`} subtitle="Open a page in a new tab to inspect it. Your admin browsing is excluded." className={`${styles.surfaceCard} ${styles.dashboardVisits}`}>
            {loading && <p className={styles.smallNote}>Loading visits...</p>}
            {error && <p className={styles.errorText}>{error}</p>}
            {!loading && stats?.visits.length === 0 && <p className={styles.smallNote}>No visits in this period.</p>}
            <div className={styles.visitList}>
              {stats?.visits.map((visit) => <ActivityVisitCard key={visit.visitId} visit={visit} />)}
            </div>
            {hasMoreVisits && (
              <Button variant="outline" disabled={loadingMore} onClick={() => void loadMoreVisits()}>
                {loadingMore ? 'Loading...' : 'Load 30 more visits'}
              </Button>
            )}
          </SectionCard>

          <SectionCard title={`Community activity · ${FORGE_PERIODS.find((option) => option.value === period)?.label.toLowerCase()}`} className={`${styles.surfaceCard} ${styles.dashboardActivity}`}>
            {loading && <p className={styles.smallNote}>Loading activity...</p>}
            {!loading && feed.length === 0 && <p className={styles.smallNote}>No community activity in this period.</p>}
            <div className={styles.activityFeed}>
              {feed.map((item) => (
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
        if (selectedUserId) params.set('userId', String(selectedUserId));
        if (selectedVisitorId) params.set('visitorId', selectedVisitorId);
        const response = await fetch(`/api/app?${params.toString()}`, { credentials: 'include' });
        const next = (await response.json()) as ForgeStatsResponse & { error?: string };
        if (!response.ok) throw new Error(next.error || 'Could not load Forge statistics.');
        if (!cancelled) {
          setData(next);
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
  }, [selectedUserId, selectedVisitorId, since]);

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
      setData((current) => current ? {
        ...current,
        visits: [...current.visits, ...next.visits],
        hasMore: next.hasMore,
        nextCursor: next.nextCursor,
      } : next);
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
      setData((current) => current ? {
        ...current,
        recentActivity: [...current.recentActivity, ...next.recentActivity],
        hasMoreActivity: next.hasMoreActivity,
        nextActivityCursor: next.nextActivityCursor,
      } : next);
      setActivityCursor(next.nextActivityCursor);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load more activity.');
    } finally {
      setLoadingMoreActivity(false);
    }
  };

  const dailyTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of data?.daily || []) {
      let key = row.activity_date;
      if (grouping === 'week') {
        const monday = new Date(`${key}T00:00:00Z`);
        monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
        key = monday.toISOString().slice(0, 10);
      }
      totals.set(key, (totals.get(key) || 0) + row.event_count);
    }
    return Array.from(totals.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [data?.daily, grouping]);
  const maxDaily = Math.max(1, ...dailyTotals.map(([, count]) => count));
  const selectedVisitor = data?.visitors.find((visitor) => visitor.visitorId === selectedVisitorId) || null;
  const selectedLabel = selectedVisitor?.managerName
    || (selectedUserId ? data?.users.find((user) => user.userId === selectedUserId)?.managerName : null)
    || 'everyone';
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
                  {dailyTotals.map(([date, count]) => (
                    <div key={date} className={styles.activityBarItem} title={`${date}: ${count} events`}>
                      <span className={styles.activityBar} style={{ height: `${Math.max(4, (count / maxDaily) * 100)}%` }} />
                      <span>{date.slice(5)}</span>
                    </div>
                  ))}
                </div>
              </SectionCard>

              <SectionCard title="Recent visitors" className={`${styles.surfaceCard} ${styles.statsUsers}`}>
                <div className={styles.statsHeadingRow}>
                  <p className={styles.smallNote}>Select a visitor to filter their journeys.</p>
                  {(selectedVisitorId || selectedUserId) && (
                    <button type="button" className={styles.clearSelection} onClick={() => {
                      setSelectedVisitorId(null);
                      setSelectedUserId(null);
                    }}>Show everyone</button>
                  )}
                </div>
                {data.visitors.length === 0 ? <p className={styles.smallNote}>No visitors in this period.</p> : (
                  <div className={styles.statsTableWrap}>
                    <table className={styles.statsTable}>
                      <thead><tr><th>Visitor</th><th>Page views</th><th>Country</th><th>Device</th><th>Last seen</th></tr></thead>
                      <tbody>
                        {data.visitors.slice(0, visitorLimit).map((visitor) => (
                          <tr key={visitor.visitorId} className={selectedVisitorId === visitor.visitorId ? styles.selectedRow : ''}>
                            <td>
                              <button type="button" className={styles.tableButton} onClick={() => {
                                setSelectedUserId(null);
                                setSelectedVisitorId(selectedVisitorId === visitor.visitorId ? null : visitor.visitorId);
                              }}>
                                <span className={styles.visitorName}>
                                  {visitor.countries[0] && <span className={styles.countryFlag}>{countryFlag(visitor.countries[0])}</span>}
                                  {visitor.managerName || 'Anonymous visitor'}
                                </span>
                                <small>{visitor.managerName ? `Hattrick ID ${visitor.userId}` : `Visitor ${visitor.visitorId.slice(0, 8)}`}</small>
                              </button>
                            </td>
                            <td>{visitor.visits}</td>
                            <td>{visitor.countries.join(', ') || 'Unknown'}</td>
                            <td>{visitor.platforms.join(', ') || 'Unknown'} · {visitor.browsers.join(', ') || 'Unknown'}</td>
                            <td>{formatDateTime(visitor.lastSeen)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {data.visitors.length > visitorLimit && (
                  <Button variant="outline" onClick={() => setVisitorLimit((limit) => limit + 30)}>Load 30 more visitors</Button>
                )}
              </SectionCard>

              <SectionCard title="Identified users" className={`${styles.surfaceCard} ${styles.statsUsers}`}>
                <p className={styles.smallNote}>Select a user to filter their journeys.</p>
                {data.users.length === 0 ? <p className={styles.smallNote}>No identified users in this period.</p> : (
                  <div className={styles.statsTableWrap}>
                    <table className={styles.statsTable}>
                      <thead><tr><th>Manager</th><th>Page views</th><th>Events</th><th>Tournaments</th><th>Last seen</th></tr></thead>
                      <tbody>
                        {data.users.slice(0, userLimit).map((user) => (
                          <tr key={user.userId} className={selectedUserId === user.userId ? styles.selectedRow : ''}>
                            <td><button type="button" className={styles.tableButton} onClick={() => {
                              setSelectedVisitorId(null);
                              setSelectedUserId(selectedUserId === user.userId ? null : user.userId);
                            }}>{user.managerName}<small>ID {user.userId}</small></button></td>
                            <td>{user.visits}</td><td>{user.events}</td><td>{user.tournaments}</td><td>{formatDateTime(user.lastSeen)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {data.users.length > userLimit && (
                  <Button variant="outline" onClick={() => setUserLimit((limit) => limit + 30)}>Load 30 more users</Button>
                )}
              </SectionCard>

              <SectionCard title={selectedVisitorId || selectedUserId ? `Journey: ${selectedLabel}` : 'Visits and journeys'} className={`${styles.surfaceCard} ${styles.statsEvents}`}>
                <div className={styles.statsHeadingRow}>
                  {(selectedVisitor || selectedUserId) && <p className={styles.smallNote}>Nickname is captured from the authenticated Hattrick profile when available.</p>}
                  {(selectedVisitorId || selectedUserId) && (
                    <button type="button" className={styles.clearSelection} onClick={() => {
                      setSelectedVisitorId(null);
                      setSelectedUserId(null);
                    }}>Show everyone</button>
                  )}
                </div>
                {data.visits.length === 0 ? <p className={styles.smallNote}>No visits in this period.</p> : (
                  <div className={styles.visitList}>
                    {data.visits.map((visit) => <ActivityVisitCard key={visit.visitId} visit={visit} />)}
                  </div>
                )}
                {data.hasMore && (
                  <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
                    {loadingMore ? 'Loading...' : 'Load 30 more visits'}
                  </Button>
                )}
              </SectionCard>

              <SectionCard title="Recent activity" className={`${styles.surfaceCard} ${styles.statsUsers}`}>
                {data.recentActivity.length === 0 ? <p className={styles.smallNote}>No activity in this period.</p> : (
                  <div className={styles.activityFeed}>
                    {data.recentActivity.map((event) => (
                      <article key={event.id} className={styles.activityFeedItem}>
                        <div className={styles.activityFeedHeading}>
                          <strong>{activityEventTitle(event)}</strong>
                          <time>{formatDateTime(event.occurred_at)}</time>
                        </div>
                        <div className={styles.listTitle}>{event.resolved_manager_name || event.manager_name || 'Anonymous visitor'}</div>
                        <p className={styles.activityFeedDetails}>{activityEventDetails(event)}</p>
                      </article>
                    ))}
                  </div>
                )}
                {data.hasMoreActivity && (
                  <Button variant="outline" disabled={loadingMoreActivity} onClick={() => void loadMoreActivity()}>
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

function ForgeTestingSection() {
  const [managerId, setManagerId] = useState(() => (typeof window !== 'undefined' ? window.localStorage.getItem('forge_ht_user_id') || '' : ''));
  const [teamId, setTeamId] = useState('');
  const [opponentTeamId, setOpponentTeamId] = useState('');
  const [weekend, setWeekend] = useState(false);
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);

  const runTool = async (tool: string, sideEffect = false) => {
    if (sideEffect && !window.confirm('This can send a real Hattrick challenge. Continue?')) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ tool, managerId, teamId, opponentTeamId, format: 'json' });
      if (weekend) params.set('isWeekendFriendly', '1');
      if (sideEffect) params.set('confirm', '1');
      const response = await fetch(`/api/testing?${params.toString()}`, { credentials: 'include' });
      const json = await response.json();
      setOutput(JSON.stringify(json, null, 2));
    } catch (error) {
      setOutput(error instanceof Error ? error.message : 'Testing request failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={styles.sectionStack}>
      <SectionCard
        title="Testing hub"
        subtitle="Direct CHPP checks for challenge management and friendly booking."
        className={styles.surfaceCard}
      >
        <div className={styles.testingGrid}>
          <label className={styles.testingField}><span>Manager ID</span><input value={managerId} onChange={(event) => setManagerId(event.target.value)} /></label>
          <label className={styles.testingField}><span>My team ID</span><input value={teamId} onChange={(event) => setTeamId(event.target.value)} /></label>
          <label className={styles.testingField}><span>Opponent team ID</span><input value={opponentTeamId} onChange={(event) => setOpponentTeamId(event.target.value)} /></label>
        </div>
        <label className={styles.testingCheckbox}><input type="checkbox" checked={weekend} onChange={(event) => setWeekend(event.target.checked)} /> Weekend friendly</label>
        <div className={styles.editorActions}>
          <Button variant="outline" disabled={loading} onClick={() => void runTool('credentials-check')}>Credentials check</Button>
          <Button variant="outline" disabled={loading} onClick={() => void runTool('challenges-view')}>Challenges view</Button>
          <Button variant="outline" disabled={loading} onClick={() => void runTool('challengeable')}>Challengeable</Button>
          <Button variant="outline" disabled={loading} onClick={() => void runTool('challenges-compare')}>Compare variants</Button>
          <Button variant="outline" disabled={loading} onClick={() => void runTool('booking-status')}>Booking status</Button>
          <Button variant="secondaryYellow" disabled={loading} onClick={() => void runTool('challenge-send', true)}>Send challenge</Button>
        </div>
        <p className={styles.smallNote}>Challenge send has a real Hattrick side effect and is never run without confirmation.</p>
        {output && <pre className={styles.testingOutput}>{output}</pre>}
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
      onLogoutForge={auth.logoutForge}
    >
      <Routes>
        <Route index element={<ForgeDashboard adminUserId={auth.userId} adminManagerName={auth.managerName} />} />
        <Route path="stats" element={<ForgeStatsSection />} />
        <Route path="matches" element={<ForgeMatchesSection />} />
        <Route path="faq" element={<ForgeFaqEditor />} />
        <Route path="testing" element={<ForgeTestingSection />} />
        <Route path="admins" element={<ForgeAdminsSection />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ForgeShell>
  );
};
