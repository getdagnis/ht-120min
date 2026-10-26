-- A repeat submission replaces the manager's latest survey answer and the
-- corresponding operational preferences instead of failing on the unique key.
BEGIN;

GRANT UPDATE ON public.survey_responses TO service_role;

CREATE OR REPLACE FUNCTION public.submit_tournament_preference_survey(
  p_survey_id uuid, p_tournament_id uuid, p_manager_ht_id bigint,
  p_manager_name text, p_manager_country_id integer,
  p_manager_importance text, p_team_answers jsonb
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  survey_variant text;
  expected_teams integer;
  answer jsonb;
  answer_team_id uuid;
  answer_ht_team_id bigint;
  seen_teams uuid[] := '{}';
BEGIN
  SELECT variant INTO survey_variant FROM public.surveys
    WHERE id = p_survey_id AND tournament_id = p_tournament_id
      AND scope = 'tournament' AND status = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Survey is no longer active' USING ERRCODE = '40001'; END IF;
  IF p_manager_ht_id IS NULL OR p_manager_ht_id <= 0
    OR p_manager_importance NOT IN ('high', 'nice', 'depends', 'regular')
    OR p_manager_name IS NULL OR length(trim(p_manager_name)) = 0
    OR p_team_answers IS NULL OR jsonb_typeof(p_team_answers) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid survey response' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO expected_teams FROM public.teams
    WHERE tournament_id = p_tournament_id AND hattrick_user_id = p_manager_ht_id
      AND active = true AND NOT coalesce(reserve_active, false)
      AND NOT coalesce(is_placeholder, false) AND ht_team_id > 0;
  IF expected_teams = 0 OR jsonb_array_length(p_team_answers) <> expected_teams THEN
    RAISE EXCEPTION 'Participating teams changed' USING ERRCODE = '40001';
  END IF;
  FOR answer IN SELECT value FROM jsonb_array_elements(p_team_answers) LOOP
    answer_team_id := (answer->>'team_id')::uuid;
    answer_ht_team_id := (answer->>'ht_team_id')::bigint;
    IF answer_team_id = ANY(seen_teams)
      OR NOT EXISTS (
        SELECT 1 FROM public.teams WHERE id = answer_team_id
          AND tournament_id = p_tournament_id AND ht_team_id = answer_ht_team_id
          AND hattrick_user_id = p_manager_ht_id AND active = true
          AND NOT coalesce(reserve_active, false) AND NOT coalesce(is_placeholder, false)
      ) OR NOT (
        (survey_variant = 'flag_hunters' AND answer->>'priority' IN ('flags', '120m', 'both', 'fun'))
        OR (survey_variant = 'exotic_hfi' AND answer->>'priority' IN ('domestic', '120m', 'both', 'fun'))
      ) THEN
      RAISE EXCEPTION 'Invalid team answer' USING ERRCODE = '22023';
    END IF;
    seen_teams := array_append(seen_teams, answer_team_id);
  END LOOP;

  INSERT INTO public.survey_responses
    (survey_id, manager_ht_id, manager_name, manager_country_id, manager_importance, team_answers)
  VALUES (p_survey_id, p_manager_ht_id, p_manager_name, p_manager_country_id, p_manager_importance, p_team_answers)
  ON CONFLICT (survey_id, manager_ht_id) DO UPDATE SET
    manager_name = EXCLUDED.manager_name,
    manager_country_id = EXCLUDED.manager_country_id,
    manager_importance = EXCLUDED.manager_importance,
    team_answers = EXCLUDED.team_answers,
    completed_at = now();

  FOR answer IN SELECT value FROM jsonb_array_elements(p_team_answers) LOOP
    INSERT INTO public.team_preferences
      (tournament_id, ht_team_id, manager_ht_id, priority)
    VALUES (p_tournament_id, (answer->>'ht_team_id')::bigint, p_manager_ht_id, answer->>'priority')
    ON CONFLICT (tournament_id, ht_team_id, manager_ht_id) DO UPDATE
      SET priority = EXCLUDED.priority, updated_at = now();
  END LOOP;
  INSERT INTO public.manager_preferences
    (tournament_id, manager_ht_id, importance_120m)
  VALUES (p_tournament_id, p_manager_ht_id, p_manager_importance)
  ON CONFLICT (tournament_id, manager_ht_id) DO UPDATE
    SET importance_120m = EXCLUDED.importance_120m, updated_at = now();
END $$;

REVOKE ALL ON FUNCTION public.submit_tournament_preference_survey(uuid, uuid, bigint, text, integer, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_tournament_preference_survey(uuid, uuid, bigint, text, integer, text, jsonb)
  TO service_role;

COMMIT;

-- applied!