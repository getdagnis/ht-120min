'use client';

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Home and Tournament View have dedicated SSR route boundaries. When a link
 * leaves one of those boundaries, reload the destination so Next can select
 * its own route instead of leaving React Router with no matching element.
 */
export function LegacyRouteHandoff() {
  const location = useLocation();

  useEffect(() => {
    window.location.replace(window.location.href);
  }, [location.hash, location.pathname, location.search]);

  return <div role="status">Opening page…</div>;
}
