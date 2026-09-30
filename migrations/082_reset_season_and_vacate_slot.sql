BEGIN;

-- Admin lifecycle operations for the current season. These functions are only
-- callable through the server-side service-role path after tournament access
-- has been checked there.
CREATE OR REPLACE FUNCTION public.reset_current_season_to_planning(
  p_tournament_id uuid,
  p_season_number integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tournament public.tournaments%ROWTYPE;
  v_season public.tournament_seasons%ROWTYPE;
  v_now timestamptz := now();
  v_round_count integer := 0;
  v_match_count integer := 0;
  v_next_tournament_status text;
BEGIN
  SELECT * INTO v_tournament
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_season
  FROM public.tournament_seasons
  WHERE tournament_id = p_tournament_id
    AND season_number = p_season_number
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current tournament season was not found' USING ERRCODE = 'P0002';
  END IF;
  IF COALESCE(v_tournament.season, 1) <> p_season_number THEN
    RAISE EXCEPTION 'Only the current tournament season can be reset' USING ERRCODE = '22023';
  END IF;
  IF v_season.status IS DISTINCT FROM 'ongoing' THEN
    RAISE EXCEPTION 'Only an ongoing season can be reset to planning' USING ERRCODE = '22023';
  END IF;

  -- Serialize the safety check with fixture refresh/result writes. If a
  -- refresh commits an ongoing/finished state first, this transaction sees it
  -- and rejects; if reset wins first, the refresh finds no current fixtures.
  PERFORM 1
  FROM public.matches m
  JOIN public.rounds r ON r.id = m.round_id
  WHERE r.tournament_id = p_tournament_id
    AND r.season_number = p_season_number
  FOR UPDATE OF m;

  IF EXISTS (
    SELECT 1
    FROM public.matches m
    JOIN public.rounds r ON r.id = m.round_id
    WHERE r.tournament_id = p_tournament_id
      AND r.season_number = p_season_number
      AND (
        m.completed = true
        OR m.status IN ('ongoing', 'finished')
        OR m.finished_at IS NOT NULL
        OR m.home_goals IS NOT NULL
        OR m.away_goals IS NOT NULL
        OR m.match_event_details IS NOT NULL
        OR (m.scheduled_for IS NOT NULL AND m.scheduled_for <= v_now)
        OR (m.ht_match_id IS NOT NULL AND m.scheduled_for IS NULL)
      )
  ) THEN
    RAISE EXCEPTION 'This season cannot be reset after a match has started or finished' USING ERRCODE = '55000';
  END IF;

  SELECT count(*) INTO v_match_count
  FROM public.matches m
  JOIN public.rounds r ON r.id = m.round_id
  WHERE r.tournament_id = p_tournament_id
    AND r.season_number = p_season_number;

  SELECT count(*) INTO v_round_count
  FROM public.rounds
  WHERE tournament_id = p_tournament_id
    AND season_number = p_season_number;

  -- Delete fixtures before slot rows because matches retain slot references.
  DELETE FROM public.matches m
  USING public.rounds r
  WHERE r.id = m.round_id
    AND r.tournament_id = p_tournament_id
    AND r.season_number = p_season_number;

  DELETE FROM public.tournament_season_slot_assignments a
  USING public.tournament_season_slots s
  WHERE s.id = a.tournament_season_slot_id
    AND s.tournament_season_id = v_season.id;

  DELETE FROM public.tournament_season_slots
  WHERE tournament_season_id = v_season.id;

  DELETE FROM public.rounds
  WHERE tournament_id = p_tournament_id
    AND season_number = p_season_number;

  v_next_tournament_status := CASE
    WHEN v_tournament.registration_closed_at IS NULL THEN 'open'
    ELSE 'active'
  END;

  UPDATE public.tournament_seasons
  SET status = 'planned',
      started_at = NULL,
      finished_at = NULL,
      snapshot_json = NULL,
      fixtures_snapshot_json = NULL,
      planned_start_slot = v_tournament.schedule_start_slot,
      updated_at = now()
  WHERE id = v_season.id;

  -- Registration state is deliberately preserved. An organizer may keep a
  -- roster closed while rebuilding a season, just as before the reset.
  UPDATE public.tournaments
  SET status = v_next_tournament_status,
      schedule_locked_at = NULL,
      schedule_generated_at = NULL
  WHERE id = p_tournament_id;

  RETURN jsonb_build_object(
    'season_number', p_season_number,
    'tournament_status', v_next_tournament_status,
    'round_count', v_round_count,
    'match_count', v_match_count,
    'registration_closed_at', v_tournament.registration_closed_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.vacate_team_slot_in_current_season(
  p_tournament_id uuid,
  p_season_number integer,
  p_team_id uuid
)
RETURNS TABLE(slot_id uuid, former_assignment_id uuid, incomplete_match_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_season public.tournament_seasons%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_slot public.tournament_season_slots%ROWTYPE;
  v_assignment_id uuid;
  v_box_size integer;
  v_participant_count integer;
  v_home_count integer := 0;
  v_away_count integer := 0;
  v_match record;
  v_now timestamptz := now();
BEGIN
  PERFORM 1
  FROM public.tournaments
  WHERE id = p_tournament_id
    AND COALESCE(season, 1) = p_season_number
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament is not on the requested current season' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_season
  FROM public.tournament_seasons
  WHERE tournament_id = p_tournament_id
    AND season_number = p_season_number
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current tournament season was not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_team
  FROM public.teams
  WHERE id = p_team_id
    AND tournament_id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND OR v_team.is_placeholder THEN
    RAISE EXCEPTION 'Team is not a real team in this tournament' USING ERRCODE = '22023';
  END IF;
  IF NOT v_team.active OR COALESCE(v_team.reserve_active, false) THEN
    RAISE EXCEPTION 'Only an active participant can be removed from the scheduled season' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.matches m
  JOIN public.rounds r ON r.id = m.round_id
  WHERE r.tournament_id = p_tournament_id
    AND r.season_number = p_season_number
  FOR UPDATE OF m;

  -- Completed history is allowed to remain attached to the slot. Any other
  -- side that cannot be proven future and unstarted blocks the whole removal;
  -- otherwise the slot could be vacated while an actual match still owns it.
  IF EXISTS (
    SELECT 1
    FROM public.matches m
    JOIN public.rounds r ON r.id = m.round_id
    WHERE r.tournament_id = p_tournament_id
      AND r.season_number = p_season_number
      AND (
        (m.home_team_id = v_team.id AND m.completed IS DISTINCT FROM true)
        OR (m.away_team_id = v_team.id AND m.completed IS DISTINCT FROM true)
      )
      AND (
        m.status = 'ongoing'
        OR m.status = 'finished'
        OR m.finished_at IS NOT NULL
        OR m.home_goals IS NOT NULL
        OR m.away_goals IS NOT NULL
        OR m.match_event_details IS NOT NULL
        OR m.scheduled_for IS NULL
        OR m.scheduled_for <= v_now
        OR (m.ht_match_id IS NOT NULL AND m.scheduled_for IS NULL)
      )
  ) THEN
    RAISE EXCEPTION 'Team cannot be removed while an incomplete fixture may have started' USING ERRCODE = '55000';
  END IF;

  -- Older generated seasons may not have been backfilled into slots yet. Use
  -- the same deterministic ordering as the existing replacement RPC first.
  IF NOT EXISTS (
    SELECT 1
    FROM public.tournament_season_slots
    WHERE tournament_season_id = v_season.id
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM public.matches m
      JOIN public.rounds r ON r.id = m.round_id
      WHERE r.tournament_id = p_tournament_id
        AND r.season_number = p_season_number
        AND (m.home_slot_id IS NOT NULL OR m.away_slot_id IS NOT NULL)
    ) THEN
      RAISE EXCEPTION 'Fixture slot state is partially backfilled' USING ERRCODE = '22023';
    END IF;

    CREATE TEMP TABLE slot_backfill_team (
      team_id uuid PRIMARY KEY,
      first_round integer,
      first_side integer
    ) ON COMMIT DROP;

    INSERT INTO slot_backfill_team(team_id, first_round, first_side)
    SELECT team_id, min(round_number), min(side_order)
    FROM (
      SELECT m.home_team_id AS team_id, r.round_number, 1 AS side_order
      FROM public.matches m
      JOIN public.rounds r ON r.id = m.round_id
      WHERE r.tournament_id = p_tournament_id
        AND r.season_number = p_season_number
        AND m.home_team_id IS NOT NULL
      UNION ALL
      SELECT m.away_team_id, r.round_number, 2
      FROM public.matches m
      JOIN public.rounds r ON r.id = m.round_id
      WHERE r.tournament_id = p_tournament_id
        AND r.season_number = p_season_number
        AND m.away_team_id IS NOT NULL
    ) sides
    GROUP BY team_id;

    INSERT INTO slot_backfill_team(team_id, first_round, first_side)
    SELECT t.id, 2147483647, 3
    FROM public.teams t
    WHERE t.tournament_id = p_tournament_id
      AND t.active = true
      AND COALESCE(t.reserve_active, false) = false
      AND COALESCE(t.is_placeholder, false) = false
    ON CONFLICT (team_id) DO NOTHING;

    SELECT count(*) INTO v_participant_count FROM slot_backfill_team;
    IF v_participant_count < 2 OR v_participant_count > 12 THEN
      RAISE EXCEPTION 'Season is outside supported 2-12 team slot box' USING ERRCODE = '22023';
    END IF;
    v_box_size := v_participant_count + (v_participant_count % 2);

    INSERT INTO public.tournament_season_slots(tournament_season_id, slot_index, box_size, current_team_id)
    SELECT v_season.id, row_number() OVER (ORDER BY b.first_round, b.first_side, b.team_id), v_box_size, b.team_id
    FROM slot_backfill_team b;

    INSERT INTO public.tournament_season_slots(tournament_season_id, slot_index, box_size)
    SELECT v_season.id, n, v_box_size
    FROM generate_series(v_participant_count + 1, v_box_size) n;

    INSERT INTO public.tournament_season_slot_assignments(
      tournament_season_slot_id, team_id, reason, team_name, ht_team_id,
      manager_name, hattrick_user_id, logo_url
    )
    SELECT s.id, t.id, 'schedule_backfill', t.name, t.ht_team_id,
           t.manager_name, t.hattrick_user_id, t.logo_url
    FROM public.tournament_season_slots s
    JOIN public.teams t ON t.id = s.current_team_id
    WHERE s.tournament_season_id = v_season.id;

    FOR v_match IN
      SELECT m.id, m.home_team_id, m.away_team_id
      FROM public.matches m
      JOIN public.rounds r ON r.id = m.round_id
      WHERE r.tournament_id = p_tournament_id
        AND r.season_number = p_season_number
    LOOP
      UPDATE public.matches AS target_match
      SET home_slot_id = (
            SELECT s.id FROM public.tournament_season_slots s
            WHERE s.tournament_season_id = v_season.id
              AND s.current_team_id = v_match.home_team_id
          ),
          home_slot_assignment_id = (
            SELECT a.id
            FROM public.tournament_season_slot_assignments a
            JOIN public.tournament_season_slots s ON s.id = a.tournament_season_slot_id
            WHERE s.tournament_season_id = v_season.id
              AND s.current_team_id = v_match.home_team_id
              AND a.released_at IS NULL
          ),
          away_slot_id = (
            SELECT s.id FROM public.tournament_season_slots s
            WHERE s.tournament_season_id = v_season.id
              AND s.current_team_id = v_match.away_team_id
          ),
          away_slot_assignment_id = (
            SELECT a.id
            FROM public.tournament_season_slot_assignments a
            JOIN public.tournament_season_slots s ON s.id = a.tournament_season_slot_id
            WHERE s.tournament_season_id = v_season.id
              AND s.current_team_id = v_match.away_team_id
              AND a.released_at IS NULL
          )
      WHERE target_match.id = v_match.id;
    END LOOP;
  END IF;

  SELECT * INTO v_slot
  FROM public.tournament_season_slots
  WHERE tournament_season_id = v_season.id
    AND current_team_id = v_team.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team has no current-season slot' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_assignment_id
  FROM public.tournament_season_slot_assignments
  WHERE tournament_season_slot_id = v_slot.id
    AND released_at IS NULL
  FOR UPDATE;
  IF v_assignment_id IS NULL THEN
    RAISE EXCEPTION 'Target slot has no current assignment' USING ERRCODE = '22023';
  END IF;

  UPDATE public.tournament_season_slot_assignments
  SET released_at = now()
  WHERE id = v_assignment_id;

  UPDATE public.tournament_season_slots
  SET current_team_id = NULL,
      updated_at = now()
  WHERE id = v_slot.id;

  UPDATE public.teams
  SET active = false,
      reserve_active = false,
      reserve_joined_at = NULL,
      reapply_season_number = NULL
  WHERE id = v_team.id;

  UPDATE public.matches AS m
  SET home_team_id = NULL,
      home_slot_assignment_id = NULL
  FROM public.rounds AS r
  WHERE r.id = m.round_id
    AND r.tournament_id = p_tournament_id
    AND r.season_number = p_season_number
    AND m.home_slot_id = v_slot.id
    AND m.home_team_id = v_team.id
    AND m.completed IS DISTINCT FROM true
    AND m.status IS DISTINCT FROM 'ongoing'
    AND m.status IS DISTINCT FROM 'finished'
    AND m.finished_at IS NULL
    AND m.home_goals IS NULL
    AND m.away_goals IS NULL
    AND m.match_event_details IS NULL
    AND m.scheduled_for IS NOT NULL
    AND m.scheduled_for > v_now;
  GET DIAGNOSTICS v_home_count = ROW_COUNT;

  UPDATE public.matches AS m
  SET away_team_id = NULL,
      away_slot_assignment_id = NULL
  FROM public.rounds AS r
  WHERE r.id = m.round_id
    AND r.tournament_id = p_tournament_id
    AND r.season_number = p_season_number
    AND m.away_slot_id = v_slot.id
    AND m.away_team_id = v_team.id
    AND m.completed IS DISTINCT FROM true
    AND m.status IS DISTINCT FROM 'ongoing'
    AND m.status IS DISTINCT FROM 'finished'
    AND m.finished_at IS NULL
    AND m.home_goals IS NULL
    AND m.away_goals IS NULL
    AND m.match_event_details IS NULL
    AND m.scheduled_for IS NOT NULL
    AND m.scheduled_for > v_now;
  GET DIAGNOSTICS v_away_count = ROW_COUNT;

  UPDATE public.fixture_warnings AS fw
  SET active = false
  FROM public.rounds AS r
  WHERE fw.round_id = r.id
    AND fw.tournament_id = p_tournament_id
    AND fw.team_id = v_team.id
    AND r.tournament_id = p_tournament_id
    AND r.season_number = p_season_number;

  slot_id := v_slot.id;
  former_assignment_id := v_assignment_id;
  incomplete_match_count := v_home_count + v_away_count;
  RETURN NEXT;
END;
$$;

-- Fill a slot vacated by the scheduled-season removal action. The existing
-- replacement RPC remains unchanged for live slots; this wrapper preserves
-- that path and delegates only the vacant-slot case here.
CREATE OR REPLACE FUNCTION public.fill_vacant_team_slot_in_current_season(
  p_tournament_id uuid,
  p_season_number integer,
  p_former_team_id uuid,
  p_incoming_ht_team_id bigint
)
RETURNS TABLE(slot_id uuid, former_assignment_id uuid, incoming_assignment_id uuid, incomplete_match_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_season public.tournament_seasons%ROWTYPE;
  v_former public.teams%ROWTYPE;
  v_incoming public.teams%ROWTYPE;
  v_slot public.tournament_season_slots%ROWTYPE;
  v_former_assignment_id uuid;
  v_incoming_assignment_id uuid;
  v_conflict_count integer;
  v_home_count integer := 0;
  v_away_count integer := 0;
  v_now timestamptz := now();
BEGIN
  PERFORM 1
  FROM public.tournaments
  WHERE id = p_tournament_id
    AND COALESCE(season, 1) = p_season_number
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament is not on the requested current season' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_season
  FROM public.tournament_seasons
  WHERE tournament_id = p_tournament_id
    AND season_number = p_season_number
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current tournament season was not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_former
  FROM public.teams
  WHERE id = p_former_team_id
    AND tournament_id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND OR v_former.is_placeholder THEN
    RAISE EXCEPTION 'Outgoing team is not a real team in this tournament' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_incoming
  FROM public.teams
  WHERE tournament_id = p_tournament_id
    AND ht_team_id = p_incoming_ht_team_id
  FOR UPDATE;
  IF NOT FOUND OR v_incoming.is_placeholder THEN
    RAISE EXCEPTION 'Incoming known team row was not found in this tournament' USING ERRCODE = '22023';
  END IF;
  IF v_incoming.id = v_former.id THEN
    RAISE EXCEPTION 'A team cannot replace itself' USING ERRCODE = '22023';
  END IF;
  IF v_incoming.hattrick_user_id IS NULL OR v_incoming.oauth_token IS NULL OR v_incoming.oauth_token_secret IS NULL THEN
    RAISE EXCEPTION 'Incoming team has no reusable ownership credentials' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_conflict_count
  FROM public.teams AS other_team
  JOIN public.tournaments AS other_tournament ON other_tournament.id = other_team.tournament_id
  WHERE other_team.ht_team_id = p_incoming_ht_team_id
    AND other_team.id <> v_incoming.id
    AND other_team.active = true
    AND COALESCE(other_tournament.is_test, false) = false
    AND other_tournament.status IN ('open', 'waiting', 'active', 'paused');
  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'Incoming team is active in another blocking tournament' USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_slot
  FROM public.tournament_season_slots AS s
  WHERE s.tournament_season_id = v_season.id
    AND s.current_team_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.tournament_season_slot_assignments AS a
      WHERE a.tournament_season_slot_id = s.id
        AND a.team_id = v_former.id
        AND a.released_at IS NOT NULL
    )
  ORDER BY s.slot_index
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Outgoing team has no vacant current-season slot' USING ERRCODE = '22023';
  END IF;

  SELECT a.id INTO v_former_assignment_id
  FROM public.tournament_season_slot_assignments AS a
  WHERE a.tournament_season_slot_id = v_slot.id
    AND a.team_id = v_former.id
    AND a.released_at IS NOT NULL
  ORDER BY a.released_at DESC
  LIMIT 1
  FOR UPDATE;

  PERFORM 1
  FROM public.matches AS m
  JOIN public.rounds AS r ON r.id = m.round_id
  WHERE r.tournament_id = p_tournament_id
    AND r.season_number = p_season_number
  FOR UPDATE OF m;

  IF EXISTS (
    SELECT 1
    FROM public.matches AS m
    JOIN public.rounds AS r ON r.id = m.round_id
    WHERE r.tournament_id = p_tournament_id
      AND r.season_number = p_season_number
      AND (
        m.home_slot_id = v_slot.id
        OR m.away_slot_id = v_slot.id
      )
      AND m.completed IS DISTINCT FROM true
      AND (
        m.status IN ('ongoing', 'finished')
        OR m.finished_at IS NOT NULL
        OR m.home_goals IS NOT NULL
        OR m.away_goals IS NOT NULL
        OR m.match_event_details IS NOT NULL
        OR m.scheduled_for IS NULL
        OR m.scheduled_for <= v_now
      )
  ) THEN
    RAISE EXCEPTION 'Vacant slot cannot be filled while an incomplete fixture may have started' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tournament_season_slots
    WHERE tournament_season_id = v_season.id
      AND current_team_id = v_incoming.id
  ) THEN
    RAISE EXCEPTION 'Incoming team already occupies a current-season slot' USING ERRCODE = '23505';
  END IF;

  UPDATE public.tournament_season_slots
  SET current_team_id = v_incoming.id,
      updated_at = now()
  WHERE id = v_slot.id;

  INSERT INTO public.tournament_season_slot_assignments(
    tournament_season_slot_id, team_id, reason, team_name, ht_team_id,
    manager_name, hattrick_user_id, logo_url
  )
  VALUES (
    v_slot.id, v_incoming.id, 'admin_replace', v_incoming.name, v_incoming.ht_team_id,
    v_incoming.manager_name, v_incoming.hattrick_user_id, v_incoming.logo_url
  )
  RETURNING id INTO v_incoming_assignment_id;

  UPDATE public.teams
  SET active = false,
      reserve_active = false,
      reserve_joined_at = NULL,
      reapply_season_number = NULL
  WHERE id = v_former.id;

  UPDATE public.teams
  SET active = true,
      reserve_active = false,
      reserve_joined_at = NULL,
      reapply_season_number = NULL
  WHERE id = v_incoming.id;

  UPDATE public.matches AS m
  SET home_team_id = v_incoming.id,
      home_slot_assignment_id = v_incoming_assignment_id
  FROM public.rounds AS r
  WHERE r.id = m.round_id
    AND r.tournament_id = p_tournament_id
    AND r.season_number = p_season_number
    AND m.home_slot_id = v_slot.id
    AND m.completed = false
    AND m.status IS DISTINCT FROM 'ongoing'
    AND m.status IS DISTINCT FROM 'finished'
    AND m.finished_at IS NULL
    AND m.home_goals IS NULL
    AND m.away_goals IS NULL
    AND m.match_event_details IS NULL
    AND m.scheduled_for IS NOT NULL
    AND m.scheduled_for > v_now
    AND (m.home_team_id IS NULL OR m.home_team_id = v_former.id);
  GET DIAGNOSTICS v_home_count = ROW_COUNT;

  UPDATE public.matches AS m
  SET away_team_id = v_incoming.id,
      away_slot_assignment_id = v_incoming_assignment_id
  FROM public.rounds AS r
  WHERE r.id = m.round_id
    AND r.tournament_id = p_tournament_id
    AND r.season_number = p_season_number
    AND m.away_slot_id = v_slot.id
    AND m.completed = false
    AND m.status IS DISTINCT FROM 'ongoing'
    AND m.status IS DISTINCT FROM 'finished'
    AND m.finished_at IS NULL
    AND m.home_goals IS NULL
    AND m.away_goals IS NULL
    AND m.match_event_details IS NULL
    AND m.scheduled_for IS NOT NULL
    AND m.scheduled_for > v_now
    AND (m.away_team_id IS NULL OR m.away_team_id = v_former.id);
  GET DIAGNOSTICS v_away_count = ROW_COUNT;

  slot_id := v_slot.id;
  former_assignment_id := v_former_assignment_id;
  incoming_assignment_id := v_incoming_assignment_id;
  incomplete_match_count := v_home_count + v_away_count;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_or_fill_known_team_in_current_season(
  p_tournament_id uuid,
  p_season_number integer,
  p_former_team_id uuid,
  p_incoming_ht_team_id bigint
)
RETURNS TABLE(slot_id uuid, former_assignment_id uuid, incoming_assignment_id uuid, incomplete_match_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_season public.tournament_seasons%ROWTYPE;
  v_slot public.tournament_season_slots%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  PERFORM 1
  FROM public.tournaments
  WHERE id = p_tournament_id
    AND COALESCE(season, 1) = p_season_number
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament is not on the requested current season' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_season
  FROM public.tournament_seasons
  WHERE tournament_id = p_tournament_id
    AND season_number = p_season_number
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current tournament season was not found' USING ERRCODE = 'P0002';
  END IF;

  -- Keep the lock order shared with removal/fill/reset: tournament, season,
  -- outgoing team, then current-season fixtures.
  PERFORM 1
  FROM public.teams
  WHERE id = p_former_team_id
    AND tournament_id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Outgoing team is not a real team in this tournament' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.matches AS m
  JOIN public.rounds AS r ON r.id = m.round_id
  WHERE r.tournament_id = p_tournament_id
    AND r.season_number = p_season_number
  FOR UPDATE OF m;

  IF EXISTS (
    SELECT 1
    FROM public.tournament_season_slots
    WHERE tournament_season_id = v_season.id
      AND current_team_id = p_former_team_id
  ) THEN
    SELECT * INTO v_slot
    FROM public.tournament_season_slots
    WHERE tournament_season_id = v_season.id
      AND current_team_id = p_former_team_id
    FOR UPDATE;

    IF EXISTS (
      SELECT 1
      FROM public.matches AS m
      JOIN public.rounds AS r ON r.id = m.round_id
      WHERE r.tournament_id = p_tournament_id
        AND r.season_number = p_season_number
        AND (
          (m.home_slot_id = v_slot.id AND m.home_team_id = p_former_team_id)
          OR (m.away_slot_id = v_slot.id AND m.away_team_id = p_former_team_id)
        )
        AND m.completed IS DISTINCT FROM true
        AND (
          m.status IN ('ongoing', 'finished')
          OR m.finished_at IS NOT NULL
          OR m.home_goals IS NOT NULL
          OR m.away_goals IS NOT NULL
          OR m.match_event_details IS NOT NULL
          OR m.scheduled_for IS NULL
          OR m.scheduled_for <= v_now
        )
    ) THEN
      RAISE EXCEPTION 'Team cannot be replaced while an incomplete fixture may have started' USING ERRCODE = '55000';
    END IF;

    RETURN QUERY
    SELECT *
    FROM public.replace_known_team_in_current_season(
      p_tournament_id,
      p_season_number,
      p_former_team_id,
      p_incoming_ht_team_id
    );
  ELSE
    -- The historical replacement RPC can backfill slots for older generated
    -- seasons. Apply the same started-match guard before delegating to it.
    IF NOT EXISTS (
      SELECT 1
      FROM public.tournament_season_slots
      WHERE tournament_season_id = v_season.id
    )
      AND EXISTS (
        SELECT 1
        FROM public.matches AS m
        JOIN public.rounds AS r ON r.id = m.round_id
        WHERE r.tournament_id = p_tournament_id
          AND r.season_number = p_season_number
          AND (
            (m.home_team_id = p_former_team_id AND m.completed IS DISTINCT FROM true)
            OR (m.away_team_id = p_former_team_id AND m.completed IS DISTINCT FROM true)
          )
          AND (
            m.status IN ('ongoing', 'finished')
            OR m.finished_at IS NOT NULL
            OR m.home_goals IS NOT NULL
            OR m.away_goals IS NOT NULL
            OR m.match_event_details IS NOT NULL
            OR m.scheduled_for IS NULL
            OR m.scheduled_for <= v_now
          )
      ) THEN
      RAISE EXCEPTION 'Team cannot be replaced while an incomplete fixture may have started' USING ERRCODE = '55000';
    END IF;

    RETURN QUERY
    SELECT *
    FROM public.fill_vacant_team_slot_in_current_season(
      p_tournament_id,
      p_season_number,
      p_former_team_id,
      p_incoming_ht_team_id
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_current_season_to_planning(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vacate_team_slot_in_current_season(uuid, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fill_vacant_team_slot_in_current_season(uuid, integer, uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.replace_or_fill_known_team_in_current_season(uuid, integer, uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.replace_known_team_in_current_season(uuid, integer, uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_current_season_to_planning(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.vacate_team_slot_in_current_season(uuid, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fill_vacant_team_slot_in_current_season(uuid, integer, uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_or_fill_known_team_in_current_season(uuid, integer, uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_known_team_in_current_season(uuid, integer, uuid, bigint) TO service_role;

COMMIT;

-- applied!