-- Rollback-only assertions for the synthetic schema in home-snapshot-dependencies.sql.
BEGIN;
DO $$
DECLARE first_generation bigint; after_generation bigint; lease record;
BEGIN
  SELECT source_generation INTO first_generation FROM public.public_snapshots WHERE target_key = 'home:directory';
  IF (SELECT exposure FROM public.public_snapshots WHERE target_key = 'home:directory') <> 'draft' THEN RAISE EXCEPTION 'Not draft'; END IF;
  INSERT INTO public.tournaments (id,name) VALUES ('test','Cup');
  SELECT source_generation INTO after_generation FROM public.public_snapshots WHERE target_key = 'home:directory';
  IF after_generation <> first_generation + 1 THEN RAISE EXCEPTION 'Insert did not dirty'; END IF;
  UPDATE public.tournaments SET admin_password = 'not-published' WHERE id = 'test';
  IF (SELECT source_generation FROM public.public_snapshots WHERE target_key = 'home:directory') <> after_generation THEN RAISE EXCEPTION 'Secret dirtied Home'; END IF;
  UPDATE public.tournaments SET name = 'Cup' WHERE id = 'test';
  IF (SELECT source_generation FROM public.public_snapshots WHERE target_key = 'home:directory') <> after_generation THEN RAISE EXCEPTION 'No-op dirtied'; END IF;
  PERFORM public.approve_public_snapshot('home:directory',1,after_generation);
  SELECT * INTO lease FROM public.claim_public_snapshot_build('home:directory',1,90);
  UPDATE public.tournaments SET name = 'Changed' WHERE id = 'test';
  IF public.publish_public_snapshot('home:directory',1,lease.source_generation,lease.lease_token,'{}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') THEN RAISE EXCEPTION 'Stale build committed'; END IF;
  SELECT source_generation INTO first_generation FROM public.public_snapshots WHERE target_key = 'home:directory';
  BEGIN
    UPDATE public.tournaments SET name = 'Rolled back' WHERE id = 'test';
    RAISE EXCEPTION 'rollback synthetic write';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  IF (SELECT source_generation FROM public.public_snapshots WHERE target_key = 'home:directory') <> first_generation THEN RAISE EXCEPTION 'Dirty escaped rollback'; END IF;
  INSERT INTO public.teams (id,tournament_id,name) VALUES ('team','test','Team');
  INSERT INTO public.rounds (id,tournament_id,round_number) VALUES ('round','test',1);
  INSERT INTO public.matches (id,round_id,completed,status) VALUES ('match','round',false,'ongoing');
  SELECT source_generation INTO first_generation FROM public.public_snapshots WHERE target_key = 'home:directory';
  UPDATE public.matches SET last_live_refresh_at = clock_timestamp() WHERE id = 'match';
  IF (SELECT source_generation FROM public.public_snapshots WHERE target_key = 'home:directory') <> first_generation THEN RAISE EXCEPTION 'Refresh clock dirtied'; END IF;
  UPDATE public.matches SET completed = true WHERE id = 'match';
  INSERT INTO public.fixture_warnings VALUES ('warning','round','team',true);
  INSERT INTO public.news_posts VALUES ('news','test','Report',true);
  IF (SELECT source_generation FROM public.public_snapshots WHERE target_key = 'home:directory') <> first_generation + 3 THEN RAISE EXCEPTION 'Dependency missing'; END IF;
  SELECT * INTO lease FROM public.claim_public_snapshot_build('home:directory',1,90);
  IF NOT public.publish_public_snapshot('home:directory',1,lease.source_generation,lease.lease_token,
    '{"nextRefreshAt":"2000-01-01T00:00:00Z"}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') THEN RAISE EXCEPTION 'Publish failed'; END IF;
  PERFORM public.dirty_home_snapshot_time_boundary();
  PERFORM public.dirty_home_snapshot_time_boundary();
  IF (SELECT source_generation FROM public.public_snapshots WHERE target_key = 'home:directory') <> lease.source_generation + 1 THEN RAISE EXCEPTION 'Time boundary not idempotent'; END IF;
  SELECT * INTO lease FROM public.claim_public_snapshot_build('home:directory',1,90);
  PERFORM public.publish_public_snapshot('home:directory',1,lease.source_generation,lease.lease_token,'{}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  DELETE FROM public.news_posts WHERE id = 'news';
  IF (SELECT exposure FROM public.public_snapshots WHERE target_key = 'home:directory') <> 'approved' THEN RAISE EXCEPTION 'Deleted news still admitted'; END IF;
  SELECT * INTO lease FROM public.claim_public_snapshot_build('home:directory',1,90);
  PERFORM public.publish_public_snapshot('home:directory',1,lease.source_generation,lease.lease_token,'{}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  UPDATE public.tournaments SET is_private = true WHERE id = 'test';
  IF (SELECT exposure FROM public.public_snapshots WHERE target_key = 'home:directory') <> 'approved' THEN RAISE EXCEPTION 'Hidden content still admitted at origin'; END IF;
  IF EXISTS (SELECT 1 FROM public.public_snapshots WHERE target_key = 'home:directory' AND exposure = 'public') THEN RAISE EXCEPTION 'Origin public read leaked'; END IF;
  SELECT source_generation INTO first_generation FROM public.public_snapshots WHERE target_key = 'home:directory';
  PERFORM public.withdraw_public_snapshot('home:directory',1,first_generation);
  UPDATE public.tournaments SET name = 'After withdrawal' WHERE id = 'test';
  IF (SELECT exposure FROM public.public_snapshots WHERE target_key = 'home:directory') <> 'withdrawn' THEN RAISE EXCEPTION 'Source republished withdrawal'; END IF;
END;
$$;
SET LOCAL ROLE anon;
UPDATE public.tournaments SET name = 'Browser writer' WHERE id = 'test';
DO $$ BEGIN
  IF has_function_privilege('anon','public.dirty_home_snapshot_source()','EXECUTE')
    OR has_function_privilege('anon','public.dirty_home_snapshot_time_boundary()','EXECUTE')
    OR has_table_privilege('anon','public.public_snapshots','SELECT') THEN RAISE EXCEPTION 'Public access leaked'; END IF;
END; $$;
RESET ROLE;
ROLLBACK;
