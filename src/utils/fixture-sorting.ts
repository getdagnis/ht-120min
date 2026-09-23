export interface FixtureSortInput {
  id: string;
  ht_match_id?: number | null;
  match_date?: Date | string | null;
}

function fixtureTimestamp(value: FixtureSortInput['match_date']) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  if (typeof value === 'string') {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }
  return 0;
}

/** Keeps SSR, full refreshes, and fixture-only refreshes in the same display order. */
export function compareFixtures<T extends FixtureSortInput>(a: T, b: T) {
  const dateDifference = fixtureTimestamp(a.match_date) - fixtureTimestamp(b.match_date);
  if (dateDifference !== 0) return dateDifference;

  const aHtMatchId = Number(a.ht_match_id) || Number.MAX_SAFE_INTEGER;
  const bHtMatchId = Number(b.ht_match_id) || Number.MAX_SAFE_INTEGER;
  if (aHtMatchId !== bHtMatchId) return aHtMatchId - bHtMatchId;

  return a.id.localeCompare(b.id);
}
