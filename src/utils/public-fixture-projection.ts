/** Presentation projection only. Never use this to overwrite stored match/report facts. */
export function projectPublicFixture<T extends Record<string, unknown>>(fixture: T): T {
  const projected = { ...fixture };
  delete projected.next_match_arrange_story;
  if (!fixture.completed) {
    Object.assign(projected, {
      match_event_details: null, home_goals: null, away_goals: null,
      total_minutes: 90, went_120: false,
      penalty_shootout_home_goals: null, penalty_shootout_away_goals: null,
      home_yellow_cards: 0, home_red_cards: 0, home_injuries: 0,
      away_yellow_cards: 0, away_red_cards: 0, away_injuries: 0,
    });
  } else if (fixture.match_event_details && typeof fixture.match_event_details === 'object') {
    const { result: _result, notableEvents: _events, ...details } = fixture.match_event_details as Record<string, unknown>;
    void _result;
    void _events;
    projected.match_event_details = details;
  }
  return projected;
}

export function projectPublicSeason<T extends Record<string, unknown>>(season: T): T {
  const snapshot = season.fixtures_snapshot_json as { rounds?: Array<Record<string, unknown> & { matches?: Record<string, unknown>[] }> } | null;
  return { ...season, fixtures_snapshot_json: snapshot ? {
    ...snapshot, rounds: snapshot.rounds?.map((round) => ({ ...round, matches: round.matches?.map(projectPublicFixture) })),
  } : null };
}
