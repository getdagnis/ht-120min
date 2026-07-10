import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildForgeAuthReturnUrl,
  clearForgeAuthSession,
  clearMainAuthSession,
  FORGE_AUTH_MANAGER_NAME_KEY,
  FORGE_AUTH_USER_ID_KEY,
} from '../utils/auth-storage';
import { FORGE_SUPERADMIN_USER_ID } from '../constants/site-admins';
import { hasSuperAdminBypassCookie } from '../utils/superadmin-bypass';

export const useForgeAuth = () => {
  const [managerName, setManagerName] = useState<string | null>(() =>
    localStorage.getItem(FORGE_AUTH_MANAGER_NAME_KEY),
  );
  const [userId, setUserId] = useState<number | null>(() => {
    const stored = Number(localStorage.getItem(FORGE_AUTH_USER_ID_KEY) || '0');
    return stored || null;
  });

  useEffect(() => {
    setTimeout(() => {
      setManagerName(localStorage.getItem(FORGE_AUTH_MANAGER_NAME_KEY));
      const stored = Number(localStorage.getItem(FORGE_AUTH_USER_ID_KEY) || '0');
      setUserId(stored || null);
    }, 0);
  }, []);

  const isDevBypass = useMemo(() => {
    try {
      return hasSuperAdminBypassCookie(document.cookie);
    } catch {
      return false;
    }
  }, []);

  const isAuthorized = isDevBypass || userId === FORGE_SUPERADMIN_USER_ID;

  const login = useCallback(() => {
    const returnUrl = buildForgeAuthReturnUrl(window.location.pathname, window.location.search);
    document.cookie = `auth_return_url=${encodeURIComponent(returnUrl)}; path=/; max-age=300`;
    window.location.href = '/api/auth/init';
  }, []);

  const logoutForge = useCallback(() => {
    clearForgeAuthSession();
    setManagerName(null);
    setUserId(null);
  }, []);

  const logoutMain = useCallback(() => {
    clearMainAuthSession();
    window.location.href = '/';
  }, []);

  const hydrateFromStorage = useCallback(() => {
    const storedManagerName = localStorage.getItem(FORGE_AUTH_MANAGER_NAME_KEY);
    setManagerName(storedManagerName);
    const storedUserId = Number(localStorage.getItem(FORGE_AUTH_USER_ID_KEY) || '0');
    setUserId(storedUserId || null);
  }, []);

  return {
    managerName,
    userId,
    isAuthorized,
    isDevBypass,
    login,
    logoutForge,
    logoutMain,
    hydrateFromStorage,
  };
};
