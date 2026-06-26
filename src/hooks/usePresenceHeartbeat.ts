import { useEffect, useRef } from 'react';

const INTERVAL_MS = 60 * 1000; // 1 minute while visible

async function ping() {
  try {
    const res = await fetch('/api/presence', { method: 'POST', credentials: 'include' });
    if (!res.ok && import.meta.env.DEV) {
      console.warn('[presence] ping failed', res.status, await res.text());
    }
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[presence] ping error', e);
  }
}

export function usePresenceHeartbeat(loggedIn: boolean, activitySignal: string) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!loggedIn) return;

    const start = () => {
      if (intervalRef.current) return;
      intervalRef.current = setInterval(ping, INTERVAL_MS);
    };
    const stop = () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void ping();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') {
      void ping();
      start();
    }

    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loggedIn, activitySignal]);
}
