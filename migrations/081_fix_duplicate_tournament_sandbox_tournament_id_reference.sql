-- Qualify the source team's tournament_id in the sandbox snapshot function.
BEGIN;

CREATE OR REPLACE FUNCTION public.duplicate_tournament_as_sandbox(
  p_source_tournament_id UUID,
  p_name TEXT,
  p_slug TEXT,
  p_admin_password TEXT,
  p_organizer_id BIGINT,
  p_organizer_name TEXT,
  p_teams JSONB
)
RETURNS TABLE(tournament_id UUID, slug TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_source public.tournaments%ROWTYPE;
  v_tournament_id UUID;
  v_team JSONB;
  v_team_count INTEGER;
BEGIN
  SELECT *
  INTO v_source
  FROM public.tournaments
  WHERE id = p_source_tournament_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source tournament not found' USING ERRCODE = 'P0002';
  END IF;
  IF COALESCE(v_source.is_test, FALSE) OR v_source.registration_type = 'sandbox' THEN
    RAISE EXCEPTION 'Only real tournaments can be duplicated as sandboxes' USING ERRCODE = '22023';
  END IF;
  IF p_organizer_id IS NULL
    OR btrim(COALESCE(p_name, '')) = ''
    OR btrim(COALESCE(p_slug, '')) = ''
    OR btrim(COALESCE(p_admin_password, '')) = '' THEN
    RAISE EXCEPTION 'Sandbox identity is incomplete' USING ERRCODE = '22023';
  END IF;
  IF p_teams IS NULL OR jsonb_typeof(p_teams) <> 'array' THEN
    RAISE EXCEPTION 'Sandbox teams must be an array' USING ERRCODE = '22023';
  END IF;

  v_team_count := jsonb_array_length(p_teams);
  IF v_team_count < 2 THEN
    RAISE EXCEPTION 'At least two effective participants are required' USING ERRCODE = '22023';
  END IF;
  IF v_source.max_teams IS NOT NULL AND v_team_count > v_source.max_teams THEN
    RAISE EXCEPTION 'Effective roster exceeds the tournament team limit' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_teams) AS item
    GROUP BY (item->>'ht_team_id')
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Effective roster contains duplicate Hattrick teams' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.tournaments (
    name,
    slug,
    admin_password,
    scoring_mode,
    is_private,
    description,
    show_description,
    is_featured,
    image_url,
    include_week15_weekend_friendly,
    thumbnail_index,
    chpp_only_join,
    country_limit,
    country_limit_format,
    league_category,
    registration_type,
    season,
    is_test,
    status,
    organizer_id,
    organizer_name,
    max_teams,
    schedule_mode,
    schedule_start_slot,
    schedule_locked_at,
    registration_closed_at,
    schedule_generated_at,
    admin_email,
    forum_id,
    is_archived
  )
  VALUES (
    p_name,
    p_slug,
    p_admin_password,
    v_source.scoring_mode,
    TRUE,
    v_source.description,
    v_source.show_description,
    FALSE,
    v_source.image_url,
    v_source.include_week15_weekend_friendly,
    v_source.thumbnail_index,
    v_source.chpp_only_join,
    v_source.country_limit,
    v_source.country_limit_format,
    v_source.league_category,
    'sandbox',
    1,
    TRUE,
    'open',
    p_organizer_id,
    p_organizer_name,
    v_source.max_teams,
    v_source.schedule_mode,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    FALSE
  )
  RETURNING id INTO v_tournament_id;

  INSERT INTO public.sandbox_tournaments (tournament_id, team_id_min, team_id_max)
  VALUES (
    v_tournament_id,
    CASE WHEN v_source.league_category = 'hfi' THEN 3220000 ELSE 40000 END,
    CASE WHEN v_source.league_category = 'hfi' THEN 3240000 ELSE 330000 END
  );

  INSERT INTO public.tournament_seasons (
    tournament_id,
    season_number,
    status,
    planned_start_slot
  )
  VALUES (v_tournament_id, 1, 'planned', NULL);

  FOR v_team IN SELECT value FROM jsonb_array_elements(p_teams)
  LOOP
    IF NULLIF(v_team->>'source_team_id', '') IS NULL
      OR NULLIF(v_team->>'ht_team_id', '') IS NULL
      OR btrim(COALESCE(v_team->>'name', '')) = '' THEN
      RAISE EXCEPTION 'Sandbox team snapshot is incomplete' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.teams source_team
      WHERE source_team.id = (v_team->>'source_team_id')::UUID
        AND source_team.tournament_id = p_source_tournament_id
    ) THEN
      RAISE EXCEPTION 'Sandbox team is not from the source tournament' USING ERRCODE = '22023';
    END IF;

    UPDATE public.teams AS source_team
    SET team_rank = NULLIF(v_team->>'team_rank', '')::INTEGER
    WHERE source_team.id = (v_team->>'source_team_id')::UUID
      AND source_team.tournament_id = p_source_tournament_id;

    INSERT INTO public.teams (
      tournament_id,
      name,
      ht_team_id,
      ht_team_name,
      active,
      replacement_for_team_id,
      hattrick_user_id,
      oauth_token,
      oauth_token_secret,
      logo_url,
      country_name,
      country_id,
      league_id,
      gender_id,
      league_level,
      team_rank,
      joined_via_oauth,
      manager_name,
      join_story,
      reserve_active,
      reserve_joined_at,
      reapply_season_number,
      is_placeholder
    )
    VALUES (
      v_tournament_id,
      v_team->>'name',
      (v_team->>'ht_team_id')::BIGINT,
      v_team->>'name',
      TRUE,
      NULL,
      NULL,
      NULL,
      NULL,
      NULLIF(v_team->>'logo_url', ''),
      NULLIF(v_team->>'country_name', ''),
      NULLIF(v_team->>'country_id', '')::INTEGER,
      NULLIF(v_team->>'league_id', '')::INTEGER,
      NULLIF(v_team->>'gender_id', '')::INTEGER,
      NULLIF(v_team->>'league_level', '')::INTEGER,
      NULLIF(v_team->>'team_rank', '')::INTEGER,
      FALSE,
      NULLIF(v_team->>'manager_name', ''),
      NULL,
      FALSE,
      NULL,
      NULL,
      FALSE
    );
  END LOOP;

  RETURN QUERY SELECT v_tournament_id, p_slug;
END;
$$;

COMMIT;

-- applied!