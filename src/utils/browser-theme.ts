import type { EffectiveTheme } from './theme';

export type ThemePreference = EffectiveTheme | 'system';
const THEME_CHANGED_EVENT = 'ht-120min:theme-changed';

export function normalizeTournamentTheme(value: unknown): EffectiveTheme | null {
  return value === 'light' || value === 'dark' ? value : null;
}

export function getThemeSnapshot(): ThemePreference {
  const tournamentTheme = normalizeTournamentTheme(document.documentElement.dataset.tournamentTheme);
  if (tournamentTheme) return tournamentTheme;
  try {
    return normalizeTournamentTheme(localStorage.getItem('theme')) ?? 'system';
  } catch {
    return 'system';
  }
}

export function getServerThemeSnapshot(): ThemePreference { return 'system'; }

export function applyCurrentTheme() {
  const theme = getThemeSnapshot();
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme;
}

export function subscribeToTheme(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(THEME_CHANGED_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(THEME_CHANGED_EVENT, callback);
  };
}

export function setTournamentTheme(theme: EffectiveTheme | null) {
  if (theme) document.documentElement.dataset.tournamentTheme = theme;
  else delete document.documentElement.dataset.tournamentTheme;
  applyCurrentTheme();
  window.dispatchEvent(new Event(THEME_CHANGED_EVENT));
}

export function toggleCurrentTheme() {
  const current = getThemeSnapshot();
  const isLight = current === 'light' || (current === 'system' && !window.matchMedia('(prefers-color-scheme: dark)').matches);
  const next = isLight ? 'dark' : 'light';
  if (document.documentElement.dataset.tournamentTheme) {
    setTournamentTheme(next);
  } else {
    try { localStorage.setItem('theme', next); } catch { /* Storage can be disabled. */ }
    document.documentElement.dataset.theme = next;
    window.dispatchEvent(new Event(THEME_CHANGED_EVENT));
  }
}
