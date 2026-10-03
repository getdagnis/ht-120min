import type { HomeInitialData } from './home-snapshot-builder.js';

export const HOME_SNAPSHOT_TARGET = 'home:directory';
export const HOME_SNAPSHOT_VERSION = 1;
export const HOME_SNAPSHOT_TAG = 'public-home-v1';

type Shape = Record<string, string | Shape | [Shape | string]>;
const match: Shape = {
  id: 'string', completed: 'boolean', went_120: 'boolean?', status: 'string',
  home_team_id: 'string?', away_team_id: 'string?', scheduled_for: 'string?', finished_at: 'string?',
  home_team: { country_name: 'string?' },
};
const round: Shape = { id: 'string', created_at: 'string', round_number: 'number', season_number: 'number?', matches: [match] };
const team: Shape = {
  id: 'string', name: 'string', ht_team_id: 'number?', joined_via_oauth: 'boolean?',
  active: 'boolean?', reserve_active: 'boolean?', is_placeholder: 'boolean?',
};
const tournament: Shape = {
  id: 'string', name: 'string', slug: 'string', created_at: 'string', season: 'number',
  schedule_start_slot: 'string?', schedule_generated_at: 'string?', is_featured: 'boolean',
  is_private: 'boolean', is_test: 'boolean?', status: 'string?', is_archived: 'boolean?',
  thumbnail_index: 'number?', image_url: 'string?', country_limit: 'string?', country_limit_format: 'string?',
  scoring_mode: 'string?', league_category: 'string?', max_teams: 'number?',
  rounds: [round], teams: [team], validatedTeamCount: 'number', totalRounds: 'number',
  completedRounds: 'number', totalMatches: 'number', completedMatches: 'number', activityScore: 'number',
  teamCount: 'number', nextMatchDate: 'string?', plannedStartDate: 'string?', startedAt: 'string?', finishedAt: 'string?',
};
const activity: Shape = {
  id: 'string', type: 'string', occurred_at: 'string', tournament_id: 'string', tournament_slug: 'string',
  tournament_display_name: 'string', tournament_name: 'string', manager_name: 'string?', manager_href: 'string?',
  manager_flag: 'string?', manager_ht_id: 'number?', team_name: 'string?', team_ht_id: 'number?',
  team_flag: 'string?', season_number: 'number?', round_number: 'number?', report_id: 'string?',
};
const shape: Shape = {
  nextRefreshAt: 'string?',
  weeklyPosts: [{
    id: 'string', tournament_id: 'string', tournament_slug: 'string', tournament_name: 'string', tournament_display_name: 'string',
    title: 'string?', content: 'string', image_url: 'string?', author_name: 'string', author_team_id: 'string?',
    author_ht_user_id: 'number?', author_team_name: 'string?', tournament_image_url: 'string?',
    tournament_league_category: 'string?', tournament_country_limit: 'string?', tournament_country_limit_format: 'string?',
    is_admin: 'boolean', created_at: 'string',
  }],
  featuredTournaments: [tournament], activeTournaments: [tournament], openTournaments: [tournament],
  exoticHfiTournaments: [tournament],
  topTeams: [{ name: 'string', ht_team_id: 'number', achievements120min: 'number' }],
  topActiveTournaments: [{ name: 'string', slug: 'string', completedMatches: 'number' }], activity: [activity],
};

function decode(input: unknown, schema: Shape | string | [Shape | string]): unknown {
  if (typeof schema === 'string') {
    if (input == null && schema.endsWith('?')) return input;
    const kind = schema.replace('?', '');
    if (typeof input !== kind || (kind === 'number' && !Number.isFinite(input))) throw new Error('Invalid Home publication.');
    return input;
  }
  if (Array.isArray(schema)) {
    if (!Array.isArray(input) || input.length > 20_000) throw new Error('Invalid Home publication.');
    return input.map((value) => decode(value, schema[0]));
  }
  if (input === null && schema === match.home_team) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid Home publication.');
  const row = input as Record<string, unknown>;
  return Object.fromEntries(Object.entries(schema).map(([key, field]) => [key, decode(row[key], field)]));
}

/** Reconstruct every level. Source-only join stories and all credential/admin fields are omitted. */
export function parseHomeSnapshot(input: unknown): HomeInitialData {
  const result = decode(input, shape) as HomeInitialData;
  if (result.nextRefreshAt != null && !Number.isFinite(Date.parse(result.nextRefreshAt))) throw new Error('Invalid Home boundary.');
  for (const key of ['featuredTournaments', 'activeTournaments', 'openTournaments', 'exoticHfiTournaments'] as const) {
    if (result[key].some((row) => row.is_private || row.is_test || row.is_archived || ['stopped', 'archived'].includes(row.status || ''))) {
      throw new Error('Invalid Home publication visibility.');
    }
  }
  return result;
}

export const homeSnapshotContract = {
  targetKey: HOME_SNAPSHOT_TARGET, version: HOME_SNAPSHOT_VERSION, parse: parseHomeSnapshot,
};
