-- Correct season-end weekend friendly handling:
-- - Week 15 weekend is optional because qualifiers may block teams.
-- - Week 16 weekend is a regular friendly slot and is included by default.

BEGIN;

ALTER TABLE matches
  DROP CONSTRAINT IF EXISTS matches_schedule_slot_type_check;

ALTER TABLE matches
  ADD CONSTRAINT matches_schedule_slot_type_check
  CHECK (
    schedule_slot_type IS NULL
    OR schedule_slot_type IN ('midweek_friendly', 'weekend_friendly', 'week15_weekend_friendly')
  );

CREATE OR REPLACE FUNCTION public.generate_tournament_schedule(
  p_tournament_id uuid,
  p_admin_password text,
  p_schedule_payload jsonb,
  p_schedule_mode text,
  p_schedule_start_slot timestamptz,
  p_include_week15_weekend_friendly boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_tournament tournaments%ROWTYPE;
  v_round jsonb;
  v_match jsonb;
  v_rounds jsonb;
  v_round_number integer;
  v_round_index integer;
  v_team_count integer;
  v_payload_team_count integer;
  v_expected_rounds integer;
  v_expected_matches_per_round integer;
  v_active_team_ids uuid[];
  v_seen_team_ids uuid[];
  v_payload_seen_team_ids uuid[] := ARRAY[]::uuid[];
  v_home_team_id uuid;
  v_away_team_id uuid;
  v_scheduled_for timestamptz;
  v_round_display_date timestamptz;
  v_payload_mode text;
  v_payload_start_slot_id text;
  v_payload_start_slot_date timestamptz;
  v_payload_start_slot_kind text;
  v_payload_include_week15 boolean;
  v_round_slot_kind text;
  v_round_slot_date timestamptz;
  v_round_match_count integer;
  v_round_bye_count integer;
  v_round_local_date date;
  v_round_week_start date;
  v_round_week_index integer;
  v_round_ht_week integer;
  v_round_ht_season integer;
  v_expected_slot_kind text;
  v_expected_local_date date;
  v_previous_slot_kind text;
  v_previous_week_start date;
  v_previous_week_index integer;
  v_previous_ht_week integer;
  v_match_slot_type text;
  v_match_local_date date;
  v_match_week_index integer;
  v_match_ht_week integer;
  v_match_ht_season integer;
  v_week15_weekend_count integer := 0;
  v_round_id uuid;
  v_inserted_rounds integer := 0;
  v_inserted_matches integer := 0;
  v_missing_team_id uuid;
BEGIN
  IF p_admin_password IS NULL OR btrim(p_admin_password) = '' THEN
    RAISE EXCEPTION 'Missing admin password' USING ERRCODE = '42501';
  END IF;

  IF p_schedule_payload IS NULL OR jsonb_typeof(p_schedule_payload) <> 'object' THEN
    RAISE EXCEPTION 'Schedule payload must be an object' USING ERRCODE = '22023';
  END IF;

  v_payload_mode := p_schedule_payload->>'mode';
  v_payload_start_slot_id := p_schedule_payload->>'start_slot_id';
  v_payload_start_slot_kind := p_schedule_payload->>'start_slot_kind';
  v_payload_start_slot_date := NULLIF(p_schedule_payload->>'start_slot_date', '')::timestamptz;
  v_payload_team_count := NULLIF(p_schedule_payload->>'team_count', '')::integer;
  v_payload_include_week15 := COALESCE((p_schedule_payload->>'include_week15_weekend_friendly')::boolean, false);
  v_rounds := p_schedule_payload->'rounds';

  IF p_schedule_mode IS NULL OR p_schedule_mode NOT IN ('single', 'double', 'recurring') THEN
    RAISE EXCEPTION 'Invalid schedule mode' USING ERRCODE = '22023';
  END IF;

  IF v_payload_mode IS NULL OR v_payload_mode <> p_schedule_mode THEN
    RAISE EXCEPTION 'Schedule payload mode does not match the requested mode' USING ERRCODE = '22023';
  END IF;

  IF v_rounds IS NULL OR jsonb_typeof(v_rounds) <> 'array' OR jsonb_array_length(v_rounds) = 0 THEN
    RAISE EXCEPTION 'Schedule payload must contain at least one round' USING ERRCODE = '22023';
  END IF;

  IF p_schedule_start_slot IS NULL THEN
    RAISE EXCEPTION 'Schedule start slot is required' USING ERRCODE = '22023';
  END IF;

  IF v_payload_start_slot_id IS NULL OR btrim(v_payload_start_slot_id) = '' THEN
    RAISE EXCEPTION 'Schedule payload is missing the start slot id' USING ERRCODE = '22023';
  END IF;

  IF v_payload_start_slot_kind NOT IN ('midweek_friendly', 'weekend_friendly', 'week15_weekend_friendly') THEN
    RAISE EXCEPTION 'Invalid start slot kind' USING ERRCODE = '22023';
  END IF;

  IF v_payload_start_slot_date IS NULL THEN
    RAISE EXCEPTION 'Schedule payload is missing the start slot date' USING ERRCODE = '22023';
  END IF;

  IF v_payload_start_slot_date <> p_schedule_start_slot THEN
    RAISE EXCEPTION 'Schedule payload start slot does not match the RPC argument' USING ERRCODE = '22023';
  END IF;

  IF v_payload_include_week15 IS DISTINCT FROM p_include_week15_weekend_friendly THEN
    RAISE EXCEPTION 'Week 15 weekend flag mismatch' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_tournament
  FROM tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_tournament.admin_password IS DISTINCT FROM p_admin_password THEN
    RAISE EXCEPTION 'Unauthorized schedule generation attempt' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM rounds
    WHERE tournament_id = p_tournament_id
  ) THEN
    RAISE EXCEPTION 'Tournament already has rounds' USING ERRCODE = '22023';
  END IF;

  IF v_tournament.status IS DISTINCT FROM 'open' AND v_tournament.status IS DISTINCT FROM 'waiting' THEN
    RAISE EXCEPTION 'Tournament schedule is read-only once generated' USING ERRCODE = '22023';
  END IF;

  SELECT ARRAY_AGG(id ORDER BY created_at, id)
  INTO v_active_team_ids
  FROM teams
  WHERE tournament_id = p_tournament_id
    AND active = true
    AND COALESCE(is_placeholder, false) = false;

  v_team_count := COALESCE(cardinality(v_active_team_ids), 0);

  IF v_team_count < 2 THEN
    RAISE EXCEPTION 'At least two active non-placeholder teams are required' USING ERRCODE = '22023';
  END IF;

  IF v_payload_team_count IS NULL OR v_payload_team_count <> v_team_count THEN
    RAISE EXCEPTION 'Payload team count does not match eligible teams. Eligible teams are active registered teams, excluding placeholder slots.' USING ERRCODE = '22023';
  END IF;

  v_expected_rounds := CASE
    WHEN p_schedule_mode = 'single' THEN CASE WHEN v_team_count % 2 = 0 THEN v_team_count - 1 ELSE v_team_count END
    WHEN p_schedule_mode = 'double' THEN (CASE WHEN v_team_count % 2 = 0 THEN v_team_count - 1 ELSE v_team_count END) * 2
    ELSE 4
  END;
  v_expected_matches_per_round := (v_team_count + 1) / 2;

  IF jsonb_array_length(v_rounds) <> v_expected_rounds THEN
    RAISE EXCEPTION 'Round count does not match the selected format' USING ERRCODE = '22023';
  END IF;

  v_round_index := 0;
  FOR v_round IN
    SELECT value
    FROM jsonb_array_elements(v_rounds) AS value
  LOOP
    v_round_index := v_round_index + 1;

    IF jsonb_typeof(v_round) <> 'object' THEN
      RAISE EXCEPTION 'Each round must be an object' USING ERRCODE = '22023';
    END IF;

    v_round_number := NULLIF(v_round->>'round_number', '')::integer;
    IF v_round_number IS NULL OR v_round_number <> v_round_index THEN
      RAISE EXCEPTION 'Round numbers must be sequential starting at 1' USING ERRCODE = '22023';
    END IF;

    v_round_slot_kind := v_round->>'slot_kind';
    IF v_round_slot_kind NOT IN ('midweek_friendly', 'weekend_friendly', 'week15_weekend_friendly') THEN
      RAISE EXCEPTION 'Invalid round slot kind' USING ERRCODE = '22023';
    END IF;

    IF v_round->'matches' IS NULL OR jsonb_typeof(v_round->'matches') <> 'array' THEN
      RAISE EXCEPTION 'Each round must include a matches array' USING ERRCODE = '22023';
    END IF;

    v_round_slot_date := NULLIF(v_round->>'slot_date', '')::timestamptz;
    v_round_display_date := NULLIF(v_round->>'display_date', '')::timestamptz;
    IF v_round_slot_date IS NULL THEN
      RAISE EXCEPTION 'Each round must include a slot date' USING ERRCODE = '22023';
    END IF;
    IF v_round_display_date IS NULL THEN
      RAISE EXCEPTION 'Each round must include a display date' USING ERRCODE = '22023';
    END IF;

    v_round_local_date := (v_round_slot_date AT TIME ZONE 'Europe/Stockholm')::date;
    v_round_week_index := FLOOR(((v_round_local_date - DATE '2026-03-30')::numeric) / 7)::integer;
    v_round_ht_week := ((v_round_week_index % 16) + 16) % 16 + 1;
    v_round_ht_season := 94 + FLOOR(v_round_week_index::numeric / 16)::integer;
    v_round_week_start := DATE '2026-03-30' + (v_round_week_index * 7);

    IF v_round_ht_week BETWEEN 1 AND 3 THEN
      RAISE EXCEPTION 'Schedule payload crosses into blocked cup week W%', v_round_ht_week USING ERRCODE = '22023';
    END IF;

    IF v_round_slot_kind = 'midweek_friendly' AND v_round_local_date <> v_round_week_start + 2 THEN
      RAISE EXCEPTION 'Midweek round slot date is not the canonical Wednesday' USING ERRCODE = '22023';
    END IF;

    IF v_round_slot_kind IN ('weekend_friendly', 'week15_weekend_friendly') THEN
      IF v_round_ht_week NOT IN (15, 16) OR v_round_local_date <> v_round_week_start + 5 THEN
        RAISE EXCEPTION 'Weekend round must be a canonical W15 or W16 weekend slot' USING ERRCODE = '22023';
      END IF;
      IF v_round_slot_kind = 'week15_weekend_friendly' AND v_round_ht_week <> 15 THEN
        RAISE EXCEPTION 'Legacy Week 15 weekend slot type can only be used for W15' USING ERRCODE = '22023';
      END IF;
      IF v_round_ht_week = 15 THEN
        v_week15_weekend_count := v_week15_weekend_count + 1;
      END IF;
    END IF;

    IF v_round_index = 1 THEN
      IF v_round_slot_date <> p_schedule_start_slot OR v_round_slot_kind <> v_payload_start_slot_kind THEN
        RAISE EXCEPTION 'The first round must match the selected start slot' USING ERRCODE = '22023';
      END IF;
    ELSE
      IF v_previous_slot_kind = 'midweek_friendly' AND v_previous_ht_week = 15 AND p_include_week15_weekend_friendly THEN
        v_expected_slot_kind := 'weekend_friendly';
        v_expected_local_date := v_previous_week_start + 5;
      ELSIF v_previous_slot_kind = 'midweek_friendly' AND v_previous_ht_week = 16 THEN
        v_expected_slot_kind := 'weekend_friendly';
        v_expected_local_date := v_previous_week_start + 5;
      ELSE
        v_expected_slot_kind := 'midweek_friendly';
        v_expected_local_date := v_previous_week_start + 9;
      END IF;

      IF v_round_slot_kind = 'week15_weekend_friendly' AND v_expected_slot_kind = 'weekend_friendly' THEN
        v_expected_slot_kind := 'week15_weekend_friendly';
      END IF;

      IF v_round_slot_kind <> v_expected_slot_kind OR v_round_local_date <> v_expected_local_date THEN
        RAISE EXCEPTION 'Round slots must follow the canonical ordered HT calendar sequence' USING ERRCODE = '22023';
      END IF;
    END IF;

    v_round_match_count := jsonb_array_length(v_round->'matches');
    IF v_round_match_count = 0 THEN
      RAISE EXCEPTION 'Rounds must contain at least one match' USING ERRCODE = '22023';
    END IF;

    IF v_round_match_count <> v_expected_matches_per_round THEN
      RAISE EXCEPTION 'Match count does not match eligible team count, including one BYE row per round for odd-team tournaments' USING ERRCODE = '22023';
    END IF;

    v_seen_team_ids := ARRAY[]::uuid[];
    v_round_bye_count := 0;

    FOR v_match IN
      SELECT value
      FROM jsonb_array_elements(v_round->'matches') AS value
    LOOP
      IF jsonb_typeof(v_match) <> 'object' THEN
        RAISE EXCEPTION 'Each match must be an object' USING ERRCODE = '22023';
      END IF;

      v_home_team_id := NULLIF(v_match->>'home_team_id', '')::uuid;
      v_away_team_id := NULLIF(v_match->>'away_team_id', '')::uuid;

      IF v_home_team_id IS NULL AND v_away_team_id IS NULL THEN
        RAISE EXCEPTION 'Match rows must contain at least one team id' USING ERRCODE = '22023';
      END IF;

      IF v_home_team_id IS NULL OR v_away_team_id IS NULL THEN
        IF v_team_count % 2 = 0 THEN
          RAISE EXCEPTION 'Bye rows are only valid for odd-team schedules' USING ERRCODE = '22023';
        END IF;
        v_round_bye_count := v_round_bye_count + 1;
        IF v_round_bye_count > 1 THEN
          RAISE EXCEPTION 'Only one bye row is allowed per round' USING ERRCODE = '22023';
        END IF;
      END IF;

      IF v_home_team_id IS NOT NULL AND v_home_team_id = v_away_team_id THEN
        RAISE EXCEPTION 'Home and away teams must be different' USING ERRCODE = '22023';
      END IF;

      IF COALESCE(v_match->>'venue_type', '') <> 'home_away' THEN
        RAISE EXCEPTION 'Invalid venue type in schedule payload' USING ERRCODE = '22023';
      END IF;

      v_match_slot_type := v_match->>'schedule_slot_type';
      IF v_match_slot_type NOT IN ('midweek_friendly', 'weekend_friendly', 'week15_weekend_friendly') THEN
        RAISE EXCEPTION 'Invalid schedule slot type in payload' USING ERRCODE = '22023';
      END IF;

      IF v_match_slot_type <> v_round_slot_kind THEN
        RAISE EXCEPTION 'Round slot kind and match schedule slot type must match' USING ERRCODE = '22023';
      END IF;

      v_scheduled_for := NULLIF(v_match->>'scheduled_for', '')::timestamptz;
      IF v_scheduled_for IS NULL THEN
        RAISE EXCEPTION 'Match scheduled_for timestamps are required' USING ERRCODE = '22023';
      END IF;

      IF v_scheduled_for <= v_now THEN
        RAISE EXCEPTION 'Match scheduled_for timestamps must be in the future' USING ERRCODE = '22023';
      END IF;

      v_match_local_date := (v_scheduled_for AT TIME ZONE 'Europe/Stockholm')::date;
      v_match_week_index := FLOOR(((v_match_local_date - DATE '2026-03-30')::numeric) / 7)::integer;
      v_match_ht_week := ((v_match_week_index % 16) + 16) % 16 + 1;
      v_match_ht_season := 94 + FLOOR(v_match_week_index::numeric / 16)::integer;
      IF v_match_ht_week BETWEEN 1 AND 3 THEN
        RAISE EXCEPTION 'Schedule payload crosses into a blocked cup week' USING ERRCODE = '22023';
      END IF;

      IF v_match_ht_week <> v_round_ht_week OR v_match_ht_season <> v_round_ht_season THEN
        RAISE EXCEPTION 'Match timestamp does not belong to the round HT week' USING ERRCODE = '22023';
      END IF;

      IF v_home_team_id IS NOT NULL AND NOT (v_home_team_id = ANY(v_active_team_ids)) THEN
        RAISE EXCEPTION 'Home team does not belong to this tournament or is inactive/placeholder' USING ERRCODE = '22023';
      END IF;

      IF v_away_team_id IS NOT NULL AND NOT (v_away_team_id = ANY(v_active_team_ids)) THEN
        RAISE EXCEPTION 'Away team does not belong to this tournament or is inactive/placeholder' USING ERRCODE = '22023';
      END IF;

      IF (v_home_team_id IS NOT NULL AND v_home_team_id = ANY(v_seen_team_ids))
        OR (v_away_team_id IS NOT NULL AND v_away_team_id = ANY(v_seen_team_ids)) THEN
        RAISE EXCEPTION 'A team appears more than once in the same round' USING ERRCODE = '22023';
      END IF;

      IF v_home_team_id IS NOT NULL THEN
        v_seen_team_ids := array_append(v_seen_team_ids, v_home_team_id);
      END IF;
      IF v_away_team_id IS NOT NULL THEN
        v_seen_team_ids := array_append(v_seen_team_ids, v_away_team_id);
      END IF;

      IF v_home_team_id IS NOT NULL AND NOT (v_home_team_id = ANY(v_payload_seen_team_ids)) THEN
        v_payload_seen_team_ids := array_append(v_payload_seen_team_ids, v_home_team_id);
      END IF;
      IF v_away_team_id IS NOT NULL AND NOT (v_away_team_id = ANY(v_payload_seen_team_ids)) THEN
        v_payload_seen_team_ids := array_append(v_payload_seen_team_ids, v_away_team_id);
      END IF;
    END LOOP;

    IF v_team_count % 2 = 1 AND v_round_bye_count <> 1 THEN
      RAISE EXCEPTION 'Odd-team schedules must include one bye row per round' USING ERRCODE = '22023';
    END IF;

    v_previous_slot_kind := v_round_slot_kind;
    v_previous_week_start := v_round_week_start;
    v_previous_week_index := v_round_week_index;
    v_previous_ht_week := v_round_ht_week;
  END LOOP;

  IF (v_week15_weekend_count > 0) IS DISTINCT FROM p_include_week15_weekend_friendly THEN
    RAISE EXCEPTION 'Week 15 weekend flag must match the generated rounds' USING ERRCODE = '22023';
  END IF;

  IF (v_week15_weekend_count > 0) IS DISTINCT FROM v_payload_include_week15 THEN
    RAISE EXCEPTION 'Payload Week 15 weekend flag must match the generated rounds' USING ERRCODE = '22023';
  END IF;

  FOREACH v_missing_team_id IN ARRAY v_active_team_ids
  LOOP
    IF NOT (v_missing_team_id = ANY(v_payload_seen_team_ids)) THEN
      RAISE EXCEPTION 'Schedule payload does not include every active non-placeholder team' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  UPDATE tournaments
  SET
    status = 'active',
    schedule_mode = p_schedule_mode,
    schedule_start_slot = p_schedule_start_slot,
    schedule_locked_at = v_now,
    registration_closed_at = v_now,
    schedule_generated_at = v_now,
    include_week15_weekend_friendly = p_include_week15_weekend_friendly
  WHERE id = p_tournament_id;

  v_round_index := 0;
  FOR v_round IN
    SELECT value
    FROM jsonb_array_elements(v_rounds) AS value
  LOOP
    v_round_index := v_round_index + 1;

    INSERT INTO rounds (tournament_id, round_number)
    VALUES (p_tournament_id, v_round_index)
    RETURNING id INTO v_round_id;

    v_inserted_rounds := v_inserted_rounds + 1;

    FOR v_match IN
      SELECT value
      FROM jsonb_array_elements(v_round->'matches') AS value
    LOOP
      INSERT INTO matches (
        round_id,
        home_team_id,
        away_team_id,
        venue_type,
        scheduled_for,
        schedule_slot_type,
        home_goals,
        away_goals,
        went_120,
        completed,
        total_minutes
      )
      VALUES (
        v_round_id,
        NULLIF(v_match->>'home_team_id', '')::uuid,
        NULLIF(v_match->>'away_team_id', '')::uuid,
        NULLIF(v_match->>'venue_type', ''),
        NULLIF(v_match->>'scheduled_for', '')::timestamptz,
        NULLIF(v_match->>'schedule_slot_type', ''),
        NULL,
        NULL,
        false,
        false,
        90
      );

      v_inserted_matches := v_inserted_matches + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'tournament_id', p_tournament_id,
    'rounds_inserted', v_inserted_rounds,
    'matches_inserted', v_inserted_matches,
    'schedule_mode', p_schedule_mode,
    'schedule_start_slot', p_schedule_start_slot,
    'schedule_locked_at', v_now,
    'registration_closed_at', v_now,
    'schedule_generated_at', v_now
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reschedule_tournament_rounds(
  p_tournament_id uuid,
  p_admin_password text,
  p_from_round_number integer,
  p_schedule_payload jsonb,
  p_schedule_start_slot timestamptz,
  p_include_week15_weekend_friendly boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_tournament tournaments%ROWTYPE;
  v_rounds jsonb;
  v_round jsonb;
  v_match jsonb;
  v_round_index integer := 0;
  v_expected_round_number integer;
  v_round_id uuid;
  v_round_number integer;
  v_segment_round_number integer;
  v_round_slot_kind text;
  v_round_slot_date timestamptz;
  v_round_local_date date;
  v_round_week_index integer;
  v_round_ht_season integer;
  v_round_ht_week integer;
  v_round_week_start date;
  v_previous_week_index integer;
  v_previous_slot_kind text;
  v_previous_ht_week integer;
  v_expected_slot_kind text;
  v_expected_local_date date;
  v_week15_weekend_count integer := 0;
  v_payload_from_round_number integer;
  v_payload_start_slot_id text;
  v_payload_start_slot_date timestamptz;
  v_payload_start_slot_kind text;
  v_payload_include_week15 boolean;
  v_expected_round_count integer;
  v_payload_match_count integer;
  v_db_match_count integer;
  v_match_id uuid;
  v_seen_match_ids uuid[];
  v_home_team_id uuid;
  v_away_team_id uuid;
  v_existing_home_team_id uuid;
  v_existing_away_team_id uuid;
  v_existing_venue_type text;
  v_existing_completed boolean;
  v_existing_status text;
  v_existing_ht_match_id integer;
  v_scheduled_for timestamptz;
  v_match_slot_type text;
  v_match_local_date date;
  v_match_week_index integer;
  v_match_ht_season integer;
  v_match_ht_week integer;
  v_is_bye boolean;
  v_updated_matches integer := 0;
BEGIN
  IF p_admin_password IS NULL OR btrim(p_admin_password) = '' THEN
    RAISE EXCEPTION 'Missing admin password' USING ERRCODE = '42501';
  END IF;

  IF p_from_round_number IS NULL OR p_from_round_number < 1 THEN
    RAISE EXCEPTION 'Invalid starting round' USING ERRCODE = '22023';
  END IF;

  IF p_schedule_payload IS NULL OR jsonb_typeof(p_schedule_payload) <> 'object' THEN
    RAISE EXCEPTION 'Reschedule payload must be an object' USING ERRCODE = '22023';
  END IF;

  v_rounds := p_schedule_payload->'rounds';
  IF v_rounds IS NULL OR jsonb_typeof(v_rounds) <> 'array' OR jsonb_array_length(v_rounds) = 0 THEN
    RAISE EXCEPTION 'Reschedule payload must include at least one round' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_tournament
  FROM tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament not found' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_tournament.admin_password, '') <> p_admin_password THEN
    RAISE EXCEPTION 'Invalid admin password' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM rounds
    WHERE tournament_id = p_tournament_id
      AND round_number = p_from_round_number
  ) THEN
    RAISE EXCEPTION 'Starting round does not exist' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)
    INTO v_expected_round_count
  FROM rounds
  WHERE tournament_id = p_tournament_id
    AND round_number >= p_from_round_number;

  IF v_expected_round_count <> jsonb_array_length(v_rounds) THEN
    RAISE EXCEPTION 'Reschedule payload must include every round from the selected start onward' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM rounds r
    JOIN matches m ON m.round_id = r.id
    WHERE r.tournament_id = p_tournament_id
      AND r.round_number >= p_from_round_number
      AND (
        COALESCE(m.completed, false)
        OR m.ht_match_id IS NOT NULL
        OR COALESCE(m.status, 'not_arranged') <> 'not_arranged'
      )
  ) THEN
    RAISE EXCEPTION 'Selected rounds include matches that are already arranged or played' USING ERRCODE = '22023';
  END IF;

  v_payload_from_round_number := NULLIF(p_schedule_payload->>'from_round_number', '')::integer;
  IF v_payload_from_round_number IS NULL OR v_payload_from_round_number <> p_from_round_number THEN
    RAISE EXCEPTION 'Payload starting round does not match the selected round' USING ERRCODE = '22023';
  END IF;

  v_payload_start_slot_id := p_schedule_payload->>'start_slot_id';
  v_payload_start_slot_date := NULLIF(p_schedule_payload->>'start_slot_date', '')::timestamptz;
  v_payload_start_slot_kind := p_schedule_payload->>'start_slot_kind';
  v_payload_include_week15 := COALESCE((p_schedule_payload->>'include_week15_weekend_friendly')::boolean, false);

  IF v_payload_start_slot_id IS NULL OR v_payload_start_slot_id = '' THEN
    RAISE EXCEPTION 'Payload start slot id is required' USING ERRCODE = '22023';
  END IF;

  IF v_payload_start_slot_kind NOT IN ('midweek_friendly', 'weekend_friendly', 'week15_weekend_friendly') THEN
    RAISE EXCEPTION 'Invalid start slot type' USING ERRCODE = '22023';
  END IF;

  IF v_payload_start_slot_date IS NULL OR p_schedule_start_slot IS NULL THEN
    RAISE EXCEPTION 'Start slot timestamp is required' USING ERRCODE = '22023';
  END IF;

  IF v_payload_start_slot_date <> p_schedule_start_slot THEN
    RAISE EXCEPTION 'Start slot timestamp does not match payload' USING ERRCODE = '22023';
  END IF;

  IF v_payload_include_week15 IS DISTINCT FROM p_include_week15_weekend_friendly THEN
    RAISE EXCEPTION 'Week 15 weekend flag mismatch' USING ERRCODE = '22023';
  END IF;

  v_expected_round_number := p_from_round_number;

  FOR v_round IN
    SELECT value
    FROM jsonb_array_elements(v_rounds) AS value
  LOOP
    v_round_index := v_round_index + 1;
    v_round_id := NULLIF(v_round->>'round_id', '')::uuid;
    v_round_number := NULLIF(v_round->>'round_number', '')::integer;
    v_segment_round_number := NULLIF(v_round->>'segment_round_number', '')::integer;
    v_round_slot_kind := v_round->>'slot_kind';
    v_round_slot_date := NULLIF(v_round->>'slot_date', '')::timestamptz;

    IF v_round_id IS NULL OR v_round_number IS NULL OR v_segment_round_number IS NULL THEN
      RAISE EXCEPTION 'Round id, number, and segment number are required' USING ERRCODE = '22023';
    END IF;

    IF v_round_number <> v_expected_round_number OR v_segment_round_number <> v_round_index THEN
      RAISE EXCEPTION 'Reschedule rounds must be sequential from the selected round' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM rounds
      WHERE id = v_round_id
        AND tournament_id = p_tournament_id
        AND round_number = v_round_number
    ) THEN
      RAISE EXCEPTION 'Round does not belong to this tournament' USING ERRCODE = '22023';
    END IF;

    IF v_round_slot_kind NOT IN ('midweek_friendly', 'weekend_friendly', 'week15_weekend_friendly') THEN
      RAISE EXCEPTION 'Invalid round slot type' USING ERRCODE = '22023';
    END IF;

    IF v_round_slot_date IS NULL THEN
      RAISE EXCEPTION 'Round slot date is required' USING ERRCODE = '22023';
    END IF;

    IF v_round_index = 1 THEN
      IF v_round_slot_date <> v_payload_start_slot_date OR v_round_slot_kind <> v_payload_start_slot_kind THEN
        RAISE EXCEPTION 'First rescheduled round must match the selected start slot' USING ERRCODE = '22023';
      END IF;
    END IF;

    v_round_local_date := (v_round_slot_date AT TIME ZONE 'Europe/Stockholm')::date;
    v_round_week_index := floor(((v_round_local_date - DATE '2026-03-30')::numeric) / 7)::integer;
    v_round_ht_season := 94 + floor(v_round_week_index::numeric / 16)::integer;
    v_round_ht_week := mod(mod(v_round_week_index, 16) + 16, 16) + 1;
    v_round_week_start := DATE '2026-03-30' + (v_round_week_index * 7);

    IF v_round_ht_week IN (1, 2, 3) THEN
      RAISE EXCEPTION 'Reschedule payload crosses into blocked cup week W%', v_round_ht_week USING ERRCODE = '22023';
    END IF;

    IF v_round_slot_kind = 'midweek_friendly' AND v_round_local_date <> v_round_week_start + 2 THEN
      RAISE EXCEPTION 'Midweek slot date does not match the canonical calendar' USING ERRCODE = '22023';
    END IF;

    IF v_round_slot_kind IN ('weekend_friendly', 'week15_weekend_friendly') THEN
      IF v_round_ht_week NOT IN (15, 16) OR v_round_local_date <> v_round_week_start + 5 THEN
        RAISE EXCEPTION 'Weekend slot must be a canonical W15 or W16 weekend slot' USING ERRCODE = '22023';
      END IF;
      IF v_round_slot_kind = 'week15_weekend_friendly' AND v_round_ht_week <> 15 THEN
        RAISE EXCEPTION 'Legacy Week 15 weekend slot type can only be used for W15' USING ERRCODE = '22023';
      END IF;
      IF v_round_ht_week = 15 THEN
        v_week15_weekend_count := v_week15_weekend_count + 1;
      END IF;
    END IF;

    IF v_round_index > 1 THEN
      IF v_previous_slot_kind = 'midweek_friendly' AND v_previous_ht_week = 15 AND p_include_week15_weekend_friendly THEN
        v_expected_slot_kind := 'weekend_friendly';
        v_expected_local_date := DATE '2026-03-30' + (v_previous_week_index * 7) + 5;
      ELSIF v_previous_slot_kind = 'midweek_friendly' AND v_previous_ht_week = 16 THEN
        v_expected_slot_kind := 'weekend_friendly';
        v_expected_local_date := DATE '2026-03-30' + (v_previous_week_index * 7) + 5;
      ELSE
        v_expected_slot_kind := 'midweek_friendly';
        v_expected_local_date := DATE '2026-03-30' + ((v_previous_week_index + 1) * 7) + 2;
      END IF;

      IF v_round_slot_kind = 'week15_weekend_friendly' AND v_expected_slot_kind = 'weekend_friendly' THEN
        v_expected_slot_kind := 'week15_weekend_friendly';
      END IF;

      IF v_round_slot_kind <> v_expected_slot_kind OR v_round_local_date <> v_expected_local_date THEN
        RAISE EXCEPTION 'Round slots do not follow the canonical ordered calendar sequence' USING ERRCODE = '22023';
      END IF;
    END IF;

    IF v_round->'matches' IS NULL OR jsonb_typeof(v_round->'matches') <> 'array' THEN
      RAISE EXCEPTION 'Round matches must be an array' USING ERRCODE = '22023';
    END IF;

    v_payload_match_count := jsonb_array_length(v_round->'matches');
    SELECT COUNT(*)
      INTO v_db_match_count
    FROM matches
    WHERE round_id = v_round_id;

    IF v_payload_match_count <> v_db_match_count THEN
      RAISE EXCEPTION 'Payload match count does not match the existing round' USING ERRCODE = '22023';
    END IF;

    v_seen_match_ids := ARRAY[]::uuid[];

    FOR v_match IN
      SELECT value
      FROM jsonb_array_elements(v_round->'matches') AS value
    LOOP
      v_match_id := NULLIF(v_match->>'match_id', '')::uuid;
      v_home_team_id := NULLIF(v_match->>'home_team_id', '')::uuid;
      v_away_team_id := NULLIF(v_match->>'away_team_id', '')::uuid;
      v_match_slot_type := v_match->>'schedule_slot_type';
      v_scheduled_for := NULLIF(v_match->>'scheduled_for', '')::timestamptz;
      v_is_bye := COALESCE((v_match->>'is_bye')::boolean, false);

      IF v_match_id IS NULL THEN
        RAISE EXCEPTION 'Match id is required' USING ERRCODE = '22023';
      END IF;

      IF v_match_id = ANY(v_seen_match_ids) THEN
        RAISE EXCEPTION 'Duplicate match id in reschedule payload' USING ERRCODE = '22023';
      END IF;
      v_seen_match_ids := array_append(v_seen_match_ids, v_match_id);

      SELECT home_team_id, away_team_id, venue_type, completed, COALESCE(status, 'not_arranged'), ht_match_id
        INTO v_existing_home_team_id,
             v_existing_away_team_id,
             v_existing_venue_type,
             v_existing_completed,
             v_existing_status,
             v_existing_ht_match_id
      FROM matches
      WHERE id = v_match_id
        AND round_id = v_round_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Match does not belong to the supplied round' USING ERRCODE = '22023';
      END IF;

      IF COALESCE(v_existing_completed, false) OR v_existing_ht_match_id IS NOT NULL OR v_existing_status <> 'not_arranged' THEN
        RAISE EXCEPTION 'Cannot reschedule a match that is already arranged or played' USING ERRCODE = '22023';
      END IF;

      IF v_home_team_id IS DISTINCT FROM v_existing_home_team_id OR v_away_team_id IS DISTINCT FROM v_existing_away_team_id THEN
        RAISE EXCEPTION 'Reschedule payload cannot change match pairings' USING ERRCODE = '22023';
      END IF;

      IF v_home_team_id IS NOT NULL AND v_away_team_id IS NOT NULL AND v_home_team_id = v_away_team_id THEN
        RAISE EXCEPTION 'A team cannot play itself' USING ERRCODE = '22023';
      END IF;

      IF (v_home_team_id IS NULL OR v_away_team_id IS NULL) <> v_is_bye THEN
        RAISE EXCEPTION 'BYE flag does not match match teams' USING ERRCODE = '22023';
      END IF;

      IF COALESCE(v_match->>'venue_type', '') <> COALESCE(v_existing_venue_type, 'home_away') THEN
        RAISE EXCEPTION 'Reschedule payload cannot change venue type' USING ERRCODE = '22023';
      END IF;

      IF COALESCE(v_match->>'venue_type', '') <> 'home_away' THEN
        RAISE EXCEPTION 'Invalid venue type' USING ERRCODE = '22023';
      END IF;

      IF v_match_slot_type NOT IN ('midweek_friendly', 'weekend_friendly', 'week15_weekend_friendly') THEN
        RAISE EXCEPTION 'Invalid match slot type' USING ERRCODE = '22023';
      END IF;

      IF v_match_slot_type <> v_round_slot_kind THEN
        RAISE EXCEPTION 'Match slot type must match the round slot type' USING ERRCODE = '22023';
      END IF;

      IF v_scheduled_for IS NULL THEN
        RAISE EXCEPTION 'Match scheduled_for timestamp is required' USING ERRCODE = '22023';
      END IF;

      IF v_scheduled_for <= v_now THEN
        RAISE EXCEPTION 'Match scheduled_for timestamps must be in the future' USING ERRCODE = '22023';
      END IF;

      v_match_local_date := (v_scheduled_for AT TIME ZONE 'Europe/Stockholm')::date;
      v_match_week_index := floor(((v_match_local_date - DATE '2026-03-30')::numeric) / 7)::integer;
      v_match_ht_season := 94 + floor(v_match_week_index::numeric / 16)::integer;
      v_match_ht_week := mod(mod(v_match_week_index, 16) + 16, 16) + 1;

      IF v_match_ht_season <> v_round_ht_season OR v_match_ht_week <> v_round_ht_week THEN
        RAISE EXCEPTION 'Match timestamp must fall in the same HT week as the round slot' USING ERRCODE = '22023';
      END IF;

      IF v_home_team_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM teams
        WHERE id = v_home_team_id
          AND tournament_id = p_tournament_id
          AND active = true
          AND COALESCE(is_placeholder, false) = false
      ) THEN
        RAISE EXCEPTION 'Home team is not an active tournament team' USING ERRCODE = '22023';
      END IF;

      IF v_away_team_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM teams
        WHERE id = v_away_team_id
          AND tournament_id = p_tournament_id
          AND active = true
          AND COALESCE(is_placeholder, false) = false
      ) THEN
        RAISE EXCEPTION 'Away team is not an active tournament team' USING ERRCODE = '22023';
      END IF;

      UPDATE matches
      SET scheduled_for = v_scheduled_for,
          schedule_slot_type = v_match_slot_type
      WHERE id = v_match_id;

      v_updated_matches := v_updated_matches + 1;
    END LOOP;

    v_previous_week_index := v_round_week_index;
    v_previous_slot_kind := v_round_slot_kind;
    v_previous_ht_week := v_round_ht_week;
    v_expected_round_number := v_expected_round_number + 1;
  END LOOP;

  IF p_include_week15_weekend_friendly <> (v_week15_weekend_count > 0)
     OR v_payload_include_week15 <> (v_week15_weekend_count > 0) THEN
    RAISE EXCEPTION 'Week 15 weekend flag does not match reschedule payload' USING ERRCODE = '22023';
  END IF;

  UPDATE tournaments
  SET include_week15_weekend_friendly = EXISTS (
    SELECT 1
    FROM rounds r
    JOIN matches m ON m.round_id = r.id
    WHERE r.tournament_id = p_tournament_id
      AND m.schedule_slot_type IN ('weekend_friendly', 'week15_weekend_friendly')
      AND (
        mod(
          mod(
            floor((((m.scheduled_for AT TIME ZONE 'Europe/Stockholm')::date - DATE '2026-03-30')::numeric) / 7)::integer,
            16
          ) + 16,
          16
        ) + 1
      ) = 15
  )
  WHERE id = p_tournament_id;

  RETURN jsonb_build_object(
    'tournament_id', p_tournament_id,
    'from_round_number', p_from_round_number,
    'matches_updated', v_updated_matches,
    'include_week15_weekend_friendly', v_week15_weekend_count > 0,
    'rescheduled_at', v_now
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_tournament_schedule(uuid, text, jsonb, text, timestamptz, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_tournament_schedule(uuid, text, jsonb, text, timestamptz, boolean) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.reschedule_tournament_rounds(uuid, text, integer, jsonb, timestamptz, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reschedule_tournament_rounds(uuid, text, integer, jsonb, timestamptz, boolean) TO anon, authenticated;

COMMIT;

-- MIGRATION APPLIED!
