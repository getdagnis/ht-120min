-- Read-only preview: currently enabled, current-season tournaments eligible for booking.
SELECT
  t.id AS tournament_id,
  t.name,
  t.slug,
  t.status,
  COALESCE(t.season, 1) AS current_season,
  s.season_number AS enabled_season,
  s.updated_at AS setting_updated_at
FROM public.tournament_season_auto_booking_settings AS s
JOIN public.tournaments AS t ON t.id = s.tournament_id
WHERE s.enabled IS TRUE
  AND s.season_number = COALESCE(t.season, 1)
  AND COALESCE(t.is_archived, FALSE) IS FALSE
  AND COALESCE(t.is_test, FALSE) IS FALSE
  AND LOWER(COALESCE(t.status, '')) NOT IN ('finished', 'archived', 'cancelled', 'disabled')
ORDER BY s.updated_at, t.name;

-- Replacement cron: exactly one named job calls the batch endpoint every five minutes.
-- Uses the existing Vault secret named AUTO_BOOKING_CRON_SECRET.
-- Production endpoint supplied by the project owner:
--   https://ht120min.vercel.app/api/cron/auto-booking
-- This scheduled request asks for real mode. The endpoint returns 409 without
-- doing work until Vercel AUTO_BOOKING_CRON_LIVE_ENABLED=true.
DO $cron$
DECLARE
  v_secret text;
  v_job record;
BEGIN
  IF COALESCE(current_setting('cron.timezone', true), 'GMT') NOT IN ('GMT', 'UTC', 'Etc/UTC') THEN
    RAISE EXCEPTION 'Auto-booking cron requires UTC cron timezone';
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'AUTO_BOOKING_CRON_SECRET';

  IF v_secret IS NULL OR length(v_secret) < 32 THEN
    RAISE EXCEPTION 'Set the existing AUTO_BOOKING_CRON_SECRET Vault entry to a value of at least 32 characters';
  END IF;

  FOR v_job IN
    SELECT jobid FROM cron.job
    WHERE username = current_user
      AND (jobname = 'ht120-auto-booking-worker'
        OR command ILIKE '%/api/cron/auto-booking%')
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'ht120-auto-booking-worker',
    '*/5 * * * *',
    $command$
      SELECT net.http_post(
        url := 'https://ht120min.vercel.app/api/cron/auto-booking',
        body := '{"mode":"real"}'::jsonb,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'AUTO_BOOKING_CRON_SECRET')
        ),
        timeout_milliseconds := 60000
      );
    $command$
  );
END;
$cron$;
