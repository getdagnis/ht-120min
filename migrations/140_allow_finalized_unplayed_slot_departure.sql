-- A finalized, unlinked DNP is historical even though completed remains false.
-- Keep every other started/linked fixture guard in the existing slot function.
BEGIN;

DO $$
DECLARE
  function_definition text;
  old_guard constant text := 'OR m.scheduled_for <= v_now';
  new_guard constant text := 'OR (m.scheduled_for <= v_now AND NOT (m.schedule_resolution = ''finalized_unplayed'' AND m.status = ''misarranged'' AND m.ht_match_id IS NULL))';
BEGIN
  SELECT pg_get_functiondef('public.vacate_team_slot_in_current_season(uuid,integer,uuid)'::regprocedure)
  INTO function_definition;

  IF function_definition IS NULL
    OR length(function_definition) - length(replace(function_definition, old_guard, '')) <> length(old_guard) THEN
    RAISE EXCEPTION 'Unexpected vacate_team_slot_in_current_season guard; inspect before applying migration 140';
  END IF;

  EXECUTE replace(function_definition, old_guard, new_guard);
END;
$$;

COMMIT;

-- applied!