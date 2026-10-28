-- Return stale-snapshot conflicts to the caller instead of PostgREST retrying
-- the same stale payload indefinitely. The application rereads and retries once.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';
DO $patch$
DECLARE
  signature regprocedure := 'public.replace_match_120m_ratings(uuid,jsonb,jsonb,jsonb)'::regprocedure;
  definition text := pg_get_functiondef(signature);
  conflict_message text;
  old_statement text;
  new_statement text;
BEGIN
  FOREACH conflict_message IN ARRAY ARRAY['Fixture performance changed', 'Fixture participant changed'] LOOP
    old_statement := format('RAISE EXCEPTION %L USING ERRCODE=''40001'';', conflict_message);
    new_statement := format('RAISE EXCEPTION %L USING ERRCODE=''PT409'';', conflict_message);
    IF strpos(definition, old_statement) = 0 AND strpos(definition, new_statement) = 0 THEN
      RAISE EXCEPTION 'Unexpected rating function definition; no change applied';
    END IF;
    definition := replace(definition, old_statement, new_statement);
  END LOOP;
  EXECUTE definition;
END;
$patch$;
NOTIFY pgrst, 'reload schema';
COMMIT;

-- applied!