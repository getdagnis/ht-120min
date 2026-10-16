BEGIN;

-- Fail without changing production if the installed membership guard does not
-- support the two transaction-local bypasses used by this narrow wrapper.
DO $$
DECLARE
  promotion_rpc regprocedure := to_regprocedure('public.promote_tournament_reserve_as_site_admin(uuid,uuid)');
  membership_guard regprocedure := to_regprocedure('public.enforce_tournament_membership()');
  definition text;
BEGIN
  IF promotion_rpc IS NULL OR membership_guard IS NULL
    OR strpos(pg_get_functiondef(promotion_rpc), 'ht120.site_admin_team_limit_bypass') = 0
    OR strpos(pg_get_functiondef(membership_guard), 'ht120.membership_bypass') = 0
    OR strpos(pg_get_functiondef(membership_guard), 'ht120.site_admin_team_limit_bypass') = 0
    OR strpos(pg_get_functiondef(membership_guard),
      'IF public.tournament_is_exclusive(target.status,target.is_test,target.registration_type) THEN') = 0 THEN
    RAISE EXCEPTION 'Site-admin promotion prerequisites differ from the expected schema; inspect the installed functions';
  END IF;
  -- Keep all installed trigger logic, changing only its planning-row side effect.
  definition := pg_get_functiondef(membership_guard);
  EXECUTE replace(definition,
    'IF public.tournament_is_exclusive(target.status,target.is_test,target.registration_type) THEN',
    'IF public.tournament_is_exclusive(target.status,target.is_test,target.registration_type) AND current_setting(''ht120.membership_bypass'',true) IS DISTINCT FROM ''true'' THEN');
END $$;

-- The site-admin wrapper already bypasses the configured team limit. Also
-- bypass the existing cross-tournament and country-size guards for this
-- verified site-admin promotion path.
CREATE OR REPLACE FUNCTION public.promote_tournament_reserve_as_site_admin(
  p_tournament_id uuid,
  p_team_id uuid
)
RETURNS TABLE(id uuid, active boolean, reserve_active boolean, reserve_joined_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  previous_membership_bypass text := current_setting('ht120.membership_bypass', true);
  previous_team_limit_bypass text := current_setting('ht120.site_admin_team_limit_bypass', true);
BEGIN
  PERFORM set_config('ht120.membership_bypass', 'true', true);
  PERFORM set_config('ht120.site_admin_team_limit_bypass', 'true', true);
  RETURN QUERY
    UPDATE public.teams AS team
    SET active = true, reserve_active = false, reserve_joined_at = NULL
    WHERE team.id = p_team_id AND team.tournament_id = p_tournament_id
      AND team.active = false AND team.reserve_active = true
      AND NOT COALESCE(team.is_placeholder, false)
    RETURNING team.id, team.active, team.reserve_active, team.reserve_joined_at;
  PERFORM set_config('ht120.membership_bypass', COALESCE(previous_membership_bypass, 'false'), true);
  PERFORM set_config('ht120.site_admin_team_limit_bypass', COALESCE(previous_team_limit_bypass, 'false'), true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('ht120.membership_bypass', COALESCE(previous_membership_bypass, 'false'), true);
  PERFORM set_config('ht120.site_admin_team_limit_bypass', COALESCE(previous_team_limit_bypass, 'false'), true);
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_tournament_reserve_as_site_admin(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_tournament_reserve_as_site_admin(uuid, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
