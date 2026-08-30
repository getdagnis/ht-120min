-- Depends on 047_add_week15_special_schedule.sql and corrected 048_add_schedule_metadata_and_generation_rpc.sql.
-- Apply 047 first, then 048, then this migration.
-- Adds a transactional RPC for moving future unarranged rounds without changing pairings.

BEGIN;

DROP FUNCTION IF EXISTS public.reschedule_tournament_rounds(uuid, text, integer, jsonb, timestamptz, boolean);

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

  IF v_payload_start_slot_kind NOT IN ('midweek_friendly', 'week15_weekend_friendly') THEN
    RAISE EXCEPTION 'Invalid start slot type' USING ERRCODE = '22023';
  END IF;

  IF v_payload_start_slot_date IS NULL OR p_schedule_start_slot IS NULL THEN
    RAISE EXCEPTION 'Start slot timestamp is required' USING ERRCODE = '22023';
  END IF;

  IF v_payload_start_slot_date <> p_schedule_start_slot THEN
    RAISE EXCEPTION 'Start slot timestamp does not match payload' USING ERRCODE = '22023';
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

    IF v_round_slot_kind NOT IN ('midweek_friendly', 'week15_weekend_friendly') THEN
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

    IF v_round_slot_kind = 'week15_weekend_friendly' THEN
      IF v_round_ht_week <> 15 OR v_round_local_date <> v_round_week_start + 5 THEN
        RAISE EXCEPTION 'Week 15 weekend slot does not match the canonical calendar' USING ERRCODE = '22023';
      END IF;
      v_week15_weekend_count := v_week15_weekend_count + 1;
      IF v_week15_weekend_count > 1 THEN
        RAISE EXCEPTION 'Week 15 weekend slot can only appear once' USING ERRCODE = '22023';
      END IF;
    END IF;

    IF v_round_index > 1 THEN
      IF v_previous_slot_kind = 'midweek_friendly' AND v_round_ht_week = 15 AND v_round_slot_kind = 'week15_weekend_friendly' THEN
        IF v_round_week_index <> v_previous_week_index THEN
          RAISE EXCEPTION 'Week 15 weekend slot must immediately follow W15 midweek' USING ERRCODE = '22023';
        END IF;
      ELSE
        IF v_round_slot_kind <> 'midweek_friendly' OR v_round_week_index <> v_previous_week_index + 1 THEN
          RAISE EXCEPTION 'Round slots do not follow the canonical ordered calendar sequence' USING ERRCODE = '22023';
        END IF;
        v_expected_local_date := DATE '2026-03-30' + (v_round_week_index * 7) + 2;
        IF v_round_local_date <> v_expected_local_date THEN
          RAISE EXCEPTION 'Round slot date does not match the canonical ordered calendar sequence' USING ERRCODE = '22023';
        END IF;
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
      AND m.schedule_slot_type = 'week15_weekend_friendly'
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

REVOKE EXECUTE ON FUNCTION public.reschedule_tournament_rounds(uuid, text, integer, jsonb, timestamptz, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reschedule_tournament_rounds(uuid, text, integer, jsonb, timestamptz, boolean) TO anon, authenticated;

COMMIT;

-- Supabase SQL Editor smoke-test checklist, to be adapted with real local ids:
-- BEGIN;
-- SELECT public.reschedule_tournament_rounds('<tournament_id>', 'wrong-password', 2, '{}'::jsonb, now(), false);
-- -- Expect wrong password failure.
-- -- Build a payload for a generated tournament with a future unarranged suffix.
-- -- Verify malformed payloads fail:
-- --   missing rounds, changed home_team_id/away_team_id, duplicate match_id, W1/W2 slot date, locked arranged match.
-- -- Verify a valid payload succeeds and only updates matches where round_number >= p_from_round_number.
-- ROLLBACK;


-- MIGRATION APPLIED!
