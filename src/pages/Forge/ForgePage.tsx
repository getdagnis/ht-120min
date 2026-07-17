import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import {
  CaretDown,
  ChartLineUp,
  ChatCircleDots,
  Flask,
  House,
  ListBullets,
  Shield,
  SignOut,
  User,
  Users,
} from 'phosphor-react';
import { Button } from '../../components/Button/Button';
import { SectionCard } from '../../components/Card/SectionCard';
import { Switch } from '../../components/Switch/Switch';
import { faqPublished, faqSections, type FaqSection } from '../../constants/faq-essential';
import { siteAdminRules } from '../../constants/site-admins';
import { supabase } from '../../lib/supabase';
import { useForgeAuth } from '../../hooks/useForgeAuth';
import faqStyles from '../../components/Faq/FaqRenderer.module.sass';
import { HATTRICK_WORLD_DETAILS } from '../../../shared/worlddetails';
import styles from './Forge.module.sass';

interface DashboardUser {
  hattrick_user_id: number;
  manager_name: string;
  created_at: string;
  last_seen_at: string | null;
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
  created_at: string;
  tournament_id: string;
  tournaments?: { id: string; name: string; slug: string } | null;
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
  summary: { events: number; visits: number; actions: number; uniqueVisitors: number; identifiedUsers: number };
  users: ForgeStatsUser[];
  visitors: ForgeStatsVisitor[];
  events: ForgeStatsEvent[];
  breakdowns: Record<string, ForgeStatsBreakdown[]>;
  daily: ForgeStatsDaily[];
}

const sidebarItems = [
  { to: '/forge', label: 'Dashboard', icon: <House size={18} weight="bold" /> },
  { to: '/forge/stats', label: 'Statistics', icon: <ChartLineUp size={18} weight="bold" /> },
  { to: '/forge/faq', label: 'FAQ', icon: <ListBullets size={18} weight="bold" /> },
  { to: '/forge/testing', label: 'Testing', icon: <Flask size={18} weight="bold" /> },
  { to: '/forge/admins', label: 'Admins', icon: <Users size={18} weight="bold" /> },
];

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('lv-LV', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function countryFlag(countryCode: string) {
  const normalized = countryCode.toUpperCase();
  return Object.values(HATTRICK_WORLD_DETAILS).find((entry) => entry.isoCode === normalized)?.emoji || '🌐';
}

function eventMetadataSummary(event: ForgeStatsEvent) {
  const metadata = event.metadata || {};
  const details: string[] = [];
  if (typeof metadata.control === 'string') details.push(`Control: ${metadata.control}`);
  if (typeof metadata.value === 'string' || typeof metadata.value === 'boolean') details.push(`Value: ${String(metadata.value)}`);
  if (typeof metadata.depth === 'number') details.push(`Scroll: ${metadata.depth}%`);
  if (typeof metadata.maxScrollPercent === 'number') details.push(`Max scroll: ${metadata.maxScrollPercent}%`);
  if (typeof metadata.durationSeconds === 'number') details.push(`Time: ${metadata.durationSeconds}s`);
  if (typeof metadata.reason === 'string') details.push(`Exit: ${metadata.reason}`);
  if (typeof metadata.theme === 'string') details.push(`Theme: ${metadata.theme}`);
  if (typeof metadata.viewport === 'string') details.push(`Viewport: ${metadata.viewport}`);
  return details.join(' · ');
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
        <Link to="/forge" className={styles.brand}>
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
              end={item.to === '/forge'}
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

function ForgeDashboard() {
  const [loading, setLoading] = useState(true);
  const [totalRegistered, setTotalRegistered] = useState(0);
  const [latestUsers, setLatestUsers] = useState<DashboardUser[]>([]);
  const [latestChat, setLatestChat] = useState<DashboardChat[]>([]);
  const [latestTournaments, setLatestTournaments] = useState<DashboardTournament[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const [countRes, usersRes, chatRes, tournamentRes] = await Promise.all([
        supabase.from('profiles').select('hattrick_user_id', { count: 'exact', head: true }),
        supabase
          .from('profiles')
          .select('hattrick_user_id, manager_name, created_at, last_seen_at')
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('tournament_chat')
          .select('id, content, author_name, created_at, tournament_id, tournaments (id, name, slug)')
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('tournaments')
          .select('id, name, slug, created_at')
          .order('created_at', { ascending: false })
          .limit(5),
      ]);

      if (cancelled) return;

      setTotalRegistered(countRes.count ?? 0);
      setLatestUsers((usersRes.data as DashboardUser[] | null) ?? []);
      setLatestChat((chatRes.data as DashboardChat[] | null) ?? []);
      setLatestTournaments((tournamentRes.data as DashboardTournament[] | null) ?? []);
      setLoading(false);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className={styles.sectionStack}>
      <SectionCard title="Dashboard" subtitle="Quick status and recent activity." className={styles.surfaceCard}>
        {loading ? (
          <p className={styles.smallNote}>Loading dashboard data...</p>
        ) : (
          <div className={styles.dashboardGrid}>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Total registered</span>
              <span className={styles.metricValue}>{totalRegistered}</span>
            </div>

            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Latest registered</span>
              <div className={styles.list}>
                {latestUsers.map((user) => (
                  <div key={user.hattrick_user_id} className={styles.listRow}>
                    <div>
                      <div className={styles.listTitle}>{user.manager_name}</div>
                      <div className={styles.listMeta}>ID {user.hattrick_user_id}</div>
                    </div>
                    <div className={styles.listMeta}>{formatDateTime(user.created_at)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Latest chat activity</span>
              <div className={styles.list}>
                {latestChat.map((message) => {
                  const tournament = message.tournaments;
                  return (
                    <div key={message.id} className={styles.listRow}>
                      <div>
                        <div className={styles.listTitle}>{message.author_name}</div>
                        <div className={styles.listMeta}>{message.content}</div>
                        {tournament && (
                          <Link to={`/t/${tournament.slug}?tab=news`} className={styles.inlineLink}>
                            {tournament.name} chat
                          </Link>
                        )}
                      </div>
                      <div className={styles.listMeta}>{formatDateTime(message.created_at)}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Latest tournaments</span>
              <div className={styles.list}>
                {latestTournaments.map((tournament) => (
                  <div key={tournament.id} className={styles.listRow}>
                    <div>
                      <Link to={`/t/${tournament.slug}`} className={styles.inlineLink}>
                        {tournament.name}
                      </Link>
                      <div className={styles.listMeta}>Created {formatDateTime(tournament.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </SectionCard>
    </section>
  );
}

function ForgeStatsSection() {
  const [days, setDays] = useState('30');
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [selectedVisitorId, setSelectedVisitorId] = useState<string | null>(null);
  const [data, setData] = useState<ForgeStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({
          route: 'forge-stats',
          since: new Date(Date.now() - Number(days) * 86400000).toISOString(),
        });
        if (selectedUserId) params.set('userId', String(selectedUserId));
        if (selectedVisitorId) params.set('visitorId', selectedVisitorId);
        const response = await fetch(`/api/app?${params.toString()}`, { credentials: 'include' });
        const next = (await response.json()) as ForgeStatsResponse & { error?: string };
        if (!response.ok) throw new Error(next.error || 'Could not load Forge statistics.');
        if (!cancelled) setData(next);
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
  }, [days, selectedUserId, selectedVisitorId]);

  const dailyTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of data?.daily || []) totals.set(row.activity_date, (totals.get(row.activity_date) || 0) + row.event_count);
    return Array.from(totals.entries()).slice(-30);
  }, [data?.daily]);
  const maxDaily = Math.max(1, ...dailyTotals.map(([, count]) => count));
  const selectedVisitor = data?.visitors.find((visitor) => visitor.visitorId === selectedVisitorId) || null;
  const selectedLabel = selectedVisitor?.managerName
    || (selectedUserId ? data?.users.find((user) => user.userId === selectedUserId)?.managerName : null)
    || 'everyone';
  const breakdownCards = [
    { key: 'countries', title: 'Countries', flags: true },
    { key: 'routes', title: 'Pages', flags: false },
    { key: 'referrers', title: 'Sources', flags: false },
    { key: 'platforms', title: 'Platforms', flags: false },
    { key: 'browsers', title: 'Browsers', flags: false },
    { key: 'languages', title: 'Languages', flags: false },
    { key: 'themes', title: 'Themes', flags: false },
    { key: 'screens', title: 'Screens', flags: false },
    { key: 'times', title: 'Visit times', flags: false },
  ] as const;

  return (
    <section className={styles.sectionStack}>
      <SectionCard
        title="Statistics"
        subtitle="Private usage and journey data. Raw records are retained for 90 days."
        className={styles.surfaceCard}
      >
        <div className={styles.statsToolbar}>
          <label className={styles.testingField}>
            <span>Period</span>
            <select value={days} onChange={(event) => setDays(event.target.value)}>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </label>
          <span className={styles.smallNote}>Your own identified activity is excluded from these totals by default.</span>
        </div>

        {loading && <p className={styles.smallNote}>Loading statistics...</p>}
        {error && <p className={styles.errorText}>{error}</p>}
        {data && !loading && (
          <>
            <div className={styles.statsMetricGrid}>
              <div className={styles.metricCard}><span className={styles.metricLabel}>Visits</span><span className={styles.metricValue}>{data.summary.visits}</span></div>
              <div className={styles.metricCard}><span className={styles.metricLabel}>Unique visitors</span><span className={styles.metricValue}>{data.summary.uniqueVisitors}</span></div>
              <div className={styles.metricCard}><span className={styles.metricLabel}>Identified users</span><span className={styles.metricValue}>{data.summary.identifiedUsers}</span></div>
              <div className={styles.metricCard}><span className={styles.metricLabel}>Actions</span><span className={styles.metricValue}>{data.summary.actions}</span></div>
            </div>

            <div className={styles.statsBreakdownGrid}>
              {breakdownCards.map((card) => {
                const rows = data.breakdowns[card.key] || [];
                return (
                  <div key={card.key} className={styles.statsBreakdownCard}>
                    <h3>{card.title}</h3>
                    {rows.length === 0 ? <p className={styles.smallNote}>No data yet.</p> : (
                      <div className={styles.breakdownList}>
                        {rows.map((row) => (
                          <div key={row.value} className={styles.breakdownRow}>
                            <span className={styles.breakdownName}>
                              {card.flags === true && <span className={styles.countryFlag}>{countryFlag(row.value)}</span>}
                              {row.value}
                            </span>
                            <span className={styles.breakdownCount}>{row.count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className={styles.statsGraph}>
              <h3>Activity by day</h3>
              <div className={styles.activityBars}>
                {dailyTotals.length === 0 && <span className={styles.smallNote}>No activity in this period.</span>}
                {dailyTotals.map(([date, count]) => (
                  <div key={date} className={styles.activityBarItem} title={`${date}: ${count} events`}>
                    <span className={styles.activityBar} style={{ height: `${Math.max(4, (count / maxDaily) * 100)}%` }} />
                    <span>{date.slice(5)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.statsUsers}>
              <div className={styles.statsHeadingRow}>
                <h3>Recent visitors</h3>
                {(selectedVisitorId || selectedUserId) && (
                  <button type="button" className={styles.clearSelection} onClick={() => {
                    setSelectedVisitorId(null);
                    setSelectedUserId(null);
                  }}>
                    Show everyone
                  </button>
                )}
              </div>
              {data.visitors.length === 0 ? <p className={styles.smallNote}>No visitors in this period.</p> : (
                <div className={styles.statsTableWrap}>
                  <table className={styles.statsTable}>
                    <thead><tr><th>Visitor</th><th>Visits</th><th>Country</th><th>Device</th><th>Last seen</th></tr></thead>
                    <tbody>
                      {data.visitors.map((visitor) => (
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
            </div>

            <div className={styles.statsUsers}>
              <h3>Identified users</h3>
              {data.users.length === 0 ? <p className={styles.smallNote}>No identified users in this period.</p> : (
                <div className={styles.statsTableWrap}>
                  <table className={styles.statsTable}>
                    <thead><tr><th>Manager</th><th>Visits</th><th>Events</th><th>Tournaments</th><th>Last seen</th></tr></thead>
                    <tbody>
                      {data.users.map((user) => (
                        <tr key={user.userId} className={selectedUserId === user.userId ? styles.selectedRow : ''}>
                          <td><button type="button" className={styles.tableButton} onClick={() => setSelectedUserId(selectedUserId === user.userId ? null : user.userId)}>{user.managerName}<small>ID {user.userId}</small></button></td>
                          <td>{user.visits}</td><td>{user.events}</td><td>{user.tournaments}</td><td>{formatDateTime(user.lastSeen)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className={styles.statsEvents}>
              <div className={styles.statsHeadingRow}>
                <div>
                  <h3>{selectedVisitorId || selectedUserId ? `Journey: ${selectedLabel}` : 'Recent visits and actions'}</h3>
                  {(selectedVisitor || selectedUserId) && <p className={styles.smallNote}>Nickname is captured from the authenticated Hattrick profile when available.</p>}
                </div>
              </div>
              <div className={styles.list}>
                {data.events.map((event) => (
                  <div key={event.id} className={styles.listRow}>
                    <div>
                      <div className={styles.listTitle}>
                        {event.country_code && <span className={styles.countryFlag}>{countryFlag(event.country_code)}</span>}
                        {event.event_type} · {event.resolved_manager_name || event.manager_name || 'Anonymous visitor'}
                      </div>
                      <div className={styles.listMeta}>{event.route || 'unknown route'} · {event.platform || 'platform unknown'} · {event.browser || 'browser unknown'} · {event.language || 'language unknown'}</div>
                      {event.referrer && <div className={styles.listMeta}>From {event.referrer}</div>}
                      {eventMetadataSummary(event) && <div className={styles.listMeta}>{eventMetadataSummary(event)}</div>}
                    </div>
                    <div className={styles.listMeta}>{formatDateTime(event.occurred_at)}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </SectionCard>
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
  const [managerId, setManagerId] = useState(() => localStorage.getItem('forge_ht_user_id') || '');
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
      <SectionCard title="Admins and rules" subtitle="Superadmin first, moderators later." className={styles.surfaceCard}>
        <div className={styles.rulesList}>
          {siteAdminRules.map((rule) => (
            <div key={rule.role} className={styles.ruleCard}>
              <div className={styles.ruleTop}>
                <div>
                  <div className={styles.ruleTitle}>{rule.title}</div>
                  <div className={styles.ruleMeta}>
                    {rule.hattrickUserId ? `Hattrick user ID ${rule.hattrickUserId}` : 'Not assigned yet'}
                  </div>
                </div>
                <span className={styles.roleBadge}>{rule.role}</span>
              </div>
              <p className={styles.ruleText}>{rule.description}</p>
            </div>
          ))}
        </div>

        <div className={styles.smallNote}>
          The current production admin set is deliberately small. Superadmin owns all Forge capabilities; moderators can
          be added later with a narrower surface.
        </div>
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
        <Route index element={<ForgeDashboard />} />
        <Route path="stats" element={<ForgeStatsSection />} />
        <Route path="faq" element={<ForgeFaqEditor />} />
        <Route path="testing" element={<ForgeTestingSection />} />
        <Route path="admins" element={<ForgeAdminsSection />} />
        <Route path="*" element={<Navigate to="/forge" replace />} />
      </Routes>
    </ForgeShell>
  );
};
