'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import styles from './NavigationFeedback.module.sass';

/** Feedback before even a cold/unprefetched route has returned its loading shell. */
export function NavigationFeedback() {
  const pathname = usePathname();
  const [navigation, setNavigation] = useState({ pathname, pending: false });
  // Reset on every committed route, including Back; no stale pending state on return.
  if (navigation.pathname !== pathname) setNavigation({ pathname, pending: false });

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const onClick = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.defaultPrevented
      )
        return;
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement | HTMLElement>('a[href], [data-navigation-href]');
      const href = link?.getAttribute('href') || link?.dataset.navigationHref;
      if (!href || link?.getAttribute('target') === '_blank' || link?.hasAttribute('download')) return;
      const destination = new URL(href, window.location.href);
      if (destination.origin !== window.location.origin || destination.pathname === pathname) return;
      setNavigation({ pathname, pending: true });
      clearTimeout(timeout);
      timeout = setTimeout(() => setNavigation({ pathname, pending: false }), 30_000);
    };
    document.addEventListener('click', onClick, true);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener('click', onClick, true);
    };
  }, [pathname]);

  return navigation.pending ? (
    <p className={styles.pending} role="status" aria-live="polite">
      Loding…
    </p>
  ) : null;
}
