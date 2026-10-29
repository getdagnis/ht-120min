-- Current and previous UTC month quiz leaders, with first-answer tie breaking.
BEGIN;
CREATE OR REPLACE FUNCTION public.flag_quiz_state(p_question_id timestamptz, p_manager_id bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
WITH mine AS (
  SELECT selected_league_id FROM public.flag_quiz_answers
  WHERE question_id = p_question_id AND manager_id = p_manager_id
), bounds AS (
  SELECT date_trunc('month', now() AT TIME ZONE 'UTC') AS current_start
), months AS (
  SELECT current_start, current_start - interval '1 month' AS previous_start FROM bounds
), scores AS (
  SELECT date_trunc('month', a.answered_at AT TIME ZONE 'UTC') AS month_start,
    a.manager_id, count(*)::integer AS attempted,
    count(*) FILTER (WHERE a.selected_league_id = q.correct_league_id)::integer AS correct,
    min(a.answered_at) AS first_answer_at
  FROM public.flag_quiz_answers a
  JOIN public.flag_quiz_questions q ON q.starts_at = a.question_id
  CROSS JOIN months m
  WHERE a.answered_at >= (m.previous_start AT TIME ZONE 'UTC')
    AND a.answered_at < ((m.current_start + interval '1 month') AT TIME ZONE 'UTC')
  GROUP BY month_start, a.manager_id
), ranked AS (
  SELECT s.month_start,
    rank() OVER (PARTITION BY s.month_start ORDER BY s.correct DESC, s.first_answer_at ASC) AS rank,
    s.manager_id, coalesce(nullif(p.manager_name, ''), 'Hattrick manager') AS manager_name,
    p.avatar_json, p.country_id, p.country_name, s.correct, s.attempted, s.first_answer_at
  FROM scores s LEFT JOIN public.profiles p ON p.hattrick_user_id = s.manager_id
  WHERE s.correct > 0
), current_leaders AS (
  SELECT * FROM ranked WHERE month_start = (SELECT current_start FROM months)
  ORDER BY correct DESC, first_answer_at ASC, manager_name, manager_id LIMIT 20
), previous_leaders AS (
  SELECT * FROM ranked WHERE month_start = (SELECT previous_start FROM months)
  ORDER BY correct DESC, first_answer_at ASC, manager_name, manager_id LIMIT 5
)
SELECT jsonb_build_object(
  'answer', (SELECT jsonb_build_object('selectedLeagueId', selected_league_id, 'correctLeagueId', q.correct_league_id) FROM mine),
  'results', CASE WHEN EXISTS (SELECT 1 FROM mine) THEN jsonb_build_object(
    'total', (SELECT count(*) FROM public.flag_quiz_answers WHERE question_id = p_question_id),
    'options', (SELECT jsonb_agg(jsonb_build_object('leagueId', (o->>'leagueId')::integer,
      'count', (SELECT count(*) FROM public.flag_quiz_answers a WHERE a.question_id = p_question_id AND a.selected_league_id = (o->>'leagueId')::integer))) FROM jsonb_array_elements(q.options) o)
  ) ELSE NULL END,
  'leaderboards', CASE WHEN EXISTS (SELECT 1 FROM mine) THEN jsonb_build_object(
    'current', jsonb_build_object('month', to_char((SELECT current_start FROM months), 'YYYY-MM'), 'leaders',
      coalesce((SELECT jsonb_agg(jsonb_build_object('rank', rank, 'managerId', manager_id, 'managerName', manager_name,
        'avatar', avatar_json, 'countryId', country_id, 'countryName', country_name, 'correct', correct, 'attempted', attempted)
        ORDER BY correct DESC, first_answer_at ASC, manager_name, manager_id) FROM current_leaders), '[]'::jsonb)),
    'previous', jsonb_build_object('month', to_char((SELECT previous_start FROM months), 'YYYY-MM'), 'leaders',
      coalesce((SELECT jsonb_agg(jsonb_build_object('rank', rank, 'managerId', manager_id, 'managerName', manager_name,
        'avatar', avatar_json, 'countryId', country_id, 'countryName', country_name, 'correct', correct, 'attempted', attempted)
        ORDER BY correct DESC, first_answer_at ASC, manager_name, manager_id) FROM previous_leaders), '[]'::jsonb))
  ) ELSE jsonb_build_object(
    'current', jsonb_build_object('month', to_char((SELECT current_start FROM months), 'YYYY-MM'), 'leaders', '[]'::jsonb),
    'previous', jsonb_build_object('month', to_char((SELECT previous_start FROM months), 'YYYY-MM'), 'leaders', '[]'::jsonb)
  ) END
) FROM public.flag_quiz_questions q WHERE q.starts_at = p_question_id;
$$;
COMMIT;

-- applied!