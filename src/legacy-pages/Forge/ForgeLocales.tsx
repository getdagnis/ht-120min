import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/Button/Button';
import { localeNames, type Locale } from '../../i18n/config';
import {
  catalogSections,
  keysForSection,
  type CatalogSection,
  type CatalogValues,
  type LocaleStatus,
} from '../../i18n/catalog';
import { isValidCatalogMessage } from '../../i18n/catalog-validation';
import { exportCatalogCsv, importCatalogCsv } from '../../i18n/catalog-csv';
import styles from './ForgeLocales.module.sass';

interface LanguageSettings {
  locale: Locale;
  native_name: string;
  status: LocaleStatus;
  editor_ht_ids: number[];
}

interface HistoryEntry {
  version: number;
  author_ht_id: number;
  author_name: string | null;
  published_at: string;
}

interface CatalogResponse {
  settings: LanguageSettings[];
  role: 'admin' | 'editor';
  canEdit: boolean;
  sourceValues: CatalogValues;
  englishValues: CatalogValues;
  draftValues: CatalogValues;
  draftRevision: number;
  publishedVersion: number;
  history: HistoryEntry[];
  registeredKeys: string[];
  missingCounts: Record<CatalogSection, number>;
}

const recentKey = 'forge-locale-recent';
const selectedLocaleKey = 'forge-locale-selected';
const localeFlags: Record<Locale, string> = { en: '🇬🇧', lv: '🇱🇻' };

interface UnsavedDraft {
  values: CatalogValues;
  savedValues: CatalogValues;
  revision: number;
}

function draftKey(locale: Locale, section: CatalogSection) {
  return `${locale}:${section}`;
}

function highlightSearch(text: string, search: string) {
  const query = search.trim();
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.split(new RegExp(`(${escaped})`, 'gi')).map((part, index) =>
    index % 2 === 1 ? (
      <mark className={styles.searchHighlight} key={index}>
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function subgroup(key: string, section: CatalogSection) {
  if (key.startsWith('PublicUI.')) {
    return key.split('.')[1].replace(/([a-z])([A-Z])/g, '$1 $2');
  }
  if (section === 'System') {
    if (key.startsWith('notFound.')) return '404';
    if (key.startsWith('common.loading') || key.startsWith('common.getting')) return 'Loading';
    if (
      key.startsWith('common.authUnavailable') ||
      key.startsWith('common.tryLogin') ||
      key.startsWith('common.report')
    )
      return 'System notices';
    return 'Layout and footer';
  }
  if (section === 'Home') {
    const local = key.slice(5);
    if (local.startsWith('faq.')) return 'FAQ';
    if (local.startsWith('chat')) return 'Chat';
    if (local.startsWith('supporters')) return 'Supporters wall';
    if (local.startsWith('activity')) return 'Latest activity';
    if (local.startsWith('tournamentCard')) return 'Tournament cards';
    if (local.startsWith('news')) return 'News cards';
    if (local.startsWith('welcome')) return 'Welcome';
    return 'Home page';
  }
  return section === 'TournamentView' ? 'Fixtures' : section;
}

export function ForgeLocales({ isAdmin }: { isAdmin: boolean }) {
  const [settings, setSettings] = useState<LanguageSettings[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [locale, setLocale] = useState<Locale>('en');
  const [selectedSection, setSelectedSection] = useState<CatalogSection>('System');
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchCatalogs, setSearchCatalogs] = useState<Partial<Record<CatalogSection, CatalogResponse>>>({});
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const searchActive = Boolean(search.trim());
  const [tabOrder, setTabOrder] = useState<Locale[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(recentKey) || '[]') as string[];
      return ['en', ...saved.filter((item): item is Locale => item === 'lv')];
    } catch {
      return ['en'];
    }
  });
  const [showSettings, setShowSettings] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [draft, setDraft] = useState<CatalogValues>({});
  const [savedDraft, setSavedDraft] = useState<CatalogValues>({});
  const [unsavedValues, setUnsavedValues] = useState<Record<string, CatalogValues>>({});
  const [editedSettings, setEditedSettings] = useState<LanguageSettings | null>(null);
  const [editorIdsText, setEditorIdsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedHistoryVersion, setSelectedHistoryVersion] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);
  const unsavedDraftsRef = useRef<Record<string, UnsavedDraft>>({});
  const focusRef = useRef<{ key: string; position: number; scroll: number } | null>(null);
  const fieldsRef = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const csvInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async (targetLocale: Locale, targetSection: CatalogSection) => {
    const requestId = ++requestIdRef.current;
    const query = new URLSearchParams({ route: 'forge-locales', locale: targetLocale, section: targetSection });
    const response = await fetch(`/api/app?${query}`, { credentials: 'include' });
    const payload = (await response.json()) as CatalogResponse & { error?: string };
    if (!response.ok) throw new Error(payload.error || 'Could not load locale catalog.');
    if (requestId !== requestIdRef.current) return;
    const key = draftKey(targetLocale, targetSection);
    const unsaved = unsavedDraftsRef.current[key];
    setSettings(payload.settings);
    setCatalog(unsaved ? { ...payload, draftRevision: unsaved.revision } : payload);
    setDraft(unsaved?.values || payload.draftValues);
    setSavedDraft(unsaved?.savedValues || payload.draftValues);
    if (unsaved && unsaved.revision !== payload.draftRevision) {
      setError('This draft changed on the server. Copy your unsaved text before reloading.');
    }
    setEditedSettings(payload.settings.find((item) => item.locale === targetLocale) || null);
    setEditorIdsText((payload.settings.find((item) => item.locale === targetLocale)?.editor_ht_ids || []).join(', '));
    setSelectedHistoryVersion(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/app?route=forge-locales', { credentials: 'include' })
      .then(async (response) => {
        const payload = (await response.json()) as {
          settings?: LanguageSettings[];
          role?: 'admin' | 'editor';
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || 'Could not load languages.');
        if (cancelled) return;
        setSettings(payload.settings || []);
        let savedLocale: string | null = null;
        try { savedLocale = localStorage.getItem(selectedLocaleKey); } catch { /* Storage may be unavailable. */ }
        const preferred = payload.settings?.find((item) => item.locale === savedLocale) || (
          payload.role === 'editor'
            ? payload.settings?.find((item) => item.locale !== 'en')
            : payload.settings?.find((item) => item.locale === locale));
        if (preferred && preferred.locale !== locale) setLocale(preferred.locale);
        else if (payload.settings?.length && !payload.settings.some((item) => item.locale === locale))
          setLocale(payload.settings[0].locale);
        setInitialized(true);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load languages.');
      });
    return () => {
      cancelled = true;
    };
    // The first permitted language is selected once, when Forge opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!initialized) return;
    try { localStorage.setItem(selectedLocaleKey, locale); } catch { /* Storage may be unavailable. */ }
  }, [initialized, locale]);

  useEffect(() => {
    if (!initialized) return;
    let cancelled = false;
    void Promise.resolve()
      .then(() => load(locale, selectedSection))
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load locale catalog.');
      });
    return () => {
      cancelled = true;
    };
  }, [initialized, load, locale, selectedSection]);

  useEffect(() => {
    const marker = focusRef.current;
    if (!marker || !catalog) return;
    focusRef.current = null;
    const field = fieldsRef.current[marker.key];
    if (field) {
      field.focus({ preventScroll: true });
      field.setSelectionRange(
        Math.min(marker.position, field.value.length),
        Math.min(marker.position, field.value.length),
      );
    }
    window.scrollTo(0, marker.scroll);
  }, [catalog]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft);
  useEffect(() => {
    if (!initialized || !searchActive) return;
    const controller = new AbortController();
    void Promise.resolve()
      .then(async () => {
        if (controller.signal.aborted) return;
        setSearchLoading(true);
        setSearchError('');
        setSearchCatalogs({});
        const entries = await Promise.all(
          catalogSections.map(async (section) => {
            const query = new URLSearchParams({ route: 'forge-locales', locale, section });
            const response = await fetch(`/api/app?${query}`, { credentials: 'include', signal: controller.signal });
            const payload = (await response.json()) as CatalogResponse & { error?: string };
            if (!response.ok) throw new Error(payload.error || 'Could not search locale catalog.');
            return [section, payload] as const;
          }),
        );
        if (!controller.signal.aborted) setSearchCatalogs(Object.fromEntries(entries));
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setSearchError(cause instanceof Error ? cause.message : 'Could not search locale catalog.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setSearchLoading(false);
      });
    return () => controller.abort();
  }, [initialized, locale, searchActive]);

  const searchGroups = catalogSections.flatMap((section) => {
    const sectionCatalog = searchCatalogs[section];
    const values =
      section === selectedSection && catalog
        ? draft
        : unsavedValues[draftKey(locale, section)] || sectionCatalog?.draftValues || {};
    const englishValues = sectionCatalog?.englishValues || {};
    const query = search.trim().toLocaleLowerCase();
    const matches = (sectionCatalog?.registeredKeys || []).filter(
      (key) =>
        key.toLocaleLowerCase().includes(query) ||
        (values[key] || '').toLocaleLowerCase().includes(query) ||
        (englishValues[key] || '').toLocaleLowerCase().includes(query),
    );
    return [...new Set(matches.map((key) => subgroup(key, section)))].map((group) => ({
      section,
      group,
      values,
      englishValues,
      keys: matches.filter((key) => subgroup(key, section) === group),
    }));
  });
  const currentSettings = editedSettings || settings.find((item) => item.locale === locale);
  const savedSettings = settings.find((item) => item.locale === locale);
  const settingsDirty = Boolean(
    currentSettings &&
    savedSettings &&
    (currentSettings.native_name !== savedSettings.native_name ||
      currentSettings.status !== savedSettings.status ||
      editorIdsText !== savedSettings.editor_ht_ids.join(', ')),
  );
  const groups = useMemo(
    () => [...new Set((catalog?.registeredKeys || []).map((key) => subgroup(key, selectedSection)))],
    [catalog, selectedSection],
  );
  const visibleKeys = (catalog?.registeredKeys || []).filter(
    (key) => !selectedGroup || subgroup(key, selectedSection) === selectedGroup,
  );
  const tabs = [...tabOrder, ...(settings.length <= 5 ? settings.map((item) => item.locale) : [])]
    .filter((item, index, list) => settings.some((setting) => setting.locale === item) && list.indexOf(item) === index)
    .slice(0, 5) as Locale[];

  function hasUntranslated(section: CatalogSection, group?: string) {
    const values = section === selectedSection && catalog ? draft : unsavedValues[draftKey(locale, section)];
    if (values) {
      return keysForSection(section).some(
        (key) => (!group || subgroup(key, section) === group) && !(values[key] || '').trim(),
      );
    }
    return !group && Boolean(catalog?.missingCounts[section]);
  }

  function rememberDraft() {
    const key = draftKey(locale, selectedSection);
    if (dirty && catalog) {
      unsavedDraftsRef.current[key] = {
        values: draft,
        savedValues: savedDraft,
        revision: catalog.draftRevision,
      };
      setUnsavedValues((current) => ({ ...current, [key]: draft }));
    } else {
      delete unsavedDraftsRef.current[key];
      setUnsavedValues((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  function switchLanguage(next: Locale) {
    if (next === locale) return;
    if (settingsDirty && !window.confirm('Discard unsaved language settings?')) return;
    rememberDraft();
    setSearchCatalogs({});
    if (searchActive) setSearchLoading(true);
    setCatalog(null);
    setDraft({});
    setSavedDraft({});
    const nextSettings = settings.find((item) => item.locale === next) || null;
    setEditedSettings(nextSettings);
    setEditorIdsText((nextSettings?.editor_ht_ids || []).join(', '));
    setLocale(next);
    setNotice('');
    setError('');
    if (!tabOrder.includes(next)) {
      const nextOrder: Locale[] = ['en', ...tabOrder.filter((item) => item !== 'en').slice(-3), next];
      setTabOrder(nextOrder);
      localStorage.setItem(recentKey, JSON.stringify(nextOrder.filter((item) => item !== 'en')));
    }
  }

  function switchSection(next: CatalogSection) {
    if (next === selectedSection) {
      setShowSettings(false);
      return;
    }
    if (settingsDirty && !window.confirm('Discard unsaved language settings?')) return;
    rememberDraft();
    focusRef.current = null;
    setCatalog(null);
    setDraft({});
    setSavedDraft({});
    setSelectedSection(next);
    setShowSettings(false);
    setSelectedGroup(null);
    setNotice('');
    setError('');
  }

  async function send(action: 'save' | 'publish' | 'restore' | 'settings', extra: Record<string, unknown> = {}) {
    if (action === 'settings') rememberDraft();
    if (action === 'save') {
      const invalidKey = Object.entries(draft).find(([key, value]) => !isValidCatalogMessage(key, value))?.[0];
      if (invalidKey) {
        setError(`Check ICU variables and rich-text tags in ${invalidKey}.`);
        fieldsRef.current[invalidKey]?.focus();
        return;
      }
    }
    setBusy(true);
    setNotice('');
    setError('');
    try {
      const response = await fetch('/api/app?route=forge-locales', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          locale,
          section: selectedSection,
          expectedRevision: catalog?.draftRevision || 0,
          ...(action === 'save' ? { values: draft } : {}),
          ...extra,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Locale action failed.');
      if (action === 'save' || action === 'restore') {
        const key = draftKey(locale, selectedSection);
        delete unsavedDraftsRef.current[key];
        setUnsavedValues((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
      await load(locale, selectedSection);
      setNotice(
        action === 'publish'
          ? 'Published this section.'
          : action === 'restore'
            ? 'Version restored to draft.'
            : 'Saved.',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Locale action failed.');
    } finally {
      setBusy(false);
    }
  }

  function saveSettings() {
    if (!editedSettings) return;
    const editorIds = editorIdsText
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map(Number);
    void send('settings', { nativeName: editedSettings.native_name, status: editedSettings.status, editorIds });
  }

  function openSettings() {
    rememberDraft();
    setShowSettings(true);
    setNotice('');
    setError('');
  }

  function exportCsv() {
    const csv = exportCatalogCsv(visibleKeys, draft, catalog?.englishValues || {});
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    const group = selectedGroup ? `.${selectedGroup.replace(/\s+/g, '_')}` : '';
    link.href = url;
    link.download = `${locale.toUpperCase()}-${selectedSection}${group}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function importCsv(file: File) {
    if (!catalog?.canEdit) return;
    const requestId = requestIdRef.current;
    const allowedKeys = new Set(visibleKeys);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (file.size > 1_000_000) throw new Error('CSV file is too large (maximum 1 MB).');
      const values = importCatalogCsv(await file.text());
      if (requestId !== requestIdRef.current) return;
      for (const [key, value] of Object.entries(values)) {
        if (!allowedKeys.has(key)) throw new Error(`Key is outside the selected section or group: ${key}`);
        if (!isValidCatalogMessage(key, value)) throw new Error(`Check ICU variables and rich-text tags in ${key}.`);
      }
      setDraft((current) => ({ ...current, ...values }));
      setNotice(
        `Imported ${Object.keys(values).length} local translations into the draft. Review and save to keep them.`,
      );
    } catch (cause) {
      if (requestId === requestIdRef.current)
        setError(cause instanceof Error ? cause.message : 'Could not import CSV.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.page}>
      <header className={styles.heading}>
        <h1>Locales</h1>
        <select aria-label="Language" value={locale} onChange={(event) => switchLanguage(event.target.value as Locale)}>
          {settings.map((item) => (
            <option key={item.locale} value={item.locale}>
              {localeFlags[item.locale]} {item.native_name} ({item.locale}) · {item.status}
            </option>
          ))}
        </select>
      </header>

      <label className={styles.search}>
        Search this locale
        <input
          type="search"
          value={search}
          placeholder="Search keys or text across all sections…"
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>

      <div className={styles.tabs} role="tablist" aria-label="Recent languages">
        {tabs.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={item === locale}
            className={item === locale ? styles.activeTab : ''}
            onClick={() => switchLanguage(item)}
          >
            <span aria-hidden="true">{localeFlags[item]}</span>{' '}
            {settings.find((setting) => setting.locale === item)?.native_name || localeNames[item]}
          </button>
        ))}
      </div>

      <div className={styles.workspace}>
        <nav className={styles.tree} aria-label="Catalog sections">
          <button type="button" className={showSettings ? styles.activeTree : ''} onClick={openSettings}>
            Language settings
          </button>
          {catalogSections.map((item) => (
            <div key={item}>
              <button
                type="button"
                className={item === selectedSection && !showSettings ? styles.activeTree : ''}
                aria-label={`${item}${hasUntranslated(item) ? ', untranslated text' : ''}`}
                onClick={() => switchSection(item)}
              >
                {item}
                {hasUntranslated(item) && (
                  <span className={styles.missingDot} aria-hidden="true">
                    •
                  </span>
                )}
              </button>
              {item === selectedSection &&
                !showSettings &&
                groups.map((group) => (
                  <button
                    type="button"
                    key={group}
                    className={`${styles.child} ${group === selectedGroup ? styles.activeTree : ''}`}
                    aria-label={`${group}${hasUntranslated(item, group) ? ', untranslated text' : ''}`}
                    onClick={() => setSelectedGroup(group === selectedGroup ? null : group)}
                  >
                    {group}
                    {hasUntranslated(item, group) && (
                      <span className={styles.missingDot} aria-hidden="true">
                        •
                      </span>
                    )}
                  </button>
                ))}
            </div>
          ))}
        </nav>
        {searchActive ? (
          <div className={styles.editorWrap}>
            <div className={styles.editorHeading}>
              <strong>Search results · {localeNames[locale]}</strong>
              <span aria-live="polite">
                {searchLoading
                  ? 'Searching…'
                  : `${searchGroups.reduce((total, group) => total + group.keys.length, 0)} matches`}
              </span>
            </div>
            {searchError && <p className={styles.error}>{searchError}</p>}
            {!searchLoading && !searchError && !searchGroups.length && (
              <p className={styles.empty}>No matching keys or text.</p>
            )}
            {!searchLoading &&
              !searchError &&
              searchGroups.map(({ section, group, values, englishValues, keys }) => (
                <section key={`${section}:${group}`}>
                  <div className={styles.editorHeading}>
                    <strong>
                      {section} / {group}
                    </strong>
                  </div>
                  <div className={styles.editor}>
                    {keys.map((key) => (
                      <button
                        type="button"
                        className={`${styles.line} ${styles.searchResult}`}
                        key={key}
                        aria-label={`Edit ${key} in ${section} / ${group}`}
                        onClick={() => {
                          switchSection(section);
                          setSelectedGroup(group);
                          setActiveKey(key);
                          setSearch('');
                        }}
                      >
                        <span className={`${styles.key} ${!values[key]?.trim() ? styles.missingKey : ''}`}>{highlightSearch(key, search)}</span>
                        <span className={styles.equals}>=</span>
                        <span className={styles.valueCell}>
                          {values[key]?.trim() && (
                            <span className={styles.searchValue}>{highlightSearch(values[key], search)}</span>
                          )}
                          {locale !== 'en' && englishValues[key] && (
                            <span className={styles.englishReference}>
                              {highlightSearch(englishValues[key], search)}
                            </span>
                          )}
                          {locale === 'en' && !values[key]?.trim() && (
                            <span className={styles.searchValue}>
                              {highlightSearch(englishValues[key] || '', search)}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
          </div>
        ) : showSettings ? (
          <div className={styles.settingsPanel}>
            <div className={styles.editorHeading}>
              <strong>Language settings</strong>
              <span>{locale.toUpperCase()}</span>
            </div>
            {currentSettings && (
              <div className={styles.settings}>
                <label>
                  Native name
                  <input
                    value={currentSettings.native_name}
                    disabled={!isAdmin}
                    onChange={(event) => setEditedSettings({ ...currentSettings, native_name: event.target.value })}
                  />
                </label>
                <label>
                  State
                  <select
                    value={currentSettings.status}
                    disabled={!isAdmin}
                    onChange={(event) =>
                      setEditedSettings({ ...currentSettings, status: event.target.value as LocaleStatus })
                    }
                  >
                    <option value="implemented">Implemented</option>
                    <option value="beta" disabled={locale === 'en'}>
                      Beta
                    </option>
                    <option value="draft" disabled={locale === 'en'}>
                      Draft
                    </option>
                  </select>
                </label>
                <label>
                  Editor Hattrick IDs
                  <input
                    value={editorIdsText}
                    disabled={!isAdmin}
                    placeholder="Comma-separated IDs"
                    onChange={(event) => setEditorIdsText(event.target.value)}
                  />
                </label>
                {isAdmin && (
                  <Button variant="outline" disabled={busy || !settingsDirty} onClick={saveSettings}>
                    Save settings
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className={styles.editorWrap}>
            <div className={styles.editorHeading}>
              <strong>
                {selectedSection}
                {selectedGroup ? ` / ${selectedGroup}` : ''}
              </strong>
              <span>
                {catalog?.registeredKeys.length || 0} keys · published v{catalog?.publishedVersion || 0}
              </span>
            </div>
            <div className={styles.editor}>
              {!visibleKeys.length && <p className={styles.empty}>No registered UI messages in this section yet.</p>}
              {visibleKeys.map((key) => (
                <label className={styles.line} key={key}>
                  <span className={`${styles.key} ${!draft[key]?.trim() ? styles.missingKey : ''}`}>{key}</span>
                  <span className={styles.equals}>=</span>
                  <span className={styles.valueCell}>
                    <textarea
                      ref={(node) => {
                        fieldsRef.current[key] = node;
                      }}
                      data-catalog-key={key}
                      aria-label={key}
                      rows={Math.min(
                        10,
                        Math.max(1, (draft[key] || '').split('\n').length, Math.ceil((draft[key] || '').length / 90)),
                      )}
                      readOnly={!catalog?.canEdit}
                      onFocus={() => setActiveKey(key)}
                      onSelect={(event) => {
                        focusRef.current = {
                          key,
                          position: event.currentTarget.selectionStart,
                          scroll: window.scrollY,
                        };
                      }}
                      value={draft[key] ?? ''}
                      placeholder={catalog?.englishValues[key] || ''}
                      onChange={(event) => setDraft((old) => ({ ...old, [key]: event.target.value }))}
                    />
                    {activeKey === key && locale !== 'en' && catalog?.englishValues[key] && (
                      <span className={styles.englishReference}>{catalog.englishValues[key]}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
            <footer className={styles.footer}>
              <label className={styles.history}>
                Published history
                <select
                  value={selectedHistoryVersion ?? ''}
                  aria-label="Published history"
                  disabled={!catalog?.canEdit}
                  onChange={(event) => setSelectedHistoryVersion(Number(event.target.value) || null)}
                >
                  <option value="">Latest 20 versions</option>
                  {(catalog?.history || []).map((item) => (
                    <option key={item.version} value={item.version}>
                      v{item.version} · {new Date(item.published_at).toLocaleString()} ·{' '}
                      {item.author_name || `#${item.author_ht_id}`}
                    </option>
                  ))}
                </select>
              </label>
              <div className={styles.actions}>
                <a href={`/${locale}?localePreview=1`} target="_blank" rel="noreferrer">
                  Preview draft
                </a>
                <Button
                  variant="outline"
                  disabled={busy || !catalog?.canEdit || (!dirty && catalog.draftRevision > 0) || !visibleKeys.length}
                  onClick={() => void send('save')}
                >
                  Save draft
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !catalog?.canEdit || !selectedHistoryVersion}
                  onClick={() => {
                    if (
                      selectedHistoryVersion &&
                      window.confirm(`Restore published version ${selectedHistoryVersion} to this draft?`)
                    ) {
                      void send('restore', { version: selectedHistoryVersion });
                    }
                  }}
                >
                  Restore
                </Button>
                {isAdmin && (
                  <Button
                    variant="primary"
                    disabled={busy || dirty || !catalog?.draftRevision}
                    onClick={() => void send('publish')}
                  >
                    Publish
                  </Button>
                )}
              </div>
            </footer>
            <div className={styles.csvActions}>
              <Button
                size="xs"
                variant="secondaryAction"
                disabled={busy || !catalog || !visibleKeys.length}
                onClick={exportCsv}
              >
                Export CSV
              </Button>
              <Button
                size="xs"
                variant="secondaryAction"
                disabled={busy || !catalog?.canEdit || !visibleKeys.length}
                onClick={() => csvInputRef.current?.click()}
              >
                Import CSV
              </Button>
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void importCsv(file);
                }}
              />
            </div>
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
    </section>
  );
}
