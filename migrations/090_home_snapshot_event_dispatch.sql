-- Additive follow-up to 089. No constant Vercel polling and no new job table.
-- Requires pg_net, pg_cron (UTC), and Vault to be enabled separately by owner.
-- Installs dormant hooks; start() and Vault configuration are separate activation.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL
    OR to_regprocedure('cron.schedule(text,text,text)') IS NULL
    OR to_regprocedure('cron.unschedule(bigint)') IS NULL
    OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION 'Home dispatch extension preflight required';
  END IF;
  IF coalesce(current_setting('cron.timezone', true), 'GMT') NOT IN ('GMT', 'UTC', 'Etc/UTC') THEN
    RAISE EXCEPTION 'Home dispatch requires UTC cron timezone';
  END IF;
END; $$;

CREATE SCHEMA home_publication_internal;
REVOKE ALL ON SCHEMA home_publication_internal FROM PUBLIC, anon, authenticated, service_role;

-- Fixed endpoint/secret names: no public payload, caller URL, or source records.
-- pg_net queues transactionally and starts HTTP only AFTER COMMIT.
CREATE FUNCTION home_publication_internal.queue_refresh()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE worker_url text; worker_secret text;
BEGIN
  -- At most one wakeup per source transaction, even for a multi-row schedule RPC.
  IF current_setting('ht120.home_dispatch_queued', true) = 'yes' THEN RETURN false; END IF;
  PERFORM set_config('ht120.home_dispatch_queued', 'yes', true);
  SELECT decrypted_secret INTO worker_url FROM vault.decrypted_secrets WHERE name = 'public_home_worker_url';
  SELECT decrypted_secret INTO worker_secret FROM vault.decrypted_secrets WHERE name = 'public_home_worker_secret';
  IF worker_url IS NULL OR worker_secret IS NULL THEN RETURN false; END IF;
  IF worker_url !~ '^https://[A-Za-z0-9.-]+/api/public-data/home/refresh$' OR length(worker_secret) < 32 THEN RETURN false; END IF;
  PERFORM net.http_post(
    url := worker_url, body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || worker_secret),
    timeout_milliseconds := 60000);
  RETURN true;
END; $$;

CREATE FUNCTION home_publication_internal.next_wake()
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE snapshot public.public_snapshots%ROWTYPE;
BEGIN
  SELECT * INTO snapshot FROM public.public_snapshots WHERE target_key = 'home:directory' AND contract_version = 1;
  IF NOT FOUND OR snapshot.exposure = 'draft' THEN RETURN NULL; END IF;
  IF snapshot.exposure = 'withdrawn' THEN
    -- Prompt drain/purge retry inside target window; overdue/unverified work
    -- remains pending and moves to sparse recovery, not endless minute polling.
    IF snapshot.withdrawal_verified_at IS NOT NULL OR snapshot.withdrawal_deadline_at <= clock_timestamp() THEN RETURN NULL; END IF;
    RETURN greatest(snapshot.due_at, clock_timestamp() + interval '5 seconds');
  END IF;
  IF snapshot.source_generation > snapshot.published_generation THEN
    RETURN greatest(snapshot.due_at, coalesce(snapshot.lease_expires_at, '-infinity'::timestamptz));
  END IF;
  IF snapshot.exposure = 'public' AND snapshot.published_generation > snapshot.cache_invalidated_generation THEN
    RETURN greatest(snapshot.due_at, clock_timestamp() + interval '5 seconds');
  END IF;
  IF snapshot.exposure = 'public' THEN RETURN (snapshot.payload->>'nextRefreshAt')::timestamptz; END IF;
  RETURN NULL;
END; $$;

-- One bounded cron slot, replaced when the published boundary/retry changes.
-- Five-field cron rounds UP to a UTC minute. No background 10-second scan.
CREATE FUNCTION home_publication_internal.schedule_wake()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE wake_at timestamptz; expression text; existing record;
BEGIN
  wake_at := home_publication_internal.next_wake();
  SELECT jobid, schedule INTO existing FROM cron.job WHERE jobname = 'home-publication-wake' AND username = current_user;
  IF wake_at IS NULL THEN
    IF FOUND THEN PERFORM cron.unschedule(existing.jobid); END IF;
    RETURN;
  END IF;
  wake_at := date_trunc('minute', greatest(wake_at, clock_timestamp())) + interval '1 minute';
  expression := to_char(wake_at AT TIME ZONE 'UTC', 'MI HH24 DD MM') || ' *';
  IF existing.jobid IS NOT NULL AND existing.schedule = expression THEN RETURN; END IF;
  PERFORM cron.schedule('home-publication-wake', expression, 'SELECT home_publication_internal.dispatch_due();');
END; $$;

CREATE FUNCTION home_publication_internal.dispatch_due()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE snapshot public.public_snapshots%ROWTYPE; due boolean; sent boolean := false;
BEGIN
  -- Check/dirty time-based output at the boundary, not from a visitor or Vercel poll.
  PERFORM public.dirty_home_snapshot_time_boundary();
  SELECT * INTO snapshot FROM public.public_snapshots WHERE target_key = 'home:directory' AND contract_version = 1 FOR UPDATE;
  IF FOUND THEN
    due := (snapshot.exposure IN ('approved', 'public') AND snapshot.source_generation > snapshot.published_generation
      AND snapshot.due_at <= clock_timestamp() AND (snapshot.lease_expires_at IS NULL OR snapshot.lease_expires_at <= clock_timestamp()))
      OR (snapshot.exposure = 'public' AND snapshot.published_generation > snapshot.cache_invalidated_generation AND snapshot.due_at <= clock_timestamp())
      OR (snapshot.exposure = 'withdrawn' AND snapshot.withdrawal_verified_at IS NULL AND snapshot.due_at <= clock_timestamp());
    IF due THEN sent := home_publication_internal.queue_refresh(); END IF;
  END IF;
  PERFORM home_publication_internal.schedule_wake();
  RETURN sent;
END; $$;

CREATE FUNCTION home_publication_internal.on_snapshot_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.target_key <> 'home:directory' OR NEW.contract_version <> 1 THEN RETURN NULL; END IF;
  -- An unconfigured rollout remains dormant, including cron jobs. Mutations
  -- retain their dirty state for explicit repair after configuration is ready.
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'public_home_worker_url')
    OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'public_home_worker_secret') THEN RETURN NULL; END IF;
  IF NEW.exposure IN ('approved', 'public', 'withdrawn') AND
    (TG_OP = 'INSERT' OR NEW.source_generation IS DISTINCT FROM OLD.source_generation OR
      (NEW.exposure IN ('approved', 'withdrawn') AND NEW.exposure IS DISTINCT FROM OLD.exposure)) THEN
    PERFORM home_publication_internal.queue_refresh();
  END IF;
  -- Avoid repeated cron replacement for every row in one authoritative mutation.
  IF current_setting('ht120.home_wake_scheduled', true) IS DISTINCT FROM 'yes' THEN
    PERFORM set_config('ht120.home_wake_scheduled', 'yes', true);
    PERFORM home_publication_internal.schedule_wake();
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Dispatch infrastructure must never abort a valid tournament/match write.
  -- The row is durable; sparse recovery discovers missed/rolled-back wakeups.
  RETURN NULL;
END; $$;

CREATE TRIGGER home_snapshot_dispatch AFTER INSERT OR UPDATE ON public.public_snapshots
FOR EACH ROW EXECUTE FUNCTION home_publication_internal.on_snapshot_change();

CREATE FUNCTION home_publication_internal.start()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE worker_url text; worker_secret text;
BEGIN
  SELECT decrypted_secret INTO worker_url FROM vault.decrypted_secrets WHERE name = 'public_home_worker_url';
  SELECT decrypted_secret INTO worker_secret FROM vault.decrypted_secrets WHERE name = 'public_home_worker_secret';
  IF worker_url IS NULL OR worker_url !~ '^https://[A-Za-z0-9.-]+/api/public-data/home/refresh$'
    OR worker_secret IS NULL OR length(worker_secret) < 32 THEN
    RAISE EXCEPTION 'Home dispatch configuration required';
  END IF;
  PERFORM cron.schedule('home-publication-recovery', '*/15 * * * *', 'SELECT home_publication_internal.dispatch_due();');
  PERFORM home_publication_internal.dispatch_due();
END; $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA home_publication_internal FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
