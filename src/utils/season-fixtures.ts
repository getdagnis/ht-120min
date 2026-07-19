export interface SeasonFixtureTeamSnapshot {
  name: string;
  ht_team_id: number;
  logo_url: string | null;
  country_name: string | null;
  country_id: number | null;
  league_id: number | null;
  league_level: number | null;
  manager_name: string | null;
  hattrick_user_id: number | null;
}

export interface SeasonFixtureMatchSnapshot {
  id: string;
  round_id: string;
  home_team_id: string | null;
  away_team_id: string | null;
  home_goals: number | null;
  away_goals: number | null;
  completed: boolean;
  went_120: boolean;
  total_minutes: number;
  penalty_shootout_home_goals: number | null;
  penalty_shootout_away_goals: number | null;
  appg_outcome: 'ET3' | 'ET2' | 'PS1' | 'RT0' | 'OPW' | 'needs_review' | null;
  appg_outcome_source: 'unclassified' | 'chpp' | 'organizer' | 'csv' | null;
  home_yellow_cards: number;
  home_red_cards: number;
  home_injuries: number;
  away_yellow_cards: number;
  away_red_cards: number;
  away_injuries: number;
  status: 'not_arranged' | 'arranged' | 'ongoing' | 'misarranged' | 'finished';
  ht_match_id: number | null;
  match_type: number | null;
  venue_type: 'home_away' | null;
  scheduled_for: string | null;
  schedule_slot_type: 'midweek_friendly' | 'weekend_friendly' | 'week15_weekend_friendly' | null;
  match_date: string | null;
  home_team: SeasonFixtureTeamSnapshot | null;
  away_team: SeasonFixtureTeamSnapshot | null;
}

export interface SeasonFixtureRoundSnapshot {
  id: string;
  round_number: number;
  created_at: string;
  matches: SeasonFixtureMatchSnapshot[];
}

export interface SeasonFixturesSnapshot {
  version: 1;
  seasonNumber: number;
  savedAt: string;
  rounds: SeasonFixtureRoundSnapshot[];
}

interface SnapshotSourceTeam {
  name: string;
  ht_team_id: number;
  logo_url?: string | null;
  country_name?: string | null;
  country_id?: number | null;
  league_id?: number | null;
  league_level?: number | null;
  manager_name?: string | null;
  hattrick_user_id?: number | null;
}

interface SnapshotSourceMatch {
  id: string;
  round_id: string;
  home_team_id: string | null;
  away_team_id: string | null;
  home_goals: number | null;
  away_goals: number | null;
  completed: boolean;
  went_120: boolean;
  total_minutes: number;
  penalty_shootout_home_goals?: number | null;
  penalty_shootout_away_goals?: number | null;
  appg_outcome?: SeasonFixtureMatchSnapshot['appg_outcome'];
  appg_outcome_source?: SeasonFixtureMatchSnapshot['appg_outcome_source'];
  home_yellow_cards?: number | null;
  home_red_cards?: number | null;
  home_injuries?: number | null;
  away_yellow_cards?: number | null;
  away_red_cards?: number | null;
  away_injuries?: number | null;
  status: SeasonFixtureMatchSnapshot['status'];
  ht_match_id: number | null;
  match_type: number | null;
  venue_type?: 'home_away' | null;
  scheduled_for?: string | null;
  schedule_slot_type?: SeasonFixtureMatchSnapshot['schedule_slot_type'];
  match_date?: Date | null;
  home_team: SnapshotSourceTeam | null;
  away_team: SnapshotSourceTeam | null;
}

interface SnapshotSourceRound {
  id: string;
  round_number: number;
  created_at: string;
  matches: SnapshotSourceMatch[];
}

const snapshotTeam = (team: SnapshotSourceTeam | null): SeasonFixtureTeamSnapshot | null => {
  if (!team) return null;
  return {
    name: team.name,
    ht_team_id: team.ht_team_id,
    logo_url: team.logo_url ?? null,
    country_name: team.country_name ?? null,
    country_id: team.country_id ?? null,
    league_id: team.league_id ?? null,
    league_level: team.league_level ?? null,
    manager_name: team.manager_name ?? null,
    hattrick_user_id: team.hattrick_user_id ?? null,
  };
};

export function buildSeasonFixturesSnapshot(
  seasonNumber: number,
  rounds: SnapshotSourceRound[],
  savedAt = new Date().toISOString(),
): SeasonFixturesSnapshot {
  return {
    version: 1,
    seasonNumber,
    savedAt,
    rounds: rounds.map((round) => ({
      id: round.id,
      round_number: round.round_number,
      created_at: round.created_at,
      matches: round.matches.map((match) => ({
        id: match.id,
        round_id: match.round_id,
        home_team_id: match.home_team_id,
        away_team_id: match.away_team_id,
        home_goals: match.home_goals,
        away_goals: match.away_goals,
        completed: match.completed,
        went_120: match.went_120,
        total_minutes: match.total_minutes,
        penalty_shootout_home_goals: match.penalty_shootout_home_goals ?? null,
        penalty_shootout_away_goals: match.penalty_shootout_away_goals ?? null,
        appg_outcome: match.appg_outcome ?? null,
        appg_outcome_source: match.appg_outcome_source ?? null,
        home_yellow_cards: match.home_yellow_cards ?? 0,
        home_red_cards: match.home_red_cards ?? 0,
        home_injuries: match.home_injuries ?? 0,
        away_yellow_cards: match.away_yellow_cards ?? 0,
        away_red_cards: match.away_red_cards ?? 0,
        away_injuries: match.away_injuries ?? 0,
        status: match.status,
        ht_match_id: match.ht_match_id,
        match_type: match.match_type,
        venue_type: match.venue_type ?? null,
        scheduled_for: match.scheduled_for ?? null,
        schedule_slot_type: match.schedule_slot_type ?? null,
        match_date: match.match_date?.toISOString() ?? null,
        home_team: snapshotTeam(match.home_team),
        away_team: snapshotTeam(match.away_team),
      })),
    })),
  };
}
