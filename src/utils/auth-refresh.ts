export const REQUIRED_AUTH_REFRESH_VERSION = '2026-07-01-manage-challenges';
export const AUTH_REFRESH_VERSION_KEY = 'auth_refresh_version';

export function markAuthRefreshCurrent(storage: Storage = localStorage) {
  storage.setItem(AUTH_REFRESH_VERSION_KEY, REQUIRED_AUTH_REFRESH_VERSION);
}

export function needsAuthRefresh(storage: Storage = localStorage) {
  return storage.getItem(AUTH_REFRESH_VERSION_KEY) !== REQUIRED_AUTH_REFRESH_VERSION;
}

