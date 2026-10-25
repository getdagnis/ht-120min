-- Give surveys and operational preferences short, discoverable table names.
-- Existing records and the active Flag Hunters survey keep their IDs and data.
BEGIN;

ALTER TABLE public.tournament_preference_surveys RENAME TO surveys;
ALTER TABLE public.tournament_preference_responses RENAME TO survey_responses;
ALTER TABLE public.tournament_team_preferences RENAME TO team_preferences;
ALTER TABLE public.tournament_manager_preferences RENAME TO manager_preferences;

ALTER TABLE public.surveys
  ADD COLUMN scope text NOT NULL DEFAULT 'tournament',
  ALTER COLUMN tournament_id DROP NOT NULL,
  ADD CONSTRAINT surveys_scope_check CHECK (scope IN ('tournament', 'site')),
  ADD CONSTRAINT surveys_scope_tournament_check CHECK (
    (scope = 'tournament' AND tournament_id IS NOT NULL)
    OR (scope = 'site' AND tournament_id IS NULL)
  );

DROP INDEX public.tournament_preference_one_active;
CREATE UNIQUE INDEX surveys_one_active_per_tournament
  ON public.surveys (tournament_id)
  WHERE scope = 'tournament' AND status = 'active';
CREATE UNIQUE INDEX surveys_one_active_sitewide
  ON public.surveys ((scope))
  WHERE scope = 'site' AND status = 'active';

-- Keep old table names as service-only compatibility views during deployment.
-- This lets already-deployed API instances continue to read and administer
-- existing tournament surveys while the application switches to the short names.
CREATE VIEW public.tournament_preference_surveys AS
  SELECT id, tournament_id, variant, status, created_at, published_at, closed_at
  FROM public.surveys;
CREATE VIEW public.tournament_preference_responses AS
  SELECT survey_id, manager_ht_id, manager_name, manager_country_id,
    manager_importance, team_answers, completed_at
  FROM public.survey_responses;
CREATE VIEW public.tournament_team_preferences AS
  SELECT tournament_id, ht_team_id, manager_ht_id, priority, updated_at
  FROM public.team_preferences;
CREATE VIEW public.tournament_manager_preferences AS
  SELECT tournament_id, manager_ht_id, importance_120m, updated_at
  FROM public.manager_preferences;

REVOKE ALL ON public.tournament_preference_surveys,
  public.tournament_preference_responses,
  public.tournament_team_preferences,
  public.tournament_manager_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tournament_preference_surveys TO service_role;
GRANT SELECT, INSERT ON public.tournament_preference_responses TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.tournament_team_preferences TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.tournament_manager_preferences TO service_role;

NOTIFY pgrst, 'reload schema';

-- Keep the submission contract stable for deployed callers, but write to the
-- renamed tables. The historical answer and live preferences stay atomic.
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
  VALUES (p_survey_id, p_manager_ht_id, p_manager_name, p_manager_country_id, p_manager_importance, p_team_answers);

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
