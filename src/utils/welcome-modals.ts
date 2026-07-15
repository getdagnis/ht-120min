export const HOME_WELCOME_KEY = 'ht120_welcome_home_v1';
export const TINDER_WELCOME_KEY = 'ht120_welcome_tinder_v1';
export const TOURNAMENT_CREATED_WELCOME = 'created';

export function getTournamentVisitWelcomeKey(slug: string) {
  return `ht120_welcome_tournament_${slug}_v1`;
}

export function hasDismissedWelcome(key: string) {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(key) === 'true';
}

export function dismissWelcome(key: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(key, 'true');
}
