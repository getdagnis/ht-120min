BEGIN;

-- A released assignment is a frozen identity record, not by itself a played
-- fixture. Keep the assignment snapshot when its unused team row is removed.
CREATE OR REPLACE FUNCTION public.remove_unused_past_tournament_team(p_tournament_id uuid, p_team_id uuid)
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

  -- Lock assignment rows so a concurrent fixture cannot acquire an assignment
  -- FK reference after this check. Any live or fixture-used assignment is history.
  PERFORM 1 FROM public.tournament_season_slot_assignments
  WHERE team_id = p_team_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.tournament_season_slot_assignments a
    WHERE a.team_id = p_team_id
      AND (a.released_at IS NULL OR EXISTS (
        SELECT 1 FROM public.matches m
        WHERE m.home_slot_assignment_id = a.id OR m.away_slot_assignment_id = a.id
      ))
  ) THEN
    RAISE EXCEPTION 'Past team has fixture or other tournament history and must be kept' USING ERRCODE = '55000';
  END IF;

  FOR v_reference IN
    SELECT c.conrelid::regclass AS relation, a.attname AS column_name
    FROM pg_constraint c JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.confrelid = 'public.teams'::regclass
      AND cardinality(c.conkey) = 1
      AND NOT (c.conrelid = 'public.tournament_season_slot_assignments'::regclass
        AND a.attname = 'team_id' AND c.confdeltype = 'n')
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

REVOKE ALL ON FUNCTION public.remove_unused_past_tournament_team(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_unused_past_tournament_team(uuid,uuid) TO service_role;
COMMIT;

-- applied!