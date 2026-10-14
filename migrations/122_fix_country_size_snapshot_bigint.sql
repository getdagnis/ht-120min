-- Emergency repair for migration 121: teams.country_id is BIGINT (migration 038).
-- Keep the INTEGER function and snapshot intact; add the signature used by the trigger.
BEGIN;
CREATE OR REPLACE FUNCTION public.country_size_snapshot_count(p_country_id bigint) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_country_id BETWEEN 1 AND 2147483647
    THEN public.country_size_snapshot_count(p_country_id::integer)
    ELSE NULL END
$$;
REVOKE ALL ON FUNCTION public.country_size_snapshot_count(bigint) FROM PUBLIC,anon,authenticated;
COMMIT;

-- APPLIED!