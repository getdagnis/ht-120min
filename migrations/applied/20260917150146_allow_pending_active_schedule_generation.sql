-- Auto-started seasons close registration before their first schedule is made.
-- Allow that pending state through the generation RPC without reopening the
-- roster or making an already-generated schedule writable.
DO $$
DECLARE
  v_function_definition text;
  v_existing_status_guard constant text := E'IF v_tournament.status IS DISTINCT FROM \'open\' AND v_tournament.status IS DISTINCT FROM \'waiting\' THEN';
  v_pending_status_guard constant text := E'IF v_tournament.status IS DISTINCT FROM \'open\'\n    AND v_tournament.status IS DISTINCT FROM \'waiting\'\n    AND NOT (\n      v_tournament.status = \'active\'\n      AND v_tournament.schedule_generated_at IS NULL\n      AND NOT EXISTS (\n        SELECT 1\n        FROM rounds\n        WHERE tournament_id = p_tournament_id\n          AND season_number = COALESCE(v_tournament.season, 1)\n      )\n    ) THEN';
BEGIN
  SELECT pg_get_functiondef(
    'public.generate_tournament_schedule(uuid, text, jsonb, text, timestamptz, boolean)'::regprocedure
  )
  INTO v_function_definition;

  IF v_function_definition IS NULL THEN
    RAISE EXCEPTION 'generate_tournament_schedule function is missing' USING ERRCODE = '42883';
  END IF;

  IF position(v_pending_status_guard IN v_function_definition) > 0 THEN
    RETURN;
  END IF;

  IF position(v_existing_status_guard IN v_function_definition) = 0 THEN
    RAISE EXCEPTION 'generate_tournament_schedule has an unexpected status guard; refusing to replace it'
      USING ERRCODE = '55000';
  END IF;

  v_function_definition := replace(
    v_function_definition,
    v_existing_status_guard,
    v_pending_status_guard
  );

  EXECUTE v_function_definition;
END;
$$;
