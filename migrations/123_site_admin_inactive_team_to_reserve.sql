-- Site admins may move an inactive team to reserves without consuming the
-- country-size allowance. All slot and unfinished-fixture checks still run in
-- the existing service-only operation; ordinary organizers keep that path.
BEGIN;

CREATE FUNCTION public.move_inactive_team_to_reserve_as_site_admin(
  p_tournament_id uuid,
  p_season_number integer,
  p_team_id uuid
)
RETURNS TABLE(team_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  previous_bypass text := current_setting('ht120.membership_bypass', true);
BEGIN
  -- The allowance trigger's WHEN is evaluated during the UPDATE, before this
  -- transaction-local setting is restored. Never expose this wrapper to users.
  PERFORM set_config('ht120.membership_bypass', 'true', true);
  RETURN QUERY
    SELECT moved.team_id
    FROM public.move_inactive_team_to_reserve(
      p_tournament_id, p_season_number, p_team_id
    ) AS moved;
  PERFORM set_config('ht120.membership_bypass', COALESCE(previous_bypass, 'false'), true);
END;
$$;

REVOKE ALL ON FUNCTION public.move_inactive_team_to_reserve_as_site_admin(uuid, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_inactive_team_to_reserve_as_site_admin(uuid, integer, uuid)
  TO service_role;

COMMIT;

-- applied!
