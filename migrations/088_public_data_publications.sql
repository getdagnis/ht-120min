-- Prepared foundation only. No source triggers, scheduler or public-read cutover.
-- Application commands must verify current authority and use allowlisted DTOs.
BEGIN;

CREATE TABLE public.public_snapshots (
  target_key text NOT NULL CHECK (
    length(target_key) <= 200 AND
    target_key ~ '^(home|tournament|season|fixture|identity|news):[A-Za-z0-9:_-]+$'
  ),
  contract_version integer NOT NULL CHECK (contract_version > 0),
  exposure text NOT NULL DEFAULT 'draft'
    CHECK (exposure IN ('draft', 'approved', 'public', 'withdrawn')),
  source_generation bigint NOT NULL DEFAULT 1 CHECK (source_generation > 0),
  published_generation bigint NOT NULL DEFAULT 0,
  cache_invalidated_generation bigint NOT NULL DEFAULT 0,
  payload jsonb,
  payload_checksum text,
  published_at timestamptz,
  due_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  error_code text CHECK (error_code IN ('build_failed', 'purge_failed', 'probe_failed', 'coverage_missing')),
  withdrawal_requested_at timestamptz,
  withdrawal_deadline_at timestamptz,
  withdrawal_verified_at timestamptz,
  PRIMARY KEY (target_key, contract_version),
  CHECK (published_generation BETWEEN 0 AND source_generation),
  CHECK (cache_invalidated_generation BETWEEN 0 AND source_generation),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CHECK ((payload IS NULL) = (payload_checksum IS NULL)),
  CHECK (payload IS NULL OR (
    jsonb_typeof(payload) = 'object' AND
    octet_length(payload::text) <= 1048576 AND
    payload_checksum ~ '^[0-9a-f]{64}$'
  )),
  CHECK (exposure <> 'public' OR (payload IS NOT NULL AND published_generation > 0)),
  CHECK ((exposure = 'withdrawn') = (withdrawal_requested_at IS NOT NULL)),
  CHECK ((withdrawal_requested_at IS NULL) = (withdrawal_deadline_at IS NULL)),
  CHECK (withdrawal_deadline_at IS NULL OR
    withdrawal_deadline_at = withdrawal_requested_at + interval '60 seconds'),
  CHECK (withdrawal_verified_at IS NULL OR (
    exposure = 'withdrawn' AND withdrawal_verified_at >= withdrawal_requested_at
  ))
);

-- One current row contains repair state; no ordinary version or job stream.
CREATE INDEX public_snapshots_build_due_idx ON public.public_snapshots (due_at)
  WHERE exposure IN ('approved', 'public') AND source_generation > published_generation;
CREATE INDEX public_snapshots_delivery_due_idx ON public.public_snapshots (due_at)
  WHERE (exposure = 'public' AND published_generation > cache_invalidated_generation)
     OR (exposure = 'withdrawn' AND withdrawal_verified_at IS NULL);

CREATE TABLE public.historical_snapshot_revisions (
  target_key text NOT NULL CHECK (
    length(target_key) <= 200 AND target_key ~ '^(season|fixture):[A-Za-z0-9:_-]+$'
  ),
  contract_version integer NOT NULL CHECK (contract_version > 0),
  revision bigint NOT NULL CHECK (revision > 0),
  predecessor_revision bigint,
  actor_ht_user_id bigint NOT NULL CHECK (actor_ht_user_id > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  provenance text NOT NULL CHECK (provenance IN ('recorded', 'backfill_unknown', 'admin_correction')),
  payload jsonb NOT NULL CHECK (
    jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 1048576
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (target_key, contract_version, revision),
  -- Independent of disposable delivery rows: retiring a contract cannot erase audits.
  FOREIGN KEY (target_key, contract_version, predecessor_revision)
    REFERENCES public.historical_snapshot_revisions (target_key, contract_version, revision),
  CHECK ((revision = 1 AND predecessor_revision IS NULL AND provenance <> 'admin_correction')
    OR (revision > 1 AND predecessor_revision IS NOT NULL
      AND predecessor_revision = revision - 1 AND provenance = 'admin_correction'))
);

ALTER TABLE public.public_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historical_snapshot_revisions ENABLE ROW LEVEL SECURITY;
-- Clear inherited project default grants too; GRANT SELECT/INSERT alone does not
-- remove preexisting service-role UPDATE/DELETE/TRUNCATE privileges on audit rows.
REVOKE ALL ON public.public_snapshots, public.historical_snapshot_revisions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_snapshots TO service_role;
GRANT SELECT, INSERT ON public.historical_snapshot_revisions TO service_role;

CREATE FUNCTION public.reject_historical_snapshot_revision_change()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Historical publication revisions are immutable' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER historical_snapshot_revisions_immutable
  BEFORE UPDATE OR DELETE ON public.historical_snapshot_revisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_historical_snapshot_revision_change();

-- Called within authoritative transactions once the dependency mapping is wired.
-- New targets remain draft: being dirty is not permission to publish publicly.
CREATE FUNCTION public.mark_public_snapshot_dirty(p_target_key text, p_contract_version integer)
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_generation bigint;
BEGIN
  INSERT INTO public.public_snapshots AS snapshots (target_key, contract_version)
    VALUES (p_target_key, p_contract_version)
  ON CONFLICT (target_key, contract_version) DO UPDATE SET
    source_generation = snapshots.source_generation + 1,
    due_at = clock_timestamp(), lease_token = NULL, lease_expires_at = NULL,
    retry_count = 0, error_code = NULL
  WHERE snapshots.exposure <> 'withdrawn'
  RETURNING source_generation INTO v_generation;
  IF v_generation IS NULL THEN
    SELECT source_generation INTO v_generation FROM public.public_snapshots
    WHERE target_key = p_target_key AND contract_version = p_contract_version;
  END IF;
  RETURN v_generation;
END;
$$;

-- Explicit public publication/re-publication approval; never exposes an old payload.
CREATE FUNCTION public.approve_public_snapshot(
  p_target_key text, p_contract_version integer, p_expected_generation bigint
)
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_generation bigint;
BEGIN
  UPDATE public.public_snapshots SET
    exposure = 'approved', source_generation = source_generation + 1,
    due_at = clock_timestamp(), lease_token = NULL, lease_expires_at = NULL,
    retry_count = 0, error_code = NULL,
    withdrawal_requested_at = NULL, withdrawal_deadline_at = NULL, withdrawal_verified_at = NULL
  WHERE target_key = p_target_key AND contract_version = p_contract_version
    AND source_generation = p_expected_generation AND exposure IN ('draft', 'withdrawn')
  RETURNING source_generation INTO v_generation;
  RETURN v_generation;
END;
$$;

CREATE FUNCTION public.claim_public_snapshot_build(
  p_target_key text, p_contract_version integer, p_lease_seconds integer DEFAULT 90
)
RETURNS TABLE (source_generation bigint, lease_token uuid, lease_expires_at timestamptz)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 1 AND 90 THEN
    RAISE EXCEPTION 'Invalid publication lease duration' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY UPDATE public.public_snapshots AS snapshots SET
    lease_token = gen_random_uuid(),
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
  WHERE snapshots.target_key = p_target_key AND snapshots.contract_version = p_contract_version
    AND snapshots.exposure IN ('approved', 'public')
    AND snapshots.source_generation > snapshots.published_generation
    AND snapshots.due_at <= clock_timestamp()
    AND (snapshots.lease_token IS NULL OR snapshots.lease_expires_at <= clock_timestamp())
  RETURNING snapshots.source_generation, snapshots.lease_token, snapshots.lease_expires_at;
END;
$$;

CREATE FUNCTION public.publish_public_snapshot(
  p_target_key text, p_contract_version integer, p_source_generation bigint,
  p_lease_token uuid, p_payload jsonb, p_payload_checksum text
)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_changed integer;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
    OR octet_length(p_payload::text) > 1048576
    OR p_payload_checksum IS NULL OR p_payload_checksum !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid or oversized publication payload' USING ERRCODE = '22023';
  END IF;
  UPDATE public.public_snapshots SET
    payload = p_payload, payload_checksum = p_payload_checksum,
    published_generation = p_source_generation, published_at = clock_timestamp(),
    exposure = 'public', lease_token = NULL, lease_expires_at = NULL,
    retry_count = 0, error_code = NULL, due_at = clock_timestamp()
  WHERE target_key = p_target_key AND contract_version = p_contract_version
    AND exposure IN ('approved', 'public') AND source_generation = p_source_generation
    AND lease_token = p_lease_token AND lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed = 1;
END;
$$;

CREATE FUNCTION public.fail_public_snapshot_build(
  p_target_key text, p_contract_version integer, p_source_generation bigint, p_lease_token uuid
)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_changed integer;
BEGIN
  UPDATE public.public_snapshots SET
    retry_count = retry_count + 1, error_code = 'build_failed',
    due_at = clock_timestamp() + make_interval(secs =>
      LEAST(300, 5 * power(2, LEAST(retry_count, 6))) + random()),
    lease_token = NULL, lease_expires_at = NULL
  WHERE target_key = p_target_key AND contract_version = p_contract_version
    AND exposure IN ('approved', 'public') AND source_generation = p_source_generation
    AND lease_token = p_lease_token AND lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed = 1;
END;
$$;

CREATE FUNCTION public.withdraw_public_snapshot(
  p_target_key text, p_contract_version integer, p_expected_generation bigint
)
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_generation bigint; v_requested_at timestamptz := clock_timestamp();
BEGIN
  UPDATE public.public_snapshots SET
    exposure = 'withdrawn', source_generation = source_generation + 1,
    withdrawal_requested_at = v_requested_at,
    withdrawal_deadline_at = v_requested_at + interval '60 seconds', withdrawal_verified_at = NULL,
    due_at = v_requested_at, lease_token = NULL, lease_expires_at = NULL,
    retry_count = 0, error_code = NULL
  WHERE target_key = p_target_key AND contract_version = p_contract_version
    AND source_generation = p_expected_generation AND exposure <> 'withdrawn'
  RETURNING source_generation INTO v_generation;
  -- Retried withdrawal preserves its original deadline; it never restarts the clock.
  IF v_generation IS NULL THEN
    SELECT source_generation INTO v_generation FROM public.public_snapshots
    WHERE target_key = p_target_key AND contract_version = p_contract_version
      AND source_generation IN (p_expected_generation, p_expected_generation + 1)
      AND exposure = 'withdrawn';
  END IF;
  RETURN v_generation;
END;
$$;

-- Invocation acknowledgment is not global propagation verification.
CREATE FUNCTION public.acknowledge_public_snapshot_invalidation(
  p_target_key text, p_contract_version integer, p_generation bigint
)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_changed integer;
BEGIN
  UPDATE public.public_snapshots SET cache_invalidated_generation = p_generation
  WHERE target_key = p_target_key AND contract_version = p_contract_version
    AND cache_invalidated_generation <= p_generation
    AND ((exposure = 'public' AND published_generation = p_generation)
      OR (exposure = 'withdrawn' AND source_generation = p_generation));
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed = 1;
END;
$$;

-- Only the authorized purge worker may call this AFTER the required clean probes.
CREATE FUNCTION public.verify_public_snapshot_withdrawal(
  p_target_key text, p_contract_version integer, p_generation bigint
)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_changed integer;
BEGIN
  UPDATE public.public_snapshots SET
    withdrawal_verified_at = COALESCE(withdrawal_verified_at, clock_timestamp()),
    error_code = NULL, retry_count = 0
  WHERE target_key = p_target_key AND contract_version = p_contract_version
    AND exposure = 'withdrawn' AND source_generation = p_generation
    AND cache_invalidated_generation = p_generation;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed = 1;
END;
$$;

CREATE FUNCTION public.fail_public_snapshot_withdrawal(
  p_target_key text, p_contract_version integer, p_generation bigint, p_error_code text
)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_changed integer;
BEGIN
  IF p_error_code IS NULL OR p_error_code NOT IN ('purge_failed', 'probe_failed', 'coverage_missing') THEN
    RAISE EXCEPTION 'Invalid withdrawal error code' USING ERRCODE = '22023';
  END IF;
  UPDATE public.public_snapshots SET
    error_code = p_error_code, retry_count = retry_count + 1,
    due_at = clock_timestamp() + interval '1 minute'
  WHERE target_key = p_target_key AND contract_version = p_contract_version
    AND exposure = 'withdrawn' AND source_generation = p_generation AND withdrawal_verified_at IS NULL;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_historical_snapshot_revision_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_public_snapshot_dirty(text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.approve_public_snapshot(text, integer, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_public_snapshot_build(text, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.publish_public_snapshot(text, integer, bigint, uuid, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fail_public_snapshot_build(text, integer, bigint, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.withdraw_public_snapshot(text, integer, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.acknowledge_public_snapshot_invalidation(text, integer, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.verify_public_snapshot_withdrawal(text, integer, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fail_public_snapshot_withdrawal(text, integer, bigint, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_public_snapshot_dirty(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_public_snapshot(text, integer, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_public_snapshot_build(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_public_snapshot(text, integer, bigint, uuid, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_public_snapshot_build(text, integer, bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.withdraw_public_snapshot(text, integer, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.acknowledge_public_snapshot_invalidation(text, integer, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_public_snapshot_withdrawal(text, integer, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_public_snapshot_withdrawal(text, integer, bigint, text) TO service_role;

COMMIT;


-- applied!