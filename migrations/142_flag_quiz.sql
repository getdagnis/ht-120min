-- Global 12-hour flag quiz. Apply before deploying the quiz API/widget.
BEGIN;
CREATE TABLE public.flag_quiz_questions (
  starts_at timestamptz PRIMARY KEY,
  expires_at timestamptz NOT NULL CHECK (expires_at = starts_at + interval '12 hours'),
  emoji text NOT NULL,
  correct_league_id integer NOT NULL,
  options jsonb NOT NULL CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) = 6),
  CHECK (mod(extract(epoch FROM starts_at)::bigint, 43200) = 0)
);
CREATE TABLE public.flag_quiz_answers (
  question_id timestamptz NOT NULL REFERENCES public.flag_quiz_questions(starts_at),
  manager_id bigint NOT NULL CHECK (manager_id > 0),
  selected_league_id integer NOT NULL,
  answered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (question_id, manager_id)
);
CREATE INDEX flag_quiz_answers_month_idx ON public.flag_quiz_answers (answered_at, manager_id);
ALTER TABLE public.flag_quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flag_quiz_answers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.flag_quiz_questions, public.flag_quiz_answers FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.flag_quiz_questions, public.flag_quiz_answers TO service_role;

-- Server supplies generated candidates; one transaction serializes creation and
-- uses the previous persisted question to prevent consecutive repeated flags.
CREATE FUNCTION public.ensure_flag_quiz_question(p_candidates jsonb)
RETURNS public.flag_quiz_questions LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_start timestamptz;
  v_question public.flag_quiz_questions;
  v_previous integer;
  v_candidate jsonb;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(142, 1);
  v_start := to_timestamp(floor(extract(epoch FROM clock_timestamp()) / 43200) * 43200);
  SELECT * INTO v_question FROM public.flag_quiz_questions WHERE starts_at = v_start;
  IF FOUND THEN RETURN v_question; END IF;
  SELECT correct_league_id INTO v_previous FROM public.flag_quiz_questions
    WHERE starts_at < v_start ORDER BY starts_at DESC LIMIT 1;
  SELECT value INTO v_candidate FROM jsonb_array_elements(p_candidates)
    WHERE (value->>'correctLeagueId')::integer IS DISTINCT FROM v_previous LIMIT 1;
  IF v_candidate IS NULL THEN RAISE EXCEPTION 'No quiz candidates'; END IF;
  INSERT INTO public.flag_quiz_questions VALUES (
    v_start, v_start + interval '12 hours', v_candidate->>'emoji',
    (v_candidate->>'correctLeagueId')::integer, v_candidate->'options'
  ) RETURNING * INTO v_question;
  RETURN v_question;
END $$;

CREATE FUNCTION public.answer_flag_quiz(p_question_id timestamptz, p_manager_id bigint, p_selected_league_id integer)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_question public.flag_quiz_questions;
BEGIN
  SELECT * INTO v_question FROM public.flag_quiz_questions WHERE starts_at = p_question_id;
  IF NOT FOUND OR clock_timestamp() < v_question.starts_at OR clock_timestamp() >= v_question.expires_at THEN
    RAISE EXCEPTION 'Question expired' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_question.options) o WHERE (o->>'leagueId')::integer = p_selected_league_id) THEN
    RAISE EXCEPTION 'Invalid option' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.flag_quiz_answers (question_id, manager_id, selected_league_id)
    VALUES (p_question_id, p_manager_id, p_selected_league_id) ON CONFLICT DO NOTHING;
END $$;

CREATE FUNCTION public.flag_quiz_state(p_question_id timestamptz, p_manager_id bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
WITH mine AS (
  SELECT selected_league_id FROM public.flag_quiz_answers
  WHERE question_id = p_question_id AND manager_id = p_manager_id
), scores AS (
  SELECT a.manager_id, count(*)::integer AS attempted,
    count(*) FILTER (WHERE a.selected_league_id = q.correct_league_id)::integer AS correct
  FROM public.flag_quiz_answers a JOIN public.flag_quiz_questions q ON q.starts_at = a.question_id
  WHERE a.answered_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    AND a.answered_at < (date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC'
  GROUP BY a.manager_id
), ranked AS (
  SELECT rank() OVER (ORDER BY s.correct DESC) AS rank,
    coalesce(nullif(p.manager_name, ''), 'Hattrick manager') AS manager_name,
    s.manager_id, s.correct, s.attempted
  FROM scores s LEFT JOIN public.profiles p ON p.hattrick_user_id = s.manager_id WHERE s.correct > 0
), leaders AS (
  SELECT * FROM ranked ORDER BY correct DESC, manager_name, manager_id LIMIT 20
)
SELECT jsonb_build_object(
  'answer', (SELECT jsonb_build_object('selectedLeagueId', selected_league_id, 'correctLeagueId', q.correct_league_id) FROM mine),
  'results', CASE WHEN EXISTS (SELECT 1 FROM mine) THEN jsonb_build_object(
    'total', (SELECT count(*) FROM public.flag_quiz_answers WHERE question_id = p_question_id),
    'options', (SELECT jsonb_agg(jsonb_build_object('leagueId', (o->>'leagueId')::integer,
      'count', (SELECT count(*) FROM public.flag_quiz_answers a WHERE a.question_id = p_question_id AND a.selected_league_id = (o->>'leagueId')::integer))) FROM jsonb_array_elements(q.options) o)
  ) ELSE NULL END,
  'leaders', CASE WHEN EXISTS (SELECT 1 FROM mine) THEN coalesce((SELECT jsonb_agg(jsonb_build_object(
    'rank', rank, 'managerName', manager_name, 'correct', correct, 'attempted', attempted)
    ORDER BY correct DESC, manager_name, manager_id) FROM leaders), '[]'::jsonb) ELSE '[]'::jsonb END
) FROM public.flag_quiz_questions q WHERE q.starts_at = p_question_id;
$$;
REVOKE ALL ON FUNCTION public.ensure_flag_quiz_question(jsonb), public.answer_flag_quiz(timestamptz,bigint,integer), public.flag_quiz_state(timestamptz,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_flag_quiz_question(jsonb), public.answer_flag_quiz(timestamptz,bigint,integer), public.flag_quiz_state(timestamptz,bigint) TO service_role;
COMMIT;

-- applied!