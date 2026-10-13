import type { SpecialtyPositionGroup } from '../../shared/player-specialties.js';

export interface SharedFixtureRatings {
  id: string;
  fixture_id: string;
  team_id: string;
  ht_match_id: number;
  left_attack: number;
  centre_attack: number;
  right_attack: number;
  midfield: number;
  left_defence: number;
  centre_defence: number;
  right_defence: number;
  formation: string;
  tactic: string;
  tactic_skill: number | null;
  coach_modifier: number | null;
  set_pieces_skill: number | null;
  specialty_positions: SpecialtyPositionGroup[] | null;
  fetched_at: string;
}

export interface FixtureRatingShareStatus {
  fixture_id: string;
  team_id: string;
  ht_match_id: number;
  shared?: boolean;
  auto_sharing_enabled?: boolean;
  orders_given?: boolean | null;
  orders_checked_at?: string | null;
}

// Only these status fields may enter the shared public tournament cache.
export const PUBLIC_FIXTURE_RATING_STATUS_FIELDS = 'fixture_id,team_id,ht_match_id,shared,auto_sharing_enabled,orders_given,orders_checked_at';
export const PRIVATE_FIXTURE_RATINGS_FIELDS =
  'id,fixture_id,team_id,ht_match_id,left_attack,centre_attack,right_attack,midfield,left_defence,centre_defence,right_defence,formation,tactic,tactic_skill,coach_modifier,set_pieces_skill,specialty_positions,fetched_at';

export function attachFixtureRatingStatus<T extends { id: unknown; ht_match_id?: unknown; home_team_id?: unknown; away_team_id?: unknown }>(
  matches: T[], rows: FixtureRatingShareStatus[],
): Array<T & { rating_share_statuses: FixtureRatingShareStatus[] }> {
  const byFixture = new Map<string, FixtureRatingShareStatus[]>();
  for (const row of rows) {
    const list = byFixture.get(row.fixture_id) || [];
    list.push(row);
    byFixture.set(row.fixture_id, list);
  }
  return matches.map((match) => ({
    ...match,
    rating_share_statuses: (byFixture.get(String(match.id)) || []).filter((row) =>
      Number(match.ht_match_id) === Number(row.ht_match_id) &&
      [match.home_team_id, match.away_team_id].includes(row.team_id)),
  }));
}

export type FixtureRatingNotice = 'shared' | 'orders-unset' | 'unclear' | 'not-shared';

export function fixtureRatingNotice(status: FixtureRatingShareStatus | undefined, now: number): FixtureRatingNotice {
  if (status && status.shared !== false) return 'shared';
  if (status?.auto_sharing_enabled === false) return 'not-shared';
  const checked = Date.parse(status?.orders_checked_at || '');
  if (status?.orders_given === false && Number.isFinite(checked) && checked <= now && now - checked < 15 * 60_000) return 'orders-unset';
  return 'unclear';
}

/** Status enrichment must remain compatible with the original public view. */
export async function readFixtureRatingStatuses(
  read: (fields: string) => PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>,
) {
  let result = await read(PUBLIC_FIXTURE_RATING_STATUS_FIELDS);
  if (result.error && ['42703', 'PGRST204'].includes(result.error.code || '')) {
    // Schema rollout/cache lag must not take down tournament pages. The legacy
    // projection is still status-only; never fall back to the private shares table.
    result = await read('fixture_id,team_id,ht_match_id');
  }
  return { data: (result.data || []) as FixtureRatingShareStatus[], error: result.error };
}
