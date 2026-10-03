-- Rollback-only; synthetic schema + 088/089 + home-dispatch-fakes.sql + 090.
BEGIN;
DO $$
DECLARE initial_generation bigint; work record; count_before integer; index integer;
BEGIN
  INSERT INTO public.tournaments(id,name) VALUES ('dispatch-test','Cup');
  IF EXISTS (SELECT 1 FROM net.fake_requests) OR EXISTS (SELECT 1 FROM cron.job) THEN RAISE EXCEPTION 'Unconfigured dispatch not dormant'; END IF;
  BEGIN
    PERFORM home_publication_internal.start();
    RAISE EXCEPTION 'Missing configuration was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Home dispatch configuration required' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM cron.job) THEN RAISE EXCEPTION 'Failed activation installed jobs'; END IF;
  INSERT INTO vault.decrypted_secrets VALUES
    ('public_home_worker_url','https://home-dispatch-test.invalid/api/public-data/home/refresh'),
    ('public_home_worker_secret','synthetic-worker-secret-at-least-32-characters');
  SELECT source_generation INTO initial_generation FROM public.public_snapshots WHERE target_key = 'home:directory';
  PERFORM public.approve_public_snapshot('home:directory',1,initial_generation);
  IF (SELECT count(*) FROM net.fake_requests) <> 1 THEN RAISE EXCEPTION 'Approval did not dispatch'; END IF;
  -- Many meaningful rows, one transactional wake, not 100 network requests.
  INSERT INTO public.teams(id,tournament_id,name)
    SELECT 'dispatch-team-' || value, 'dispatch-test', 'Team' FROM generate_series(1,100) AS value;
  IF (SELECT count(*) FROM net.fake_requests) <> 1 THEN RAISE EXCEPTION 'Transaction did not coalesce'; END IF;
  IF EXISTS (SELECT 1 FROM net.fake_requests WHERE body <> '{}'::jsonb OR url <> 'https://home-dispatch-test.invalid/api/public-data/home/refresh') THEN RAISE EXCEPTION 'Source payload or arbitrary URL leaked'; END IF;
  -- Reset transaction-local coalescing to model subsequent worker transactions.
  PERFORM set_config('ht120.home_dispatch_queued','',true);
  PERFORM set_config('ht120.home_wake_scheduled','',true);
  SELECT * INTO work FROM public.claim_public_snapshot_build('home:directory',1,90);
  count_before := (SELECT count(*) FROM net.fake_requests);
  PERFORM home_publication_internal.dispatch_due();
  IF (SELECT count(*) FROM net.fake_requests) <> count_before THEN RAISE EXCEPTION 'Busy build redispatched'; END IF;
  IF NOT public.publish_public_snapshot('home:directory',1,work.source_generation,work.lease_token,
    '{"nextRefreshAt":"2099-01-01T00:00:00Z"}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') THEN RAISE EXCEPTION 'Publish failed'; END IF;
  IF (SELECT count(*) FROM net.fake_requests) <> count_before THEN RAISE EXCEPTION 'Publication queued redundant worker'; END IF;
  PERFORM public.acknowledge_public_snapshot_invalidation('home:directory',1,work.source_generation);
  PERFORM home_publication_internal.start();
  FOR index IN 1..100 LOOP
    PERFORM set_config('ht120.home_dispatch_queued','',true);
    PERFORM home_publication_internal.dispatch_due();
  END LOOP;
  IF (SELECT count(*) FROM net.fake_requests) <> count_before THEN RAISE EXCEPTION 'Idle recovery invoked Vercel'; END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'home-publication-recovery' AND schedule = '*/15 * * * *') <> 1 THEN RAISE EXCEPTION 'Recovery not sparse'; END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'home-publication-wake') <> 1 THEN RAISE EXCEPTION 'Wake slot not bounded'; END IF;
  -- Rollback cancels both source change and queued notification.
  PERFORM set_config('ht120.home_dispatch_queued','',true);
  BEGIN
    UPDATE public.tournaments SET name = 'Rollback' WHERE id = 'dispatch-test';
    RAISE EXCEPTION 'rollback test';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  IF (SELECT count(*) FROM net.fake_requests) <> count_before THEN RAISE EXCEPTION 'Wake escaped rollback'; END IF;
  -- Time boundary causes a dirty target and one notification without visitors.
  PERFORM set_config('ht120.home_dispatch_queued','',true);
  UPDATE public.public_snapshots SET payload = '{"nextRefreshAt":"2000-01-01T00:00:00Z"}'
    WHERE target_key = 'home:directory';
  PERFORM home_publication_internal.dispatch_due();
  IF (SELECT count(*) FROM net.fake_requests) <> count_before + 1 THEN RAISE EXCEPTION 'Due boundary not dispatched'; END IF;
  -- Infrastructure failure cannot break the existing domain producer.
  count_before := (SELECT count(*) FROM net.fake_requests);
  PERFORM set_config('ht120.home_dispatch_queued','',true);
  PERFORM set_config('ht120.test_net_fail','yes',true);
  UPDATE public.tournaments SET name = 'Survives infrastructure failure' WHERE id = 'dispatch-test';
  IF (SELECT name FROM public.tournaments WHERE id = 'dispatch-test') <> 'Survives infrastructure failure' THEN RAISE EXCEPTION 'Domain mutation blocked'; END IF;
  PERFORM set_config('ht120.test_net_fail','',true);
  PERFORM home_publication_internal.dispatch_due();
  IF (SELECT count(*) FROM net.fake_requests) <> count_before + 1 THEN RAISE EXCEPTION 'Missed dispatch not recovered'; END IF;
  -- Withdrawal bypasses ordinary build eligibility and is never verified here.
  PERFORM set_config('ht120.home_dispatch_queued','',true);
  SELECT source_generation INTO initial_generation FROM public.public_snapshots WHERE target_key = 'home:directory';
  PERFORM public.withdraw_public_snapshot('home:directory',1,initial_generation);
  IF (SELECT count(*) FROM net.fake_requests) <> count_before + 2 THEN RAISE EXCEPTION 'Withdrawal not dispatched'; END IF;
  IF (SELECT withdrawal_verified_at FROM public.public_snapshots WHERE target_key = 'home:directory') IS NOT NULL THEN RAISE EXCEPTION 'False withdrawal verification'; END IF;
  IF has_schema_privilege('anon','home_publication_internal','USAGE')
    OR has_function_privilege('anon','home_publication_internal.queue_refresh()','EXECUTE')
    OR has_function_privilege('service_role','home_publication_internal.start()','EXECUTE') THEN RAISE EXCEPTION 'Private dispatcher exposed'; END IF;
END; $$;
ROLLBACK;
