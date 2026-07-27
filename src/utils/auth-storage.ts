export const MAIN_AUTH_MANAGER_NAME_KEY = 'my_ht_manager_name';
export const MAIN_AUTH_USER_ID_KEY = 'my_ht_user_id';
export const MAIN_AUTH_TEAM_NAME_KEY = 'my_ht_team_name';

export const FORGE_AUTH_MANAGER_NAME_KEY = 'forge_ht_manager_name';
export const FORGE_AUTH_USER_ID_KEY = 'forge_ht_user_id';

export const FORGE_AUTH_RETURN_FLAG = 'forgeAuth=1';

export function clearMainAuthSession(storage: Storage = localStorage) {
  storage.removeItem(MAIN_AUTH_MANAGER_NAME_KEY);
  storage.removeItem(MAIN_AUTH_USER_ID_KEY);
  storage.removeItem(MAIN_AUTH_TEAM_NAME_KEY);
}

export function setMainAuthSession(
  managerName: string,
  userId: number,
  teamName?: string | null,
  storage: Storage = localStorage,
) {
  storage.setItem(MAIN_AUTH_MANAGER_NAME_KEY, managerName);
  storage.setItem(MAIN_AUTH_USER_ID_KEY, String(userId));
  if (teamName === undefined) {
    return;
  }

  if (teamName) {
    storage.setItem(MAIN_AUTH_TEAM_NAME_KEY, teamName);
  } else {
    storage.removeItem(MAIN_AUTH_TEAM_NAME_KEY);
  }
}

export function clearForgeAuthSession(storage: Storage = localStorage) {
  storage.removeItem(FORGE_AUTH_MANAGER_NAME_KEY);
  storage.removeItem(FORGE_AUTH_USER_ID_KEY);
}

export function setForgeAuthSession(managerName: string, userId: number, storage: Storage = localStorage) {
  storage.setItem(FORGE_AUTH_MANAGER_NAME_KEY, managerName);
  storage.setItem(FORGE_AUTH_USER_ID_KEY, String(userId));
}

export function isForgeAuthReturnUrl(returnUrl: string | null | undefined) {
  return !!returnUrl && returnUrl.includes(FORGE_AUTH_RETURN_FLAG);
}

export function stripForgeAuthFlag(returnUrl: string) {
  try {
    const url = new URL(returnUrl, window.location.origin);
    url.searchParams.delete('forgeAuth');
    const nextSearch = url.searchParams.toString();
    return `${url.pathname}${nextSearch ? `?${nextSearch}` : ''}${url.hash}`;
  } catch {
    return returnUrl.replace(/[?&]forgeAuth=1/, '').replace('?&', '?').replace(/&$/, '');
  }
}

export function buildForgeAuthReturnUrl(pathname: string, search = '') {
  const url = new URL(`${pathname}${search}`, window.location.origin);
  url.searchParams.set('forgeAuth', '1');
  return `${url.pathname}${url.search}${url.hash}`;
}
