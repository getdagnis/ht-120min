-- Keep a manager's chosen cutoff without rewriting an existing Hattrick booking.
-- The departure row remains as an opt-out marker until an explicit return to Waiting.
BEGIN;

CREATE FUNCTION public.complete_requested_tournament_departure(
  p_tournament_id uuid, p_season_number integer, p_after_round_id uuid, p_team_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_season_id uuid;
  v_slot_id uuid;
  v_assignment_id uuid;
  v_round_number integer;
  previous_write text:=current_setting('ht120.membership_write',true);
  previous_departure text:=current_setting('ht120.deferred_departure',true);
BEGIN
  PERFORM pg_advisory_xact_lock(120,113);
  PERFORM 1 FROM public.tournaments WHERE id=p_tournament_id AND COALESCE(season,1)=p_season_number FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tournament season changed'; END IF;
  SELECT round_number INTO v_round_number FROM public.rounds WHERE id=p_after_round_id
    AND tournament_id=p_tournament_id AND season_number=p_season_number FOR UPDATE;
  IF v_round_number IS NULL OR NOT EXISTS(SELECT 1 FROM public.tournament_team_departures
    WHERE team_id=p_team_id AND tournament_id=p_tournament_id AND season_number=p_season_number AND after_round_id=p_after_round_id)
  THEN RAISE EXCEPTION 'Departure request changed'; END IF;
  PERFORM 1 FROM public.teams WHERE id=p_team_id AND tournament_id=p_tournament_id AND active=true FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT id INTO v_season_id FROM public.tournament_seasons
    WHERE tournament_id=p_tournament_id AND season_number=p_season_number FOR UPDATE;
  SELECT id INTO v_slot_id FROM public.tournament_season_slots
    WHERE tournament_season_id=v_season_id AND current_team_id=p_team_id FOR UPDATE;
  IF v_slot_id IS NULL THEN RAISE EXCEPTION 'Departing team has no current-season slot'; END IF;
  SELECT id INTO v_assignment_id FROM public.tournament_season_slot_assignments
    WHERE tournament_season_slot_id=v_slot_id AND team_id=p_team_id AND released_at IS NULL FOR UPDATE;
  IF v_assignment_id IS NULL THEN RAISE EXCEPTION 'Departing team has no current assignment'; END IF;
  PERFORM 1 FROM public.matches m JOIN public.rounds r ON r.id=m.round_id
    WHERE r.tournament_id=p_tournament_id AND r.season_number=p_season_number
      AND p_team_id IN(m.home_team_id,m.away_team_id,m.reserve_team_id) FOR UPDATE OF m;

  PERFORM set_config('ht120.membership_write','true',true);
  PERFORM set_config('ht120.deferred_departure','true',true);
  UPDATE public.tournament_season_slot_assignments SET released_at=now() WHERE id=v_assignment_id;
  UPDATE public.tournament_season_slots SET current_team_id=NULL,updated_at=now() WHERE id=v_slot_id;
  UPDATE public.teams SET active=false,reserve_active=false,reserve_joined_at=NULL,reapply_season_number=NULL WHERE id=p_team_id;

  -- Only an untouched, future fixture may lose its team side. Any booking,
  -- started fixture, result or partial observation keeps its original IDs.
  UPDATE public.matches m SET home_team_id=NULL,home_slot_assignment_id=NULL
  FROM public.rounds r WHERE r.id=m.round_id AND r.tournament_id=p_tournament_id
    AND r.season_number=p_season_number AND r.round_number>v_round_number
    AND m.home_team_id=p_team_id AND m.completed IS DISTINCT FROM true
    AND m.ht_match_id IS NULL AND (m.status IS NULL OR m.status NOT IN ('arranged','ongoing','finished'))
    AND m.finished_at IS NULL AND m.home_goals IS NULL AND m.away_goals IS NULL
    AND m.match_event_details IS NULL AND m.scheduled_for>now();
  UPDATE public.matches m SET away_team_id=NULL,away_slot_assignment_id=NULL
  FROM public.rounds r WHERE r.id=m.round_id AND r.tournament_id=p_tournament_id
    AND r.season_number=p_season_number AND r.round_number>v_round_number
    AND m.away_team_id=p_team_id AND m.completed IS DISTINCT FROM true
    AND m.ht_match_id IS NULL AND (m.status IS NULL OR m.status NOT IN ('arranged','ongoing','finished'))
    AND m.finished_at IS NULL AND m.home_goals IS NULL AND m.away_goals IS NULL
    AND m.match_event_details IS NULL AND m.scheduled_for>now();
  DELETE FROM public.round_participants rp USING public.rounds r
    WHERE rp.round_id=r.id AND rp.team_id=p_team_id AND r.tournament_id=p_tournament_id
      AND r.season_number=p_season_number AND r.round_number>v_round_number
      AND NOT EXISTS(SELECT 1 FROM public.matches m WHERE m.round_id=r.id
        AND p_team_id IN(m.home_team_id,m.away_team_id,m.reserve_team_id));
  UPDATE public.fixture_warnings fw SET active=false FROM public.rounds r
    WHERE fw.round_id=r.id AND fw.team_id=p_team_id AND fw.tournament_id=p_tournament_id
      AND r.tournament_id=p_tournament_id AND r.season_number=p_season_number
      AND NOT EXISTS(SELECT 1 FROM public.matches m WHERE m.round_id=r.id
        AND p_team_id IN(m.home_team_id,m.away_team_id,m.reserve_team_id));
  PERFORM set_config('ht120.deferred_departure',COALESCE(previous_departure,'false'),true);
  PERFORM set_config('ht120.membership_write',COALESCE(previous_write,'false'),true);
END $$;
REVOKE ALL ON FUNCTION public.complete_requested_tournament_departure(uuid,integer,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_requested_tournament_departure(uuid,integer,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.clear_inactive_team_departure() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF current_setting('ht120.deferred_departure',true)='true' THEN RETURN NEW; END IF;
  DELETE FROM public.tournament_team_departures WHERE team_id=NEW.id;
  RETURN NEW;
END $$;
DROP TRIGGER clear_inactive_team_departure ON public.teams;
CREATE TRIGGER clear_inactive_team_departure
AFTER UPDATE OF active,reserve_active ON public.teams FOR EACH ROW
WHEN (NEW.active IS DISTINCT FROM true OR NEW.reserve_active IS TRUE
  OR (OLD.active IS DISTINCT FROM true AND NEW.active IS TRUE))
EXECUTE FUNCTION public.clear_inactive_team_departure();

CREATE OR REPLACE FUNCTION public.process_tournament_team_departures() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_team_id uuid;
BEGIN
  FOR v_team_id IN SELECT d.team_id FROM public.tournament_team_departures d
    WHERE d.after_round_id=NEW.id AND d.tournament_id=NEW.tournament_id
      AND d.season_number=NEW.season_number ORDER BY d.team_id FOR UPDATE LOOP
    BEGIN
      PERFORM public.complete_requested_tournament_departure(NEW.tournament_id,NEW.season_number,NEW.id,v_team_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Deferred tournament departure requires organizer review for team %: %',v_team_id,SQLERRM;
    END;
  END LOOP;
  RETURN NEW;
END $$;

DO $patch$
DECLARE definition text; old_text text; new_text text;
BEGIN
  definition:=pg_get_functiondef('public.get_waiting_admission_plan(uuid,integer,boolean)'::regprocedure);
  old_text:='      AND NOT EXISTS(SELECT 1 FROM public.matches m JOIN public.rounds r ON r.id=m.round_id
        WHERE r.tournament_id=t.id AND r.season_number=p_season_number AND r.round_number>current_round.round_number
          AND d.team_id IN(m.home_team_id,m.away_team_id,m.reserve_team_id)
          AND (m.ht_match_id IS NOT NULL OR m.status IN(''arranged'',''ongoing'',''finished'')
            OR m.finished_at IS NOT NULL OR m.home_goals IS NOT NULL OR m.away_goals IS NOT NULL OR m.match_event_details IS NOT NULL
            OR m.scheduled_for IS NULL OR m.scheduled_for<=now()))';
  IF strpos(definition,old_text)=0 THEN RAISE EXCEPTION 'Unexpected admission plan definition'; END IF;
  EXECUTE replace(definition,old_text,'');

  definition:=pg_get_functiondef('public.apply_length_round_transition_with_membership(uuid,integer,uuid,uuid,jsonb,uuid[],uuid[],text,uuid)'::regprocedure);
  old_text:='    PERFORM public.vacate_team_slot_in_current_season(p_tournament_id,p_season_number,v_team_id);
    DELETE FROM public.tournament_team_departures d WHERE d.team_id=v_team_id;';
  new_text:='    PERFORM public.complete_requested_tournament_departure(p_tournament_id,p_season_number,p_completed_round_id,v_team_id);';
  IF strpos(definition,old_text)=0 THEN RAISE EXCEPTION 'Unexpected membership transition definition'; END IF;
  EXECUTE replace(definition,old_text,new_text);

  definition:=pg_get_functiondef('public.save_verified_organizer_round(uuid,integer,text,jsonb,jsonb,jsonb,boolean,uuid,uuid,text,bigint)'::regprocedure);
  old_text:=' IF p_round_id IS NOT NULL THEN PERFORM 1 FROM public.matches WHERE round_id=p_round_id FOR UPDATE; END IF;';
  new_text:=' IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_matches) proposed
    JOIN public.tournament_team_departures d ON d.tournament_id=t.id AND d.season_number=p_season_number
      AND d.team_id IN((proposed->>''home_team_id'')::uuid,(proposed->>''away_team_id'')::uuid)
    WHERE NOT EXISTS(SELECT 1 FROM public.matches existing WHERE existing.round_id=p_round_id
      AND existing.home_team_id IS NOT DISTINCT FROM (proposed->>''home_team_id'')::uuid
      AND existing.away_team_id IS NOT DISTINCT FROM (proposed->>''away_team_id'')::uuid
      AND (existing.completed OR existing.ht_match_id IS NOT NULL OR existing.status IN(''arranged'',''ongoing'',''finished'')
        OR existing.finished_at IS NOT NULL OR existing.home_goals IS NOT NULL OR existing.away_goals IS NOT NULL
        OR existing.match_event_details IS NOT NULL OR existing.scheduled_for<=now())))
    THEN RAISE EXCEPTION ''A selected team has opted to leave; keep only its existing booked fixture''; END IF;
 IF p_round_id IS NOT NULL THEN PERFORM 1 FROM public.matches WHERE round_id=p_round_id FOR UPDATE; END IF;';
  IF strpos(definition,old_text)=0 THEN RAISE EXCEPTION 'Unexpected organizer save definition'; END IF;
  EXECUTE replace(definition,old_text,new_text);
END $patch$;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- applied!