import { useEffect } from 'react';

export interface ActivityEventPayload {
  route?: string;
  tournamentId?: string;
  teamId?: string;
  metadata?: Record<string, unknown>;
}

export async function trackActivity(eventType: string, payload: ActivityEventPayload = {}) {
  try {
    await fetch('/api/app?route=activity', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType, ...payload }),
      keepalive: true,
    });
  } catch {
    // Analytics must never interrupt a user action or page navigation.
  }
}

function currentPageContext() {
  return {
    theme: document.documentElement.getAttribute('data-theme') || 'unknown',
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    screen: `${window.screen.width}x${window.screen.height}`,
  };
}

function readableControlLabel(element: Element) {
  const explicit = element.getAttribute('data-track') || element.getAttribute('aria-label') || element.getAttribute('title');
  if (explicit) return explicit.trim().slice(0, 80);
  if (element instanceof HTMLButtonElement) {
    return (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'button';
  }
  if (element instanceof HTMLAnchorElement) return `link:${element.pathname}`;
  return element.getAttribute('name') || element.id || element.tagName.toLowerCase();
}

function readableFieldLabel(element: Element) {
  const explicit = element.getAttribute('data-track') || element.getAttribute('aria-label') || element.getAttribute('name');
  if (explicit) return explicit.trim().slice(0, 80);
  const label = element.closest('label')?.textContent?.replace(/\s+/g, ' ').trim();
  return label?.slice(0, 80) || element.id || element.tagName.toLowerCase();
}

export function useActivityTracking(route: string) {
  useEffect(() => {
    const startedAt = Date.now();
    const scrollMilestones = new Set<number>();
    let maxScrollPercent = 0;
    let exitSent = false;

    const emitScrollMilestone = () => {
      const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
      const percent = scrollableHeight > 0 ? Math.min(100, Math.round((window.scrollY / scrollableHeight) * 100)) : 100;
      maxScrollPercent = Math.max(maxScrollPercent, percent);
      for (const milestone of [25, 50, 75, 90, 100]) {
        if (percent >= milestone && !scrollMilestones.has(milestone)) {
          scrollMilestones.add(milestone);
          void trackActivity('scroll_depth', {
            route,
            metadata: { ...currentPageContext(), depth: milestone },
          });
        }
      }
    };

    const emitPageExit = (reason: string) => {
      if (exitSent) return;
      exitSent = true;
      void trackActivity('page_exit', {
        route,
        metadata: {
          ...currentPageContext(),
          durationSeconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
          maxScrollPercent,
          reason,
        },
      });
    };

    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('button, a, [data-track]') : null;
      if (!target) return;
      void trackActivity('control_click', {
        route,
        metadata: { ...currentPageContext(), control: readableControlLabel(target) },
      });
    };

    const handleChange = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement || target instanceof HTMLInputElement)) return;
      if (target instanceof HTMLInputElement && !['checkbox', 'radio', 'range'].includes(target.type)) return;
      void trackActivity('option_change', {
        route,
        metadata: {
          ...currentPageContext(),
          control: readableFieldLabel(target),
          value: target instanceof HTMLSelectElement ? target.value : target.type === 'range' ? target.value : target.checked,
        },
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') emitPageExit('hidden');
    };
    const handlePageHide = () => emitPageExit('pagehide');

    void trackActivity('page_view', { route, metadata: currentPageContext() });
    window.addEventListener('scroll', emitScrollMilestone, { passive: true });
    document.addEventListener('click', handleClick);
    document.addEventListener('change', handleChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      window.removeEventListener('scroll', emitScrollMilestone);
      document.removeEventListener('click', handleClick);
      document.removeEventListener('change', handleChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [route]);
}
