-- Applied 132 left direct promotions without a season slot and treated released
-- assignments as current commitments. Keep both corrections service-role only.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.fill_vacant_current_season_slot_with_reserve_as_site_admin(uuid,integer,uuid)') IS NULL
    OR to_regprocedure('public.promote_tournament_reserve_as_site_admin(uuid,uuid)') IS NULL
    OR to_regprocedure('public.move_current_season_team_as_site_admin(uuid,integer,uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Site-admin season action prerequisites are missing; apply migrations through 132 first';
  END IF;
END $$;

CREATE FUNCTION public.promote_team_into_current_season_as_site_admin(
  p_tournament_id uuid, p_season_number integer, p_team_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_tournament public.tournaments%ROWTYPE;
  v_season public.tournament_seasons%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_slot_id uuid;
  v_assignment_id uuid;
  v_next_round_id uuid;
  v_next_round_number integer;
  v_box_size integer;
  v_filled record;
  v_previous_membership_bypass text := current_setting('ht120.membership_bypass', true);
  v_previous_team_limit_bypass text := current_setting('ht120.site_admin_team_limit_bypass', true);
BEGIN
  SELECT * INTO v_tournament FROM public.tournaments
    WHERE id = p_tournament_id AND COALESCE(season, 1) = p_season_number FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_tournament.is_archived, false)
    OR v_tournament.status IN ('finished', 'stopped', 'archived') THEN
    RAISE EXCEPTION 'Tournament is not on an open current season' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_season FROM public.tournament_seasons
    WHERE tournament_id = p_tournament_id AND season_number = p_season_number FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current tournament season was not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_team FROM public.teams
    WHERE id = p_team_id AND tournament_id = p_tournament_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_team.is_placeholder, false) OR NOT (
    (v_team.active = false AND v_team.reserve_active = true) OR
    (v_team.active = true AND v_team.reserve_active = false)
  ) THEN
    RAISE EXCEPTION 'Choose a reserve or an active team without a season slot' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.tournament_season_slots
    WHERE tournament_season_id = v_season.id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.tournament_season_slots
    WHERE tournament_season_id = v_season.id) THEN
    RAISE EXCEPTION 'Current season has no initialized slots' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_season_slots
    WHERE tournament_season_id = v_season.id AND current_team_id = p_team_id) THEN
    RAISE EXCEPTION 'Team already occupies a current-season slot' USING ERRCODE = '23505';
  END IF;
  PERFORM 1 FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
    WHERE r.tournament_id = p_tournament_id AND r.season_number = p_season_number FOR UPDATE OF m;
  IF EXISTS (SELECT 1 FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
    WHERE r.tournament_id = p_tournament_id AND r.season_number = p_season_number
      AND (m.home_team_id = p_team_id OR m.away_team_id = p_team_id OR m.reserve_team_id = p_team_id)
      AND m.completed IS DISTINCT FROM true AND m.status IS DISTINCT FROM 'finished') THEN
    RAISE EXCEPTION 'Team has an unresolved current-season fixture; resolve or vacate it before promotion' USING ERRCODE = '55000';
  END IF;

  -- Restore only this club's own released standings line automatically. Filling
  -- another club's line is a separate explicit admin action.
  IF EXISTS (SELECT 1 FROM public.tournament_season_slots s
    WHERE s.tournament_season_id = v_season.id AND s.current_team_id IS NULL
      AND EXISTS (SELECT 1 FROM public.tournament_season_slot_assignments a
        WHERE a.tournament_season_slot_id = s.id AND a.released_at IS NOT NULL
          AND (a.team_id = p_team_id OR a.ht_team_id = v_team.ht_team_id)
          AND a.id = (SELECT latest.id FROM public.tournament_season_slot_assignments latest
            WHERE latest.tournament_season_slot_id = s.id AND latest.released_at IS NOT NULL
            ORDER BY latest.released_at DESC, latest.assigned_at DESC LIMIT 1))) THEN
    IF v_team.active THEN
      PERFORM set_config('ht120.membership_bypass', 'true', true);
      PERFORM set_config('ht120.site_admin_team_limit_bypass', 'true', true);
      UPDATE public.teams SET active = false, reserve_active = true, reserve_joined_at = now()
        WHERE id = p_team_id;
    END IF;
    SELECT * INTO v_filled FROM public.fill_vacant_current_season_slot_with_reserve_as_site_admin(
      p_tournament_id, p_season_number, p_team_id);
    PERFORM set_config('ht120.membership_bypass', COALESCE(v_previous_membership_bypass, 'false'), true);
    PERFORM set_config('ht120.site_admin_team_limit_bypass', COALESCE(v_previous_team_limit_bypass, 'false'), true);
    RETURN jsonb_build_object('team_id', p_team_id, 'slot_id', v_filled.slot_id,
      'updated_match_count', v_filled.updated_match_count, 'entry', 'vacant_slot');
  END IF;

  -- Length schedules materialize later regular rounds from current slot
  -- occupants. A single entrant cannot safely be paired into this round.
  IF v_tournament.schedule_mode IS DISTINCT FROM 'length' THEN
    RAISE EXCEPTION 'No vacant slot exists; this schedule cannot add a new participant' USING ERRCODE = '22023';
  END IF;
  SELECT r.id, r.round_number INTO v_next_round_id, v_next_round_number
    FROM public.rounds r
    WHERE r.tournament_id = p_tournament_id AND r.season_number = p_season_number
      AND r.phase = 'regular' AND r.phase_status = 'pending'
      AND r.round_number > (SELECT current_round.round_number FROM public.rounds current_round
        WHERE current_round.tournament_id = p_tournament_id
          AND current_round.season_number = p_season_number
          AND current_round.phase_status = 'materialized'
        ORDER BY current_round.round_number DESC LIMIT 1)
    ORDER BY r.round_number LIMIT 1;
  IF v_next_round_id IS NULL THEN
    RAISE EXCEPTION 'No future regular round is available; use paired reserve admission for the current round' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rounds r WHERE r.tournament_id = p_tournament_id
    AND r.season_number = p_season_number AND r.phase = 'postseason'
    AND r.phase_status <> 'pending') THEN
    RAISE EXCEPTION 'Playoffs have started; no new regular participant can enter' USING ERRCODE = '22023';
  END IF;

  SELECT s.id INTO v_slot_id FROM public.tournament_season_slots s
    WHERE s.tournament_season_id = v_season.id AND s.current_team_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.tournament_season_slot_assignments a
        WHERE a.tournament_season_slot_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM public.matches m
        WHERE m.home_slot_id = s.id OR m.away_slot_id = s.id)
    ORDER BY s.slot_index LIMIT 1;
  IF v_slot_id IS NULL THEN
    SELECT COALESCE(max(slot_index), 0) + 2 INTO v_box_size
      FROM public.tournament_season_slots WHERE tournament_season_id = v_season.id;
    IF v_box_size < 2 OR v_box_size % 2 <> 0 THEN
      RAISE EXCEPTION 'Season slot box is inconsistent' USING ERRCODE = '22023';
    END IF;
    UPDATE public.tournament_season_slots SET box_size = v_box_size
      WHERE tournament_season_id = v_season.id;
    INSERT INTO public.tournament_season_slots(tournament_season_id, slot_index, box_size, current_team_id)
      VALUES (v_season.id, v_box_size - 1, v_box_size, p_team_id) RETURNING id INTO v_slot_id;
    INSERT INTO public.tournament_season_slots(tournament_season_id, slot_index, box_size)
      VALUES (v_season.id, v_box_size, v_box_size);
  ELSE
    UPDATE public.tournament_season_slots SET current_team_id = p_team_id, updated_at = now()
      WHERE id = v_slot_id;
  END IF;

  INSERT INTO public.tournament_season_slot_assignments(
    tournament_season_slot_id, team_id, reason, team_name, ht_team_id,
    manager_name, hattrick_user_id, logo_url, admission_request_id, entry_round_id,
    ranking_source, ranking_value
  ) VALUES (
    v_slot_id, p_team_id, 'reserve_admission', v_team.name, v_team.ht_team_id,
    v_team.manager_name, v_team.hattrick_user_id, v_team.logo_url, gen_random_uuid(), v_next_round_id,
    CASE WHEN v_tournament.league_category = 'hfi' THEN 'team_rank' ELSE 'power_rating' END,
    CASE WHEN v_tournament.league_category = 'hfi' THEN v_team.team_rank ELSE v_team.power_rating END
  ) RETURNING id INTO v_assignment_id;
  IF NOT v_team.active THEN
    PERFORM 1 FROM public.promote_tournament_reserve_as_site_admin(p_tournament_id, p_team_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'The reserve state changed during promotion' USING ERRCODE = '40001'; END IF;
  END IF;
  RETURN jsonb_build_object('team_id', p_team_id, 'slot_id', v_slot_id,
    'assignment_id', v_assignment_id, 'entry', 'future_round',
    'next_round_number', v_next_round_number, 'updated_match_count', 0);
END $$;
REVOKE ALL ON FUNCTION public.promote_team_into_current_season_as_site_admin(uuid, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_team_into_current_season_as_site_admin(uuid, integer, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.move_current_season_team_as_site_admin(
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
  IF NOT FOUND OR COALESCE(v_team.is_placeholder, false) OR v_team.active IS DISTINCT FROM true
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
      AND (m.home_team_id = p_team_id OR m.away_team_id = p_team_id OR m.reserve_team_id = p_team_id)
      AND m.completed IS DISTINCT FROM true AND m.status IS DISTINCT FROM 'finished') THEN
    RAISE EXCEPTION 'Team has an unresolved current-season fixture; resolve its slot or booking first' USING ERRCODE = '55000';
  END IF;
  -- Released assignments and finished fixture references remain historical.
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
