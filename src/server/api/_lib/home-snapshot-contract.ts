import type { HomeInitialData, HomeTournament } from './home-snapshot-builder.js';
import { EXOTIC_HFI_CAMPAIGN_SLUGS } from '../../../constants/exotic-hfi-campaign.js';

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
  schedule_start_slot: 'string?', schedule_generated_at: 'string?', registration_closed_at: 'string?', is_featured: 'boolean',
  description: 'string?',
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
  collections: [{
    id: 'string', slug: 'string', title: 'string', description: 'string',
    bannerUrl: 'string?', homepageGroup: 'string?', displayOrder: 'number',
    members: [{ tournament, isFeatured: 'boolean', displayOrder: 'number' }],
  }],
  topTeams: [{ name: 'string', ht_team_id: 'number', achievements120min: 'number' }],
  topActiveTournaments: [{ name: 'string', slug: 'string', completedMatches: 'number' }], activity: [activity],
};
const legacyShape: Shape = { ...shape, exoticHfiTournaments: [tournament] };
delete legacyShape.collections;

// Existing contract-1 cache entries may predate collections. Keep their
// explicit public Exotic list usable until 097 and the new Home build publish.
export function normalizeHomeSnapshot(input: HomeInitialData): HomeInitialData {
  if (Array.isArray(input.collections)) return input;
  const legacy = input as HomeInitialData & { exoticHfiTournaments?: HomeTournament[] };
  if (!Array.isArray(legacy.exoticHfiTournaments)) throw new Error('Invalid Home publication.');
  if (legacy.exoticHfiTournaments.some((row) =>
    row.is_private || row.is_test || row.is_archived || ['stopped', 'archived'].includes(row.status || ''))) {
    throw new Error('Invalid Home publication visibility.');
  }
  const order = new Map<string, number>(EXOTIC_HFI_CAMPAIGN_SLUGS.map((slug, index) => [slug, index]));
  const members = legacy.exoticHfiTournaments
    .filter((row) => order.has(row.slug))
    .sort((a, b) => (order.get(a.slug) ?? 0) - (order.get(b.slug) ?? 0))
    .map((row) => ({
      tournament: row, isFeatured: (order.get(row.slug) ?? 999) < 8,
      displayOrder: (order.get(row.slug) ?? 0) + 1,
    }));
  const memberIds = new Set(members.map((member) => member.tournament.id));
  const normalized = { ...legacy };
  delete normalized.exoticHfiTournaments;
  return {
    ...normalized,
    collections: members.length ? [{
      id: 'legacy-exotic-hfi', slug: 'exotic-hfi', title: 'Exotic Small HFI Series',
      description: 'Small Hattrick International friendly leagues from across the world. Find a country, join a league, and follow each season.',
      bannerUrl: '/series/exotic-tiny-hfi-banner.jpg', homepageGroup: 'concept-120min', displayOrder: 1, members,
    }] : [],
    featuredTournaments: input.featuredTournaments,
    activeTournaments: input.activeTournaments.filter((row) => !memberIds.has(row.id)),
    openTournaments: input.openTournaments.filter((row) => !memberIds.has(row.id)),
  };
}

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
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : null;
  const isLegacy = raw?.collections === undefined && Array.isArray(raw?.exoticHfiTournaments);
  const result = normalizeHomeSnapshot(decode(input, isLegacy ? legacyShape : shape) as HomeInitialData);
  if (result.nextRefreshAt != null && !Number.isFinite(Date.parse(result.nextRefreshAt))) throw new Error('Invalid Home boundary.');
  for (const key of ['featuredTournaments', 'activeTournaments', 'openTournaments'] as const) {
    if (result[key].some((row) => row.is_private || row.is_test || row.is_archived || ['stopped', 'archived'].includes(row.status || ''))) {
      throw new Error('Invalid Home publication visibility.');
    }
  }
  for (const collection of result.collections) {
    if (collection.members.some(({ tournament: row }) => row.is_private || row.is_test || row.is_archived ||
      ['stopped', 'archived'].includes(row.status || ''))) throw new Error('Invalid collection publication visibility.');
  }
  return result;
}

export const homeSnapshotContract = {
  targetKey: HOME_SNAPSHOT_TARGET, version: HOME_SNAPSHOT_VERSION, parse: parseHomeSnapshot,
};
