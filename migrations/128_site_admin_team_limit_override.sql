BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_tournament_membership() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target public.tournaments%ROWTYPE; conflict_name text;
BEGIN
  IF NOT COALESCE(NEW.active,false) OR COALESCE(NEW.reserve_active,false)
    OR COALESCE(NEW.is_placeholder,false) OR NEW.ht_team_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.active IS NOT DISTINCT FROM NEW.active
    AND OLD.reserve_active IS NOT DISTINCT FROM NEW.reserve_active
    AND OLD.ht_team_id IS NOT DISTINCT FROM NEW.ht_team_id
    AND OLD.tournament_id IS NOT DISTINCT FROM NEW.tournament_id THEN RETURN NEW; END IF;
  SELECT * INTO target FROM public.tournaments WHERE id=NEW.tournament_id;
  IF COALESCE(target.is_test,false) OR target.registration_type='sandbox' THEN RETURN NEW; END IF;
  SELECT t.name INTO conflict_name FROM public.teams tm JOIN public.tournaments t ON t.id=tm.tournament_id
    WHERE tm.ht_team_id=NEW.ht_team_id AND tm.tournament_id<>NEW.tournament_id
      AND tm.active AND NOT COALESCE(tm.reserve_active,false)
      AND public.tournament_is_exclusive(t.status,t.is_test,t.registration_type) LIMIT 1;
  IF conflict_name IS NOT NULL AND current_setting('ht120.membership_bypass',true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'This team is already committed to tournament "%"',conflict_name USING ERRCODE='23505';
  END IF;
  IF target.max_teams > 0
    AND current_setting('ht120.site_admin_team_limit_bypass',true) IS DISTINCT FROM 'true'
    AND (SELECT count(*) FROM public.teams tm WHERE tm.tournament_id=NEW.tournament_id
      AND tm.active AND NOT COALESCE(tm.reserve_active,false) AND tm.id<>NEW.id) >= target.max_teams THEN
    RAISE EXCEPTION 'This tournament is full' USING ERRCODE='23505';
  END IF;
  IF public.tournament_is_exclusive(target.status,target.is_test,target.registration_type) THEN
    UPDATE public.teams tm SET active=false,reapply_season_number=NULL
      FROM public.tournaments t WHERE t.id=tm.tournament_id AND t.status='planning'
      AND tm.tournament_id<>NEW.tournament_id AND tm.ht_team_id=NEW.ht_team_id
      AND (tm.active OR tm.reapply_season_number IS NOT NULL)
      AND NOT COALESCE(t.is_test,false) AND t.registration_type IS DISTINCT FROM 'sandbox';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.promote_tournament_reserve_as_site_admin(
  p_tournament_id uuid,
  p_team_id uuid
)
RETURNS TABLE(id uuid, active boolean, reserve_active boolean, reserve_joined_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE previous_bypass text := current_setting('ht120.site_admin_team_limit_bypass', true);
BEGIN
  PERFORM set_config('ht120.site_admin_team_limit_bypass', 'true', true);
  RETURN QUERY
    UPDATE public.teams AS tm
    SET active=true, reserve_active=false, reserve_joined_at=NULL
    WHERE tm.id=p_team_id AND tm.tournament_id=p_tournament_id
      AND tm.active=false AND tm.reserve_active=true AND NOT COALESCE(tm.is_placeholder,false)
    RETURNING tm.id, tm.active, tm.reserve_active, tm.reserve_joined_at;
  PERFORM set_config('ht120.site_admin_team_limit_bypass', COALESCE(previous_bypass, 'false'), true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('ht120.site_admin_team_limit_bypass', COALESCE(previous_bypass, 'false'), true);
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_tournament_reserve_as_site_admin(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_tournament_reserve_as_site_admin(uuid, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- applied!