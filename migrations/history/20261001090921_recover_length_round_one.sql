-- One-off recovery for the destructive Round 1 repair path. The caller must
-- reconstruct the original deterministic pairings from the frozen TeamRank
-- snapshot; this function only replaces matches belonging to Round 1.
BEGIN;

CREATE OR REPLACE FUNCTION public.recover_length_schedule_round_one(
  p_tournament_id uuid,
  p_season_number integer,
  p_round_id uuid,
  p_matches jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_round public.rounds%ROWTYPE;
  v_season public.tournament_seasons%ROWTYPE;
  v_match jsonb;
  v_team_count integer;
  v_match_count integer := 0;
  v_bye_count integer := 0;
  v_seen_ids uuid[] := ARRAY[]::uuid[];
  v_roster_ids uuid[];
  v_home_team_id uuid;
  v_away_team_id uuid;
  v_home_slot_id uuid;
  v_away_slot_id uuid;
  v_home_assignment_id uuid;
  v_away_assignment_id uuid;
  v_deleted integer := 0;
  v_inserted integer := 0;
BEGIN
  -- Deliberately narrow guard: this RPC cannot be used for another round,
  -- phase, or scheduling mode.
  PERFORM 1
  FROM public.tournaments
  WHERE id = p_tournament_id
    AND COALESCE(season, 1) = p_season_number
    AND schedule_mode = 'length'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Length-scheduled tournament not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_season
  FROM public.tournament_seasons
  WHERE tournament_id = p_tournament_id AND season_number = p_season_number
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament season not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_round
  FROM public.rounds
  WHERE id = p_round_id
    AND tournament_id = p_tournament_id
    AND season_number = p_season_number
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Round 1 was not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_round.round_number <> 1 THEN
    RAISE EXCEPTION 'Round 1 recovery requires round_number = 1' USING ERRCODE = '22023';
  END IF;
  IF v_round.phase <> 'regular' THEN
    RAISE EXCEPTION 'Round 1 recovery requires the regular phase' USING ERRCODE = '22023';
  END IF;
  IF v_round.phase_status <> 'materialized' THEN
    RAISE EXCEPTION 'Round 1 recovery requires a materialized round' USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::integer, array_agg(current_team_id ORDER BY current_team_id)
  INTO v_team_count, v_roster_ids
  FROM public.tournament_season_slots
  WHERE tournament_season_id = v_season.id AND current_team_id IS NOT NULL;
  IF v_team_count < 2 THEN
    RAISE EXCEPTION 'Current season roster is incomplete' USING ERRCODE = '22023';
  END IF;
  IF p_matches IS NULL OR jsonb_typeof(p_matches) <> 'array' OR jsonb_array_length(p_matches) = 0 THEN
    RAISE EXCEPTION 'Reconstructed Round 1 pairings are required' USING ERRCODE = '22023';
  END IF;

  -- Results and started fixtures must never be removed by this one-off path.
  PERFORM 1 FROM public.matches WHERE round_id = p_round_id FOR UPDATE;
  IF EXISTS (
    SELECT 1
    FROM public.matches
    WHERE round_id = p_round_id
      AND (
        completed = true
        OR status IN ('ongoing', 'finished')
        OR finished_at IS NOT NULL
        OR schedule_resolution = 'played'
      )
  ) THEN
    RAISE EXCEPTION 'Round 1 contains a played or ongoing fixture and cannot be recovered' USING ERRCODE = '55000';
  END IF;

  -- Validate the replacement roster before deleting anything. The application
  -- reconstructs this exact set from the current season slots.
  FOR v_match IN SELECT value FROM jsonb_array_elements(p_matches)
  LOOP
    v_match_count := v_match_count + 1;
    v_home_team_id := NULLIF(v_match->>'home_team_id', '')::uuid;
    v_away_team_id := NULLIF(v_match->>'away_team_id', '')::uuid;
    IF v_home_team_id IS NULL AND v_away_team_id IS NULL THEN
      RAISE EXCEPTION 'Round 1 pairing must contain a participant' USING ERRCODE = '22023';
    END IF;
    IF v_home_team_id IS NULL OR v_away_team_id IS NULL THEN
      v_bye_count := v_bye_count + 1;
    END IF;
    IF (v_home_team_id IS NOT NULL AND v_home_team_id = ANY(v_seen_ids))
      OR (v_away_team_id IS NOT NULL AND v_away_team_id = ANY(v_seen_ids))
      OR (v_home_team_id IS NOT NULL AND v_home_team_id = v_away_team_id)
      OR (v_home_team_id IS NOT NULL AND NOT (v_home_team_id = ANY(v_roster_ids)))
      OR (v_away_team_id IS NOT NULL AND NOT (v_away_team_id = ANY(v_roster_ids))) THEN
      RAISE EXCEPTION 'Round 1 pairing does not match the current season roster' USING ERRCODE = '22023';
    END IF;
    IF v_home_team_id IS NOT NULL THEN v_seen_ids := array_append(v_seen_ids, v_home_team_id); END IF;
    IF v_away_team_id IS NOT NULL THEN v_seen_ids := array_append(v_seen_ids, v_away_team_id); END IF;
    IF NULLIF(v_match->>'scheduled_for', '') IS NULL
      OR COALESCE(v_match->>'schedule_resolution', 'pending') <> 'pending' THEN
      RAISE EXCEPTION 'Round 1 recovery requires pending scheduled fixtures' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF cardinality(v_seen_ids) <> v_team_count
    OR NOT (v_seen_ids @> v_roster_ids AND v_roster_ids @> v_seen_ids)
    OR v_match_count <> CEIL(v_team_count::numeric / 2)::integer
    OR v_bye_count <> (v_team_count % 2) THEN
    RAISE EXCEPTION 'Reconstructed Round 1 does not cover the current season roster exactly' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.fixture_warnings
  WHERE tournament_id = p_tournament_id
    AND round_id = p_round_id;

  DELETE FROM public.matches
  WHERE round_id = p_round_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  FOR v_match IN SELECT value FROM jsonb_array_elements(p_matches)
  LOOP
    v_home_team_id := NULLIF(v_match->>'home_team_id', '')::uuid;
    v_away_team_id := NULLIF(v_match->>'away_team_id', '')::uuid;
    SELECT s.id, a.id INTO v_home_slot_id, v_home_assignment_id
    FROM public.tournament_season_slots s
    LEFT JOIN public.tournament_season_slot_assignments a
      ON a.tournament_season_slot_id = s.id AND a.released_at IS NULL
    WHERE s.tournament_season_id = v_season.id AND s.current_team_id = v_home_team_id;
    SELECT s.id, a.id INTO v_away_slot_id, v_away_assignment_id
    FROM public.tournament_season_slots s
    LEFT JOIN public.tournament_season_slot_assignments a
      ON a.tournament_season_slot_id = s.id AND a.released_at IS NULL
    WHERE s.tournament_season_id = v_season.id AND s.current_team_id = v_away_team_id;
    INSERT INTO public.matches(
      round_id, home_team_id, away_team_id, home_slot_id, away_slot_id,
      home_slot_assignment_id, away_slot_assignment_id, venue_type, scheduled_for,
      schedule_slot_type, status, completed, total_minutes, schedule_resolution
    ) VALUES (
      p_round_id, v_home_team_id, v_away_team_id, v_home_slot_id, v_away_slot_id,
      v_home_assignment_id, v_away_assignment_id, 'home_away',
      NULLIF(v_match->>'scheduled_for', '')::timestamptz, v_round.reserved_slot_kind,
      'not_arranged', false, NULL, 'pending'
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'round_id', p_round_id,
    'fixtures_deleted', v_deleted,
    'fixtures_inserted', v_inserted,
    'round_number', v_round.round_number
  );
END;
$$;

REVOKE ALL ON FUNCTION public.recover_length_schedule_round_one(uuid, integer, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_length_schedule_round_one(uuid, integer, uuid, jsonb) TO service_role;

COMMIT;
