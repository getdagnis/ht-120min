import { useEffect, useState, useSyncExternalStore } from 'react';

function subscribeToHydration() {
  return () => undefined;
}

function getClientHydrationSnapshot() {
  return true;
}

function getServerHydrationSnapshot() {
  return false;
}

export function useHydrationReady() {
  return useSyncExternalStore(subscribeToHydration, getClientHydrationSnapshot, getServerHydrationSnapshot);
}

function subscribeToStorage(callback: () => void) {
  if (typeof window === 'undefined') return () => undefined;

  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

function getStorageSnapshot(key: string) {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(key);
}

function getServerStorageSnapshot() {
  return null;
}

export function useHydratedLocalStorage(key: string) {
  return useSyncExternalStore(subscribeToStorage, () => getStorageSnapshot(key), getServerStorageSnapshot);
}

export function useClientNow(intervalMs = 60_000) {
  const [now, setNow] = useState(0);

  useEffect(() => {
    const updateNow = () => setNow(Date.now());
    const initialTimer = window.setTimeout(updateNow, 0);
    const interval = window.setInterval(updateNow, intervalMs);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, [intervalMs]);

  return now;
}
