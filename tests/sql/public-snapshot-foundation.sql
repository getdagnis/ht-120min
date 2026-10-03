-- Run ONLY in a disposable database after 088_public_data_publications.sql.
-- Needs Supabase-like anon/authenticated/service_role roles; outer transaction rolls back.
-- These tests verify persistence, NOT regional cache purges or application authorization.
BEGIN;
SET LOCAL ROLE service_role;

DO $$
DECLARE
  v_key text := 'season:smoke-' || gen_random_uuid()::text;
  v_generation bigint;
  v_withdrawn_generation bigint;
  v_old_generation bigint;
  v_token uuid;
  v_old_token uuid;
  v_requested_at timestamptz;
  v_deadline_at timestamptz;
  v_rows integer;
  v_payload jsonb := '{"title":"Recorded season"}'::jsonb;
BEGIN
  PERFORM set_config('ht120.publication_smoke_key', v_key, true);
  IF has_table_privilege('anon', 'public.public_snapshots', 'SELECT')
    OR has_table_privilege('authenticated', 'public.historical_snapshot_revisions', 'SELECT')
    OR has_table_privilege('service_role', 'public.historical_snapshot_revisions', 'UPDATE')
    OR has_table_privilege('service_role', 'public.historical_snapshot_revisions', 'DELETE')
    OR has_table_privilege('service_role', 'public.historical_snapshot_revisions', 'TRUNCATE')
    OR has_function_privilege('anon', 'public.mark_public_snapshot_dirty(text,integer)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.withdraw_public_snapshot(text,integer,bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Public publication internals are exposed';
  END IF;
  IF (SELECT count(*) FROM pg_class WHERE oid IN
    ('public.public_snapshots'::regclass, 'public.historical_snapshot_revisions'::regclass)
    AND relrowsecurity) <> 2 THEN
    RAISE EXCEPTION 'Publication tables do not both have RLS enabled';
  END IF;

  v_generation := public.mark_public_snapshot_dirty(v_key, 1);
  IF v_generation <> 1 THEN RAISE EXCEPTION 'Initial dirty generation incorrect'; END IF;
  SELECT count(*) INTO v_rows FROM public.claim_public_snapshot_build(v_key, 1);
  IF v_rows <> 0 THEN RAISE EXCEPTION 'Draft target was implicitly approved'; END IF;
  IF public.approve_public_snapshot(v_key, 1, 999) IS NOT NULL THEN
    RAISE EXCEPTION 'Stale approval accepted';
  END IF;
  v_generation := public.approve_public_snapshot(v_key, 1, v_generation);
  SELECT lease_token INTO v_token FROM public.claim_public_snapshot_build(v_key, 1);
  IF v_token IS NULL THEN RAISE EXCEPTION 'Approved target did not yield a lease'; END IF;
  SELECT count(*) INTO v_rows FROM public.claim_public_snapshot_build(v_key, 1);
  IF v_rows <> 0 THEN RAISE EXCEPTION 'Same generation was claimed twice'; END IF;

  v_old_generation := v_generation;
  v_old_token := v_token;
  v_generation := public.mark_public_snapshot_dirty(v_key, 1);
  IF public.publish_public_snapshot(v_key, 1, v_old_generation, v_old_token, v_payload, repeat('a', 64)) THEN
    RAISE EXCEPTION 'Stale builder overwrote a newer source generation';
  END IF;
  SELECT lease_token INTO v_token FROM public.claim_public_snapshot_build(v_key, 1);
  IF NOT public.publish_public_snapshot(v_key, 1, v_generation, v_token, v_payload, repeat('a', 64)) THEN
    RAISE EXCEPTION 'Valid builder could not publish';
  END IF;
  IF public.publish_public_snapshot(v_key, 1, v_generation, v_token, v_payload, repeat('a', 64)) THEN
    RAISE EXCEPTION 'Consumed token published twice';
  END IF;
  IF NOT public.acknowledge_public_snapshot_invalidation(v_key, 1, v_generation) THEN
    RAISE EXCEPTION 'Publication invalidation could not be acknowledged';
  END IF;

  v_generation := public.mark_public_snapshot_dirty(v_key, 1);
  SELECT lease_token INTO v_token FROM public.claim_public_snapshot_build(v_key, 1);
  UPDATE public.public_snapshots SET lease_expires_at = clock_timestamp() - interval '1 second'
    WHERE target_key = v_key AND contract_version = 1;
  IF public.publish_public_snapshot(v_key, 1, v_generation, v_token, v_payload, repeat('b', 64)) THEN
    RAISE EXCEPTION 'Expired lease published';
  END IF;
  v_old_token := v_token;
  SELECT lease_token INTO v_token FROM public.claim_public_snapshot_build(v_key, 1);
  IF v_token IS NULL OR v_token = v_old_token THEN RAISE EXCEPTION 'Expired lease did not recover'; END IF;
  IF public.fail_public_snapshot_build(v_key, 1, v_generation, v_old_token) THEN
    RAISE EXCEPTION 'Old failure cleanup released a newer lease';
  END IF;
  IF NOT public.fail_public_snapshot_build(v_key, 1, v_generation, v_token) THEN
    RAISE EXCEPTION 'Current build failure was not recorded';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.public_snapshots WHERE target_key = v_key
    AND payload = v_payload AND published_generation < source_generation
    AND retry_count = 1 AND error_code = 'build_failed' AND due_at > clock_timestamp()) THEN
    RAISE EXCEPTION 'Failed build destroyed last-good payload or lost retry state';
  END IF;

  -- Test a build still in flight when withdrawal is committed.
  UPDATE public.public_snapshots SET due_at = clock_timestamp() WHERE target_key = v_key;
  SELECT lease_token INTO v_token FROM public.claim_public_snapshot_build(v_key, 1);
  v_withdrawn_generation := public.withdraw_public_snapshot(v_key, 1, v_generation);
  IF v_withdrawn_generation <> v_generation + 1 THEN RAISE EXCEPTION 'Withdrawal did not advance its fence'; END IF;
  SELECT withdrawal_requested_at, withdrawal_deadline_at INTO v_requested_at, v_deadline_at
    FROM public.public_snapshots WHERE target_key = v_key AND contract_version = 1;
  IF v_deadline_at <> v_requested_at + interval '60 seconds' THEN RAISE EXCEPTION 'Withdrawal target incorrect'; END IF;
  IF public.publish_public_snapshot(v_key, 1, v_generation, v_token, v_payload, repeat('c', 64)) THEN
    RAISE EXCEPTION 'In-flight build resurrected withdrawn content';
  END IF;
  IF public.withdraw_public_snapshot(v_key, 1, v_generation) <> v_withdrawn_generation THEN
    RAISE EXCEPTION 'Withdrawal retry with original expected generation was not idempotent';
  END IF;
  IF public.mark_public_snapshot_dirty(v_key, 1) <> v_withdrawn_generation THEN
    RAISE EXCEPTION 'Ordinary source mutation changed a withdrawal fence';
  END IF;
  IF EXISTS (SELECT 1 FROM public.public_snapshots WHERE target_key = v_key AND exposure = 'public') THEN
    RAISE EXCEPTION 'Withdrawn payload remained available to an origin public read';
  END IF;
  IF public.verify_public_snapshot_withdrawal(v_key, 1, v_withdrawn_generation) THEN
    RAISE EXCEPTION 'Withdrawal verified before invalidation acknowledgment';
  END IF;
  IF NOT public.fail_public_snapshot_withdrawal(v_key, 1, v_withdrawn_generation, 'purge_failed') THEN
    RAISE EXCEPTION 'Purge failure not persisted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.public_snapshots WHERE target_key = v_key
    AND withdrawal_verified_at IS NULL AND withdrawal_requested_at = v_requested_at
    AND withdrawal_deadline_at = v_deadline_at AND error_code = 'purge_failed') THEN
    RAISE EXCEPTION 'Failed purge lost pending status or reset deadline';
  END IF;
  IF public.acknowledge_public_snapshot_invalidation(v_key, 1, v_generation) THEN
    RAISE EXCEPTION 'Old invalidation acknowledged a withdrawal generation';
  END IF;
  IF NOT public.acknowledge_public_snapshot_invalidation(v_key, 1, v_withdrawn_generation)
    OR NOT public.verify_public_snapshot_withdrawal(v_key, 1, v_withdrawn_generation) THEN
    RAISE EXCEPTION 'Withdrawal acknowledgment/verification failed';
  END IF;

  -- Explicit re-publication waits for a newly built payload and fences late purge work.
  v_generation := public.approve_public_snapshot(v_key, 1, v_withdrawn_generation);
  IF EXISTS (SELECT 1 FROM public.public_snapshots WHERE target_key = v_key AND exposure = 'public') THEN
    RAISE EXCEPTION 'Re-publication approval exposed the old payload';
  END IF;
  IF public.verify_public_snapshot_withdrawal(v_key, 1, v_withdrawn_generation)
    OR public.acknowledge_public_snapshot_invalidation(v_key, 1, v_withdrawn_generation) THEN
    RAISE EXCEPTION 'Old purge work changed a newly approved publication';
  END IF;
  SELECT lease_token INTO v_token FROM public.claim_public_snapshot_build(v_key, 1);
  IF NOT public.publish_public_snapshot(v_key, 1, v_generation, v_token, v_payload, repeat('d', 64)) THEN
    RAISE EXCEPTION 'Newly approved generation could not publish';
  END IF;
  IF (SELECT count(*) FROM public.public_snapshots WHERE target_key = v_key) <> 1 THEN
    RAISE EXCEPTION 'Ordinary operations accumulated snapshot versions';
  END IF;

  BEGIN
    PERFORM public.claim_public_snapshot_build(v_key, 1, 91);
    RAISE EXCEPTION 'Invalid lease duration accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.publish_public_snapshot(v_key, 1, v_generation, gen_random_uuid(),
      jsonb_build_object('title', repeat('x', 1048576)), repeat('e', 64));
    RAISE EXCEPTION 'Oversized publication accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  INSERT INTO public.historical_snapshot_revisions
    (target_key, contract_version, revision, actor_ht_user_id, reason, provenance, payload)
    VALUES (v_key, 1, 1, 1, 'Disposable smoke initial facts', 'recorded', v_payload);
  BEGIN
    INSERT INTO public.historical_snapshot_revisions
      (target_key, contract_version, revision, actor_ht_user_id, reason, provenance, payload)
      VALUES (v_key, 1, 2, 1, 'Missing predecessor', 'admin_correction', v_payload);
    RAISE EXCEPTION 'Correction without predecessor accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.historical_snapshot_revisions
    (target_key, contract_version, revision, predecessor_revision, actor_ht_user_id, reason, provenance, payload)
    VALUES (v_key, 1, 2, 1, 1, 'Disposable smoke correction', 'admin_correction', v_payload);
  PERFORM public.withdraw_public_snapshot(v_key, 1, v_generation);
  DELETE FROM public.public_snapshots WHERE target_key = v_key;
  IF (SELECT count(*) FROM public.historical_snapshot_revisions WHERE target_key = v_key) <> 2 THEN
    RAISE EXCEPTION 'Retiring delivery rows erased audited history';
  END IF;
  BEGIN
    UPDATE public.historical_snapshot_revisions SET reason = 'Changed' WHERE target_key = v_key;
    RAISE EXCEPTION 'Service role could rewrite audit history';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'Publication persistence, withdrawal and audit constraints passed';
END;
$$;

RESET ROLE;
-- Even a privileged caller cannot silently mutate audit rows through normal DML.
DO $$
BEGIN
  BEGIN
    UPDATE public.historical_snapshot_revisions SET reason = 'Changed'
      WHERE target_key = current_setting('ht120.publication_smoke_key');
    RAISE EXCEPTION 'Audit immutability trigger did not reject update';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    DELETE FROM public.historical_snapshot_revisions
      WHERE target_key = current_setting('ht120.publication_smoke_key');
    RAISE EXCEPTION 'Audit immutability trigger did not reject delete';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  RAISE NOTICE 'Privileged audit immutability checks passed';
END;
$$;
ROLLBACK;
