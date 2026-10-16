BEGIN;

DO $$
DECLARE
  definition text;
  membership_guard text := 'WHERE incoming.id=ANY(p_team_ids) AND other.tournament_id<>t.id AND other.active=true';
  limit_guard text := 'IF t.max_teams IS NOT NULL AND field>t.max_teams THEN';
BEGIN
  SELECT pg_get_functiondef(
    'public.admit_length_schedule_reserves(uuid,integer,uuid,uuid,uuid[],jsonb,boolean)'::regprocedure
  ) INTO definition;
  IF definition IS NULL OR strpos(definition, membership_guard) = 0 OR strpos(definition, limit_guard) = 0 THEN
    RAISE EXCEPTION 'Reserve admission guards changed; inspect the installed function before applying this migration';
  END IF;
  definition := replace(
    definition,
    membership_guard,
    'WHERE current_setting(''ht120.membership_bypass'',true) IS DISTINCT FROM ''true'' AND incoming.id=ANY(p_team_ids) AND other.tournament_id<>t.id AND other.active=true'
  );
  definition := replace(
    definition,
    limit_guard,
    'IF current_setting(''ht120.site_admin_team_limit_bypass'',true) IS DISTINCT FROM ''true'' AND t.max_teams IS NOT NULL AND field>t.max_teams THEN'
  );
  EXECUTE definition;
END $$;

CREATE FUNCTION public.admit_length_schedule_reserves_as_site_admin(
  p_tournament_id uuid,
  p_season_number integer,
  p_round_id uuid,
  p_request_id uuid,
  p_team_ids uuid[],
  p_matches jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  previous_membership_bypass text := current_setting('ht120.membership_bypass', true);
  previous_team_limit_bypass text := current_setting('ht120.site_admin_team_limit_bypass', true);
  result jsonb;
BEGIN
  PERFORM set_config('ht120.membership_bypass', 'true', true);
  PERFORM set_config('ht120.site_admin_team_limit_bypass', 'true', true);
  result := public.admit_length_schedule_reserves(
    p_tournament_id, p_season_number, p_round_id, p_request_id, p_team_ids, p_matches, false
  );
  PERFORM set_config('ht120.membership_bypass', COALESCE(previous_membership_bypass, 'false'), true);
  PERFORM set_config('ht120.site_admin_team_limit_bypass', COALESCE(previous_team_limit_bypass, 'false'), true);
  RETURN result;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('ht120.membership_bypass', COALESCE(previous_membership_bypass, 'false'), true);
  PERFORM set_config('ht120.site_admin_team_limit_bypass', COALESCE(previous_team_limit_bypass, 'false'), true);
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.admit_length_schedule_reserves_as_site_admin(uuid, integer, uuid, uuid, uuid[], jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_length_schedule_reserves_as_site_admin(uuid, integer, uuid, uuid, uuid[], jsonb)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- applied!