import { useCallback, useEffect, useState } from 'react';
import {
  buildForgeAuthReturnUrl,
  clearForgeAuthSession,
  clearMainAuthSession,
  FORGE_AUTH_MANAGER_NAME_KEY,
  FORGE_AUTH_USER_ID_KEY,
} from '../utils/auth-storage';

export const useForgeAuth = () => {
  const [loading, setLoading] = useState(true);
  const [serverAuthorized, setServerAuthorized] = useState(false);
  const [role, setRole] = useState<'admin' | 'locale-editor' | null>(null);
  const [managerName, setManagerName] = useState<string | null>(() =>
    localStorage.getItem(FORGE_AUTH_MANAGER_NAME_KEY),
  );
  const [userId, setUserId] = useState<number | null>(() => {
    const stored = Number(localStorage.getItem(FORGE_AUTH_USER_ID_KEY) || '0');
    return stored || null;
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch('/api/app?route=forge-session', { credentials: 'include' });
        const data = (await response.json()) as {
          authorized?: boolean; userId?: number; managerName?: string | null; role?: 'admin' | 'locale-editor';
        };
        if (cancelled) return;
        if (data.authorized && data.userId) {
          setServerAuthorized(true);
          setRole(data.role || null);
          setUserId(data.userId);
          setManagerName(data.managerName || localStorage.getItem(FORGE_AUTH_MANAGER_NAME_KEY));
        } else {
          setServerAuthorized(false);
          setRole(null);
          setUserId(null);
          setManagerName(null);
        }
      } catch {
        if (!cancelled) {
          setUserId(null);
          setManagerName(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const isDevBypass = false;
  const isAuthorized = serverAuthorized;

  const login = useCallback(() => {
    const returnUrl = buildForgeAuthReturnUrl(window.location.pathname, window.location.search);
    document.cookie = `auth_return_url=${encodeURIComponent(returnUrl)}; path=/; max-age=300`;
    window.location.href = '/api/auth/init';
  }, []);

  const logoutForge = useCallback(() => {
    void fetch('/api/app?route=forge-session', { method: 'POST', credentials: 'include' }).finally(() => {
      clearForgeAuthSession();
      setServerAuthorized(false);
      setRole(null);
      setManagerName(null);
      setUserId(null);
    });
  }, []);

  const logoutMain = useCallback(() => {
    clearMainAuthSession();
    window.location.href = '/';
  }, []);

  const logoutLocaleEditor = useCallback(() => {
    void fetch('/api/auth/complete', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear_session' }),
    }).finally(() => {
      clearMainAuthSession();
      setServerAuthorized(false);
      setRole(null);
      window.location.href = '/';
    });
  }, []);

  const hydrateFromStorage = useCallback(() => {
    const storedManagerName = localStorage.getItem(FORGE_AUTH_MANAGER_NAME_KEY);
    setManagerName(storedManagerName);
    const storedUserId = Number(localStorage.getItem(FORGE_AUTH_USER_ID_KEY) || '0');
    setUserId(storedUserId || null);
    setServerAuthorized(false);
    setRole(null);
  }, []);

  return {
    managerName,
    userId,
    isAuthorized,
    role,
    loading,
    isDevBypass,
    login,
    logoutForge,
    logoutMain,
    logoutLocaleEditor,
    hydrateFromStorage,
  };
};
