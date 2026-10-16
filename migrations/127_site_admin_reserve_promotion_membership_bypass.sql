-- A verified site admin may promote a reserve even when the Hattrick team is
-- active in another exclusive tournament. Slot and protected-fixture checks
-- still run inside the existing service-only promotion RPC.
BEGIN;

CREATE FUNCTION public.fill_vacant_current_season_slot_with_reserve_as_site_admin(
  p_tournament_id uuid,
  p_season_number integer,
  p_incoming_reserve_team_id uuid
)
RETURNS TABLE(slot_id uuid, incoming_assignment_id uuid, updated_match_count integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  previous_bypass text := current_setting('ht120.membership_bypass', true);
BEGIN
  -- This wrapper is callable only by service_role. The API selects it only
  -- after verifying the site-admin identity; the regular RPC stays guarded.
  PERFORM set_config('ht120.membership_bypass', 'true', true);
  RETURN QUERY
    SELECT promoted.slot_id, promoted.incoming_assignment_id, promoted.updated_match_count
    FROM public.fill_vacant_current_season_slot_with_reserve(
      p_tournament_id, p_season_number, p_incoming_reserve_team_id
    ) AS promoted;
  PERFORM set_config('ht120.membership_bypass', COALESCE(previous_bypass, 'false'), true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('ht120.membership_bypass', COALESCE(previous_bypass, 'false'), true);
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.fill_vacant_current_season_slot_with_reserve_as_site_admin(uuid, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fill_vacant_current_season_slot_with_reserve_as_site_admin(uuid, integer, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- applied!