-- Follow-up site-admin controls for generated rosters. Apply after 131;
-- replacement and slot functions must already be installed. No fixtures are
-- rewritten except through their existing protected, atomic RPCs.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.vacate_team_slot_in_current_season(uuid,integer,uuid)') IS NULL
    OR to_regprocedure('public.fill_vacant_current_season_slot_with_reserve(uuid,integer,uuid)') IS NULL
    OR to_regprocedure('public.save_verified_tournament_registration(jsonb,uuid,boolean)') IS NULL
    OR to_regprocedure('public.promote_tournament_reserve_as_site_admin(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Site-admin roster prerequisites are missing; inspect installed migrations';
  END IF;
END $$;

-- The fixture-safe swap RPC has its own cross-tournament check. Make it honor
-- the same override while retaining ordinary calls.
DO $$
DECLARE
  target regprocedure;
  definition text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    to_regprocedure('public.swap_current_season_team_with_reserve(uuid,integer,uuid,uuid)')
  ] LOOP
    IF target IS NULL THEN
      RAISE EXCEPTION 'Site-admin replacement prerequisite is missing';
    END IF;
    definition := pg_get_functiondef(target);
    IF strpos(definition, 'AND other_team.active = true') = 0 THEN
      RAISE EXCEPTION 'Site-admin replacement guard changed; inspect the installed function';
    END IF;
    EXECUTE replace(definition,
      'AND other_team.active = true',
      'AND current_setting(''ht120.membership_bypass'', true) IS DISTINCT FROM ''true'' AND other_team.active = true');
  END LOOP;
END $$;

-- The staged admission wrapper in 130 already marks eligibility, membership,
-- booking, cup and capacity findings as warnings. Match its HFI rank guard.
DO $$
DECLARE definition text;
BEGIN
  IF to_regprocedure('public.admit_length_schedule_reserves_as_site_admin(uuid,integer,uuid,uuid,uuid[],jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Site-admin reserve admission prerequisite is missing';
  END IF;
  SELECT pg_get_functiondef('public.admit_length_schedule_reserves(uuid,integer,uuid,uuid,uuid[],jsonb,boolean)'::regprocedure)
    INTO definition;
  IF strpos(definition, $needle$IF source='team_rank' AND COALESCE(member.team_rank,0)<=0 THEN$needle$) = 0 THEN
    RAISE EXCEPTION 'Reserve admission rank guard changed; inspect the installed function';
  END IF;
  EXECUTE replace(definition,
    $needle$IF source='team_rank' AND COALESCE(member.team_rank,0)<=0 THEN$needle$,
    $replacement$IF current_setting('ht120.membership_bypass',true) IS DISTINCT FROM 'true' AND source='team_rank' AND COALESCE(member.team_rank,0)<=0 THEN$replacement$);
END $$;

-- Direct pre-schedule additions use the existing validated registration writer.
-- The API verifies site-admin identity before invoking this service-only wrapper.
CREATE FUNCTION public.add_tournament_team_as_site_admin(p_values jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  previous_team_limit_bypass text := current_setting('ht120.site_admin_team_limit_bypass', true);
  saved_id uuid;
BEGIN
  PERFORM set_config('ht120.site_admin_team_limit_bypass', 'true', true);
  saved_id := public.save_verified_tournament_registration(p_values, NULL, true);
  PERFORM set_config('ht120.site_admin_team_limit_bypass', COALESCE(previous_team_limit_bypass, 'false'), true);
  RETURN saved_id;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('ht120.site_admin_team_limit_bypass', COALESCE(previous_team_limit_bypass, 'false'), true);
  RAISE;
END $$;
REVOKE ALL ON FUNCTION public.add_tournament_team_as_site_admin(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_tournament_team_as_site_admin(jsonb)
  TO service_role;

-- The existing fill still checks slot lineage and protected fixtures. Only its
-- tournament membership and configured capacity guards are overridden.
CREATE OR REPLACE FUNCTION public.fill_vacant_current_season_slot_with_reserve_as_site_admin(
  p_tournament_id uuid, p_season_number integer, p_incoming_reserve_team_id uuid
)
RETURNS TABLE(slot_id uuid, incoming_assignment_id uuid, updated_match_count integer)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  previous_membership_bypass text := current_setting('ht120.membership_bypass', true);
  previous_team_limit_bypass text := current_setting('ht120.site_admin_team_limit_bypass', true);
BEGIN
  PERFORM set_config('ht120.membership_bypass', 'true', true);
  PERFORM set_config('ht120.site_admin_team_limit_bypass', 'true', true);
  RETURN QUERY SELECT promoted.slot_id, promoted.incoming_assignment_id, promoted.updated_match_count
    FROM public.fill_vacant_current_season_slot_with_reserve(
      p_tournament_id, p_season_number, p_incoming_reserve_team_id
    ) AS promoted;
  PERFORM set_config('ht120.membership_bypass', COALESCE(previous_membership_bypass, 'false'), true);
  PERFORM set_config('ht120.site_admin_team_limit_bypass', COALESCE(previous_team_limit_bypass, 'false'), true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('ht120.membership_bypass', COALESCE(previous_membership_bypass, 'false'), true);
  PERFORM set_config('ht120.site_admin_team_limit_bypass', COALESCE(previous_team_limit_bypass, 'false'), true);
  RAISE;
END $$;
REVOKE ALL ON FUNCTION public.fill_vacant_current_season_slot_with_reserve_as_site_admin(uuid, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fill_vacant_current_season_slot_with_reserve_as_site_admin(uuid, integer, uuid)
  TO service_role;

CREATE FUNCTION public.swap_current_season_team_with_reserve_as_site_admin(
  p_tournament_id uuid, p_season_number integer, p_former_team_id uuid, p_incoming_reserve_team_id uuid
)
RETURNS TABLE(slot_id uuid, former_assignment_id uuid, incoming_assignment_id uuid, updated_match_count integer)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  previous_membership_bypass text := current_setting('ht120.membership_bypass', true);
  previous_team_limit_bypass text := current_setting('ht120.site_admin_team_limit_bypass', true);
BEGIN
  PERFORM set_config('ht120.membership_bypass', 'true', true);
  PERFORM set_config('ht120.site_admin_team_limit_bypass', 'true', true);
  RETURN QUERY SELECT moved.slot_id, moved.former_assignment_id, moved.incoming_assignment_id, moved.updated_match_count
    FROM public.swap_current_season_team_with_reserve(
      p_tournament_id, p_season_number, p_former_team_id, p_incoming_reserve_team_id
    ) AS moved;
  PERFORM set_config('ht120.membership_bypass', COALESCE(previous_membership_bypass, 'false'), true);
  PERFORM set_config('ht120.site_admin_team_limit_bypass', COALESCE(previous_team_limit_bypass, 'false'), true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('ht120.membership_bypass', COALESCE(previous_membership_bypass, 'false'), true);
  PERFORM set_config('ht120.site_admin_team_limit_bypass', COALESCE(previous_team_limit_bypass, 'false'), true);
  RAISE;
END $$;
REVOKE ALL ON FUNCTION public.swap_current_season_team_with_reserve_as_site_admin(uuid, integer, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.swap_current_season_team_with_reserve_as_site_admin(uuid, integer, uuid, uuid)
  TO service_role;

-- A direct post-generation promotion has no season slot. Reclassify only a
-- team with no current-season slot, assignment, or fixture reference. A slotted
-- removal delegates to the existing fixture-safe vacate RPC.
CREATE FUNCTION public.move_current_season_team_as_site_admin(
  p_tournament_id uuid, p_season_number integer, p_team_id uuid, p_to_reserve boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_team public.teams%ROWTYPE;
  v_season_id uuid;
  v_removal jsonb;
BEGIN
  IF p_to_reserve IS NULL THEN RAISE EXCEPTION 'Choose a destination' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.tournaments
    WHERE id = p_tournament_id AND COALESCE(season, 1) = p_season_number FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tournament is not on the requested current season' USING ERRCODE = '22023'; END IF;
  SELECT id INTO v_season_id FROM public.tournament_seasons
    WHERE tournament_id = p_tournament_id AND season_number = p_season_number FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current tournament season was not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_team FROM public.teams
    WHERE id = p_team_id AND tournament_id = p_tournament_id FOR UPDATE;
  IF NOT FOUND OR v_team.is_placeholder OR v_team.active IS DISTINCT FROM true
    OR v_team.reserve_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Only a current participant can be moved' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_season_slots
    WHERE tournament_season_id = v_season_id AND current_team_id = p_team_id) THEN
    IF p_to_reserve THEN
      RAISE EXCEPTION 'Remove this scheduled team first, then move its Past row to reserves' USING ERRCODE = '22023';
    END IF;
    SELECT to_jsonb(removed) INTO v_removal
      FROM public.vacate_team_slot_in_current_season(p_tournament_id, p_season_number, p_team_id) AS removed;
    RETURN v_removal;
  END IF;
  PERFORM 1 FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
    WHERE r.tournament_id = p_tournament_id AND r.season_number = p_season_number FOR UPDATE OF m;
  IF EXISTS (SELECT 1 FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
    WHERE r.tournament_id = p_tournament_id AND r.season_number = p_season_number
      AND (m.home_team_id = p_team_id OR m.away_team_id = p_team_id)) THEN
    IF p_to_reserve THEN
      RAISE EXCEPTION 'Remove this scheduled team first, then move its Past row to reserves' USING ERRCODE = '22023';
    END IF;
    -- Legacy generated seasons may need the guarded RPC to backfill slots.
    SELECT to_jsonb(removed) INTO v_removal
      FROM public.vacate_team_slot_in_current_season(p_tournament_id, p_season_number, p_team_id) AS removed;
    RETURN v_removal;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_season_slot_assignments a
    JOIN public.tournament_season_slots s ON s.id = a.tournament_season_slot_id
    WHERE s.tournament_season_id = v_season_id AND a.team_id = p_team_id)
    OR EXISTS (SELECT 1 FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
      WHERE r.tournament_id = p_tournament_id AND r.season_number = p_season_number
      AND p_team_id IN (m.home_team_id, m.away_team_id, m.reserve_team_id, m.reserve_replaces_team_id)) THEN
    RAISE EXCEPTION 'Team has current-season fixture or slot history; use the scheduled-team action' USING ERRCODE = '22023';
  END IF;
  UPDATE public.teams SET active = false, reserve_active = p_to_reserve,
    reserve_joined_at = CASE WHEN p_to_reserve THEN now() ELSE NULL END,
    reapply_season_number = NULL
    WHERE id = p_team_id AND tournament_id = p_tournament_id;
  RETURN jsonb_build_object('team_id', p_team_id, 'active', false, 'reserve_active', p_to_reserve);
END $$;
REVOKE ALL ON FUNCTION public.move_current_season_team_as_site_admin(uuid, integer, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_current_season_team_as_site_admin(uuid, integer, uuid, boolean)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- applied!