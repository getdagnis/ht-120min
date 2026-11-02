BEGIN;

CREATE FUNCTION public.get_length_round_preparation_plan(
  p_tournament_id uuid,
  p_season_number integer,
  p_current_round_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tournament public.tournaments%ROWTYPE;
  v_current public.rounds%ROWTYPE;
  v_candidate public.teams%ROWTYPE;
  v_active_ids uuid[] := '{}';
  v_accepted_ids uuid[] := '{}';
  v_departing_ids uuid[] := '{}';
  v_rejected jsonb := '[]';
  v_reason text;
  v_field_count integer;
  v_roster_version text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(120, 113);
  SELECT * INTO v_tournament FROM public.tournaments
  WHERE id = p_tournament_id AND COALESCE(season, 1) = p_season_number FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tournament season changed' USING ERRCODE = '40001'; END IF;
  SELECT * INTO v_current FROM public.rounds
  WHERE id = p_current_round_id AND tournament_id = p_tournament_id
    AND season_number = p_season_number AND phase = 'regular'
    AND phase_status = 'materialized' AND round_source IS DISTINCT FROM 'organizer'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current regular round changed' USING ERRCODE = '40001'; END IF;

  -- Evaluate membership at this exact cutoff; overlapping rounds mean the
  -- legacy planner's oldest-materialized-round anchor is no longer sufficient.
  SELECT COALESCE(pg_catalog.array_agg(t.id ORDER BY t.id), '{}'::uuid[])
  INTO v_active_ids FROM public.teams t WHERE t.tournament_id = p_tournament_id
    AND t.active IS TRUE AND t.reserve_active IS NOT TRUE AND NOT COALESCE(t.is_placeholder, false);
  SELECT COALESCE(pg_catalog.array_agg(d.team_id ORDER BY d.team_id), '{}'::uuid[])
  INTO v_departing_ids
  FROM public.tournament_team_departures d
  WHERE d.tournament_id = p_tournament_id AND d.season_number = p_season_number
    AND d.after_round_id = v_current.id AND d.team_id = ANY(v_active_ids)
    AND EXISTS (
      SELECT 1 FROM public.tournament_season_slots sl
      JOIN public.tournament_seasons se ON se.id = sl.tournament_season_id
      WHERE se.tournament_id = p_tournament_id AND se.season_number = p_season_number
        AND sl.current_team_id = d.team_id
    );

  v_field_count := pg_catalog.cardinality(v_active_ids) - pg_catalog.cardinality(v_departing_ids);
  FOR v_candidate IN
    SELECT t.* FROM public.teams t WHERE t.tournament_id = p_tournament_id
      AND t.active = false AND t.reserve_active = true
    ORDER BY COALESCE(public.country_size_snapshot_count(t.country_id) > v_tournament.max_country_active_teams, false),
      t.reserve_joined_at NULLS LAST, t.id FOR UPDATE
  LOOP
    v_reason := public.waiting_team_admission_error(
      p_tournament_id, v_candidate.id, v_accepted_ids, v_departing_ids
    );
    IF v_reason IS NULL AND v_tournament.schedule_generated_at IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.rounds r WHERE r.tournament_id = p_tournament_id
        AND r.season_number = p_season_number AND r.phase = 'regular' AND r.phase_status = 'pending'
    ) THEN v_reason := 'There is no future regular round available'; END IF;
    IF v_reason IS NULL AND v_tournament.max_teams > 0
      AND v_field_count + pg_catalog.cardinality(v_accepted_ids) >= v_tournament.max_teams THEN
      v_reason := 'The team limit is reached; waiting for a place';
    END IF;
    IF v_reason IS NULL THEN
      IF v_candidate.actively_waiting THEN v_accepted_ids := pg_catalog.array_append(v_accepted_ids, v_candidate.id); END IF;
    ELSE
      v_rejected := v_rejected || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('teamId', v_candidate.id, 'reason', v_reason)
      );
    END IF;
  END LOOP;
  SELECT pg_catalog.md5(v_departing_ids::text || COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_array(id, active, reserve_active, actively_waiting,
      hattrick_user_id, ht_team_id, league_id, country_id, team_rank, power_rating)
    ORDER BY id)::text, '')) INTO v_roster_version
  FROM public.teams WHERE tournament_id = p_tournament_id AND NOT COALESCE(is_placeholder, false);
  RETURN pg_catalog.jsonb_build_object(
    'activeTeamIds', v_active_ids, 'departingTeamIds', v_departing_ids,
    'teamIds', v_accepted_ids, 'rejected', v_rejected, 'rosterVersion', v_roster_version
  );
END;
$$;

CREATE FUNCTION public.prepare_due_length_regular_round(
  p_tournament_id uuid,
  p_season_number integer,
  p_current_round_id uuid,
  p_next_round_id uuid,
  p_matches jsonb,
  p_pending_team_ids uuid[],
  p_active_team_ids uuid[],
  p_roster_version text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tournament public.tournaments%ROWTYPE;
  v_current public.rounds%ROWTYPE;
  v_next public.rounds%ROWTYPE;
  v_plan jsonb;
  v_accepted uuid[];
  v_current_ids uuid[];
  v_selected_ids uuid[];
  v_team_id uuid;
  v_match jsonb;
  v_home_team_id uuid;
  v_away_team_id uuid;
  v_home_slot_id uuid;
  v_away_slot_id uuid;
  v_home_assignment_id uuid;
  v_away_assignment_id uuid;
  v_seen_ids uuid[] := '{}';
  v_departing_ids uuid[];
  v_match_count integer := 0;
  v_bye_count integer := 0;
  v_team_count integer;
  v_slot_local_date date;
  v_open_date date;
  v_opens_at timestamptz;
  v_previous_write text := pg_catalog.current_setting('ht120.membership_write', true);
  v_previous_transition text := pg_catalog.current_setting('ht120.membership_transition', true);
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(120, 113);
  SELECT * INTO v_tournament FROM public.tournaments
  WHERE id = p_tournament_id AND COALESCE(season, 1) = p_season_number
    AND schedule_mode = 'length' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Length-scheduled tournament not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_current FROM public.rounds
  WHERE id = p_current_round_id AND tournament_id = p_tournament_id
    AND season_number = p_season_number AND phase = 'regular'
    AND phase_status = 'materialized' AND round_source IS DISTINCT FROM 'organizer' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current regular round changed' USING ERRCODE = '40001'; END IF;
  SELECT * INTO v_next FROM public.rounds
  WHERE id = p_next_round_id AND tournament_id = p_tournament_id
    AND season_number = p_season_number FOR UPDATE;
  IF NOT FOUND OR v_next.round_number <> v_current.round_number + 1
     OR v_next.phase <> 'regular' OR v_next.round_source = 'organizer'
     OR COALESCE(v_next.is_unscored, false) OR v_next.reserved_slot_kind IS NULL
     OR v_next.reserved_slot_kind NOT IN ('midweek_friendly', 'weekend_friendly')
     OR v_next.reserved_slot_date IS NULL THEN
    RAISE EXCEPTION 'Next reserved regular round is invalid' USING ERRCODE = '22023';
  END IF;
  IF v_next.phase_status = 'materialized' THEN
    RETURN pg_catalog.jsonb_build_object('prepared', false, 'reason', 'already_materialized', 'round_id', v_next.id);
  END IF;
  IF v_next.phase_status <> 'pending' THEN RAISE EXCEPTION 'Next regular round is not pending' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.rounds r WHERE r.tournament_id = p_tournament_id
      AND r.season_number = p_season_number AND r.phase = 'regular'
      AND r.round_source IS DISTINCT FROM 'organizer' AND r.phase_status = 'materialized'
      AND r.round_number > v_current.round_number) THEN
    RAISE EXCEPTION 'A later regular round is already materialized' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.matches WHERE round_id = v_next.id) THEN
    RAISE EXCEPTION 'Pending round already has fixture rows' USING ERRCODE = '23505';
  END IF;

  v_slot_local_date := (v_next.reserved_slot_date AT TIME ZONE 'Europe/Stockholm')::date;
  v_open_date := pg_catalog.date_trunc('week', v_slot_local_date::timestamp)::date;
  IF v_next.reserved_slot_kind = 'midweek_friendly' THEN v_open_date := v_open_date - 4; END IF;
  v_opens_at := (v_open_date + TIME '06:00') AT TIME ZONE 'Europe/Stockholm';
  IF v_opens_at > pg_catalog.now() THEN
    RETURN pg_catalog.jsonb_build_object('prepared', false, 'reason', 'not_due', 'opens_at', v_opens_at);
  END IF;
  IF p_matches IS NULL OR pg_catalog.jsonb_typeof(p_matches) <> 'array'
     OR pg_catalog.jsonb_array_length(p_matches) = 0 THEN
    RAISE EXCEPTION 'Next round pairings are required' USING ERRCODE = '22023';
  END IF;

  v_plan := public.get_length_round_preparation_plan(p_tournament_id, p_season_number, v_current.id);
  SELECT COALESCE(pg_catalog.array_agg(value::uuid ORDER BY value::uuid), '{}'::uuid[])
    INTO v_current_ids FROM pg_catalog.jsonb_array_elements_text(v_plan->'activeTeamIds') AS value;
  SELECT COALESCE(pg_catalog.array_agg(value::uuid ORDER BY value::uuid), '{}'::uuid[])
    INTO v_accepted FROM pg_catalog.jsonb_array_elements_text(v_plan->'teamIds') AS value;
  SELECT COALESCE(pg_catalog.array_agg(value::uuid ORDER BY value::uuid), '{}'::uuid[])
    INTO v_departing_ids FROM pg_catalog.jsonb_array_elements_text(v_plan->'departingTeamIds') AS value;
  SELECT COALESCE(pg_catalog.array_agg(value::uuid ORDER BY value::uuid), '{}'::uuid[])
    INTO v_selected_ids FROM pg_catalog.unnest(p_pending_team_ids) AS value;
  IF p_roster_version IS DISTINCT FROM v_plan->>'rosterVersion'
     OR v_current_ids IS DISTINCT FROM (SELECT COALESCE(pg_catalog.array_agg(value::uuid ORDER BY value::uuid), '{}'::uuid[]) FROM pg_catalog.unnest(p_active_team_ids) AS value)
     OR v_accepted IS DISTINCT FROM v_selected_ids THEN
    RAISE EXCEPTION 'Tournament membership changed; regenerate pairings' USING ERRCODE = '40001';
  END IF;

  PERFORM set_config('ht120.membership_write', 'true', true);
  PERFORM set_config('ht120.membership_transition', 'true', true);
  FOREACH v_team_id IN ARRAY v_departing_ids LOOP
    PERFORM public.complete_requested_tournament_departure(p_tournament_id, p_season_number, v_current.id, v_team_id);
  END LOOP;
  FOREACH v_team_id IN ARRAY v_accepted LOOP
    PERFORM public.activate_waiting_team(p_tournament_id, v_team_id, false, v_next.id);
  END LOOP;

  SELECT count(*) INTO v_team_count FROM public.teams
  WHERE tournament_id = p_tournament_id AND active IS TRUE
    AND reserve_active IS NOT TRUE AND COALESCE(is_placeholder, false) IS FALSE;
  FOR v_match IN SELECT value FROM pg_catalog.jsonb_array_elements(p_matches)
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
    IF v_home_team_id IS NOT NULL THEN v_seen_ids := pg_catalog.array_append(v_seen_ids, v_home_team_id); END IF;
    IF v_away_team_id IS NOT NULL THEN v_seen_ids := pg_catalog.array_append(v_seen_ids, v_away_team_id); END IF;

    SELECT s.id, a.id INTO v_home_slot_id, v_home_assignment_id
    FROM public.tournament_season_slots s
    LEFT JOIN public.tournament_season_slot_assignments a
      ON a.tournament_season_slot_id = s.id AND a.released_at IS NULL
    JOIN public.tournament_seasons season ON season.id = s.tournament_season_id
    WHERE season.tournament_id = p_tournament_id AND season.season_number = p_season_number
      AND s.current_team_id = v_home_team_id;
    SELECT s.id, a.id INTO v_away_slot_id, v_away_assignment_id
    FROM public.tournament_season_slots s
    LEFT JOIN public.tournament_season_slot_assignments a
      ON a.tournament_season_slot_id = s.id AND a.released_at IS NULL
    JOIN public.tournament_seasons season ON season.id = s.tournament_season_id
    WHERE season.tournament_id = p_tournament_id AND season.season_number = p_season_number
      AND s.current_team_id = v_away_team_id;
    IF (v_home_team_id IS NOT NULL AND v_home_slot_id IS NULL)
       OR (v_away_team_id IS NOT NULL AND v_away_slot_id IS NULL) THEN
      RAISE EXCEPTION 'Pairing includes a team outside the current season slots' USING ERRCODE = '22023';
    END IF;
    IF NULLIF(v_match->>'scheduled_for', '') IS NULL
       OR NULLIF(v_match->>'scheduled_for', '')::timestamptz <= pg_catalog.now() THEN
      RAISE EXCEPTION 'Pairing kickoff must be in the future' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.matches(
      round_id, home_team_id, away_team_id, home_slot_id, away_slot_id,
      home_slot_assignment_id, away_slot_assignment_id, venue_type, scheduled_for,
      schedule_slot_type, completed, total_minutes, schedule_resolution
    ) VALUES (
      v_next.id, v_home_team_id, v_away_team_id, v_home_slot_id, v_away_slot_id,
      v_home_assignment_id, v_away_assignment_id, 'home_away',
      (v_match->>'scheduled_for')::timestamptz, v_next.reserved_slot_kind,
      false, NULL, COALESCE(v_match->>'schedule_resolution', 'pending')
    );
  END LOOP;
  IF pg_catalog.cardinality(v_seen_ids) <> v_team_count
     OR v_match_count <> pg_catalog.ceil(v_team_count::numeric / 2)::integer
     OR v_bye_count <> v_team_count % 2 THEN
    RAISE EXCEPTION 'Regular round must account for every current participant exactly once' USING ERRCODE = '22023';
  END IF;

  UPDATE public.rounds SET phase_status = 'materialized', materialized_at = pg_catalog.now() WHERE id = v_next.id;
  PERFORM set_config('ht120.membership_write', COALESCE(v_previous_write, 'false'), true);
  PERFORM set_config('ht120.membership_transition', COALESCE(v_previous_transition, 'false'), true);
  RETURN pg_catalog.jsonb_build_object('prepared', true, 'round_id', v_next.id, 'round_number', v_next.round_number,
    'opens_at', v_opens_at, 'waiting', v_plan->'rejected');
END;
$$;

REVOKE ALL ON FUNCTION public.get_length_round_preparation_plan(uuid, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_length_round_preparation_plan(uuid, integer, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.prepare_due_length_regular_round(uuid, integer, uuid, uuid, jsonb, uuid[], uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_due_length_regular_round(uuid, integer, uuid, uuid, jsonb, uuid[], uuid[], text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- applied!