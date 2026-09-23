export function buildClearSeasonResultsPayload() {
  return {
    home_goals: null,
    away_goals: null,
    went_120: false,
    total_minutes: 90,
    completed: false,
    penalty_shootout_home_goals: null,
    penalty_shootout_away_goals: null,
    appg_outcome: 'needs_review' as const,
    appg_outcome_source: 'unclassified' as const,
  };
}

export function buildResetUnlinkedResultPayload() {
  return {
    ...buildClearSeasonResultsPayload(),
    match_event_details: null,
    home_yellow_cards: 0,
    home_red_cards: 0,
    home_injuries: 0,
    away_yellow_cards: 0,
    away_red_cards: 0,
    away_injuries: 0,
  };
}
