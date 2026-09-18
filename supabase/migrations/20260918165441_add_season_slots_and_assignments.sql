BEGIN;

-- Peak-season compatibility only. A slot owns a current-season physical line;
-- teams remain the legacy identity/credential rows until off-season work.
CREATE TABLE public.tournament_season_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_season_id uuid NOT NULL REFERENCES public.tournament_seasons(id) ON DELETE CASCADE,
  slot_index integer NOT NULL CHECK (slot_index > 0),
  box_size integer NOT NULL CHECK (box_size > 0 AND mod(box_size, 2) = 0 AND slot_index <= box_size),
  current_team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_season_id, slot_index),
  UNIQUE (tournament_season_id, id)
);

CREATE UNIQUE INDEX uq_tournament_season_slots_current_team
  ON public.tournament_season_slots(tournament_season_id, current_team_id)
  WHERE current_team_id IS NOT NULL;

CREATE TABLE public.tournament_season_slot_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_season_slot_id uuid NOT NULL REFERENCES public.tournament_season_slots(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  reason text NOT NULL CHECK (reason IN ('schedule_backfill', 'admin_replace')),
  team_name text NOT NULL,
  ht_team_id bigint,
  manager_name text,
  hattrick_user_id bigint,
  logo_url text,
  CHECK (released_at IS NULL OR released_at >= assigned_at)
);

CREATE UNIQUE INDEX uq_tournament_season_slot_assignments_current
  ON public.tournament_season_slot_assignments(tournament_season_slot_id)
  WHERE released_at IS NULL;

CREATE INDEX idx_tournament_season_slot_assignments_team
  ON public.tournament_season_slot_assignments(team_id, assigned_at DESC);

ALTER TABLE public.matches
  ADD COLUMN home_slot_id uuid REFERENCES public.tournament_season_slots(id) ON DELETE SET NULL,
  ADD COLUMN away_slot_id uuid REFERENCES public.tournament_season_slots(id) ON DELETE SET NULL,
  ADD COLUMN home_slot_assignment_id uuid REFERENCES public.tournament_season_slot_assignments(id) ON DELETE SET NULL,
  ADD COLUMN away_slot_assignment_id uuid REFERENCES public.tournament_season_slot_assignments(id) ON DELETE SET NULL;

CREATE INDEX idx_matches_home_slot ON public.matches(home_slot_id) WHERE home_slot_id IS NOT NULL;
CREATE INDEX idx_matches_away_slot ON public.matches(away_slot_id) WHERE away_slot_id IS NOT NULL;

ALTER TABLE public.tournament_season_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_season_slot_assignments ENABLE ROW LEVEL SECURITY;

-- Public pages may read frozen fixture identity and current standings identity,
-- but only the security-definer operation may mutate either table.
CREATE POLICY "Public read season slots" ON public.tournament_season_slots FOR SELECT USING (true);
CREATE POLICY "Public read season slot assignments" ON public.tournament_season_slot_assignments FOR SELECT USING (true);

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

  -- Deterministic untouched-season backfill: first fixture appearance gives a
  -- stable order; active unreferenced rows and an odd-roster BYE retain slots.
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
    UPDATE public.matches m SET home_slot_id = hs.id, home_slot_assignment_id = ha.id, away_slot_id = aw.id, away_slot_assignment_id = aa.id
    FROM public.rounds r
    LEFT JOIN public.tournament_season_slots hs ON hs.tournament_season_id = v_season.id AND hs.current_team_id = m.home_team_id
    LEFT JOIN public.tournament_season_slot_assignments ha ON ha.tournament_season_slot_id = hs.id AND ha.released_at IS NULL
    LEFT JOIN public.tournament_season_slots aw ON aw.tournament_season_id = v_season.id AND aw.current_team_id = m.away_team_id
    LEFT JOIN public.tournament_season_slot_assignments aa ON aa.tournament_season_slot_id = aw.id AND aa.released_at IS NULL
    WHERE r.id = m.round_id AND r.tournament_id = p_tournament_id AND r.season_number = p_season_number;
  END IF;

  SELECT * INTO v_slot FROM public.tournament_season_slots
  WHERE tournament_season_id = v_season.id AND current_team_id = v_former.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Outgoing team has no current-season slot (already replaced or inconsistent)' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_season_slots WHERE tournament_season_id = v_season.id AND current_team_id = v_incoming.id) THEN
    RAISE EXCEPTION 'Incoming team already occupies a current-season slot' USING ERRCODE = '23505'; END IF;
  SELECT id INTO v_former_assignment_id FROM public.tournament_season_slot_assignments
  WHERE tournament_season_slot_id = v_slot.id AND released_at IS NULL FOR UPDATE;
  IF v_former_assignment_id IS NULL THEN RAISE EXCEPTION 'Target slot has no current assignment' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
    WHERE r.tournament_id = p_tournament_id AND r.season_number = p_season_number AND
      ((m.home_team_id = v_former.id AND m.home_slot_id IS DISTINCT FROM v_slot.id) OR (m.away_team_id = v_former.id AND m.away_slot_id IS DISTINCT FROM v_slot.id))) THEN
    RAISE EXCEPTION 'Outgoing fixture position is inconsistent' USING ERRCODE = '22023'; END IF;

  UPDATE public.tournament_season_slot_assignments SET released_at = now() WHERE id = v_former_assignment_id;
  UPDATE public.tournament_season_slots SET current_team_id = v_incoming.id, updated_at = now() WHERE id = v_slot.id;
  INSERT INTO public.tournament_season_slot_assignments(tournament_season_slot_id, team_id, reason, team_name, ht_team_id, manager_name, hattrick_user_id, logo_url)
  VALUES (v_slot.id, v_incoming.id, 'admin_replace', v_incoming.name, v_incoming.ht_team_id, v_incoming.manager_name, v_incoming.hattrick_user_id, v_incoming.logo_url)
  RETURNING id INTO v_incoming_assignment_id;
  UPDATE public.teams SET active = false, reapply_season_number = NULL WHERE id = v_former.id;
  UPDATE public.teams SET active = true, reapply_season_number = NULL WHERE id = v_incoming.id;
  UPDATE public.matches m SET home_team_id = v_incoming.id, home_slot_assignment_id = v_incoming_assignment_id FROM public.rounds r
  WHERE r.id = m.round_id AND r.tournament_id = p_tournament_id AND r.season_number = p_season_number AND m.home_team_id = v_former.id AND m.home_slot_id = v_slot.id AND m.completed = false;
  GET DIAGNOSTICS v_home_count = ROW_COUNT;
  UPDATE public.matches m SET away_team_id = v_incoming.id, away_slot_assignment_id = v_incoming_assignment_id FROM public.rounds r
  WHERE r.id = m.round_id AND r.tournament_id = p_tournament_id AND r.season_number = p_season_number AND m.away_team_id = v_former.id AND m.away_slot_id = v_slot.id AND m.completed = false;
  GET DIAGNOSTICS v_away_count = ROW_COUNT;
  slot_id := v_slot.id; former_assignment_id := v_former_assignment_id; incoming_assignment_id := v_incoming_assignment_id; incomplete_match_count := v_home_count + v_away_count;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_known_team_in_current_season(uuid, integer, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_known_team_in_current_season(uuid, integer, uuid, bigint) TO service_role;
COMMIT;
