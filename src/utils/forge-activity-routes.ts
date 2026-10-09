import { isLocale } from '../i18n/config.js';

export function tournamentActivityRoute(route: string | null | undefined): string | null {
  if (!route) return null;
  const parts = route.split(/[?#]/, 1)[0].split('/').filter(Boolean);
  const path = parts.length === 3 && isLocale(parts[0]) ? parts.slice(1) : parts;
  if (path.length !== 2 || path[0] !== 't' || !/^[a-z0-9-]+$/i.test(path[1])) return null;
  return `/t/${path[1].toLowerCase()}`;
}

export function mostViewedTournament(
  routes: ReadonlyMap<string, number> | undefined,
  uniqueCounts?: ReadonlyMap<string, number>,
) {
  const top = [...(routes?.entries() || [])].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return top ? { route: top[0], count: top[1], ...(uniqueCounts?.has(top[0]) ? { uniqueCount: uniqueCounts.get(top[0]) } : {}) } : null;
}

export function summarizeUniqueTournamentViews(
  events: readonly { occurred_at: string; event_type: string; route: string | null; visitor_id: string }[],
  bucketForDay: (day: string) => string,
) {
  const visitorsByRoute = new Map<string, Set<string>>();
  for (const event of events) {
    const route = event.event_type === 'page_view' ? tournamentActivityRoute(event.route) : null;
    if (!route) continue;
    const key = `${bucketForDay(event.occurred_at.slice(0, 10))}\u0000${route}`;
    const visitors = visitorsByRoute.get(key) || new Set<string>();
    visitors.add(event.visitor_id);
    visitorsByRoute.set(key, visitors);
  }
  return [...visitorsByRoute].map(([key, visitors]) => {
    const [activity_date, route] = key.split('\u0000');
    return { activity_date, route, visitor_count: visitors.size };
  });
}
