import en from './messages/en.js';
import lv from './messages/lv.js';
import { localeNames, locales, type Locale } from './config.js';

export type CatalogSection = 'System' | 'Home' | 'TournamentView' | 'CreateTournament' | 'Tinder' | 'ManagerProfiles';
export type LocaleStatus = 'implemented' | 'beta' | 'draft';
export type CatalogValues = Record<string, string>;
export interface PublicLocaleOption {
  locale: Locale;
  status: 'implemented' | 'beta';
  nativeName: string;
}

export function publicLocaleOptions(settings: Array<{ locale: string; status: string; native_name: string }>): PublicLocaleOption[] {
  return locales.flatMap((locale) => {
    const setting = settings.find((item) => item.locale === locale);
    if (setting?.status !== 'implemented' && setting?.status !== 'beta') return [];
    return [{ locale, status: setting.status, nativeName: setting.native_name || localeNames[locale] }];
  });
}

export const catalogSections: readonly CatalogSection[] = [
  'System', 'Home', 'TournamentView', 'CreateTournament', 'Tinder', 'ManagerProfiles',
];

// Keys are assigned by their owning screen, even where a legacy dictionary namespace is shared.
export function sectionForKey(key: string): CatalogSection {
  for (const section of catalogSections.slice(2)) {
    if (key.startsWith(`${section}.`)) return section;
  }
  if (key.startsWith('Home.tinder')) return 'Tinder';
  if (key.startsWith('Home.')) return 'Home';
  if (key.startsWith('fixtures.')) return 'TournamentView';
  return 'System';
}

export function flattenMessages(source: unknown, prefix = ''): CatalogValues {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  return Object.fromEntries(Object.entries(source).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [[path, value]] : Object.entries(flattenMessages(value, path));
  }));
}

export const englishCatalog = flattenMessages(en);
export const sourceCatalogs: Record<Locale, CatalogValues> = { en: englishCatalog, lv: flattenMessages(lv) };

export function keysForSection(section: CatalogSection) {
  return Object.keys(englishCatalog).filter((key) => sectionForKey(key) === section);
}

export function applyCatalogValues<T extends object>(source: T, overrides: CatalogValues): T {
  const output = structuredClone(source) as Record<string, unknown>;
  for (const [path, value] of Object.entries(overrides)) {
    if (!(path in englishCatalog) || !value.trim()) continue;
    const parts = path.split('.');
    let target: Record<string, unknown> = output;
    for (const part of parts.slice(0, -1)) {
      const next = target[part];
      if (!next || typeof next !== 'object' || Array.isArray(next)) break;
      target = next as Record<string, unknown>;
    }
    const leaf = parts.at(-1);
    if (leaf && typeof target[leaf] === 'string') target[leaf] = value;
  }
  return output as T;
}
