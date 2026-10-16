BEGIN;

-- A Past team's released slot must be selected explicitly. The older reserve
-- fill chooses the first vacancy and is still used by its existing callers.
CREATE FUNCTION public.fill_past_team_slot_with_reserve(
  p_tournament_id uuid,
  p_season_number integer,
  p_former_team_id uuid,
  p_incoming_reserve_team_id uuid
)
RETURNS TABLE(slot_id uuid, incoming_assignment_id uuid, updated_match_count integer)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_season_id uuid;
  v_slot_id uuid;
  v_former public.teams%ROWTYPE;
  v_incoming public.teams%ROWTYPE;
  v_assignment_id uuid;
  v_slot_count integer;
  v_updated integer := 0;
BEGIN
  -- Follow the tournament-first order used by scheduled-team removal and replacement.
  PERFORM 1 FROM public.tournaments
  WHERE id = p_tournament_id AND COALESCE(season, 1) = p_season_number
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tournament is not on the requested season' USING ERRCODE = '22023'; END IF;

  SELECT id INTO v_season_id FROM public.tournament_seasons
  WHERE tournament_id = p_tournament_id AND season_number = p_season_number;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current tournament season was not found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_former FROM public.teams
  WHERE id = p_former_team_id AND tournament_id = p_tournament_id FOR UPDATE;
  IF NOT FOUND OR v_former.is_placeholder OR v_former.active IS DISTINCT FROM false
     OR v_former.reserve_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Selected team is not a Past team' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_incoming FROM public.teams
  WHERE id = p_incoming_reserve_team_id AND tournament_id = p_tournament_id FOR UPDATE;
  IF NOT FOUND OR v_incoming.is_placeholder OR v_incoming.active IS DISTINCT FROM false
     OR v_incoming.reserve_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Incoming team is not an available reserve' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_season_slots
    WHERE tournament_season_id = v_season_id AND current_team_id = v_incoming.id
  ) OR EXISTS (
    SELECT 1 FROM public.teams other_team
    JOIN public.tournaments other_tournament ON other_tournament.id = other_team.tournament_id
    WHERE other_team.ht_team_id = v_incoming.ht_team_id AND other_team.id <> v_incoming.id
      AND other_team.active = true AND COALESCE(other_tournament.is_test, false) = false
      AND other_tournament.status IN ('open', 'waiting', 'active', 'paused')
  ) THEN
    RAISE EXCEPTION 'Incoming reserve is already committed elsewhere' USING ERRCODE = '23505';
  END IF;

  SELECT count(*) INTO v_slot_count FROM public.tournament_season_slots s
  WHERE s.tournament_season_id = v_season_id AND s.current_team_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.tournament_season_slot_assignments a
      WHERE a.tournament_season_slot_id = s.id AND a.team_id = v_former.id AND a.released_at IS NOT NULL
    );
  IF v_slot_count <> 1 THEN
    RAISE EXCEPTION 'Past team must have exactly one vacant current-season slot' USING ERRCODE = '22023';
  END IF;
  SELECT s.id INTO v_slot_id FROM public.tournament_season_slots s
  WHERE s.tournament_season_id = v_season_id AND s.current_team_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.tournament_season_slot_assignments a
      WHERE a.tournament_season_slot_id = s.id AND a.team_id = v_former.id AND a.released_at IS NOT NULL
    )
  FOR UPDATE;

  PERFORM 1 FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
  WHERE r.tournament_id = p_tournament_id AND r.season_number = p_season_number
    AND (m.home_slot_id = v_slot_id OR m.away_slot_id = v_slot_id OR m.reserve_team_id = v_incoming.id
      OR m.home_team_id = v_incoming.id OR m.away_team_id = v_incoming.id)
  FOR UPDATE OF m;
  IF EXISTS (
    SELECT 1 FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
    WHERE r.tournament_id = p_tournament_id AND r.season_number = p_season_number
      AND m.completed IS NOT TRUE AND (
        m.reserve_team_id = v_incoming.id OR m.home_team_id = v_incoming.id OR m.away_team_id = v_incoming.id OR
        ((m.home_slot_id = v_slot_id OR m.away_slot_id = v_slot_id) AND (
          m.ht_match_id IS NOT NULL
          OR COALESCE(m.status, 'not_arranged') NOT IN ('not_arranged', 'misarranged')
          OR m.finished_at IS NOT NULL OR m.home_goals IS NOT NULL OR m.away_goals IS NOT NULL
          OR m.match_event_details IS NOT NULL OR m.scheduled_for IS NULL OR m.scheduled_for <= now()
          OR (m.home_slot_id = v_slot_id AND m.home_team_id IS NOT NULL)
          OR (m.away_slot_id = v_slot_id AND m.away_team_id IS NOT NULL)
        ))
      )
  ) THEN
    RAISE EXCEPTION 'The selected slot has a protected fixture or the reserve is already booked' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.rounds r
    WHERE r.tournament_id = p_tournament_id AND r.season_number = p_season_number
      AND r.phase_status = 'materialized'
      AND NOT EXISTS (
        SELECT 1 FROM public.matches m
        WHERE m.round_id = r.id AND (m.home_slot_id = v_slot_id OR m.away_slot_id = v_slot_id)
      )
  ) THEN
    RAISE EXCEPTION 'The selected slot has no fixture in the current round; repair the round first' USING ERRCODE = '55000';
  END IF;

  UPDATE public.tournament_season_slots
  SET current_team_id = v_incoming.id, updated_at = now() WHERE id = v_slot_id;
  INSERT INTO public.tournament_season_slot_assignments(
    tournament_season_slot_id, team_id, reason, team_name, ht_team_id,
    manager_name, hattrick_user_id, logo_url
  ) VALUES (
    v_slot_id, v_incoming.id, 'admin_replace', v_incoming.name, v_incoming.ht_team_id,
    v_incoming.manager_name, v_incoming.hattrick_user_id, v_incoming.logo_url
  ) RETURNING id INTO v_assignment_id;

  UPDATE public.teams SET active = true, reserve_active = false, reserve_joined_at = NULL
  WHERE id = v_incoming.id;

  UPDATE public.matches m
  SET home_team_id = CASE WHEN m.home_slot_id = v_slot_id THEN v_incoming.id ELSE m.home_team_id END,
      away_team_id = CASE WHEN m.away_slot_id = v_slot_id THEN v_incoming.id ELSE m.away_team_id END,
      home_slot_assignment_id = CASE WHEN m.home_slot_id = v_slot_id THEN v_assignment_id ELSE m.home_slot_assignment_id END,
      away_slot_assignment_id = CASE WHEN m.away_slot_id = v_slot_id THEN v_assignment_id ELSE m.away_slot_assignment_id END
  FROM public.rounds r
  WHERE r.id = m.round_id AND r.tournament_id = p_tournament_id AND r.season_number = p_season_number
    AND (m.home_slot_id = v_slot_id OR m.away_slot_id = v_slot_id)
    AND m.completed IS NOT TRUE AND m.ht_match_id IS NULL
    AND COALESCE(m.status, 'not_arranged') IN ('not_arranged', 'misarranged')
    AND m.finished_at IS NULL AND m.home_goals IS NULL AND m.away_goals IS NULL
    AND m.match_event_details IS NULL AND m.scheduled_for > now();
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  slot_id := v_slot_id;
  incoming_assignment_id := v_assignment_id;
  updated_match_count := v_updated;
  RETURN NEXT;
END;
$$;

-- Do not let ON DELETE CASCADE or SET NULL silently erase tournament history.
CREATE FUNCTION public.remove_unused_past_tournament_team(p_tournament_id uuid, p_team_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_team public.teams%ROWTYPE;
  v_reference record;
  v_used boolean;
BEGIN
  PERFORM 1 FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tournament not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_team FROM public.teams
  WHERE id = p_team_id AND tournament_id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('removed', true); END IF;
  IF v_team.active IS DISTINCT FROM false OR v_team.reserve_active IS DISTINCT FROM false
     OR v_team.is_placeholder IS TRUE OR v_team.reapply_season_number IS NOT NULL THEN
    RAISE EXCEPTION 'Only unused Past teams can be removed' USING ERRCODE = '22023';
  END IF;
  FOR v_reference IN
    SELECT c.conrelid::regclass AS relation, a.attname AS column_name
    FROM pg_constraint c JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.confrelid = 'public.teams'::regclass
      AND cardinality(c.conkey) = 1
  LOOP
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s WHERE %I=$1)',
      v_reference.relation, v_reference.column_name) INTO v_used USING p_team_id;
    IF v_used THEN
      RAISE EXCEPTION 'Past team has fixture or other tournament history and must be kept' USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM public.tournament_seasons s
    WHERE s.tournament_id = p_tournament_id
      AND (s.snapshot_json::text LIKE '%' || p_team_id::text || '%'
        OR s.fixtures_snapshot_json::text LIKE '%' || p_team_id::text || '%'
        OR (v_team.ht_team_id IS NOT NULL AND (
          s.snapshot_json::text ~ ('(^|[^0-9])' || v_team.ht_team_id::text || '([^0-9]|$)')
          OR s.fixtures_snapshot_json::text ~ ('(^|[^0-9])' || v_team.ht_team_id::text || '([^0-9]|$)')
        )))
  ) THEN
    RAISE EXCEPTION 'Past team appears in season history and must be kept' USING ERRCODE = '55000';
  END IF;
  DELETE FROM public.teams WHERE id = p_team_id AND tournament_id = p_tournament_id;
  RETURN jsonb_build_object('removed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.fill_past_team_slot_with_reserve(uuid,integer,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remove_unused_past_tournament_team(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fill_past_team_slot_with_reserve(uuid,integer,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.remove_unused_past_tournament_team(uuid,uuid) TO service_role;
COMMIT;

-- applied!