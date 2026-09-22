-- Season history retains earlier rounds. Schedule generation must only reject
-- rounds belonging to the tournament's current season.
DO $$
DECLARE
  v_function_definition text;
  v_unscoped_guard constant text := E'WHERE tournament_id = p_tournament_id\n  ) THEN';
  v_current_season_guard constant text := E'WHERE tournament_id = p_tournament_id\n      AND season_number = COALESCE(v_tournament.season, 1)\n  ) THEN';
BEGIN
  SELECT pg_get_functiondef(
    'public.generate_tournament_schedule(uuid, text, jsonb, text, timestamptz, boolean)'::regprocedure
  )
  INTO v_function_definition;

  IF v_function_definition IS NULL THEN
    RAISE EXCEPTION 'generate_tournament_schedule function is missing' USING ERRCODE = '42883';
  END IF;

  IF position(v_current_season_guard IN v_function_definition) > 0 THEN
    RETURN;
  END IF;

  IF position(v_unscoped_guard IN v_function_definition) = 0 THEN
    RAISE EXCEPTION 'generate_tournament_schedule has an unexpected round-existence guard; refusing to replace it'
      USING ERRCODE = '55000';
  END IF;

  v_function_definition := replace(
    v_function_definition,
    v_unscoped_guard,
    v_current_season_guard
  );

  EXECUTE v_function_definition;
END;
$$;
