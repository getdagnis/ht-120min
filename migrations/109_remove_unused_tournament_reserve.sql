BEGIN;

-- Remove a tournament-specific registration only; protect every reference,
-- including cascading foreign keys which would otherwise erase history.
CREATE OR REPLACE FUNCTION public.remove_unused_tournament_reserve(
  p_tournament_id uuid, p_team_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_team public.teams%ROWTYPE;
  v_reference record;
  v_used boolean;
BEGIN
  -- Use the same lock order as admission so removing cannot race promotion.
  PERFORM 1 FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tournament not found'; END IF;
  SELECT * INTO v_team FROM public.teams
    WHERE id=p_team_id AND tournament_id=p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('removed', true); END IF;
  IF v_team.active IS DISTINCT FROM false OR v_team.reserve_active IS DISTINCT FROM true
     OR v_team.is_placeholder IS TRUE THEN
    RAISE EXCEPTION 'Only unused reserve registrations can be removed';
  END IF;

  -- Explicit guards also cover legacy installations with missing constraints.
  IF EXISTS(SELECT 1 FROM public.matches WHERE home_team_id=p_team_id OR away_team_id=p_team_id
      OR reserve_team_id=p_team_id OR reserve_replaces_team_id=p_team_id)
    OR EXISTS(SELECT 1 FROM public.tournament_season_slots WHERE current_team_id=p_team_id)
    OR EXISTS(SELECT 1 FROM public.tournament_season_slot_assignments WHERE team_id=p_team_id) THEN
    RAISE EXCEPTION 'Reserve is tied to fixtures or season history';
  END IF;

  FOR v_reference IN
    SELECT c.conrelid::regclass AS relation, a.attname AS column_name
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
    WHERE c.contype='f' AND c.confrelid='public.teams'::regclass
      AND cardinality(c.conkey)=1
  LOOP
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s WHERE %I=$1)',
      v_reference.relation, v_reference.column_name) INTO v_used USING p_team_id;
    IF v_used THEN RAISE EXCEPTION 'Reserve has existing history'; END IF;
  END LOOP;

  DELETE FROM public.teams WHERE id=p_team_id AND tournament_id=p_tournament_id;
  RETURN jsonb_build_object('removed', true);
END;
$$;
REVOKE ALL ON FUNCTION public.remove_unused_tournament_reserve(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.remove_unused_tournament_reserve(uuid,uuid) TO service_role;
COMMIT;

-- applied!