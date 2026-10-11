-- Calendar-first schedules for all generated tournaments. Forward-only replacement
-- of owner-marked-applied 085; never modifies previously reserved season plans.
-- Preflight on the target database before applying:
-- SELECT pg_get_functiondef('public.generate_length_tournament_schedule(uuid,integer,jsonb)'::regprocedure);
-- SELECT pg_get_functiondef('public.apply_length_round_transition(uuid,integer,uuid,uuid,jsonb,uuid)'::regprocedure);
-- Live function definitions have not been independently inspected by this agent.
BEGIN;

ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS playoff_match_number integer
  CHECK (playoff_match_number IS NULL OR playoff_match_number > 0);
CREATE UNIQUE INDEX IF NOT EXISTS matches_round_playoff_number_unique
  ON public.matches(round_id, playoff_match_number) WHERE playoff_match_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public.protect_length_match_resolution()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_length boolean;
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  SELECT t.schedule_mode = 'length' INTO v_is_length
  FROM public.rounds r
  JOIN public.tournaments t ON t.id = r.tournament_id
  WHERE r.id = COALESCE(NEW.round_id, OLD.round_id);
  IF COALESCE(v_is_length, false) AND (
    TG_OP = 'INSERT' OR NEW.schedule_resolution IS DISTINCT FROM OLD.schedule_resolution
    OR NEW.playoff_match_number IS DISTINCT FROM OLD.playoff_match_number
  ) THEN
    RAISE EXCEPTION 'Length schedule fixture resolution is server-owned' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_length_tournament_schedule(
  p_tournament_id uuid,
  p_season_number integer,
  p_schedule_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_tournament public.tournaments%ROWTYPE;
  v_season public.tournament_seasons%ROWTYPE;
  v_round jsonb;
  v_match jsonb;
  v_snapshot jsonb;
  v_round_id uuid;
  v_season_id uuid;
  v_team_count integer;
  v_payload_team_count integer;
  v_total_rounds integer;
  v_regular_rounds integer;
  v_postseason_rounds integer;
  v_full_round_robin_rounds integer;
  v_round_index integer := 0;
  v_expected_phase text;
  v_slot_date timestamptz;
  v_previous_slot_date timestamptz;
  v_first_slot_date timestamptz;
  v_first_slot_kind text;
  v_box_size integer;
  v_home_team_id uuid;
  v_away_team_id uuid;
  v_home_slot_id uuid;
  v_away_slot_id uuid;
  v_home_assignment_id uuid;
  v_away_assignment_id uuid;
  v_seen_ids uuid[];
  v_seen_slot_ids text[] := ARRAY[]::text[];
  v_slot_id text;
  v_slot_week_index integer;
  v_slot_ht_week integer;
  v_slot_ht_season integer;
  v_first_ht_season integer;
  v_match_time timestamptz;
  v_match_week_index integer;
  v_match_ht_week integer;
  v_match_ht_season integer;
  v_active_team_ids uuid[];
  v_snapshot_team_ids uuid[];
  v_v2 boolean := p_schedule_payload->>'version' = '2';
  v_ranking_source text;
  v_pairing_round jsonb;
  v_pairing jsonb;
  v_seen_seeds integer[];
  v_match_count integer;
  v_bye_count integer;
BEGIN
  IF p_season_number IS NULL OR p_season_number < 1 THEN
    RAISE EXCEPTION 'Invalid tournament season' USING ERRCODE = '22023';
  END IF;
  IF p_schedule_payload IS NULL OR jsonb_typeof(p_schedule_payload) <> 'object'
    OR p_schedule_payload->>'mode' IS DISTINCT FROM 'length' THEN
    RAISE EXCEPTION 'Invalid length schedule payload' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_tournament
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tournament not found' USING ERRCODE = 'P0002'; END IF;
  IF COALESCE(v_tournament.season, 1) <> p_season_number THEN
    RAISE EXCEPTION 'Tournament is not on the requested season' USING ERRCODE = '22023';
  END IF;
  IF NOT COALESCE(v_v2, false) AND v_tournament.league_category IS DISTINCT FROM 'hfi' THEN
    RAISE EXCEPTION 'Length scheduling is currently available for HFI tournaments' USING ERRCODE = '22023';
  END IF;
  IF v_tournament.status NOT IN ('open', 'waiting', 'active') THEN
    RAISE EXCEPTION 'Tournament is not ready for schedule generation' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.rounds
    WHERE tournament_id = p_tournament_id AND season_number = p_season_number
  ) THEN
    RAISE EXCEPTION 'Current season already has rounds' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.tournament_seasons(tournament_id, season_number, status)
  VALUES (p_tournament_id, p_season_number, 'planned')
  ON CONFLICT (tournament_id, season_number) DO NOTHING;
  SELECT * INTO v_season
  FROM public.tournament_seasons
  WHERE tournament_id = p_tournament_id AND season_number = p_season_number
  FOR UPDATE;
  v_season_id := v_season.id;

  v_ranking_source := CASE WHEN v_tournament.league_category = 'hfi' THEN 'team_rank' ELSE 'power_rating' END;
  SELECT array_agg(t.id ORDER BY
    CASE WHEN v_ranking_source = 'team_rank' THEN t.team_rank END ASC NULLS LAST,
    CASE WHEN v_ranking_source = 'power_rating' THEN t.power_rating END DESC NULLS LAST, t.id), count(*)
  INTO v_active_team_ids, v_team_count
  FROM public.teams t
  WHERE t.tournament_id = p_tournament_id
    AND t.active = true
    AND COALESCE(t.reserve_active, false) = false
    AND COALESCE(t.is_placeholder, false) = false;

  v_payload_team_count := NULLIF(p_schedule_payload->>'team_count', '')::integer;
  v_total_rounds := NULLIF(p_schedule_payload->>'total_rounds', '')::integer;
  v_regular_rounds := NULLIF(p_schedule_payload->>'regular_rounds', '')::integer;
  v_postseason_rounds := NULLIF(p_schedule_payload->>'postseason_rounds', '')::integer;
  v_full_round_robin_rounds := CASE WHEN v_team_count % 2 = 0 THEN v_team_count - 1 ELSE v_team_count END;
  IF v_team_count < 2 OR v_payload_team_count IS DISTINCT FROM v_team_count THEN
    RAISE EXCEPTION 'Schedule roster does not match current active participants' USING ERRCODE = '22023';
  END IF;
  IF v_total_rounds IS NULL OR v_regular_rounds IS NULL OR v_postseason_rounds IS NULL
    OR v_total_rounds < 1 OR v_regular_rounds < 1 OR v_postseason_rounds NOT IN (0, 1, 2, 3)
    OR (NOT COALESCE(v_v2, false) AND v_postseason_rounds NOT IN (0, 1))
    OR v_regular_rounds + v_postseason_rounds <> v_total_rounds THEN
    RAISE EXCEPTION 'Invalid regular/postseason round counts' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(v_v2, false) THEN
    IF p_schedule_payload->>'ranking_source' IS DISTINCT FROM v_ranking_source
      OR COALESCE(p_schedule_payload->>'format', '') NOT IN ('round_robin', 'fill', 'fill_playoffs')
      OR (p_schedule_payload->>'format' = 'round_robin' AND (v_regular_rounds <> v_full_round_robin_rounds OR v_postseason_rounds <> 0))
      OR (p_schedule_payload->>'format' = 'fill' AND v_postseason_rounds <> 0)
      OR (p_schedule_payload->>'format' = 'fill_playoffs' AND v_postseason_rounds = 0)
      OR (v_postseason_rounds = 1 AND v_team_count < 6)
      OR (v_postseason_rounds = 2 AND v_team_count < 8)
      OR (v_postseason_rounds = 3 AND (v_team_count < 12 OR v_total_rounds < 8)) THEN
      RAISE EXCEPTION 'Schedule format does not match the roster and calendar' USING ERRCODE = '22023';
    END IF;
  ELSE
  IF (v_postseason_rounds = 1 AND (
        v_regular_rounds <> v_full_round_robin_rounds
        OR p_schedule_payload->>'format' IS DISTINCT FROM 'round_robin_plus_final'
      ))
    OR (v_postseason_rounds = 0 AND v_regular_rounds > v_full_round_robin_rounds)
    OR (p_schedule_payload->>'format' = 'round_robin' AND v_regular_rounds <> v_full_round_robin_rounds)
    OR (p_schedule_payload->>'format' = 'balanced' AND v_regular_rounds >= v_full_round_robin_rounds)
    OR (p_schedule_payload->>'format' = 'round_robin_plus_final' AND v_postseason_rounds <> 1)
    OR COALESCE(p_schedule_payload->>'format', '') NOT IN ('balanced', 'round_robin', 'round_robin_plus_final') THEN
    RAISE EXCEPTION 'Schedule format does not match the selected length' USING ERRCODE = '22023';
  END IF;
  END IF;
  IF jsonb_array_length(COALESCE(p_schedule_payload->'rounds', '[]'::jsonb)) <> v_total_rounds THEN
    RAISE EXCEPTION 'Reserved round count does not match the season plan' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(COALESCE(p_schedule_payload->'ranking_snapshot', '[]'::jsonb)) <> v_team_count THEN
    RAISE EXCEPTION 'A complete TeamRank snapshot is required' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_v2, false) THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_schedule_payload->'ranking_snapshot') item
      WHERE NOT ((item->>'team_id')::uuid = ANY(v_active_team_ids))
        OR NULLIF(item->>'seed', '')::integer IS DISTINCT FROM array_position(v_active_team_ids, (item->>'team_id')::uuid)
    ) OR (SELECT count(DISTINCT item->>'team_id') FROM jsonb_array_elements(p_schedule_payload->'ranking_snapshot') item) <> v_team_count THEN
      RAISE EXCEPTION 'Ranking seeds do not match the active roster' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_schedule_payload->'ranking_snapshot') item
      JOIN public.teams t ON t.id = (item->>'team_id')::uuid
      WHERE (CASE WHEN v_ranking_source = 'team_rank' THEN t.team_rank ELSE t.power_rating END)
          IS DISTINCT FROM NULLIF(item->>'ranking_value', '')::integer
        OR (v_ranking_source = 'team_rank' AND (t.team_rank IS NULL OR t.team_rank <= 0))
    ) THEN
      RAISE EXCEPTION 'Ranking data changed while the schedule was being generated' USING ERRCODE = '40001';
    END IF;
    IF jsonb_typeof(p_schedule_payload->'regular_pairings') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_schedule_payload->'regular_pairings') <> v_regular_rounds THEN
      RAISE EXCEPTION 'A complete regular round pairing plan is required' USING ERRCODE = '22023';
    END IF;
    FOR v_pairing_round IN SELECT value FROM jsonb_array_elements(p_schedule_payload->'regular_pairings') LOOP
      v_seen_seeds := ARRAY[]::integer[];
      v_bye_count := 0;
      IF jsonb_typeof(v_pairing_round) <> 'array' OR jsonb_array_length(v_pairing_round) <> CEIL(v_team_count::numeric / 2)::integer THEN
        RAISE EXCEPTION 'Invalid reserved regular pairings' USING ERRCODE = '22023';
      END IF;
      FOR v_pairing IN SELECT value FROM jsonb_array_elements(v_pairing_round) LOOP
        IF NULLIF(v_pairing->>'home_slot_index', '')::integer IS NULL
          OR NULLIF(v_pairing->>'home_slot_index', '')::integer < 1
          OR NULLIF(v_pairing->>'home_slot_index', '')::integer > v_team_count
          OR NULLIF(v_pairing->>'home_slot_index', '')::integer = ANY(v_seen_seeds) THEN
          RAISE EXCEPTION 'Invalid reserved home slot' USING ERRCODE = '22023';
        END IF;
        v_seen_seeds := array_append(v_seen_seeds, (v_pairing->>'home_slot_index')::integer);
        IF NULLIF(v_pairing->>'away_slot_index', '') IS NULL THEN
          v_bye_count := v_bye_count + 1;
        ELSE
          IF (v_pairing->>'away_slot_index')::integer < 1 OR (v_pairing->>'away_slot_index')::integer > v_team_count
            OR (v_pairing->>'away_slot_index')::integer = ANY(v_seen_seeds) THEN
            RAISE EXCEPTION 'Invalid reserved away slot' USING ERRCODE = '22023';
          END IF;
          v_seen_seeds := array_append(v_seen_seeds, (v_pairing->>'away_slot_index')::integer);
        END IF;
      END LOOP;
      IF cardinality(v_seen_seeds) <> v_team_count OR v_bye_count <> v_team_count % 2 THEN
        RAISE EXCEPTION 'Reserved regular round does not account for every participant' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  ELSE
  SELECT array_agg((item->>'team_id')::uuid ORDER BY (item->>'team_id')::uuid)
  INTO v_snapshot_team_ids
  FROM jsonb_array_elements(p_schedule_payload->'ranking_snapshot') item
  WHERE NULLIF(item->>'team_rank', '')::integer > 0;
  IF cardinality(v_snapshot_team_ids) <> v_team_count
    OR NOT (v_snapshot_team_ids @> v_active_team_ids AND v_active_team_ids @> v_snapshot_team_ids) THEN
    RAISE EXCEPTION 'TeamRank snapshot does not match the active roster' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_schedule_payload->'ranking_snapshot') item
    JOIN public.teams t ON t.id = (item->>'team_id')::uuid
    WHERE t.tournament_id <> p_tournament_id
      OR t.team_rank IS DISTINCT FROM NULLIF(item->>'team_rank', '')::integer
  ) THEN
    RAISE EXCEPTION 'TeamRank changed while the schedule was being generated' USING ERRCODE = '40001';
  END IF;

  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_season_slots WHERE tournament_season_id = v_season_id) THEN
    RAISE EXCEPTION 'Current season already has competition slots' USING ERRCODE = '23505';
  END IF;
  v_box_size := v_team_count + (v_team_count % 2);
  INSERT INTO public.tournament_season_slots(tournament_season_id, slot_index, box_size, current_team_id)
  SELECT v_season_id, array_position(v_active_team_ids, t.id), v_box_size, t.id
  FROM public.teams t
  WHERE t.id = ANY(v_active_team_ids);
  IF v_box_size > v_team_count THEN
    INSERT INTO public.tournament_season_slots(tournament_season_id, slot_index, box_size, current_team_id)
    VALUES (v_season_id, v_box_size, v_box_size, NULL);
  END IF;
  INSERT INTO public.tournament_season_slot_assignments(
    tournament_season_slot_id, team_id, reason, team_name, ht_team_id, manager_name, hattrick_user_id, logo_url
  )
  SELECT s.id, t.id, 'schedule_backfill', t.name, t.ht_team_id, t.manager_name, t.hattrick_user_id, t.logo_url
  FROM public.tournament_season_slots s
  JOIN public.teams t ON t.id = s.current_team_id
  WHERE s.tournament_season_id = v_season_id;

  FOR v_round IN SELECT value FROM jsonb_array_elements(p_schedule_payload->'rounds')
  LOOP
    v_round_index := v_round_index + 1;
    IF NULLIF(v_round->>'round_number', '')::integer IS DISTINCT FROM v_round_index THEN
      RAISE EXCEPTION 'Round numbers must be sequential' USING ERRCODE = '22023';
    END IF;
    v_expected_phase := CASE WHEN v_round_index <= v_regular_rounds THEN 'regular' ELSE 'postseason' END;
    IF v_round->>'phase' IS DISTINCT FROM v_expected_phase THEN
      RAISE EXCEPTION 'Round phase does not match the season plan' USING ERRCODE = '22023';
    END IF;
    IF NULLIF(v_round->>'phase_round_number', '')::integer IS DISTINCT FROM (
      CASE
        WHEN v_expected_phase = 'regular' THEN v_round_index
        ELSE v_round_index - v_regular_rounds
      END
    ) THEN
      RAISE EXCEPTION 'Phase round numbers must be sequential' USING ERRCODE = '22023';
    END IF;
    IF (v_round_index = 1 AND v_round->>'phase_status' IS DISTINCT FROM 'materialized')
      OR (v_round_index > 1 AND v_round->>'phase_status' IS DISTINCT FROM 'pending') THEN
      RAISE EXCEPTION 'Only the first round may be materialized initially' USING ERRCODE = '22023';
    END IF;
    -- reserved_slot_date identifies the HT-week slot only. Real Hattrick
    -- friendly kickoff times remain country-specific (and may be Tuesday,
    -- Wednesday or Thursday) via scheduled_for. Do not canonicalize them here.
    -- The only weekend slot used by the length planner is HT Week 16; W15
    -- weekend stays excluded because qualification participation is known too
    -- late for reliable tournament scheduling.
    IF v_round->>'slot_kind' NOT IN ('midweek_friendly', 'weekend_friendly') THEN
      RAISE EXCEPTION 'Invalid reserved friendly slot' USING ERRCODE = '22023';
    END IF;
    v_slot_id := NULLIF(v_round->>'slot_id', '');
    v_slot_date := NULLIF(v_round->>'slot_date', '')::timestamptz;
    IF v_slot_date IS NULL OR v_slot_date <= v_now THEN
      RAISE EXCEPTION 'Reserved round slots must be in the future' USING ERRCODE = '22023';
    END IF;
    v_slot_week_index := FLOOR((((v_slot_date AT TIME ZONE 'Europe/Stockholm')::date - DATE '2026-03-30')::numeric) / 7)::integer;
    v_slot_ht_week := ((v_slot_week_index % 16) + 16) % 16 + 1;
    v_slot_ht_season := 94 + FLOOR(v_slot_week_index::numeric / 16)::integer;
    IF v_slot_ht_week BETWEEN 1 AND 3
      OR (v_round->>'slot_kind' = 'weekend_friendly' AND v_slot_ht_week <> 16)
      OR (v_previous_slot_date IS NOT NULL AND v_slot_date <= v_previous_slot_date)
      OR v_slot_id IS NULL
      OR v_slot_id = ANY(v_seen_slot_ids)
      OR v_slot_id IS DISTINCT FROM format(
        'S%s-W%s-%s',
        v_slot_ht_season,
        v_slot_ht_week,
        CASE WHEN v_round->>'slot_kind' = 'weekend_friendly' THEN 'weekend' ELSE 'midweek' END
      ) THEN
      RAISE EXCEPTION 'Invalid or unsafe reserved friendly slot' USING ERRCODE = '22023';
    END IF;
    v_seen_slot_ids := array_append(v_seen_slot_ids, v_slot_id);
    IF v_round_index = 1 THEN
      v_first_slot_date := v_slot_date;
      v_first_slot_kind := v_round->>'slot_kind';
      v_first_ht_season := v_slot_ht_season;
    ELSIF v_slot_ht_season IS DISTINCT FROM v_first_ht_season THEN
      RAISE EXCEPTION 'Length schedule cannot cross into another Hattrick season' USING ERRCODE = '22023';
    END IF;
    v_previous_slot_date := v_slot_date;
    IF (v_round_index = 1 AND jsonb_array_length(COALESCE(v_round->'matches', '[]'::jsonb)) = 0)
      OR (v_round_index > 1 AND jsonb_array_length(COALESCE(v_round->'matches', '[]'::jsonb)) <> 0) THEN
      RAISE EXCEPTION 'Only Round 1 may contain initial fixtures' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.rounds(
      tournament_id, season_number, round_number, phase, phase_round_number, phase_status,
      reserved_slot_id, reserved_slot_kind, reserved_slot_date, reserved_display_date, materialized_at
    ) VALUES (
      p_tournament_id, p_season_number, v_round_index, v_expected_phase,
      NULLIF(v_round->>'phase_round_number', '')::integer, v_round->>'phase_status',
      v_round->>'slot_id', v_round->>'slot_kind', v_slot_date,
      NULLIF(v_round->>'display_date', '')::timestamptz,
      CASE WHEN v_round_index = 1 THEN v_now ELSE NULL END
    ) RETURNING id INTO v_round_id;

    IF v_round_index = 1 THEN
      v_seen_ids := ARRAY[]::uuid[];
      v_match_count := 0;
      v_bye_count := 0;
      FOR v_match IN SELECT value FROM jsonb_array_elements(v_round->'matches')
      LOOP
        v_match_count := v_match_count + 1;
        v_home_team_id := NULLIF(v_match->>'home_team_id', '')::uuid;
        v_away_team_id := NULLIF(v_match->>'away_team_id', '')::uuid;
        IF v_home_team_id IS NULL AND v_away_team_id IS NULL THEN
          RAISE EXCEPTION 'Initial fixture must contain a participant' USING ERRCODE = '22023';
        END IF;
        IF v_home_team_id IS NULL OR v_away_team_id IS NULL THEN v_bye_count := v_bye_count + 1; END IF;
        IF (v_home_team_id IS NOT NULL AND (NOT v_home_team_id = ANY(v_active_team_ids) OR v_home_team_id = ANY(v_seen_ids)))
          OR (v_away_team_id IS NOT NULL AND (NOT v_away_team_id = ANY(v_active_team_ids) OR v_away_team_id = ANY(v_seen_ids)))
          OR v_home_team_id = v_away_team_id THEN
          RAISE EXCEPTION 'Invalid or duplicate participant in Round 1' USING ERRCODE = '22023';
        END IF;
        IF v_home_team_id IS NOT NULL THEN v_seen_ids := array_append(v_seen_ids, v_home_team_id); END IF;
        IF v_away_team_id IS NOT NULL THEN v_seen_ids := array_append(v_seen_ids, v_away_team_id); END IF;
        v_match_time := NULLIF(v_match->>'scheduled_for', '')::timestamptz;
        IF v_match_time IS NULL OR v_match_time <= v_now THEN
          RAISE EXCEPTION 'Initial fixture kickoff times must be in the future' USING ERRCODE = '22023';
        END IF;
        v_match_week_index := FLOOR((((v_match_time AT TIME ZONE 'Europe/Stockholm')::date - DATE '2026-03-30')::numeric) / 7)::integer;
        v_match_ht_week := ((v_match_week_index % 16) + 16) % 16 + 1;
        v_match_ht_season := 94 + FLOOR(v_match_week_index::numeric / 16)::integer;
        IF v_match_ht_week IS DISTINCT FROM v_slot_ht_week OR v_match_ht_season IS DISTINCT FROM v_slot_ht_season THEN
          RAISE EXCEPTION 'Initial fixture kickoff does not belong to its reserved HT week' USING ERRCODE = '22023';
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
          schedule_slot_type, completed, total_minutes, schedule_resolution
        ) VALUES (
          v_round_id, v_home_team_id, v_away_team_id, v_home_slot_id, v_away_slot_id,
          v_home_assignment_id, v_away_assignment_id, 'home_away',
          v_match_time, v_round->>'slot_kind', false, NULL, 'pending'
        );
      END LOOP;
      IF cardinality(v_seen_ids) <> v_team_count THEN
        RAISE EXCEPTION 'Round 1 must include every active participant exactly once' USING ERRCODE = '22023';
      END IF;
      IF v_match_count <> CEIL(v_team_count::numeric / 2)::integer
        OR v_bye_count <> (v_team_count % 2) THEN
        RAISE EXCEPTION 'Round 1 has an invalid fixture or BYE count' USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;

  v_snapshot := jsonb_build_object(
    'version', CASE WHEN COALESCE(v_v2, false) THEN 2 ELSE 1 END,
    'total_rounds', v_total_rounds,
    'regular_rounds', v_regular_rounds,
    'postseason_rounds', v_postseason_rounds,
    'ranking_source', v_ranking_source,
    'regular_pairings', CASE WHEN COALESCE(v_v2, false) THEN p_schedule_payload->'regular_pairings' ELSE NULL END,
    'format', p_schedule_payload->>'format'
  );
  UPDATE public.tournament_seasons
  SET status = 'ongoing', planned_start_slot = v_first_slot_date, started_at = v_now,
      finished_at = NULL, schedule_plan_json = v_snapshot,
      ranking_snapshot_json = p_schedule_payload->'ranking_snapshot',
      champion_slot_id = NULL, champion_team_id = NULL, champion_decided_at = NULL, updated_at = v_now
  WHERE id = v_season_id;
  UPDATE public.tournaments
  SET status = 'active', schedule_mode = 'length', schedule_start_slot = v_first_slot_date,
      schedule_locked_at = v_now, registration_closed_at = COALESCE(registration_closed_at, v_now),
      schedule_generated_at = v_now, include_week15_weekend_friendly = false
  WHERE id = p_tournament_id;

  RETURN jsonb_build_object('tournament_id', p_tournament_id, 'season_number', p_season_number,
    'rounds_reserved', v_total_rounds, 'rounds_materialized', 1, 'schedule_mode', 'length');
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_length_round_transition(
  p_tournament_id uuid,
  p_season_number integer,
  p_completed_round_id uuid,
  p_next_round_id uuid,
  p_matches jsonb,
  p_champion_team_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_season public.tournament_seasons%ROWTYPE;
  v_completed public.rounds%ROWTYPE;
  v_next public.rounds%ROWTYPE;
  v_match jsonb;
  v_team_count integer;
  v_seen_ids uuid[] := ARRAY[]::uuid[];
  v_home_team_id uuid;
  v_away_team_id uuid;
  v_home_slot_id uuid;
  v_away_slot_id uuid;
  v_home_assignment_id uuid;
  v_away_assignment_id uuid;
  v_champion_slot_id uuid;
  v_match_count integer := 0;
  v_bye_count integer := 0;
  v_playoff_matches integer;
  v_match_numbers integer[] := ARRAY[]::integer[];
  v_match_number integer;
BEGIN
  PERFORM 1 FROM public.tournaments
  WHERE id = p_tournament_id AND COALESCE(season, 1) = p_season_number AND schedule_mode = 'length'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Length-scheduled tournament not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_season FROM public.tournament_seasons
  WHERE tournament_id = p_tournament_id AND season_number = p_season_number FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tournament season not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_completed FROM public.rounds
  WHERE id = p_completed_round_id AND tournament_id = p_tournament_id AND season_number = p_season_number
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Completed round not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.matches WHERE round_id = v_completed.id FOR UPDATE;

  IF v_completed.phase_status = 'completed' THEN
    RETURN jsonb_build_object('advanced', false, 'reason', 'already_completed');
  END IF;
  IF v_completed.phase_status <> 'materialized' THEN
    RAISE EXCEPTION 'Round is not materialized' USING ERRCODE = '22023';
  END IF;

  -- An unlinked fixture whose precise country-specific scheduled kickoff has
  -- passed can no longer be arranged for this round. Finalize it as DNP so a
  -- forgotten booking or external friendly cannot block staged progression
  -- forever. Linked/arranged/ongoing fixtures are deliberately untouched.
  UPDATE public.matches
  SET schedule_resolution = 'finalized_unplayed',
      status = 'misarranged'
  WHERE round_id = v_completed.id
    AND COALESCE(completed, false) = false
    AND ht_match_id IS NULL
    AND COALESCE(status, 'not_arranged') IN ('not_arranged', 'misarranged')
    AND scheduled_for IS NOT NULL
    AND scheduled_for <= v_now
    AND schedule_resolution IS DISTINCT FROM 'finalized_unplayed';

  IF EXISTS (
    SELECT 1 FROM public.matches m
    WHERE m.round_id = v_completed.id
      AND m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL
      AND NOT (
        (COALESCE(m.completed, false) = true OR m.status = 'finished')
        OR m.schedule_resolution = 'finalized_unplayed'
      )
  ) THEN
    RETURN jsonb_build_object('advanced', false, 'reason', 'round_unresolved');
  END IF;
  IF EXISTS (SELECT 1 FROM public.matches m WHERE m.round_id = v_completed.id AND m.status = 'ongoing') THEN
    RETURN jsonb_build_object('advanced', false, 'reason', 'round_ongoing');
  END IF;
  UPDATE public.matches
  SET schedule_resolution = CASE
    WHEN completed = true OR status = 'finished' THEN 'played'
    ELSE schedule_resolution
  END
  WHERE round_id = v_completed.id;
  UPDATE public.rounds SET phase_status = 'completed', completed_at = v_now WHERE id = v_completed.id;

  IF p_next_round_id IS NULL THEN
    IF v_completed.phase = 'postseason' AND p_champion_team_id IS NULL THEN
      RAISE EXCEPTION 'A completed Championship Final requires a champion' USING ERRCODE = '22023';
    END IF;
    IF v_completed.phase = 'postseason' AND p_champion_team_id IS NOT NULL THEN
      SELECT CASE
        WHEN m.home_team_id = p_champion_team_id THEN m.home_slot_id
        WHEN m.away_team_id = p_champion_team_id THEN m.away_slot_id
        ELSE NULL
      END
      INTO v_champion_slot_id
      FROM public.matches m
      WHERE m.round_id = v_completed.id
        AND p_champion_team_id IN (m.home_team_id, m.away_team_id)
      LIMIT 1;
      IF v_champion_slot_id IS NULL THEN
        RAISE EXCEPTION 'Champion does not belong to the completed final' USING ERRCODE = '22023';
      END IF;
      UPDATE public.tournament_seasons
      SET champion_slot_id = v_champion_slot_id, champion_team_id = p_champion_team_id,
          champion_decided_at = v_now, updated_at = v_now
      WHERE id = v_season.id;
    END IF;
    RETURN jsonb_build_object('advanced', true, 'next_round_materialized', false);
  END IF;

  SELECT * INTO v_next FROM public.rounds
  WHERE id = p_next_round_id AND tournament_id = p_tournament_id AND season_number = p_season_number
  FOR UPDATE;
  IF NOT FOUND OR v_next.round_number <> v_completed.round_number + 1 THEN
    RAISE EXCEPTION 'Next reserved round is invalid' USING ERRCODE = '22023';
  END IF;
  IF v_next.phase_status <> 'pending' THEN
    RETURN jsonb_build_object('advanced', true, 'next_round_materialized', false, 'reason', 'already_materialized');
  END IF;
  IF EXISTS (SELECT 1 FROM public.matches WHERE round_id = v_next.id) THEN
    RAISE EXCEPTION 'Pending round already has fixture rows' USING ERRCODE = '23505';
  END IF;
  IF p_matches IS NULL OR jsonb_typeof(p_matches) <> 'array' OR jsonb_array_length(p_matches) = 0 THEN
    RAISE EXCEPTION 'Next round pairings are required' USING ERRCODE = '22023';
  END IF;

  IF v_next.phase = 'postseason' THEN
    v_playoff_matches := CASE WHEN v_season.schedule_plan_json->>'version' = '2'
      THEN power(2, (v_season.schedule_plan_json->>'postseason_rounds')::integer - v_next.phase_round_number)::integer
      ELSE 1 END;
    IF v_playoff_matches NOT IN (1, 2, 4) THEN
      RAISE EXCEPTION 'Invalid playoff round' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT count(*) INTO v_team_count FROM public.tournament_season_slots
  WHERE tournament_season_id = v_season.id AND current_team_id IS NOT NULL;
  FOR v_match IN SELECT value FROM jsonb_array_elements(p_matches)
  LOOP
    v_match_count := v_match_count + 1;
    v_match_number := NULL;
    IF v_next.phase = 'postseason' AND v_season.schedule_plan_json->>'version' = '2' THEN
      v_match_number := NULLIF(v_match->>'playoff_match_number', '')::integer;
      IF v_match_number IS NULL OR v_match_number < 1 OR v_match_number > v_playoff_matches OR v_match_number = ANY(v_match_numbers) THEN
        RAISE EXCEPTION 'Invalid or duplicate playoff match number' USING ERRCODE = '22023';
      END IF;
      v_match_numbers := array_append(v_match_numbers, v_match_number);
    END IF;
    v_home_team_id := NULLIF(v_match->>'home_team_id', '')::uuid;
    v_away_team_id := NULLIF(v_match->>'away_team_id', '')::uuid;
    IF v_home_team_id IS NULL AND v_away_team_id IS NULL THEN
      RAISE EXCEPTION 'Pairing must include a participant' USING ERRCODE = '22023';
    END IF;
    IF v_home_team_id IS NULL OR v_away_team_id IS NULL THEN v_bye_count := v_bye_count + 1; END IF;
    IF (v_home_team_id IS NOT NULL AND v_home_team_id = ANY(v_seen_ids))
      OR (v_away_team_id IS NOT NULL AND v_away_team_id = ANY(v_seen_ids))
      OR v_home_team_id = v_away_team_id THEN
      RAISE EXCEPTION 'Duplicate or invalid next-round participant' USING ERRCODE = '22023';
    END IF;
    IF v_home_team_id IS NOT NULL THEN v_seen_ids := array_append(v_seen_ids, v_home_team_id); END IF;
    IF v_away_team_id IS NOT NULL THEN v_seen_ids := array_append(v_seen_ids, v_away_team_id); END IF;
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
    IF (v_home_team_id IS NOT NULL AND v_home_slot_id IS NULL)
      OR (v_away_team_id IS NOT NULL AND v_away_slot_id IS NULL) THEN
      RAISE EXCEPTION 'Pairing includes a team outside the current season slots' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.matches(
      round_id, home_team_id, away_team_id, home_slot_id, away_slot_id,
      home_slot_assignment_id, away_slot_assignment_id, venue_type, scheduled_for,
      schedule_slot_type, completed, total_minutes, schedule_resolution, playoff_match_number
    ) VALUES (
      v_next.id, v_home_team_id, v_away_team_id, v_home_slot_id, v_away_slot_id,
      v_home_assignment_id, v_away_assignment_id, 'home_away',
      NULLIF(v_match->>'scheduled_for', '')::timestamptz, v_next.reserved_slot_kind,
      false, NULL, COALESCE(v_match->>'schedule_resolution', 'pending'), v_match_number
    );
  END LOOP;
  IF v_next.phase = 'regular' AND cardinality(v_seen_ids) <> v_team_count THEN
    RAISE EXCEPTION 'Regular round must account for every current participant' USING ERRCODE = '22023';
  END IF;
  IF v_next.phase = 'regular' AND (
    v_match_count <> CEIL(v_team_count::numeric / 2)::integer
    OR v_bye_count <> (v_team_count % 2)
  ) THEN
    RAISE EXCEPTION 'Regular round has an invalid fixture or BYE count' USING ERRCODE = '22023';
  END IF;
  IF v_next.phase = 'postseason' AND cardinality(v_seen_ids) <> v_playoff_matches * 2 THEN
    RAISE EXCEPTION 'Playoff round has an invalid participant count' USING ERRCODE = '22023';
  END IF;
  IF v_next.phase = 'postseason' AND (v_match_count <> v_playoff_matches OR v_bye_count <> 0) THEN
    RAISE EXCEPTION 'Playoff round has an invalid fixture count' USING ERRCODE = '22023';
  END IF;
  UPDATE public.rounds SET phase_status = 'materialized', materialized_at = v_now WHERE id = v_next.id;
  RETURN jsonb_build_object('advanced', true, 'next_round_materialized', true, 'next_round_id', v_next.id);
END;
$$;

REVOKE ALL ON FUNCTION public.generate_length_tournament_schedule(uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_length_round_transition(uuid, integer, uuid, uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_length_tournament_schedule(uuid, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_length_round_transition(uuid, integer, uuid, uuid, jsonb, uuid) TO service_role;
COMMIT;

-- applied!