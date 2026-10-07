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
  set_pieces_skill: number | null;
  specialty_positions: SpecialtyPositionGroup[] | null;
  fetched_at: string;
}

export interface FixtureRatingShareStatus {
  fixture_id: string;
  team_id: string;
  ht_match_id: number;
}

// Only these existence fields may enter the shared public tournament cache.
export const PUBLIC_FIXTURE_RATING_STATUS_FIELDS = 'fixture_id,team_id,ht_match_id';
export const PRIVATE_FIXTURE_RATINGS_FIELDS =
  'id,fixture_id,team_id,ht_match_id,left_attack,centre_attack,right_attack,midfield,left_defence,centre_defence,right_defence,formation,tactic,tactic_skill,set_pieces_skill,specialty_positions,fetched_at';

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
