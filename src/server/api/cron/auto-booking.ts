import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  AUTO_BOOKING_RUN_LOOKBACK_MS,
  autoBookingRunIsDue,
  autoBookingRunKey,
  MAX_AUTO_BOOKING_TOURNAMENTS_PER_RUN,
  selectEnabledCurrentTournaments,
  shouldSkipRecentFixture,
  STALE_AUTO_BOOKING_RUN_MS,
  type AutoBookingRun,
  type EnabledAutoBookingSetting,
} from '../_lib/auto-booking-cron.js';
import { REAL_BOOKING_CONFIRMATION } from '../_lib/auto-booking-worker.js';
import { isValidCronBearerToken } from '../_lib/cron-auth.js';
import { getServiceSupabase } from '../_lib/supabase.js';
import { runAutoBookingWorker } from '../forge/matches.js';

function headerValue(req: VercelRequest, name: string) {
  const value = req.headers[name] ?? req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const configuredSecret = process.env.AUTO_BOOKING_CRON_SECRET;
  if (!configuredSecret || configuredSecret.length < 32) {
    return res.status(503).json({ error: 'Cron authentication is not configured.' });
  }
  if (!isValidCronBearerToken(headerValue(req, 'authorization'), configuredSecret)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'A JSON request body is required.' });
  }
  const mode = req.body.mode === 'real' ? 'real' : 'dry_run';
  if (mode === 'real' && process.env.AUTO_BOOKING_CRON_LIVE_ENABLED !== 'true') {
    return res.status(409).json({ error: 'Live booking is disabled for the cron endpoint.' });
  }

  try {
    const supabase = getServiceSupabase();
    const { data: settings, error: settingsError } = await supabase
      .from('tournament_season_auto_booking_settings')
      .select(`tournament_id, season_number, enabled, updated_at,
        tournament:tournaments!inner(id, name, slug, season, status, is_archived, is_test)`)
      .eq('enabled', true)
      .order('updated_at', { ascending: true });
    if (settingsError) throw settingsError;

    const enabled = selectEnabledCurrentTournaments((settings || []) as EnabledAutoBookingSetting[]);
    if (enabled.length === 0) {
      return res.status(200).json({ mode, enabledTournaments: 0, attempted: 0, skippedForRetryDelay: 0, results: [] });
    }

    const now = Date.now();
    const tournamentIds = enabled.map(({ tournament }) => tournament.id);
    const staleBefore = new Date(now - STALE_AUTO_BOOKING_RUN_MS).toISOString();
    const { data: staleRuns, error: staleRunsError } = await supabase.from('forge_booking_worker_runs')
      .select('id, started_at, outcome')
      .in('tournament_id', tournamentIds)
      .eq('mode', mode)
      .eq('status', 'running')
      .lt('started_at', staleBefore)
      .limit(MAX_AUTO_BOOKING_TOURNAMENTS_PER_RUN * 10);
    if (staleRunsError) throw staleRunsError;
    for (const staleRun of staleRuns || []) {
      const { error } = await supabase.from('forge_booking_worker_runs').update({
        status: 'failed',
        outcome: { ...(staleRun.outcome || {}), result: 'stale_run_recovered', explanation: 'The previous worker stopped without finishing; its overlap guard was released.' },
        finished_at: new Date(now).toISOString(),
      }).eq('id', staleRun.id).eq('status', 'running');
      if (error) throw error;
    }

    const { data: runRows, error: runsError } = await supabase.from('forge_booking_worker_runs')
      .select('tournament_id, season_number, mode, status, outcome, fixture_id, started_at')
      .in('tournament_id', tournamentIds)
      .eq('mode', mode)
      .gte('started_at', new Date(now - AUTO_BOOKING_RUN_LOOKBACK_MS).toISOString())
      .order('started_at', { ascending: false })
      .limit(1000);
    if (runsError) throw runsError;

    const latestRun = new Map<string, AutoBookingRun>();
    const latestFixtureRun = new Map<string, AutoBookingRun>();
    const recentlyBookedFixtureIds = new Map<string, string[]>();
    const nextFixtureAttemptAt = new Map<string, number>();
    for (const run of (runRows || []) as AutoBookingRun[]) {
      const key = autoBookingRunKey(run.tournament_id, run.season_number);
      if (!latestRun.has(key)) latestRun.set(key, run);
      if (run.fixture_id) {
        const fixtureKey = `${key}:${run.fixture_id}`;
        if (!latestFixtureRun.has(fixtureKey)) latestFixtureRun.set(fixtureKey, run);
      }
    }
    for (const run of latestFixtureRun.values()) {
      const key = autoBookingRunKey(run.tournament_id, run.season_number);
      if (shouldSkipRecentFixture(run, now)) {
        const fixtureIds = recentlyBookedFixtureIds.get(key) || [];
        if (run.fixture_id && !fixtureIds.includes(run.fixture_id)) fixtureIds.push(run.fixture_id);
        recentlyBookedFixtureIds.set(key, fixtureIds);
        if (run.fixture_id && run.status !== 'booked') {
          const nextAt = Date.parse(String(run.outcome?.nextAttemptAt || ''));
          if (Number.isFinite(nextAt) && nextAt > now) {
            const previous = nextFixtureAttemptAt.get(key);
            if (previous === undefined || nextAt < previous) nextFixtureAttemptAt.set(key, nextAt);
          }
        }
      }
    }

    enabled.sort((left, right) => {
      const leftRun = latestRun.get(autoBookingRunKey(left.tournament.id, left.setting.season_number));
      const rightRun = latestRun.get(autoBookingRunKey(right.tournament.id, right.setting.season_number));
      const leftTime = Date.parse(leftRun?.started_at || left.setting.updated_at || '');
      const rightTime = Date.parse(rightRun?.started_at || right.setting.updated_at || '');
      return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
    });

    const results: Array<Record<string, unknown>> = [];
    let skippedForRetryDelay = 0;
    let attempted = 0;
    let stoppedOnError = false;
    for (const { setting, tournament } of enabled) {
      const key = autoBookingRunKey(tournament.id, setting.season_number);
      if (!autoBookingRunIsDue(latestRun.get(key), now)) {
        skippedForRetryDelay += 1;
        continue;
      }
      if (attempted >= MAX_AUTO_BOOKING_TOURNAMENTS_PER_RUN) break;
      attempted += 1;

      let statusCode = 200;
      let payload: Record<string, unknown> = {};
      const captureResponse = {
        status(code: number) { statusCode = code; return this; },
        json(value: Record<string, unknown>) { payload = value; return this; },
      } as unknown as VercelResponse;
      const workerRequest = {
        ...req,
        body: {
          action: 'run-auto-booking-worker',
          tournamentId: tournament.id,
          mode,
          skipFixtureIds: recentlyBookedFixtureIds.get(key) || [],
          ...(nextFixtureAttemptAt.has(key)
            ? { nextCandidateAttemptAt: new Date(nextFixtureAttemptAt.get(key)!).toISOString() }
            : {}),
          ...(mode === 'real' ? { confirmRealChpp: REAL_BOOKING_CONFIRMATION } : {}),
        },
      } as VercelRequest;

      try {
        await runAutoBookingWorker(workerRequest, captureResponse);
        results.push({ tournamentId: tournament.id, tournamentName: tournament.name, statusCode, ...payload });
      } catch (error) {
        stoppedOnError = true;
        results.push({ tournamentId: tournament.id, tournamentName: tournament.name, statusCode: 500, error: 'Worker failed.' });
        console.error('Auto-booking cron stopped after worker failure:', error);
        break;
      }
    }

    return res.status(stoppedOnError ? 503 : 200).json({
      mode,
      enabledTournaments: enabled.length,
      attempted,
      skippedForRetryDelay,
      results,
    });
  } catch (error) {
    console.error('Auto-booking cron request failed:', error);
    return res.status(500).json({ error: 'Auto-booking worker failed.' });
  }
}
