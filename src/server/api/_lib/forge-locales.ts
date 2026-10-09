import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isForgeEnabled } from '../../forge-availability.js';
import { getAppSessionSecret, verifyAppSessionCookie } from './app-session.js';
import { verifyForgeSessionCookie } from './forge-session.js';
import { getServiceSupabase } from './supabase.js';
import { isLocale, localeNames } from '../../../i18n/config.js';
import {
  catalogSections, englishCatalog, keysForSection, sectionForKey,
  sourceCatalogs, type CatalogSection, type CatalogValues, type LocaleStatus,
} from '../../../i18n/catalog.js';
import { validateCatalogValues } from '../../../i18n/catalog-validation.js';

function section(value: unknown): CatalogSection | null {
  return typeof value === 'string' && catalogSections.includes(value as CatalogSection)
    ? value as CatalogSection : null;
}

async function access(req: VercelRequest) {
  const admin = verifyForgeSessionCookie(req.headers.cookie);
  if (admin) return { userId: admin.userId, admin: true };
  const secret = getAppSessionSecret();
  const session = secret ? verifyAppSessionCookie(req.headers.cookie, secret) : null;
  return session ? { userId: session.userId, admin: false } : null;
}

export async function handleForgeLocales(req: VercelRequest, res: VercelResponse) {
  if (!isForgeEnabled()) return res.status(404).json({ error: 'Not found.' });
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  res.setHeader('Cache-Control', 'private, no-store');
  const actor = await access(req);
  if (!actor) return res.status(401).json({ error: 'Sign in to edit locales.' });
  const db = getServiceSupabase(6000);
  const { data: settings, error: settingsError } = await db.from('locale_catalog_settings')
    .select('locale, native_name, status, editor_ht_ids, updated_at');
  if (settingsError) throw settingsError;
  const assignedSettings = (settings || []).filter((row) => actor.admin || row.editor_ht_ids?.includes(actor.userId));
  if (!actor.admin && !assignedSettings.length) return res.status(403).json({ error: 'Locale editor access required.' });
  const visibleSettings = actor.admin ? assignedSettings : (settings || [])
    .filter((row) => row.locale === 'en' || row.editor_ht_ids?.includes(actor.userId))
    .map((row) => ({ ...row, editor_ht_ids: row.editor_ht_ids?.includes(actor.userId) ? [actor.userId] : [] }));

  if (req.method === 'POST' && req.body?.action === 'settings') {
    if (!actor.admin) return res.status(403).json({ error: 'Forge admin access required.' });
    const locale = req.body?.locale;
    const nativeName = req.body?.nativeName;
    const status = req.body?.status as LocaleStatus;
    const editorIds = req.body?.editorIds;
    if (!isLocale(locale) || typeof nativeName !== 'string' || !nativeName.trim() || nativeName.length > 80
      || !['implemented', 'beta', 'draft'].includes(status) || (locale === 'en' && status !== 'implemented')
      || !Array.isArray(editorIds) || editorIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      return res.status(400).json({ error: 'Invalid language settings.' });
    }
    const { error } = await db.from('locale_catalog_settings').update({
      native_name: nativeName.trim(), status, editor_ht_ids: [...new Set(editorIds)], updated_at: new Date().toISOString(),
    }).eq('locale', locale);
    if (error) throw error;
    return res.status(200).json({ saved: true });
  }

  const locale = req.method === 'GET' ? req.query.locale : req.body?.locale;
  if (!locale) return res.status(200).json({ settings: visibleSettings, role: actor.admin ? 'admin' : 'editor' });
  if (!isLocale(locale) || !visibleSettings.some((row) => row.locale === locale)) {
    return res.status(403).json({ error: 'Locale access required.' });
  }
  const canEdit = actor.admin || assignedSettings.some((row) => row.locale === locale);
  const selectedSection = section(req.method === 'GET' ? req.query.section : req.body?.section);
  if (!selectedSection) return res.status(400).json({ error: 'Invalid catalog section.' });

  if (req.method === 'POST') {
    if (!canEdit) return res.status(403).json({ error: 'Locale editor access required.' });
    const action = req.body?.action;
    const expectedRevision = req.body?.expectedRevision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      return res.status(400).json({ error: 'Invalid draft revision.' });
    }
    if (action === 'publish' && !actor.admin) return res.status(403).json({ error: 'Forge admin access required.' });
    let values: CatalogValues | null = null;
    if (action === 'save') values = validateCatalogValues(req.body?.values, selectedSection);
    if (action === 'restore') {
      if (!Number.isSafeInteger(req.body?.version) || req.body.version < 1) {
        return res.status(400).json({ error: 'Invalid published version.' });
      }
      const { data, error } = await db.from('locale_catalog_history').select('catalog_values')
        .eq('locale', locale).eq('section', selectedSection).eq('version', req.body.version).maybeSingle();
      if (error) throw error;
      values = validateCatalogValues(data?.catalog_values, selectedSection);
    }
    if (action === 'save' || action === 'restore') {
      if (!values) return res.status(400).json({ error: 'Values must use registered keys and valid message syntax.' });
      if (expectedRevision === 0) {
        const { error } = await db.from('locale_catalog_sections').insert({
          locale, section: selectedSection, draft_values: values, draft_revision: 1,
        });
        if (error?.code === '23505') return res.status(409).json({ error: 'Draft changed. Reload this section.' });
        if (error) throw error;
        return res.status(200).json({ draftRevision: 1 });
      }
      const { data, error } = await db.from('locale_catalog_sections').update({
        draft_values: values, draft_revision: expectedRevision + 1, updated_at: new Date().toISOString(),
      }).eq('locale', locale).eq('section', selectedSection).eq('draft_revision', expectedRevision)
        .select('draft_revision').maybeSingle();
      if (error) throw error;
      if (!data) return res.status(409).json({ error: 'Draft changed. Reload this section.' });
      return res.status(200).json({ draftRevision: data.draft_revision });
    }
    if (action === 'publish') {
      const { data: draft, error: draftError } = await db.from('locale_catalog_sections')
        .select('draft_values').eq('locale', locale).eq('section', selectedSection).maybeSingle();
      if (draftError) throw draftError;
      if (!validateCatalogValues(draft?.draft_values, selectedSection)) {
        return res.status(400).json({ error: 'Draft values are invalid.' });
      }
      const { data, error } = await db.rpc('publish_locale_catalog_section', {
        p_locale: locale, p_section: selectedSection,
        p_expected_draft_revision: expectedRevision, p_author_ht_id: actor.userId,
      });
      if (error?.code === '40001') return res.status(409).json({ error: 'Draft changed. Reload this section.' });
      if (error) throw error;
      return res.status(200).json({ version: data });
    }
    return res.status(400).json({ error: 'Unknown locale action.' });
  }

  const [rowResult, historyResult] = await Promise.all([
    db.from('locale_catalog_sections').select('draft_values, draft_revision, published_values, published_version')
      .eq('locale', locale).eq('section', selectedSection).maybeSingle(),
    db.from('locale_catalog_history').select('version, author_ht_id, published_at')
      .eq('locale', locale).eq('section', selectedSection).order('version', { ascending: false }).limit(20),
  ]);
  if (rowResult.error) throw rowResult.error;
  if (historyResult.error) throw historyResult.error;
  const authorIds = [...new Set((historyResult.data || []).map((item) => item.author_ht_id))];
  const authors = authorIds.length ? await db.from('profiles').select('hattrick_user_id, manager_name')
    .in('hattrick_user_id', authorIds) : { data: [], error: null };
  if (authors.error) throw authors.error;
  const authorNames = Object.fromEntries((authors.data || []).map((item) => [item.hattrick_user_id, item.manager_name]));
  const sourceValues = Object.fromEntries(keysForSection(selectedSection).map((key) => [key, sourceCatalogs[locale][key] || '']));
  return res.status(200).json({
    settings: visibleSettings, role: actor.admin ? 'admin' : 'editor', locale, section: selectedSection,
    canEdit,
    sourceValues,
    draftValues: { ...sourceValues, ...(rowResult.data?.draft_values || {}) },
    draftRevision: rowResult.data?.draft_revision || 0,
    publishedValues: rowResult.data?.published_values || {},
    publishedVersion: rowResult.data?.published_version || 0,
    history: (historyResult.data || []).map((item) => ({ ...item, author_name: authorNames[item.author_ht_id] || null })),
    registeredKeys: keysForSection(selectedSection),
    groups: Object.fromEntries(keysForSection(selectedSection).map((key) => [key, sectionForKey(key)])),
    englishValues: Object.fromEntries(keysForSection(selectedSection).map((key) => [key, englishCatalog[key]])),
    nativeName: localeNames[locale],
  });
}
