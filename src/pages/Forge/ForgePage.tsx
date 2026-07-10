import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import {
  CaretDown,
  Check,
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
import { faqPublished, faqSections, type FaqSection } from '../../constants/faq-revised';
import { FORGE_SUPERADMIN_USER_ID, siteAdminRules } from '../../constants/site-admins';
import { getAllScenarios, getMockManagerId, getTestManagerIdList, clearMockState, setMockManagerId } from '../../mock/matchmaker';
import { supabase } from '../../lib/supabase';
import { useForgeAuth } from '../../hooks/useForgeAuth';
import faqStyles from '../../components/Faq/FaqRenderer.module.sass';
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

const sidebarItems = [
  { to: '/forge', label: 'Dashboard', icon: <House size={18} weight="bold" /> },
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

function ForgeGate({ onLogin }: { onLogin: () => void }) {
  return (
    <div className={styles.gate}>
      <SectionCard title="Forge admin login" className={styles.gateCard}>
        <p className={styles.gateText}>
          This area is for Forge site administration. Sign in with the dedicated CHPP flow to continue.
        </p>
        <div className={styles.gateActions}>
          <Button variant="secondaryYellow" size="lg" onClick={onLogin}>
            <Shield size={18} weight="bold" />
            Login with CHPP
          </Button>
        </div>
        <p className={styles.smallNote}>Initial admin access is limited to Hattrick user ID {FORGE_SUPERADMIN_USER_ID}.</p>
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
      <ForgeHeader managerName={managerName} onLogoutMain={onLogoutMain} onLogoutForge={onLogoutForge} onLogin={onLogin} />
      <div className={styles.shell}>
        <aside className={styles.sidebar}>
          {sidebarItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/forge'} className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navItemActive : ''}`}>
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
        supabase.from('tournaments').select('id, name, slug, created_at').order('created_at', { ascending: false }).limit(5),
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
      <SectionCard title="Dashboard" subtitle="Quick status and recent activity.">
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
        section.description !== undefined ? `    description: ${tsString(section.description)},` : null,
        `    order: ${section.order},`,
        `    published: ${section.published !== false},`,
        `    items: [`,
        ...section.items.flatMap((item) => [
          `      {`,
          `        id: ${tsString(item.id)},`,
          `        question: ${tsString(item.question)},`,
          `        answer: \`${escapeTemplateLiteral(item.answer)}\`,`,
          `        status: ${tsString(item.status)},`,
          item.featured ? `        featured: true,` : null,
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

  const generatedSource = useMemo(() => generateFaqSource(globalPublished, draftSections), [draftSections, globalPublished]);
  const currentContentSignature = useMemo(() => getFaqContentSignature(draftSections), [draftSections]);
  const savedContentSignature = useMemo(() => getFaqContentSignature(savedSections), [savedSections]);
  const fileDirty = currentContentSignature !== savedContentSignature;

  const isItemDirty = (sectionId: string, item: FaqSection['items'][number]) => {
    const savedItem = savedSections.find((section) => section.id === sectionId)?.items.find((candidate) => candidate.id === item.id);
    if (!savedItem) return true;
    return (
      savedItem.question !== item.question ||
      savedItem.answer !== item.answer
    );
  };

  const updateSection = (sectionId: string, update: (section: FaqSection) => FaqSection) => {
    setDraftSections((current) => current.map((section) => (section.id === sectionId ? update(section) : section)));
    setExportState('idle');
  };

  const updateItem = (sectionId: string, itemId: string, update: (item: FaqSection['items'][number]) => FaqSection['items'][number]) => {
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
      link.download = 'faq-revised.ts';
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
          {exportState === 'downloaded' && 'Generated faq-revised.ts download.'}
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
                <article
                  key={item.id}
                  className={`${faqStyles.item} ${isExpanded ? faqStyles.itemExpanded : ''}`}
                >
                  <div className={faqStyles.summary}>
                    <input
                      className={faqStyles.editableQuestion}
                      value={item.question}
                      onChange={(event) => updateItem(section.id, item.id, (current) => ({ ...current, question: event.target.value }))}
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
                        onChange={(event) => updateItem(section.id, item.id, (current) => ({ ...current, answer: event.target.value }))}
                      />

                      <div className={faqStyles.itemActions}>
                        <button
                          type="button"
                          className={`${faqStyles.itemButton} ${itemDirty ? faqStyles.buttonDirty : ''}`}
                          onClick={handleDownload}
                        >
                          Save
                        </button>
                        <button type="button" className={faqStyles.itemButton} onClick={() => restoreItem(section.id, item.id)}>
                          Cancel
                        </button>
                        <Switch
                          size="sm"
                          checked={item.published !== false}
                          onChange={(checked) => updateItem(section.id, item.id, (current) => ({ ...current, published: checked }))}
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
  const [mode, setMode] = useState(() => localStorage.getItem('ht120_mode') || 'production');
  const [scenario, setScenario] = useState(() => localStorage.getItem('ht120_scenario') || '');
  const [mockManagerId, setLocalMockManagerId] = useState(() => getMockManagerId() || '');
  const scenarios = useMemo(() => getAllScenarios(), []);

  const apply = () => {
    localStorage.setItem('ht120_mode', mode);
    if (mode === 'scenario' && scenario) {
      localStorage.setItem('ht120_scenario', scenario);
    } else {
      localStorage.removeItem('ht120_scenario');
    }

    if (mode === 'mock') {
      setMockManagerId(mockManagerId || null);
    } else {
      setMockManagerId(null);
    }

    window.location.reload();
  };

  const reset = () => {
    localStorage.removeItem('ht120_mode');
    localStorage.removeItem('ht120_scenario');
    window.location.reload();
  };

  const clearState = () => {
    clearMockState();
    window.location.reload();
  };

  return (
    <section className={styles.sectionStack}>
      <SectionCard title="Testing hub" subtitle="Scenario and mock controls for CHPP and matchmaker debugging.">
        <div className={styles.testingGrid}>
          <div className={styles.testingField}>
            <label>Mode</label>
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="production">Production</option>
              <option value="mock">Mock</option>
              <option value="scenario">Scenario</option>
            </select>
          </div>

          {mode === 'scenario' && (
            <div className={styles.testingField}>
              <label>Scenario</label>
              <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
                <option value="">(none)</option>
                {scenarios.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {mode === 'mock' && (
            <div className={styles.testingField}>
              <label>Mock manager</label>
              <select value={mockManagerId} onChange={(e) => setLocalMockManagerId(e.target.value)}>
                <option value="">(none)</option>
                {getTestManagerIdList().map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label} ({item.id})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className={styles.editorActions}>
          <Button variant="secondaryYellow" onClick={apply}>
            <Check size={18} weight="bold" />
            Apply
          </Button>
          <Button variant="outline" onClick={reset}>
            Reset
          </Button>
          <Button variant="outline" onClick={clearState}>
            Clear mock state
          </Button>
        </div>

        <div className={styles.previewWrap}>
          <p className={styles.smallNote}>
            These controls mirror the current development test state and stay entirely in browser storage until you
            apply them.
          </p>
        </div>
      </SectionCard>
    </section>
  );
}

function ForgeAdminsSection() {
  return (
    <section className={styles.sectionStack}>
      <SectionCard title="Admins and rules" subtitle="Superadmin first, moderators later.">
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
          The current production admin set is deliberately small. Superadmin owns all Forge capabilities; moderators
          can be added later with a narrower surface.
        </div>
      </SectionCard>
    </section>
  );
}

export const ForgePage: React.FC = () => {
  const auth = useForgeAuth();

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
        <Route path="faq" element={<ForgeFaqEditor />} />
        <Route path="testing" element={<ForgeTestingSection />} />
        <Route path="admins" element={<ForgeAdminsSection />} />
        <Route path="*" element={<Navigate to="/forge" replace />} />
      </Routes>
    </ForgeShell>
  );
};
