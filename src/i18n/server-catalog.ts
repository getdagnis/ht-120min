import 'server-only';
import { cache } from 'react';
import { getServiceSupabase } from '../server/api/_lib/supabase.js';
import { getAppSessionSecret, verifyAppSessionCookie } from '../server/api/_lib/app-session.js';
import { verifyForgeSessionCookie } from '../server/api/_lib/forge-session.js';
import { defaultLocale, localeNames, locales, type Locale } from './config';
import { applyCatalogValues, publicLocaleOptions, type CatalogValues, type PublicLocaleOption } from './catalog';
import { getDictionary, type Dictionary } from './get-dictionary';

export type { PublicLocaleOption } from './catalog';

export const loadPublicLocaleSettings = cache(async (): Promise<{ options: PublicLocaleOption[]; available: boolean }> => {
  try {
    const { data, error } = await getServiceSupabase(6000)
      .from('locale_catalog_settings').select('locale, status, native_name').in('locale', [...locales]);
    if (error) throw error;
    return { options: publicLocaleOptions(data || []), available: true };
  } catch (error) {
    console.warn('Locale settings unavailable; keeping English available.', error);
    return { options: [{ locale: defaultLocale, status: 'implemented', nativeName: localeNames[defaultLocale] }], available: false };
  }
});

export async function canPreviewLocale(locale: Locale, previewHeader: string | null, cookieHeader: string | null) {
  if (previewHeader !== '1') return false;
  if (verifyForgeSessionCookie(cookieHeader || undefined)) return true;
  const secret = getAppSessionSecret();
  const session = secret ? verifyAppSessionCookie(cookieHeader || undefined, secret) : null;
  if (!session) return false;
  try {
    const { data, error } = await getServiceSupabase(6000).from('locale_catalog_settings')
      .select('editor_ht_ids').eq('locale', locale).maybeSingle();
    return !error && Boolean(data?.editor_ht_ids?.includes(session.userId));
  } catch { return false; }
}

export async function loadRuntimeDictionary(locale: Locale, preview = false): Promise<Dictionary> {
  let result: Dictionary = getDictionary(locale);
  try {
    const { data, error } = await getServiceSupabase(6000)
      .from('locale_catalog_sections')
      .select('section, draft_values, published_values')
      .eq('locale', locale);
    if (error) throw error;
    for (const row of data || []) {
      const values = (preview ? row.draft_values : row.published_values) as CatalogValues | null;
      if (values) result = applyCatalogValues(result, values);
    }
  } catch (error) {
    console.warn('Published locale catalog unavailable; using source dictionary.', { locale, error });
  }
  return result;
}

export function availableLocaleOrDefault(options: PublicLocaleOption[], locale: Locale) {
  return options.some((option) => option.locale === locale) ? locale : defaultLocale;
}
