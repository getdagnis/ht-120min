-- Calendar-first staged schedules for new tournaments. Legacy generated and
-- manual schedules retain their existing representation and RPCs.
BEGIN;

ALTER TABLE public.tournaments
  DROP CONSTRAINT IF EXISTS tournaments_schedule_mode_check;
ALTER TABLE public.tournaments
  ADD CONSTRAINT tournaments_schedule_mode_check
  CHECK (schedule_mode IS NULL OR schedule_mode IN ('single', 'double', 'recurring', 'manual', 'length'));

ALTER TABLE public.rounds
  ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'regular',
  ADD COLUMN IF NOT EXISTS phase_round_number integer,
  ADD COLUMN IF NOT EXISTS phase_status text NOT NULL DEFAULT 'materialized',
  ADD COLUMN IF NOT EXISTS reserved_slot_id text,
  ADD COLUMN IF NOT EXISTS reserved_slot_kind text,
  ADD COLUMN IF NOT EXISTS reserved_slot_date timestamptz,
  ADD COLUMN IF NOT EXISTS reserved_display_date timestamptz,
  ADD COLUMN IF NOT EXISTS materialized_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE public.rounds
  DROP CONSTRAINT IF EXISTS rounds_phase_check,
  DROP CONSTRAINT IF EXISTS rounds_phase_status_check,
  DROP CONSTRAINT IF EXISTS rounds_reserved_slot_kind_check;
ALTER TABLE public.rounds
  ADD CONSTRAINT rounds_phase_check CHECK (phase IN ('regular', 'postseason')),
  ADD CONSTRAINT rounds_phase_status_check CHECK (phase_status IN ('pending', 'materialized', 'completed')),
  ADD CONSTRAINT rounds_reserved_slot_kind_check CHECK (
    reserved_slot_kind IS NULL OR reserved_slot_kind IN ('midweek_friendly', 'weekend_friendly', 'week15_weekend_friendly')
  );

UPDATE public.rounds AS r
SET
  phase = 'regular',
  phase_round_number = COALESCE(r.phase_round_number, r.round_number),
  phase_status = CASE
    WHEN EXISTS (SELECT 1 FROM public.matches m WHERE m.round_id = r.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.matches m
        WHERE m.round_id = r.id
          AND COALESCE(m.completed, false) = false
          AND m.status IS DISTINCT FROM 'finished'
      ) THEN 'completed'
    ELSE 'materialized'
  END,
  materialized_at = COALESCE(r.materialized_at, r.created_at),
  completed_at = CASE
    WHEN EXISTS (SELECT 1 FROM public.matches m WHERE m.round_id = r.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.matches m
        WHERE m.round_id = r.id
          AND COALESCE(m.completed, false) = false
          AND m.status IS DISTINCT FROM 'finished'
      ) THEN COALESCE(r.completed_at, r.created_at)
    ELSE r.completed_at
  END;

CREATE OR REPLACE FUNCTION public.set_round_phase_defaults()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.phase := COALESCE(NEW.phase, 'regular');
  NEW.phase_round_number := COALESCE(NEW.phase_round_number, NEW.round_number);
  NEW.phase_status := COALESCE(NEW.phase_status, 'materialized');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_round_phase_defaults ON public.rounds;
CREATE TRIGGER trg_set_round_phase_defaults
BEFORE INSERT OR UPDATE OF round_number, phase, phase_round_number, phase_status ON public.rounds
FOR EACH ROW
EXECUTE FUNCTION public.set_round_phase_defaults();

ALTER TABLE public.rounds
  ALTER COLUMN phase_round_number SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rounds_tournament_season_phase
  ON public.rounds(tournament_id, season_number, phase, round_number);
CREATE INDEX IF NOT EXISTS idx_rounds_pending_progression
  ON public.rounds(tournament_id, season_number, round_number)
  WHERE phase_status = 'pending';

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS schedule_resolution text NOT NULL DEFAULT 'pending';
ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_schedule_resolution_check;
ALTER TABLE public.matches
  ADD CONSTRAINT matches_schedule_resolution_check
  CHECK (schedule_resolution IN ('pending', 'played', 'finalized_unplayed'));

UPDATE public.matches
SET schedule_resolution = CASE
  WHEN completed = true OR status = 'finished' THEN 'played'
  ELSE 'pending'
END;

ALTER TABLE public.tournament_seasons
  ADD COLUMN IF NOT EXISTS schedule_plan_json jsonb,
  ADD COLUMN IF NOT EXISTS ranking_snapshot_json jsonb,
  ADD COLUMN IF NOT EXISTS champion_slot_id uuid REFERENCES public.tournament_season_slots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS champion_team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS champion_decided_at timestamptz;

CREATE OR REPLACE FUNCTION public.protect_length_season_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
    IF TG_OP = 'INSERT' AND (
      NEW.schedule_plan_json IS NOT NULL
      OR NEW.ranking_snapshot_json IS NOT NULL
      OR NEW.champion_slot_id IS NOT NULL
      OR NEW.champion_team_id IS NOT NULL
      OR NEW.champion_decided_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Length schedule metadata is server-owned' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND (
      NEW.schedule_plan_json IS DISTINCT FROM OLD.schedule_plan_json
      OR NEW.ranking_snapshot_json IS DISTINCT FROM OLD.ranking_snapshot_json
      OR NEW.champion_slot_id IS DISTINCT FROM OLD.champion_slot_id
      OR NEW.champion_team_id IS DISTINCT FROM OLD.champion_team_id
      OR NEW.champion_decided_at IS DISTINCT FROM OLD.champion_decided_at
    ) THEN
      RAISE EXCEPTION 'Length schedule metadata is server-owned' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_length_season_metadata ON public.tournament_seasons;
CREATE TRIGGER trg_protect_length_season_metadata
BEFORE INSERT OR UPDATE ON public.tournament_seasons
FOR EACH ROW
EXECUTE FUNCTION public.protect_length_season_metadata();

CREATE OR REPLACE FUNCTION public.protect_length_round_metadata()
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
  SELECT schedule_mode = 'length' INTO v_is_length
  FROM public.tournaments
  WHERE id = COALESCE(NEW.tournament_id, OLD.tournament_id);
  IF COALESCE(v_is_length, false) AND (
    TG_OP = 'INSERT'
    OR NEW.phase IS DISTINCT FROM OLD.phase
    OR NEW.phase_round_number IS DISTINCT FROM OLD.phase_round_number
    OR NEW.phase_status IS DISTINCT FROM OLD.phase_status
    OR NEW.reserved_slot_id IS DISTINCT FROM OLD.reserved_slot_id
    OR NEW.reserved_slot_kind IS DISTINCT FROM OLD.reserved_slot_kind
    OR NEW.reserved_slot_date IS DISTINCT FROM OLD.reserved_slot_date
    OR NEW.reserved_display_date IS DISTINCT FROM OLD.reserved_display_date
    OR NEW.materialized_at IS DISTINCT FROM OLD.materialized_at
    OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
  ) THEN
    RAISE EXCEPTION 'Length schedule rounds are server-owned' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_length_round_metadata ON public.rounds;
CREATE TRIGGER trg_protect_length_round_metadata
BEFORE INSERT OR UPDATE ON public.rounds
FOR EACH ROW
EXECUTE FUNCTION public.protect_length_round_metadata();

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
  ) THEN
    RAISE EXCEPTION 'Length schedule fixture resolution is server-owned' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_length_match_resolution ON public.matches;
CREATE TRIGGER trg_protect_length_match_resolution
BEFORE INSERT OR UPDATE ON public.matches
FOR EACH ROW
EXECUTE FUNCTION public.protect_length_match_resolution();

CREATE OR REPLACE FUNCTION public.clear_staged_schedule_plan_on_reset()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'ongoing' AND NEW.status = 'planned' AND NEW.started_at IS NULL THEN
    NEW.schedule_plan_json := NULL;
    NEW.ranking_snapshot_json := NULL;
    NEW.champion_slot_id := NULL;
    NEW.champion_team_id := NULL;
    NEW.champion_decided_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_staged_schedule_plan_on_reset ON public.tournament_seasons;
CREATE TRIGGER trg_clear_staged_schedule_plan_on_reset
BEFORE UPDATE ON public.tournament_seasons
FOR EACH ROW
EXECUTE FUNCTION public.clear_staged_schedule_plan_on_reset();

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
  IF v_tournament.league_category IS DISTINCT FROM 'hfi' THEN
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

  SELECT array_agg(t.id ORDER BY t.team_rank, t.id), count(*)
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
    OR v_total_rounds < 1 OR v_regular_rounds < 1 OR v_postseason_rounds NOT IN (0, 1)
    OR v_regular_rounds + v_postseason_rounds <> v_total_rounds THEN
    RAISE EXCEPTION 'Invalid regular/postseason round counts' USING ERRCODE = '22023';
  END IF;
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
  IF jsonb_array_length(COALESCE(p_schedule_payload->'rounds', '[]'::jsonb)) <> v_total_rounds THEN
    RAISE EXCEPTION 'Reserved round count does not match the season plan' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(COALESCE(p_schedule_payload->'ranking_snapshot', '[]'::jsonb)) <> v_team_count THEN
    RAISE EXCEPTION 'A complete TeamRank snapshot is required' USING ERRCODE = '22023';
  END IF;

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

  IF EXISTS (SELECT 1 FROM public.tournament_season_slots WHERE tournament_season_id = v_season_id) THEN
    RAISE EXCEPTION 'Current season already has competition slots' USING ERRCODE = '23505';
  END IF;
  v_box_size := v_team_count + (v_team_count % 2);
  INSERT INTO public.tournament_season_slots(tournament_season_id, slot_index, box_size, current_team_id)
  SELECT v_season_id, row_number() OVER (ORDER BY t.team_rank, t.id), v_box_size, t.id
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
    IF NULLIF(v_round->>'phase_round_number', '')::integer IS DISTINCT FROM
      CASE WHEN v_expected_phase = 'regular' THEN v_round_index ELSE v_round_index - v_regular_rounds END THEN
      RAISE EXCEPTION 'Phase round numbers must be sequential' USING ERRCODE = '22023';
    END IF;
    IF (v_round_index = 1 AND v_round->>'phase_status' IS DISTINCT FROM 'materialized')
      OR (v_round_index > 1 AND v_round->>'phase_status' IS DISTINCT FROM 'pending') THEN
      RAISE EXCEPTION 'Only the first round may be materialized initially' USING ERRCODE = '22023';
    END IF;
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
    'version', 1,
    'total_rounds', v_total_rounds,
    'regular_rounds', v_regular_rounds,
    'postseason_rounds', v_postseason_rounds,
    'ranking_source', 'team_rank',
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

  SELECT count(*) INTO v_team_count FROM public.tournament_season_slots
  WHERE tournament_season_id = v_season.id AND current_team_id IS NOT NULL;
  FOR v_match IN SELECT value FROM jsonb_array_elements(p_matches)
  LOOP
    v_match_count := v_match_count + 1;
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
      schedule_slot_type, completed, total_minutes, schedule_resolution
    ) VALUES (
      v_next.id, v_home_team_id, v_away_team_id, v_home_slot_id, v_away_slot_id,
      v_home_assignment_id, v_away_assignment_id, 'home_away',
      NULLIF(v_match->>'scheduled_for', '')::timestamptz, v_next.reserved_slot_kind,
      false, NULL, COALESCE(v_match->>'schedule_resolution', 'pending')
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
  IF v_next.phase = 'postseason' AND cardinality(v_seen_ids) <> 2 THEN
    RAISE EXCEPTION 'Championship Final requires exactly two participants' USING ERRCODE = '22023';
  END IF;
  IF v_next.phase = 'postseason' AND (v_match_count <> 1 OR v_bye_count <> 0) THEN
    RAISE EXCEPTION 'Championship Final must be one two-team fixture' USING ERRCODE = '22023';
  END IF;
  UPDATE public.rounds SET phase_status = 'materialized', materialized_at = v_now WHERE id = v_next.id;
  RETURN jsonb_build_object('advanced', true, 'next_round_materialized', true, 'next_round_id', v_next.id);
END;
$$;

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

  DELETE FROM public.matches
  WHERE round_id = p_round_id
    AND completed = false
    AND COALESCE(status, 'not_arranged') NOT IN ('arranged', 'ongoing', 'finished')
    AND ht_match_id IS NULL
    AND (scheduled_for IS NULL OR scheduled_for > now());
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

CREATE OR REPLACE FUNCTION public.save_length_schedule_results(
  p_tournament_id uuid,
  p_season_number integer,
  p_updates jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_round public.rounds%ROWTYPE;
  v_update jsonb;
  v_match_id uuid;
  v_updated integer := 0;
  v_expected integer;
BEGIN
  PERFORM 1
  FROM public.tournaments
  WHERE id = p_tournament_id
    AND COALESCE(season, 1) = p_season_number
    AND schedule_mode = 'length'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Length-scheduled tournament not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_round
  FROM public.rounds
  WHERE tournament_id = p_tournament_id
    AND season_number = p_season_number
    AND phase_status = 'materialized'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no current materialized round' USING ERRCODE = '22023';
  END IF;
  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'array' OR jsonb_array_length(p_updates) = 0 THEN
    RAISE EXCEPTION 'At least one result update is required' USING ERRCODE = '22023';
  END IF;
  v_expected := jsonb_array_length(p_updates);
  IF (
    SELECT count(DISTINCT value->>'match_id')
    FROM jsonb_array_elements(p_updates)
  ) <> v_expected THEN
    RAISE EXCEPTION 'Duplicate match result update' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.matches WHERE round_id = v_round.id FOR UPDATE;
  FOR v_update IN SELECT value FROM jsonb_array_elements(p_updates)
  LOOP
    v_match_id := NULLIF(v_update->>'match_id', '')::uuid;
    IF v_match_id IS NULL
      OR NULLIF(v_update->>'home_goals', '')::integer IS NULL
      OR NULLIF(v_update->>'away_goals', '')::integer IS NULL
      OR NULLIF(v_update->>'total_minutes', '')::integer IS NULL
      OR NULLIF(v_update->>'home_goals', '')::integer < 0
      OR NULLIF(v_update->>'away_goals', '')::integer < 0
      OR NULLIF(v_update->>'total_minutes', '')::integer < 1 THEN
      RAISE EXCEPTION 'Invalid result payload' USING ERRCODE = '22023';
    END IF;
    UPDATE public.matches
    SET
      home_goals = NULLIF(v_update->>'home_goals', '')::integer,
      away_goals = NULLIF(v_update->>'away_goals', '')::integer,
      went_120 = COALESCE((v_update->>'went_120')::boolean, false),
      total_minutes = NULLIF(v_update->>'total_minutes', '')::integer,
      completed = true,
      status = 'finished',
      finished_at = COALESCE(finished_at, now()),
      penalty_shootout_home_goals = NULLIF(v_update->>'penalty_shootout_home_goals', '')::integer,
      penalty_shootout_away_goals = NULLIF(v_update->>'penalty_shootout_away_goals', '')::integer,
      appg_outcome = NULLIF(v_update->>'appg_outcome', ''),
      appg_outcome_source = NULLIF(v_update->>'appg_outcome_source', ''),
      schedule_resolution = 'played'
    WHERE id = v_match_id
      AND round_id = v_round.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A result does not belong to the current round' USING ERRCODE = '22023';
    END IF;
    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('round_id', v_round.id, 'results_updated', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.generate_length_tournament_schedule(uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_length_round_transition(uuid, integer, uuid, uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.repair_length_schedule_round(uuid, integer, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_length_schedule_results(uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_round_phase_defaults() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_length_season_metadata() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_length_round_metadata() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_length_match_resolution() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_staged_schedule_plan_on_reset() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_length_tournament_schedule(uuid, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_length_round_transition(uuid, integer, uuid, uuid, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.repair_length_schedule_round(uuid, integer, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_length_schedule_results(uuid, integer, jsonb) TO service_role;

COMMIT;
