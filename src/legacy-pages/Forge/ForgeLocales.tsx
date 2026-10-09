import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/Button/Button';
import { localeNames, type Locale } from '../../i18n/config';
import { catalogSections, type CatalogSection, type CatalogValues, type LocaleStatus } from '../../i18n/catalog';
import { isValidCatalogMessage } from '../../i18n/catalog-validation';
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
}

const recentKey = 'forge-locale-recent';
const localeFlags: Record<Locale, string> = { en: '🇬🇧', lv: '🇱🇻' };

interface UnsavedDraft {
  values: CatalogValues;
  savedValues: CatalogValues;
  revision: number;
}

function draftKey(locale: Locale, section: CatalogSection) {
  return `${locale}:${section}`;
}

function subgroup(key: string, section: CatalogSection) {
  if (section === 'System') {
    if (key.startsWith('notFound.')) return '404';
    if (key.startsWith('common.loading') || key.startsWith('common.getting')) return 'Loading';
    if (key.startsWith('common.authUnavailable') || key.startsWith('common.tryLogin') || key.startsWith('common.report')) return 'System notices';
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
  const [tabOrder, setTabOrder] = useState<Locale[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(recentKey) || '[]') as string[];
      return ['en', ...saved.filter((item): item is Locale => item === 'lv')];
    } catch { return ['en']; }
  });
  const [showSettings, setShowSettings] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [draft, setDraft] = useState<CatalogValues>({});
  const [savedDraft, setSavedDraft] = useState<CatalogValues>({});
  const [editedSettings, setEditedSettings] = useState<LanguageSettings | null>(null);
  const [editorIdsText, setEditorIdsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedHistoryVersion, setSelectedHistoryVersion] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);
  const unsavedDraftsRef = useRef<Record<string, UnsavedDraft>>({});
  const focusRef = useRef<{ key: string; position: number; scroll: number } | null>(null);
  const fieldsRef = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const load = useCallback(async (targetLocale: Locale, targetSection: CatalogSection) => {
    const requestId = ++requestIdRef.current;
    const query = new URLSearchParams({ route: 'forge-locales', locale: targetLocale, section: targetSection });
    const response = await fetch(`/api/app?${query}`, { credentials: 'include' });
    const payload = await response.json() as CatalogResponse & { error?: string };
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
    void fetch('/api/app?route=forge-locales', { credentials: 'include' }).then(async (response) => {
      const payload = await response.json() as { settings?: LanguageSettings[]; role?: 'admin' | 'editor'; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Could not load languages.');
      if (cancelled) return;
      setSettings(payload.settings || []);
      const preferred = payload.role === 'editor'
        ? payload.settings?.find((item) => item.locale !== 'en')
        : payload.settings?.find((item) => item.locale === locale);
      if (preferred && preferred.locale !== locale) setLocale(preferred.locale);
      else if (payload.settings?.length && !payload.settings.some((item) => item.locale === locale)) setLocale(payload.settings[0].locale);
      setInitialized(true);
    }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load languages.'); });
    return () => { cancelled = true; };
  // The first permitted language is selected once, when Forge opens.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!initialized) return;
    let cancelled = false;
    void Promise.resolve().then(() => load(locale, selectedSection)).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load locale catalog.');
    });
    return () => { cancelled = true; };
  }, [initialized, load, locale, selectedSection]);

  useEffect(() => {
    const marker = focusRef.current;
    if (!marker || !catalog) return;
    focusRef.current = null;
    const field = fieldsRef.current[marker.key];
    if (field) {
      field.focus();
      field.setSelectionRange(Math.min(marker.position, field.value.length), Math.min(marker.position, field.value.length));
    }
    if (editorRef.current) editorRef.current.scrollTop = marker.scroll;
  }, [catalog]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft);
  const currentSettings = editedSettings || settings.find((item) => item.locale === locale);
  const savedSettings = settings.find((item) => item.locale === locale);
  const settingsDirty = Boolean(currentSettings && savedSettings && (
    currentSettings.native_name !== savedSettings.native_name
    || currentSettings.status !== savedSettings.status
    || editorIdsText !== savedSettings.editor_ht_ids.join(', ')
  ));
  const groups = useMemo(() => [...new Set((catalog?.registeredKeys || []).map((key) => subgroup(key, selectedSection)))],
    [catalog, selectedSection]);
  const visibleKeys = (catalog?.registeredKeys || []).filter((key) => !selectedGroup || subgroup(key, selectedSection) === selectedGroup);
  const tabs = [...tabOrder, ...(settings.length <= 5 ? settings.map((item) => item.locale) : [])]
    .filter((item, index, list) => settings.some((setting) => setting.locale === item) && list.indexOf(item) === index)
    .slice(0, 5) as Locale[];

  function rememberDraft() {
    const key = draftKey(locale, selectedSection);
    if (dirty && catalog) {
      unsavedDraftsRef.current[key] = {
        values: draft, savedValues: savedDraft, revision: catalog.draftRevision,
      };
    } else {
      delete unsavedDraftsRef.current[key];
    }
  }

  function switchLanguage(next: Locale) {
    if (next === locale) return;
    if (settingsDirty && !window.confirm('Discard unsaved language settings?')) return;
    rememberDraft();
    if (focusRef.current) focusRef.current.scroll = editorRef.current?.scrollTop || 0;
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
      const nextOrder = ['en', ...tabOrder.filter((item) => item !== 'en').slice(-3), next];
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
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, locale, section: selectedSection, expectedRevision: catalog?.draftRevision || 0,
          ...(action === 'save' ? { values: draft } : {}), ...extra }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Locale action failed.');
      if (action === 'save' || action === 'restore') delete unsavedDraftsRef.current[draftKey(locale, selectedSection)];
      await load(locale, selectedSection);
      setNotice(action === 'publish' ? 'Published this section.' : action === 'restore' ? 'Version restored to draft.' : 'Saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Locale action failed.');
    } finally { setBusy(false); }
  }

  function saveSettings() {
    if (!editedSettings) return;
    const editorIds = editorIdsText.split(',').map((item) => item.trim()).filter(Boolean).map(Number);
    void send('settings', { nativeName: editedSettings.native_name, status: editedSettings.status, editorIds });
  }

  function openSettings() {
    rememberDraft();
    setShowSettings(true);
    setNotice('');
    setError('');
  }

  return (
    <section className={styles.page}>
      <header className={styles.heading}>
        <h1>Locales</h1>
        <select aria-label="Language" value={locale} onChange={(event) => switchLanguage(event.target.value as Locale)}>
          {settings.map((item) => <option key={item.locale} value={item.locale}>{localeFlags[item.locale]} {item.native_name} ({item.locale}) · {item.status}</option>)}
        </select>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Recent languages">
        {tabs.map((item) => <button key={item} type="button" role="tab" aria-selected={item === locale}
          className={item === locale ? styles.activeTab : ''} onClick={() => switchLanguage(item)}>
          <span aria-hidden="true">{localeFlags[item]}</span> {settings.find((setting) => setting.locale === item)?.native_name || localeNames[item]}
        </button>)}
      </div>

      <div className={styles.workspace}>
        <nav className={styles.tree} aria-label="Catalog sections">
          <button type="button" className={showSettings ? styles.activeTree : ''}
            onClick={openSettings}>Language settings</button>
          {catalogSections.map((item) => <div key={item}>
            <button type="button" className={item === selectedSection && !showSettings ? styles.activeTree : ''}
              onClick={() => switchSection(item)}>{item}</button>
            {item === selectedSection && !showSettings && groups.map((group) => <button type="button" key={group}
              className={`${styles.child} ${group === selectedGroup ? styles.activeTree : ''}`}
              onClick={() => setSelectedGroup(group === selectedGroup ? null : group)}>{group}</button>)}
          </div>)}
        </nav>
        {showSettings ? <div className={styles.settingsPanel}>
          <div className={styles.editorHeading}><strong>Language settings</strong><span>{locale.toUpperCase()}</span></div>
          {currentSettings && <div className={styles.settings}>
            <label>Native name<input value={currentSettings.native_name} disabled={!isAdmin} onChange={(event) =>
              setEditedSettings({ ...currentSettings, native_name: event.target.value })} /></label>
            <label>State<select value={currentSettings.status} disabled={!isAdmin} onChange={(event) =>
              setEditedSettings({ ...currentSettings, status: event.target.value as LocaleStatus })}>
              <option value="implemented">Implemented</option><option value="beta" disabled={locale === 'en'}>Beta</option>
              <option value="draft" disabled={locale === 'en'}>Draft</option>
            </select></label>
            <label>Editor Hattrick IDs<input value={editorIdsText} disabled={!isAdmin} placeholder="Comma-separated IDs"
              onChange={(event) => setEditorIdsText(event.target.value)} /></label>
            {isAdmin && <Button variant="outline" disabled={busy || !settingsDirty} onClick={saveSettings}>Save settings</Button>}
          </div>}
        </div> :
        <div className={styles.editorWrap}>
          <div className={styles.editorHeading}><strong>{selectedSection}{selectedGroup ? ` / ${selectedGroup}` : ''}</strong>
            <span>{catalog?.registeredKeys.length || 0} keys · published v{catalog?.publishedVersion || 0}</span></div>
          <div className={styles.editor} ref={editorRef}>
            {!visibleKeys.length && <p className={styles.empty}>No registered UI messages in this section yet.</p>}
            {visibleKeys.map((key) => <label className={styles.line} key={key}>
              <span className={styles.key}>{key}</span><span className={styles.equals}>=</span>
              <span className={styles.valueCell}>
                <textarea ref={(node) => { fieldsRef.current[key] = node; }} data-catalog-key={key}
                  aria-label={key} rows={Math.min(10, Math.max(1, (draft[key] || '').split('\n').length,
                    Math.ceil((draft[key] || '').length / 90)))}
                  readOnly={!catalog?.canEdit}
                  onFocus={() => setActiveKey(key)}
                  onSelect={(event) => { focusRef.current = {
                    key, position: event.currentTarget.selectionStart, scroll: editorRef.current?.scrollTop || 0,
                  }; }}
                  value={draft[key] ?? ''} placeholder={catalog?.englishValues[key] || ''}
                  onChange={(event) => setDraft((old) => ({ ...old, [key]: event.target.value }))} />
                {activeKey === key && locale !== 'en' && catalog?.englishValues[key] &&
                  <span className={styles.englishReference}>English: {catalog.englishValues[key]}</span>}
              </span>
            </label>)}
          </div>
          <footer className={styles.footer}>
            <label className={styles.history}>Published history
              <select value={selectedHistoryVersion ?? ''} aria-label="Published history" disabled={!catalog?.canEdit}
                onChange={(event) => setSelectedHistoryVersion(Number(event.target.value) || null)}>
                <option value="">Latest 20 versions</option>
                {(catalog?.history || []).map((item) => <option key={item.version} value={item.version}>
                  v{item.version} · {new Date(item.published_at).toLocaleString()} · {item.author_name || `#${item.author_ht_id}`}
                </option>)}
              </select>
            </label>
            <div className={styles.actions}>
              <a href={`/${locale}?localePreview=1`} target="_blank" rel="noreferrer">Preview draft</a>
              <Button variant="outline" disabled={busy || !catalog?.canEdit || (!dirty && catalog.draftRevision > 0) || !visibleKeys.length} onClick={() => void send('save')}>Save draft</Button>
              <Button variant="outline" disabled={busy || !catalog?.canEdit || !selectedHistoryVersion}
                onClick={() => {
                  if (selectedHistoryVersion && window.confirm(`Restore published version ${selectedHistoryVersion} to this draft?`)) {
                    void send('restore', { version: selectedHistoryVersion });
                  }
                }}>Restore</Button>
              {isAdmin && <Button variant="primary" disabled={busy || dirty || !catalog?.draftRevision}
                onClick={() => void send('publish')}>Publish</Button>}
            </div>
          </footer>
        </div>}
      </div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
    </section>
  );
}
