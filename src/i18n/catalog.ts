import en from './messages/en.js';
import lv from './messages/lv.js';
import { localeNames, locales, type Locale } from './config.js';

export type CatalogSection = 'System' | 'Home' | 'TournamentView' | 'CreateTournament' | 'Tinder' | 'ManagerProfiles' | 'Collections' | 'Supporters' | 'Auth';
export type LocaleStatus = 'implemented' | 'beta' | 'draft';
export type CatalogValues = Record<string, string>;
export interface PublicLocaleOption {
  locale: Locale;
  status: 'implemented' | 'beta';
  nativeName: string;
}

export interface LocaleMenuOption extends Omit<PublicLocaleOption, 'status'> {
  status: LocaleStatus;
}

export function authorizedLocaleMenuOptions(
  settings: Array<{ locale: string; status: string; native_name: string; editor_ht_ids?: number[] }>,
  userId: number | null,
  admin: boolean,
): LocaleMenuOption[] {
  return locales.flatMap((locale) => {
    const setting = settings.find((item) => item.locale === locale);
    if (!setting) return [];
    if (setting.status !== 'implemented' && setting.status !== 'beta' &&
      !(setting.status === 'draft' && (admin || (userId !== null && setting.editor_ht_ids?.includes(userId))))) return [];
    return [{ locale, status: setting.status as LocaleStatus, nativeName: setting.native_name || localeNames[locale] }];
  });
}

export function publicLocaleOptions(settings: Array<{ locale: string; status: string; native_name: string }>): PublicLocaleOption[] {
  return locales.flatMap((locale) => {
    const setting = settings.find((item) => item.locale === locale);
    if (setting?.status !== 'implemented' && setting?.status !== 'beta') return [];
    return [{ locale, status: setting.status, nativeName: setting.native_name || localeNames[locale] }];
  });
}

export const catalogSections: readonly CatalogSection[] = [
  'System', 'Home', 'TournamentView', 'CreateTournament', 'Tinder', 'ManagerProfiles', 'Collections', 'Supporters', 'Auth',
];

const publicUiSections: Record<string, CatalogSection> = {
  AuthCallback: 'Auth',
  CreateTournament: 'CreateTournament',
  ProfilePage: 'ManagerProfiles',
  MatchmakerBrowseDeck: 'Tinder',
  TournamentView: 'TournamentView',
  Matchmaker: 'Tinder',
  TeamByline: 'ManagerProfiles',
  WelcomeModal: 'Home',
  PublicDataUnavailable: 'System',
  ToastRegion: 'System',
  ToastItemView: 'System',
  CollectionMembershipPanel: 'Collections',
  CollectionView: 'Collections',
  ReserveTeamsWidget: 'TournamentView',
  ProfileModal: 'ManagerProfiles',
  TeamDisplay: 'ManagerProfiles',
  MatchRecord: 'TournamentView',
  SeasonYearbook: 'TournamentView',
  TournamentHistory: 'TournamentView',
  NewsComments: 'TournamentView',
  StandingsView: 'TournamentView',
  TournamentActivity: 'TournamentView',
  TeamOwnershipReclaim: 'CreateTournament',
  Modal: 'System',
  NoticeDialog: 'System',
  DeleteConfirmationFlow: 'System',
  Layout: 'System',
  SidebarPollWidget: 'TournamentView',
  ModalTeamCard: 'CreateTournament',
  TournamentBadgeChips: 'TournamentView',
  GameStyle: 'TournamentView',
  RatingsPitch: 'TournamentView',
  FixtureCard: 'TournamentView',
  NewsTab: 'TournamentView',
  StandingsRoundPreview: 'TournamentView',
  FixturesView: 'TournamentView',
  NavigationFeedback: 'System',
  SupportersWall: 'Supporters',
  TinderWidget: 'Tinder',
  TeamSelectorModal: 'CreateTournament',
  ManagerSpotlight: 'ManagerProfiles',
};

// Keys are assigned by their owning screen, even where a legacy dictionary namespace is shared.
export function sectionForKey(key: string): CatalogSection {
  if (key.startsWith('PublicUI.')) return publicUiSections[key.split('.')[1]] || 'System';
  for (const section of catalogSections.slice(2)) {
    if (key.startsWith(`${section}.`)) return section;
  }
  if (key.startsWith('Home.tinder')) return 'Tinder';
  if (key.startsWith('Home.')) return 'Home';
  if (key.startsWith('fixtures.') || key.startsWith('lobby.')) return 'TournamentView';
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
    if (!(path in englishCatalog) || !value.trim() || value.trim() === path) continue;
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
