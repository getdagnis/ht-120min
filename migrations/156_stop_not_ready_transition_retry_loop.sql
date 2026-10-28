-- Stop PostgREST's internal serialization retries for a deterministic rejection.
-- Only changes the error code. The exception, rollback, permissions and lock stay.
-- Apply before clearing existing retrying database sessions.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';
DO $patch$
DECLARE
  signature regprocedure := 'public.apply_length_round_transition_with_membership(uuid,integer,uuid,uuid,jsonb,uuid[],uuid[],text,uuid)'::regprocedure;
  definition text;
  old_statement text := 'RAISE EXCEPTION ''Round is not ready; membership remains unchanged'' USING ERRCODE=''40001'';';
  new_statement text := 'RAISE EXCEPTION ''Round is not ready; membership remains unchanged'' USING ERRCODE=''P0001'';';
BEGIN
  definition := pg_get_functiondef(signature);
  IF strpos(definition, old_statement) = 0 THEN
    IF strpos(definition, new_statement) > 0 THEN RETURN; END IF;
    RAISE EXCEPTION 'Unexpected transition definition; no change applied';
  END IF;
  EXECUTE replace(definition, old_statement, new_statement);
END;
$patch$;
NOTIFY pgrst, 'reload schema';
COMMIT;
