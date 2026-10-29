export const MAX_AUTO_BOOKING_TOURNAMENTS_PER_RUN = 5;
export const AUTO_BOOKING_RUN_LOOKBACK_MS = 24 * 60 * 60 * 1000;
export const RECENTLY_BOOKED_FIXTURE_SKIP_MS = 24 * 60 * 60 * 1000;
export const NO_SAFE_ACTION_FIXTURE_SKIP_MS = 60 * 60 * 1000;

export type AutoBookingTournament = {
  id: string;
  name: string;
  slug: string | null;
  season: number | null;
  status: string | null;
  is_archived: boolean | null;
  is_test: boolean | null;
};

export type EnabledAutoBookingSetting = {
  tournament_id: string;
  season_number: number;
  enabled: boolean;
  updated_at?: string;
  tournament: AutoBookingTournament | AutoBookingTournament[] | null;
};

export type AutoBookingRun = {
  tournament_id: string;
  season_number: number;
  mode: 'dry_run' | 'real';
  status: string;
  outcome: Record<string, unknown> | null;
  fixture_id: string | null;
  started_at: string;
};

const inactiveStatuses = new Set(['finished', 'archived', 'cancelled', 'disabled']);

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function seasonOf(tournament: AutoBookingTournament) {
  return tournament.season || 1;
}

export function selectEnabledCurrentTournaments(settings: EnabledAutoBookingSetting[]) {
  const selected: Array<{ setting: EnabledAutoBookingSetting; tournament: AutoBookingTournament }> = [];
  for (const setting of settings) {
    const tournament = first(setting.tournament);
    if (!setting.enabled || !tournament || setting.season_number !== seasonOf(tournament)) continue;
    if (tournament.is_archived === true || tournament.is_test === true
      || inactiveStatuses.has((tournament.status || '').toLowerCase())) continue;
    selected.push({ setting, tournament });
  }
  return selected;
}

export function autoBookingRetryDelayMs(run: AutoBookingRun) {
  if (run.status === 'booked') return 0;
  if (run.status === 'dry_run') return 30 * 60 * 1000;
  if (run.status === 'pending' && run.outcome?.result === 'error_70_unresolved') return 15 * 60 * 1000;
  if (run.status === 'pending' || run.status === 'failed') return 10 * 60 * 1000;
  if (run.status === 'skipped' && run.outcome?.result === 'no_safe_action') return 60 * 60 * 1000;
  if (run.status === 'skipped') return 15 * 60 * 1000;
  return 0;
}

export function autoBookingRunIsDue(run: AutoBookingRun | undefined, now: number) {
  if (!run) return true;
  if (run.status === 'running') return false;
  if (run.status === 'skipped' && run.outcome?.result === 'no_safe_action') return true;
  const startedAt = Date.parse(run.started_at);
  if (!Number.isFinite(startedAt)) return true;
  return now - startedAt >= autoBookingRetryDelayMs(run);
}

export function shouldSkipRecentFixture(run: AutoBookingRun, now: number) {
  const startedAt = Date.parse(run.started_at);
  if (!run.fixture_id || !Number.isFinite(startedAt)) return false;
  if (run.status === 'booked') return now - startedAt < RECENTLY_BOOKED_FIXTURE_SKIP_MS;
  return run.status === 'skipped' && run.outcome?.result === 'no_safe_action'
    && now - startedAt < NO_SAFE_ACTION_FIXTURE_SKIP_MS;
}

export function autoBookingRunKey(tournamentId: string, seasonNumber: number) {
  return `${tournamentId}:${seasonNumber}`;
}
