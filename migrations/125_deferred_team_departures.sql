-- A manager can request to leave after the current materialized round. The
-- request stays private until it is processed; public roster reads are unchanged.
CREATE TABLE public.tournament_team_departures (
  team_id uuid PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  season_number integer NOT NULL CHECK (season_number > 0),
  after_round_id uuid NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tournament_team_departures_round_idx
  ON public.tournament_team_departures(after_round_id);

ALTER TABLE public.tournament_team_departures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tournament_team_departures FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_team_departures TO service_role;

CREATE FUNCTION public.set_tournament_team_departure(
  p_tournament_id uuid,
  p_team_id uuid,
  p_manager_id bigint,
  p_leave boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tournament public.tournaments%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_round public.rounds%ROWTYPE;
BEGIN
  SELECT * INTO v_tournament FROM public.tournaments
  WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tournament not found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_team FROM public.teams
  WHERE id = p_team_id AND tournament_id = p_tournament_id FOR UPDATE;
  IF NOT FOUND OR v_team.hattrick_user_id IS DISTINCT FROM p_manager_id THEN
    RAISE EXCEPTION 'Only this team manager can change its departure request' USING ERRCODE = '42501';
  END IF;
  IF v_team.active IS DISTINCT FROM true OR COALESCE(v_team.reserve_active, false)
    OR COALESCE(v_team.is_placeholder, false) THEN
    RAISE EXCEPTION 'This team is not a current participant' USING ERRCODE = '22023';
  END IF;

  IF NOT p_leave THEN
    DELETE FROM public.tournament_team_departures WHERE team_id = p_team_id;
    RETURN jsonb_build_object('checked', false);
  END IF;

  SELECT * INTO v_round FROM public.rounds
  WHERE tournament_id = p_tournament_id
    AND season_number = COALESCE(v_tournament.season, 1)
    AND phase_status = 'materialized'
  ORDER BY round_number LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no active round to finish before leaving' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tournament_season_slots s
    JOIN public.tournament_seasons ts ON ts.id = s.tournament_season_id
    WHERE ts.tournament_id = p_tournament_id
      AND ts.season_number = v_round.season_number
      AND s.current_team_id = p_team_id
  ) THEN
    RAISE EXCEPTION 'This team has no current-season slot' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.tournament_team_departures
    (team_id, tournament_id, season_number, after_round_id)
  VALUES (p_team_id, p_tournament_id, v_round.season_number, v_round.id)
  ON CONFLICT (team_id) DO UPDATE SET
    season_number = EXCLUDED.season_number,
    after_round_id = EXCLUDED.after_round_id,
    requested_at = now();
  RETURN jsonb_build_object('checked', true, 'after_round_id', v_round.id);
END;
$$;
REVOKE ALL ON FUNCTION public.set_tournament_team_departure(uuid,uuid,bigint,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_tournament_team_departure(uuid,uuid,bigint,boolean)
  TO service_role;

-- Runs after the round transition has written the next round's fixture rows.
-- The existing removal RPC keeps completed history and vacates future sides.
-- If a fixture cannot safely be vacated, keep the request visible for review
-- without rolling back the completed round.
CREATE FUNCTION public.process_tournament_team_departures() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_team_id uuid;
BEGIN
  FOR v_team_id IN
    SELECT d.team_id FROM public.tournament_team_departures d
    WHERE d.after_round_id = NEW.id
      AND d.tournament_id = NEW.tournament_id
      AND d.season_number = NEW.season_number
    ORDER BY d.team_id FOR UPDATE
  LOOP
    BEGIN
      IF EXISTS (
        SELECT 1 FROM public.matches m
        JOIN public.rounds r ON r.id = m.round_id
        WHERE r.tournament_id = NEW.tournament_id
          AND r.season_number = NEW.season_number
          AND r.round_number > NEW.round_number
          AND v_team_id IN (m.home_team_id, m.away_team_id)
          AND (m.ht_match_id IS NOT NULL OR m.status IN ('arranged', 'ongoing', 'finished')
            OR m.scheduled_for IS NULL OR m.scheduled_for <= now())
      ) THEN
        RAISE EXCEPTION 'A later fixture is already booked or started';
      END IF;
      PERFORM public.vacate_team_slot_in_current_season(
        NEW.tournament_id, NEW.season_number, v_team_id
      );
      DELETE FROM public.tournament_team_departures WHERE team_id = v_team_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Deferred tournament departure requires organizer review for team %: %',
        v_team_id, SQLERRM;
    END;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.process_tournament_team_departures()
  FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER process_tournament_team_departures
AFTER UPDATE OF phase_status ON public.rounds
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW.phase_status = 'completed' AND OLD.phase_status IS DISTINCT FROM NEW.phase_status)
EXECUTE FUNCTION public.process_tournament_team_departures();

CREATE FUNCTION public.clear_inactive_team_departure() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM public.tournament_team_departures WHERE team_id = NEW.id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.clear_inactive_team_departure()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER clear_inactive_team_departure
AFTER UPDATE OF active, reserve_active ON public.teams
FOR EACH ROW
WHEN (NEW.active IS DISTINCT FROM true OR NEW.reserve_active IS TRUE)
EXECUTE FUNCTION public.clear_inactive_team_departure();

-- applied!
