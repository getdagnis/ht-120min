-- Disposable database only: creates minimal Supabase roles/profile fixture.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE TABLE public.profiles (
  hattrick_user_id bigint PRIMARY KEY, manager_name text, avatar_json jsonb,
  country_id integer, country_name text
);
GRANT SELECT ON public.profiles TO service_role;
\ir ../../migrations/142_flag_quiz.sql
\ir ../../migrations/143_flag_quiz_leader_profiles.sql
BEGIN;
INSERT INTO public.profiles VALUES
  (77, 'mr_bots', '{"backgroundImage":"avatar.png"}', 1, 'Sverige'),
  (78, 'another_manager', NULL, 2, 'England');
INSERT INTO public.flag_quiz_questions VALUES (
  to_timestamp(floor(extract(epoch FROM now()) / 43200) * 43200) - interval '12 hours',
  to_timestamp(floor(extract(epoch FROM now()) / 43200) * 43200), '🇸🇪', 1,
  '[{"leagueId":1,"name":"Sweden"},{"leagueId":2,"name":"England"},{"leagueId":3,"name":"Germany"},{"leagueId":4,"name":"Italy"},{"leagueId":5,"name":"France"},{"leagueId":6,"name":"Mexico"}]'
);
SET LOCAL ROLE service_role;
DO $$
DECLARE q public.flag_quiz_questions; again public.flag_quiz_questions; s jsonb; candidates jsonb;
BEGIN
  candidates := '[{"correctLeagueId":1,"emoji":"🇸🇪","options":[{"leagueId":1},{"leagueId":2},{"leagueId":3},{"leagueId":4},{"leagueId":5},{"leagueId":6}]},
    {"correctLeagueId":2,"emoji":"🏴","options":[{"leagueId":1},{"leagueId":2},{"leagueId":3},{"leagueId":4},{"leagueId":5},{"leagueId":6}]}]';
  q := public.ensure_flag_quiz_question(candidates);
  ASSERT q.correct_league_id = 2, 'previous flag must not repeat';
  again := public.ensure_flag_quiz_question(candidates);
  ASSERT q = again, 'question and options must remain stable';
  s := public.flag_quiz_state(q.starts_at, NULL);
  ASSERT s->'answer' = 'null'::jsonb AND s->'results' = 'null'::jsonb AND s->'leaders' = '[]'::jsonb;
  PERFORM public.answer_flag_quiz(q.starts_at,77,2);
  PERFORM public.answer_flag_quiz(q.starts_at,77,1);
  PERFORM public.answer_flag_quiz(q.starts_at,78,1);
  s := public.flag_quiz_state(q.starts_at,77);
  ASSERT (s#>>'{answer,selectedLeagueId}')::integer = 2, 'duplicate must not change saved guess';
  ASSERT (s#>>'{answer,correctLeagueId}')::integer = 2;
  ASSERT (s#>>'{results,total}')::integer = 2;
  ASSERT (s#>>'{leaders,0,managerName}') = 'mr_bots';
  ASSERT (s#>>'{leaders,0,managerId}')::bigint = 77;
  ASSERT (s#>>'{leaders,0,avatar,backgroundImage}') = 'avatar.png';
  ASSERT (s#>>'{leaders,0,countryId}')::integer = 1;
  ASSERT (s#>>'{leaders,0,countryName}') = 'Sverige';
  ASSERT (s#>>'{leaders,0,correct}')::integer = 1 AND (s#>>'{leaders,0,attempted}')::integer = 1;
  ASSERT (SELECT sum((value->>'count')::int) FROM jsonb_array_elements(s#>'{results,options}')) = 2;
  s := public.flag_quiz_state(q.starts_at,999);
  ASSERT s->'answer' = 'null'::jsonb AND s->'results' = 'null'::jsonb;
  BEGIN
    PERFORM public.answer_flag_quiz(q.starts_at,79,999);
    RAISE EXCEPTION 'invalid option accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.answer_flag_quiz(q.starts_at-interval '12 hours',79,1);
    RAISE EXCEPTION 'expired answer accepted';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  -- Previous UTC month must not contribute to the current ranking.
  INSERT INTO public.flag_quiz_answers(question_id,manager_id,selected_league_id,answered_at)
    VALUES(q.starts_at,3000,2,(date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')-interval '1 second');
  s := public.flag_quiz_state(q.starts_at,3000);
  ASSERT jsonb_array_length(s->'leaders') = 1, 'previous month must not contribute';

  -- More than the REST row cap: SQL totals and top 20 must remain complete.
  INSERT INTO public.flag_quiz_answers(question_id,manager_id,selected_league_id)
    SELECT q.starts_at,generate_series(1000,2500),2;
  s := public.flag_quiz_state(q.starts_at,77);
  ASSERT (s#>>'{results,total}')::integer = 1504;
  ASSERT jsonb_array_length(s->'leaders') = 20;
  ASSERT (SELECT bool_and((value->>'rank')::int=1) FROM jsonb_array_elements(s->'leaders')), 'ties share rank';

END $$;
RESET ROLE;
DO $$
DECLARE role_name text; table_name text; operation text; function_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH table_name IN ARRAY ARRAY['flag_quiz_questions','flag_quiz_answers'] LOOP
      FOREACH operation IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
        ASSERT NOT has_table_privilege(role_name,'public.'||table_name,operation), 'browser table access';
      END LOOP;
    END LOOP;
    FOREACH function_name IN ARRAY ARRAY['ensure_flag_quiz_question(jsonb)','answer_flag_quiz(timestamptz,bigint,integer)','flag_quiz_state(timestamptz,bigint)'] LOOP
      ASSERT NOT has_function_privilege(role_name,'public.'||function_name,'EXECUTE'), 'browser RPC access';
    END LOOP;
  END LOOP;
END $$;
ROLLBACK;
