BEGIN;

-- Follow-up to 20260918165441. The original function referenced the target
-- UPDATE alias from a JOIN ... ON clause, which PostgreSQL rejects at runtime.
CREATE OR REPLACE FUNCTION public.replace_known_team_in_current_season(
  p_tournament_id uuid,
  p_season_number integer,
  p_former_team_id uuid,
  p_incoming_ht_team_id bigint
)
RETURNS TABLE(slot_id uuid, former_assignment_id uuid, incoming_assignment_id uuid, incomplete_match_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_season public.tournament_seasons%ROWTYPE;
  v_former public.teams%ROWTYPE;
  v_incoming public.teams%ROWTYPE;
  v_slot public.tournament_season_slots%ROWTYPE;
  v_former_assignment_id uuid;
  v_incoming_assignment_id uuid;
  v_box_size integer;
  v_participant_count integer;
  v_home_count integer := 0;
  v_away_count integer := 0;
  v_conflict_count integer;
  v_match record;
BEGIN
  SELECT * INTO v_season FROM public.tournament_seasons
  WHERE tournament_id = p_tournament_id AND season_number = p_season_number FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current tournament season was not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.tournaments WHERE id = p_tournament_id AND COALESCE(season, 1) = p_season_number FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tournament is not on the requested current season' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_former FROM public.teams WHERE id = p_former_team_id AND tournament_id = p_tournament_id FOR UPDATE;
  IF NOT FOUND OR v_former.is_placeholder THEN RAISE EXCEPTION 'Outgoing team is not a real team in this tournament' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_incoming FROM public.teams WHERE tournament_id = p_tournament_id AND ht_team_id = p_incoming_ht_team_id FOR UPDATE;
  IF NOT FOUND OR v_incoming.is_placeholder THEN RAISE EXCEPTION 'Incoming known team row was not found in this tournament' USING ERRCODE = '22023'; END IF;
  IF v_incoming.id = v_former.id THEN RAISE EXCEPTION 'A team cannot replace itself' USING ERRCODE = '22023'; END IF;
  IF v_incoming.hattrick_user_id IS NULL OR v_incoming.oauth_token IS NULL OR v_incoming.oauth_token_secret IS NULL THEN
    RAISE EXCEPTION 'Incoming team has no reusable ownership credentials' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_conflict_count FROM public.teams other_team
  JOIN public.tournaments other_tournament ON other_tournament.id = other_team.tournament_id
  WHERE other_team.ht_team_id = p_incoming_ht_team_id AND other_team.id <> v_incoming.id
    AND other_team.active = true AND COALESCE(other_tournament.is_test, false) = false
    AND other_tournament.status IN ('open', 'waiting', 'active', 'paused');
  IF v_conflict_count > 0 THEN RAISE EXCEPTION 'Incoming team is active in another blocking tournament' USING ERRCODE = '23505'; END IF;

  PERFORM 1 FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
  WHERE r.tournament_id = p_tournament_id AND r.season_number = p_season_number FOR UPDATE OF m;

  IF NOT EXISTS (SELECT 1 FROM public.tournament_season_slots WHERE tournament_season_id = v_season.id) THEN
    IF EXISTS (SELECT 1 FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
      WHERE r.tournament_id = p_tournament_id AND r.season_number = p_season_number
        AND (m.home_slot_id IS NOT NULL OR m.away_slot_id IS NOT NULL)) THEN
      RAISE EXCEPTION 'Fixture slot state is partially backfilled' USING ERRCODE = '22023';
    END IF;
    CREATE TEMP TABLE slot_backfill_team (team_id uuid PRIMARY KEY, first_round integer, first_side integer) ON COMMIT DROP;
    INSERT INTO slot_backfill_team(team_id, first_round, first_side)
    SELECT team_id, min(round_number), min(side_order) FROM (
      SELECT m.home_team_id team_id, r.round_number, 1 side_order FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
      WHERE r.tournament_id = p_tournament_id AND r.season_number = p_season_number AND m.home_team_id IS NOT NULL
      UNION ALL
      SELECT m.away_team_id, r.round_number, 2 FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
      WHERE r.tournament_id = p_tournament_id AND r.season_number = p_season_number AND m.away_team_id IS NOT NULL
    ) sides GROUP BY team_id;
    INSERT INTO slot_backfill_team(team_id, first_round, first_side)
    SELECT t.id, 2147483647, 3 FROM public.teams t
    WHERE t.tournament_id = p_tournament_id AND t.active AND NOT COALESCE(t.is_placeholder, false)
    ON CONFLICT (team_id) DO NOTHING;
    SELECT count(*) INTO v_participant_count FROM slot_backfill_team;
    IF v_participant_count < 2 OR v_participant_count > 12 THEN RAISE EXCEPTION 'Season is outside supported 2-12 team slot box' USING ERRCODE = '22023'; END IF;
    v_box_size := v_participant_count + (v_participant_count % 2);
    INSERT INTO public.tournament_season_slots(tournament_season_id, slot_index, box_size, current_team_id)
    SELECT v_season.id, row_number() OVER (ORDER BY b.first_round, b.first_side, b.team_id), v_box_size, b.team_id FROM slot_backfill_team b;
    INSERT INTO public.tournament_season_slots(tournament_season_id, slot_index, box_size)
    SELECT v_season.id, n, v_box_size FROM generate_series(v_participant_count + 1, v_box_size) n;
    INSERT INTO public.tournament_season_slot_assignments(tournament_season_slot_id, team_id, reason, team_name, ht_team_id, manager_name, hattrick_user_id, logo_url)
    SELECT s.id, t.id, 'schedule_backfill', t.name, t.ht_team_id, t.manager_name, t.hattrick_user_id, t.logo_url
    FROM public.tournament_season_slots s JOIN public.teams t ON t.id = s.current_team_id WHERE s.tournament_season_id = v_season.id;
    FOR v_match IN
      SELECT m.id, m.home_team_id, m.away_team_id
      FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
      WHERE r.tournament_id = p_tournament_id AND r.season_number = p_season_number
    LOOP
      UPDATE public.matches m SET
        home_slot_id = (SELECT s.id FROM public.tournament_season_slots s WHERE s.tournament_season_id = v_season.id AND s.current_team_id = v_match.home_team_id),
        home_slot_assignment_id = (SELECT a.id FROM public.tournament_season_slot_assignments a WHERE a.tournament_season_slot_id = (SELECT s.id FROM public.tournament_season_slots s WHERE s.tournament_season_id = v_season.id AND s.current_team_id = v_match.home_team_id) AND a.released_at IS NULL),
        away_slot_id = (SELECT s.id FROM public.tournament_season_slots s WHERE s.tournament_season_id = v_season.id AND s.current_team_id = v_match.away_team_id),
        away_slot_assignment_id = (SELECT a.id FROM public.tournament_season_slot_assignments a WHERE a.tournament_season_slot_id = (SELECT s.id FROM public.tournament_season_slots s WHERE s.tournament_season_id = v_season.id AND s.current_team_id = v_match.away_team_id) AND a.released_at IS NULL)
      WHERE m.id = v_match.id;
    END LOOP;
  END IF;

  SELECT * INTO v_slot FROM public.tournament_season_slots WHERE tournament_season_id = v_season.id AND current_team_id = v_former.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Outgoing team has no current-season slot (already replaced or inconsistent)' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_season_slots WHERE tournament_season_id = v_season.id AND current_team_id = v_incoming.id) THEN RAISE EXCEPTION 'Incoming team already occupies a current-season slot' USING ERRCODE = '23505'; END IF;
  SELECT id INTO v_former_assignment_id FROM public.tournament_season_slot_assignments WHERE tournament_season_slot_id = v_slot.id AND released_at IS NULL FOR UPDATE;
  IF v_former_assignment_id IS NULL THEN RAISE EXCEPTION 'Target slot has no current assignment' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.matches m JOIN public.rounds r ON r.id = m.round_id WHERE r.tournament_id = p_tournament_id AND r.season_number = p_season_number AND ((m.home_team_id = v_former.id AND m.home_slot_id IS DISTINCT FROM v_slot.id) OR (m.away_team_id = v_former.id AND m.away_slot_id IS DISTINCT FROM v_slot.id))) THEN RAISE EXCEPTION 'Outgoing fixture position is inconsistent' USING ERRCODE = '22023'; END IF;

  UPDATE public.tournament_season_slot_assignments SET released_at = now() WHERE id = v_former_assignment_id;
  UPDATE public.tournament_season_slots SET current_team_id = v_incoming.id, updated_at = now() WHERE id = v_slot.id;
  INSERT INTO public.tournament_season_slot_assignments(tournament_season_slot_id, team_id, reason, team_name, ht_team_id, manager_name, hattrick_user_id, logo_url)
  VALUES (v_slot.id, v_incoming.id, 'admin_replace', v_incoming.name, v_incoming.ht_team_id, v_incoming.manager_name, v_incoming.hattrick_user_id, v_incoming.logo_url)
  RETURNING id INTO v_incoming_assignment_id;
  UPDATE public.teams SET active = false, reapply_season_number = NULL WHERE id = v_former.id;
  UPDATE public.teams SET active = true, reapply_season_number = NULL WHERE id = v_incoming.id;
  UPDATE public.matches m SET home_team_id = v_incoming.id, home_slot_assignment_id = v_incoming_assignment_id FROM public.rounds r WHERE r.id = m.round_id AND r.tournament_id = p_tournament_id AND r.season_number = p_season_number AND m.home_team_id = v_former.id AND m.home_slot_id = v_slot.id AND m.completed = false;
  GET DIAGNOSTICS v_home_count = ROW_COUNT;
  UPDATE public.matches m SET away_team_id = v_incoming.id, away_slot_assignment_id = v_incoming_assignment_id FROM public.rounds r WHERE r.id = m.round_id AND r.tournament_id = p_tournament_id AND r.season_number = p_season_number AND m.away_team_id = v_former.id AND m.away_slot_id = v_slot.id AND m.completed = false;
  GET DIAGNOSTICS v_away_count = ROW_COUNT;
  slot_id := v_slot.id; former_assignment_id := v_former_assignment_id; incoming_assignment_id := v_incoming_assignment_id; incomplete_match_count := v_home_count + v_away_count;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_known_team_in_current_season(uuid, integer, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_known_team_in_current_season(uuid, integer, uuid, bigint) TO service_role;
COMMIT;
