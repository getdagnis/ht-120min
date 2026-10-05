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
  fetched_at: string;
}

// Keep this list explicit. The public query must never return private CHPP data.
export const PUBLIC_FIXTURE_RATINGS_FIELDS =
  'id,fixture_id,team_id,ht_match_id,left_attack,centre_attack,right_attack,midfield,left_defence,centre_defence,right_defence,formation,tactic,tactic_skill,set_pieces_skill,fetched_at';

export function attachFixtureRatings<T extends { id: unknown; ht_match_id?: unknown; home_team_id?: unknown; away_team_id?: unknown }>(
  matches: T[], rows: SharedFixtureRatings[],
): Array<T & { shared_ratings: SharedFixtureRatings[] }> {
  const byFixture = new Map<string, SharedFixtureRatings[]>();
  for (const row of rows) {
    const list = byFixture.get(row.fixture_id) || [];
    list.push(row);
    byFixture.set(row.fixture_id, list);
  }
  return matches.map((match) => ({
    ...match,
    shared_ratings: (byFixture.get(String(match.id)) || []).filter((row) =>
      Number(match.ht_match_id) === Number(row.ht_match_id) &&
      [match.home_team_id, match.away_team_id].includes(row.team_id)),
  }));
}
