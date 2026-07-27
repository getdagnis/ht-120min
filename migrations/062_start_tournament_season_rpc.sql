-- Keeps the live tournament row as the current-season pointer while retaining
-- all finished rows for History. The fixture archive itself is built in the UI
-- from the already-verified persisted fixtures and passed in as JSONB.
CREATE OR REPLACE FUNCTION public.start_tournament_season(
  p_tournament_id UUID,
  p_next_season_number INTEGER,
  p_mode TEXT,
  p_fixtures_snapshot JSONB,
  p_planned_start_slot TIMESTAMPTZ DEFAULT NULL
)
RETURNS SETOF public.tournament_seasons
LANGUAGE plpgsql
AS $$
DECLARE
  v_tournament public.tournaments%ROWTYPE;
  v_current_season INTEGER;
  v_next_status TEXT;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_mode NOT IN ('auto', 'open') THEN
    RAISE EXCEPTION 'Invalid season transition mode' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_tournament
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_tournament.status <> 'finished' THEN
    RAISE EXCEPTION 'A new season can only start after the current season is finished' USING ERRCODE = '22023';
  END IF;

  v_current_season := COALESCE(v_tournament.season, 1);
  IF p_next_season_number <> v_current_season + 1 THEN
    RAISE EXCEPTION 'Next season number must immediately follow the finished season' USING ERRCODE = '22023';
  END IF;

  UPDATE public.tournament_seasons
  SET fixtures_snapshot_json = COALESCE(fixtures_snapshot_json, p_fixtures_snapshot),
      updated_at = v_now
  WHERE tournament_id = p_tournament_id
    AND season_number = v_current_season;

  v_next_status := CASE WHEN p_mode = 'auto' THEN 'active' ELSE 'waiting' END;

  INSERT INTO public.tournament_seasons (
    tournament_id,
    season_number,
    status,
    planned_start_slot,
    created_at,
    updated_at
  )
  VALUES (
    p_tournament_id,
    p_next_season_number,
    'planned',
    p_planned_start_slot,
    v_now,
    v_now
  );

  IF p_mode = 'open' THEN
    UPDATE public.teams
    SET active = FALSE,
        replacement_for_team_id = NULL,
        reapply_season_number = p_next_season_number
    WHERE tournament_id = p_tournament_id
      AND active = TRUE;
  END IF;

  UPDATE public.tournaments
  SET season = p_next_season_number,
      status = v_next_status,
      schedule_start_slot = p_planned_start_slot,
      schedule_locked_at = NULL,
      registration_closed_at = CASE WHEN p_mode = 'auto' THEN v_now ELSE NULL END,
      schedule_generated_at = NULL
  WHERE id = p_tournament_id;

  RETURN QUERY
  SELECT *
  FROM public.tournament_seasons
  WHERE tournament_id = p_tournament_id
    AND season_number = p_next_season_number;
END;
$$;

-- MIGRATION APPLIED!