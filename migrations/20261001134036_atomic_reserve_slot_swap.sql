BEGIN;

-- Repair lifecycle rows from season-slot lineage rather than tournament or
-- team names. A current slot occupant is a participant; a reserve without a
-- current slot is not an active participant.
UPDATE public.teams t
SET active = true,
    reserve_active = false,
    reserve_joined_at = NULL
WHERE t.reserve_active = true
  AND EXISTS (
    SELECT 1
    FROM public.tournament_season_slots s
    JOIN public.tournament_seasons ts ON ts.id = s.tournament_season_id
    JOIN public.tournaments tr ON tr.id = ts.tournament_id
    WHERE s.current_team_id = t.id
      AND ts.tournament_id = t.tournament_id
      AND ts.season_number = COALESCE(tr.season, 1)
  );

UPDATE public.teams t
SET active = false
WHERE t.reserve_active = true
  AND t.active = true
  AND NOT EXISTS (
    SELECT 1
    FROM public.tournament_season_slots s
    JOIN public.tournament_seasons ts ON ts.id = s.tournament_season_id
    JOIN public.tournaments tr ON tr.id = ts.tournament_id
    WHERE s.current_team_id = t.id
      AND ts.tournament_id = t.tournament_id
      AND ts.season_number = COALESCE(tr.season, 1)
  );

-- Replace a current-season participant with an existing reserve without
-- rewriting any Hattrick match that has already been arranged or linked.
CREATE OR REPLACE FUNCTION public.swap_current_season_team_with_reserve(
  p_tournament_id uuid,
  p_season_number integer,
  p_former_team_id uuid,
  p_incoming_reserve_team_id uuid
)
RETURNS TABLE(slot_id uuid, former_assignment_id uuid, incoming_assignment_id uuid, updated_match_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_season public.tournament_seasons%ROWTYPE;
  v_slot public.tournament_season_slots%ROWTYPE;
  v_former public.teams%ROWTYPE;
  v_incoming public.teams%ROWTYPE;
  v_former_assignment_id uuid;
  v_incoming_assignment_id uuid;
  v_updated_match_count integer := 0;
BEGIN
  SELECT * INTO v_season
  FROM public.tournament_seasons
  WHERE tournament_id = p_tournament_id
    AND season_number = p_season_number
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current tournament season was not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.tournaments
  WHERE id = p_tournament_id
    AND COALESCE(season, 1) = p_season_number
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament is not on the requested current season' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_former
  FROM public.teams
  WHERE id = p_former_team_id
    AND tournament_id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND OR v_former.is_placeholder THEN
    RAISE EXCEPTION 'Outgoing team is not a real team in this tournament' USING ERRCODE = '22023';
  END IF;
  IF v_former.active IS DISTINCT FROM true OR v_former.reserve_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Outgoing team is not a current participant' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_incoming
  FROM public.teams
  WHERE id = p_incoming_reserve_team_id
    AND tournament_id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND OR v_incoming.is_placeholder THEN
    RAISE EXCEPTION 'Incoming team is not a real team in this tournament' USING ERRCODE = '22023';
  END IF;
  IF v_incoming.active IS DISTINCT FROM false OR v_incoming.reserve_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Incoming team is not an available reserve' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.tournament_season_slots
    WHERE tournament_season_id = v_season.id
      AND current_team_id = v_incoming.id
  ) THEN
    RAISE EXCEPTION 'Incoming reserve already occupies a current-season slot' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.teams other_team
    JOIN public.tournaments other_tournament ON other_tournament.id = other_team.tournament_id
    WHERE other_team.ht_team_id = v_incoming.ht_team_id
      AND other_team.id <> v_incoming.id
      AND other_team.active = true
      AND COALESCE(other_tournament.is_test, false) = false
      AND other_tournament.status IN ('open', 'waiting', 'active', 'paused')
  ) THEN
    RAISE EXCEPTION 'Incoming team is active in another blocking tournament' USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_slot
  FROM public.tournament_season_slots
  WHERE tournament_season_id = v_season.id
    AND current_team_id = v_former.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Outgoing team has no current-season slot' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_former_assignment_id
  FROM public.tournament_season_slot_assignments
  WHERE tournament_season_slot_id = v_slot.id
    AND team_id = v_former.id
    AND released_at IS NULL
  FOR UPDATE;
  IF v_former_assignment_id IS NULL THEN
    RAISE EXCEPTION 'Outgoing slot has no current assignment' USING ERRCODE = '22023';
  END IF;

  -- Lock and validate every fixture before changing any row. A single
  -- protected fixture aborts the complete swap, preventing partial state.
  PERFORM 1
  FROM public.matches m
  JOIN public.rounds r ON r.id = m.round_id
  WHERE r.tournament_id = p_tournament_id
    AND r.season_number = p_season_number
    AND (m.home_slot_id = v_slot.id OR m.away_slot_id = v_slot.id)
  FOR UPDATE OF m;

  IF EXISTS (
    SELECT 1
    FROM public.matches m
    JOIN public.rounds r ON r.id = m.round_id
    WHERE r.tournament_id = p_tournament_id
      AND r.season_number = p_season_number
      AND (m.home_slot_id = v_slot.id OR m.away_slot_id = v_slot.id)
      AND (
        m.completed IS DISTINCT FROM true
        OR m.ht_match_id IS NOT NULL
        OR COALESCE(m.status, 'not_arranged') NOT IN ('not_arranged', 'misarranged')
        OR m.finished_at IS NOT NULL
        OR m.home_goals IS NOT NULL
        OR m.away_goals IS NOT NULL
        OR m.match_event_details IS NOT NULL
        OR m.scheduled_for IS NULL
        OR m.scheduled_for <= now()
      )
  ) THEN
    RAISE EXCEPTION 'The reserve swap is blocked by a protected fixture' USING ERRCODE = '55000';
  END IF;

  UPDATE public.tournament_season_slot_assignments
  SET released_at = now()
  WHERE id = v_former_assignment_id;

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

  -- Lifecycle fields only. All incoming reserve metadata remains untouched.
  UPDATE public.teams
  SET active = false,
      reserve_active = true,
      reserve_joined_at = now()
  WHERE id = v_former.id;

  UPDATE public.teams
  SET active = true,
      reserve_active = false,
      reserve_joined_at = NULL
  WHERE id = v_incoming.id;

  UPDATE public.matches m
  SET home_team_id = CASE WHEN m.home_slot_id = v_slot.id THEN v_incoming.id ELSE m.home_team_id END,
      away_team_id = CASE WHEN m.away_slot_id = v_slot.id THEN v_incoming.id ELSE m.away_team_id END,
      home_slot_assignment_id = CASE WHEN m.home_slot_id = v_slot.id THEN v_incoming_assignment_id ELSE m.home_slot_assignment_id END,
      away_slot_assignment_id = CASE WHEN m.away_slot_id = v_slot.id THEN v_incoming_assignment_id ELSE m.away_slot_assignment_id END
  FROM public.rounds r
  WHERE r.id = m.round_id
    AND r.tournament_id = p_tournament_id
    AND r.season_number = p_season_number
    AND (m.home_slot_id = v_slot.id OR m.away_slot_id = v_slot.id)
    AND m.completed = false
    AND m.ht_match_id IS NULL
    AND COALESCE(m.status, 'not_arranged') IN ('not_arranged', 'misarranged')
    AND m.finished_at IS NULL
    AND m.home_goals IS NULL
    AND m.away_goals IS NULL
    AND m.match_event_details IS NULL
    AND m.scheduled_for IS NOT NULL
    AND m.scheduled_for > now();
  GET DIAGNOSTICS v_updated_match_count = ROW_COUNT;

  UPDATE public.fixture_warnings fw
  SET active = false
  FROM public.rounds r
  WHERE fw.round_id = r.id
    AND fw.tournament_id = p_tournament_id
    AND fw.team_id = v_former.id
    AND fw.active = true
    AND r.season_number = p_season_number;

  slot_id := v_slot.id;
  former_assignment_id := v_former_assignment_id;
  incoming_assignment_id := v_incoming_assignment_id;
  updated_match_count := v_updated_match_count;
  RETURN NEXT;
END;
$$;

-- Fill a vacant physical slot with a reserve. This is the reserve-only
-- counterpart used after a scheduled team has been removed.
CREATE OR REPLACE FUNCTION public.fill_vacant_current_season_slot_with_reserve(
  p_tournament_id uuid,
  p_season_number integer,
  p_incoming_reserve_team_id uuid
)
RETURNS TABLE(slot_id uuid, incoming_assignment_id uuid, updated_match_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_season public.tournament_seasons%ROWTYPE;
  v_slot public.tournament_season_slots%ROWTYPE;
  v_incoming public.teams%ROWTYPE;
  v_incoming_assignment_id uuid;
  v_updated_match_count integer := 0;
BEGIN
  SELECT * INTO v_season
  FROM public.tournament_seasons
  WHERE tournament_id = p_tournament_id
    AND season_number = p_season_number
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current tournament season was not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.tournaments
  WHERE id = p_tournament_id
    AND COALESCE(season, 1) = p_season_number
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament is not on the requested current season' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_incoming
  FROM public.teams
  WHERE id = p_incoming_reserve_team_id
    AND tournament_id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND OR v_incoming.is_placeholder THEN
    RAISE EXCEPTION 'Incoming team is not a real team in this tournament' USING ERRCODE = '22023';
  END IF;
  IF v_incoming.active IS DISTINCT FROM false OR v_incoming.reserve_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Incoming team is not an available reserve' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.tournament_season_slots
    WHERE tournament_season_id = v_season.id
      AND current_team_id = v_incoming.id
  ) THEN
    RAISE EXCEPTION 'Incoming reserve already occupies a current-season slot' USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_slot
  FROM public.tournament_season_slots s
  WHERE s.tournament_season_id = v_season.id
    AND s.current_team_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.tournament_season_slot_assignments a
      WHERE a.tournament_season_slot_id = s.id
        AND a.released_at IS NOT NULL
    )
  ORDER BY s.slot_index
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No vacant current-season slot is available' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.matches m
  JOIN public.rounds r ON r.id = m.round_id
  WHERE r.tournament_id = p_tournament_id
    AND r.season_number = p_season_number
    AND (m.home_slot_id = v_slot.id OR m.away_slot_id = v_slot.id)
  FOR UPDATE OF m;

  IF EXISTS (
    SELECT 1
    FROM public.matches m
    JOIN public.rounds r ON r.id = m.round_id
    WHERE r.tournament_id = p_tournament_id
      AND r.season_number = p_season_number
      AND (m.home_slot_id = v_slot.id OR m.away_slot_id = v_slot.id)
      AND (
        m.completed IS DISTINCT FROM true
        OR m.ht_match_id IS NOT NULL
        OR COALESCE(m.status, 'not_arranged') NOT IN ('not_arranged', 'misarranged')
        OR m.finished_at IS NOT NULL
        OR m.home_goals IS NOT NULL
        OR m.away_goals IS NOT NULL
        OR m.match_event_details IS NOT NULL
        OR m.scheduled_for IS NULL
        OR m.scheduled_for <= now()
      )
  ) THEN
    RAISE EXCEPTION 'The reserve fill is blocked by a protected fixture' USING ERRCODE = '55000';
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
  SET active = true,
      reserve_active = false,
      reserve_joined_at = NULL
  WHERE id = v_incoming.id;

  UPDATE public.matches m
  SET home_team_id = CASE WHEN m.home_slot_id = v_slot.id THEN v_incoming.id ELSE m.home_team_id END,
      away_team_id = CASE WHEN m.away_slot_id = v_slot.id THEN v_incoming.id ELSE m.away_team_id END,
      home_slot_assignment_id = CASE WHEN m.home_slot_id = v_slot.id THEN v_incoming_assignment_id ELSE m.home_slot_assignment_id END,
      away_slot_assignment_id = CASE WHEN m.away_slot_id = v_slot.id THEN v_incoming_assignment_id ELSE m.away_slot_assignment_id END
  FROM public.rounds r
  WHERE r.id = m.round_id
    AND r.tournament_id = p_tournament_id
    AND r.season_number = p_season_number
    AND (m.home_slot_id = v_slot.id OR m.away_slot_id = v_slot.id)
    AND m.completed = false
    AND m.ht_match_id IS NULL
    AND COALESCE(m.status, 'not_arranged') IN ('not_arranged', 'misarranged')
    AND m.finished_at IS NULL
    AND m.home_goals IS NULL
    AND m.away_goals IS NULL
    AND m.match_event_details IS NULL
    AND m.scheduled_for IS NOT NULL
    AND m.scheduled_for > now();
  GET DIAGNOSTICS v_updated_match_count = ROW_COUNT;

  slot_id := v_slot.id;
  incoming_assignment_id := v_incoming_assignment_id;
  updated_match_count := v_updated_match_count;
  RETURN NEXT;
END;
$$;

-- Move only a genuinely inactive, slotless row into the reserve list. Rows
-- with unresolved current-season fixtures remain protected from reclassification.
CREATE OR REPLACE FUNCTION public.move_inactive_team_to_reserve(
  p_tournament_id uuid,
  p_season_number integer,
  p_team_id uuid
)
RETURNS TABLE(team_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team public.teams%ROWTYPE;
BEGIN
  SELECT * INTO v_team
  FROM public.teams
  WHERE id = p_team_id
    AND tournament_id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND OR v_team.is_placeholder THEN
    RAISE EXCEPTION 'Team is not a real team in this tournament' USING ERRCODE = '22023';
  END IF;
  IF v_team.active IS DISTINCT FROM false OR v_team.reserve_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Only an inactive non-reserve team can be moved to reserves' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tournament_season_slots s
    JOIN public.tournament_seasons ts ON ts.id = s.tournament_season_id
    WHERE ts.tournament_id = p_tournament_id
      AND ts.season_number = p_season_number
      AND s.current_team_id = p_team_id
  ) THEN
    RAISE EXCEPTION 'Team still owns a current-season slot' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.matches m
    JOIN public.rounds r ON r.id = m.round_id
    WHERE r.tournament_id = p_tournament_id
      AND r.season_number = p_season_number
      AND (m.home_team_id = p_team_id OR m.away_team_id = p_team_id)
      AND m.completed IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'Team still has an unresolved current-season fixture' USING ERRCODE = '55000';
  END IF;

  UPDATE public.teams
  SET active = false,
      reserve_active = true,
      reserve_joined_at = now()
  WHERE id = p_team_id;

  team_id := p_team_id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.swap_current_season_team_with_reserve(uuid, integer, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fill_vacant_current_season_slot_with_reserve(uuid, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.move_inactive_team_to_reserve(uuid, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.swap_current_season_team_with_reserve(uuid, integer, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fill_vacant_current_season_slot_with_reserve(uuid, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.move_inactive_team_to_reserve(uuid, integer, uuid) TO service_role;

COMMIT;

-- applied!