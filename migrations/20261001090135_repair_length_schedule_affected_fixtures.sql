BEGIN;

CREATE OR REPLACE FUNCTION public.repair_length_schedule_round(
  p_tournament_id uuid,
  p_season_number integer,
  p_round_id uuid,
  p_unlocked_matches jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_round public.rounds%ROWTYPE;
  v_season_id uuid;
  v_repair_team_ids uuid[];
  v_match jsonb;
  v_deleted integer := 0;
  v_inserted integer := 0;
  v_home_team_id uuid;
  v_away_team_id uuid;
  v_home_slot_id uuid;
  v_away_slot_id uuid;
  v_home_assignment_id uuid;
  v_away_assignment_id uuid;
BEGIN
  PERFORM 1 FROM public.tournaments
  WHERE id = p_tournament_id AND COALESCE(season, 1) = p_season_number AND schedule_mode = 'length'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Length-scheduled tournament not found' USING ERRCODE = 'P0002'; END IF;
  SELECT id INTO v_season_id FROM public.tournament_seasons
  WHERE tournament_id = p_tournament_id AND season_number = p_season_number FOR UPDATE;
  SELECT * INTO v_round FROM public.rounds
  WHERE id = p_round_id AND tournament_id = p_tournament_id AND season_number = p_season_number
  FOR UPDATE;
  IF NOT FOUND OR v_round.phase <> 'regular' OR v_round.phase_status <> 'materialized' THEN
    RAISE EXCEPTION 'Round is no longer repairable' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.matches WHERE round_id = p_round_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.matches
    WHERE round_id = p_round_id
      AND (
        completed = true
        OR status IN ('ongoing', 'finished')
        OR finished_at IS NOT NULL
        OR (scheduled_for IS NOT NULL AND scheduled_for <= now())
      )
  ) THEN
    RAISE EXCEPTION 'A started or completed round cannot be repaired' USING ERRCODE = '55000';
  END IF;

  SELECT array_agg(DISTINCT team_id)
  INTO v_repair_team_ids
  FROM (
    SELECT NULLIF(value->>'home_team_id', '')::uuid AS team_id
    FROM jsonb_array_elements(COALESCE(p_unlocked_matches, '[]'::jsonb))
    UNION
    SELECT NULLIF(value->>'away_team_id', '')::uuid
    FROM jsonb_array_elements(COALESCE(p_unlocked_matches, '[]'::jsonb))
  ) q
  WHERE team_id IS NOT NULL;

  DELETE FROM public.matches
  WHERE round_id = p_round_id
    AND completed = false
    AND COALESCE(status, 'not_arranged') NOT IN ('arranged', 'ongoing', 'finished')
    AND ht_match_id IS NULL
    AND (scheduled_for IS NULL OR scheduled_for > now())
    AND (
      home_team_id = ANY(v_repair_team_ids)
      OR away_team_id = ANY(v_repair_team_ids)
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  FOR v_match IN SELECT value FROM jsonb_array_elements(COALESCE(p_unlocked_matches, '[]'::jsonb))
  LOOP
    v_home_team_id := NULLIF(v_match->>'home_team_id', '')::uuid;
    v_away_team_id := NULLIF(v_match->>'away_team_id', '')::uuid;
    IF EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.round_id = p_round_id
        AND (m.home_team_id IN (v_home_team_id, v_away_team_id) OR m.away_team_id IN (v_home_team_id, v_away_team_id))
    ) THEN
      RAISE EXCEPTION 'Repair would reuse a participant from a protected fixture' USING ERRCODE = '40001';
    END IF;
    SELECT s.id, a.id INTO v_home_slot_id, v_home_assignment_id
    FROM public.tournament_season_slots s
    LEFT JOIN public.tournament_season_slot_assignments a
      ON a.tournament_season_slot_id = s.id AND a.released_at IS NULL
    WHERE s.tournament_season_id = v_season_id AND s.current_team_id = v_home_team_id;
    SELECT s.id, a.id INTO v_away_slot_id, v_away_assignment_id
    FROM public.tournament_season_slots s
    LEFT JOIN public.tournament_season_slot_assignments a
      ON a.tournament_season_slot_id = s.id AND a.released_at IS NULL
    WHERE s.tournament_season_id = v_season_id AND s.current_team_id = v_away_team_id;
    INSERT INTO public.matches(
      round_id, home_team_id, away_team_id, home_slot_id, away_slot_id,
      home_slot_assignment_id, away_slot_assignment_id, venue_type, scheduled_for,
      schedule_slot_type, status, completed, total_minutes, schedule_resolution
    ) VALUES (
      p_round_id, v_home_team_id, v_away_team_id, v_home_slot_id, v_away_slot_id,
      v_home_assignment_id, v_away_assignment_id, 'home_away',
      NULLIF(v_match->>'scheduled_for', '')::timestamptz, v_round.reserved_slot_kind,
      CASE WHEN v_match->>'schedule_resolution' = 'finalized_unplayed' THEN 'misarranged' ELSE 'not_arranged' END,
      false, NULL, COALESCE(v_match->>'schedule_resolution', 'pending')
    );
    v_inserted := v_inserted + 1;
  END LOOP;
  RETURN jsonb_build_object('round_id', p_round_id, 'fixtures_replaced', v_deleted, 'fixtures_inserted', v_inserted);
END;
$$;

COMMIT;

--applied!