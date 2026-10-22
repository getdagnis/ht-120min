-- Add the fields needed to render quiz leaderboard managers like chat authors.
BEGIN;
CREATE OR REPLACE FUNCTION public.flag_quiz_state(p_question_id timestamptz, p_manager_id bigint)
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
    s.manager_id,
    coalesce(nullif(p.manager_name, ''), 'Hattrick manager') AS manager_name,
    p.avatar_json, p.country_id, p.country_name,
    s.correct, s.attempted
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
    'rank', rank, 'managerId', manager_id, 'managerName', manager_name,
    'avatar', avatar_json, 'countryId', country_id, 'countryName', country_name,
    'correct', correct, 'attempted', attempted)
    ORDER BY correct DESC, manager_name, manager_id) FROM leaders), '[]'::jsonb) ELSE '[]'::jsonb END
) FROM public.flag_quiz_questions q WHERE q.starts_at = p_question_id;
$$;
COMMIT;

-- applied!