export interface WeeklyNewsPostBase {
  id: string;
  created_at: string;
  is_admin?: boolean | null;
}

// Official tournament press releases are prioritized until they become this old
const PRIORITY_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export function pickFrontpageWeeklyPosts<T extends WeeklyNewsPostBase>(posts: T[], now = Date.now()) {
  const newestFirst = [...posts].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const freshOfficial = newestFirst
    .filter((post) => post.is_admin && now - new Date(post.created_at).getTime() <= PRIORITY_DAYS_MS)
    .slice(0, 3);

  const pickedIds = new Set(freshOfficial.map((post) => post.id));

  const fill = newestFirst
    .filter((post) => !pickedIds.has(post.id))
    .slice(0, Math.max(0, 3 - freshOfficial.length));

  return [...freshOfficial, ...fill].slice(0, 3);
}