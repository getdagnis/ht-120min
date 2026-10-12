-- Planning is a non-exclusive waiting list. Recruiting publishes and commits it.
-- Apply only after reviewing docs/tournament-lifecycle-preflight.sql.
BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.tournaments t JOIN public.rounds r ON r.tournament_id=t.id
    AND COALESCE(r.season_number,1)=COALESCE(t.season,1)
    WHERE t.status IN ('open','waiting') AND NOT COALESCE(t.is_test,false)
      AND t.registration_type IS DISTINCT FROM 'sandbox') THEN
    RAISE EXCEPTION 'Preflight required: an open/waiting real tournament already has current-season rounds';
  END IF;
END $$;

CREATE FUNCTION public.tournament_is_exclusive(p_status text, p_test boolean, p_registration text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT NOT COALESCE(p_test,false) AND p_registration IS DISTINCT FROM 'sandbox'
    AND COALESCE(p_status,'') NOT IN ('planning','finished','stopped','archived');
$$;

-- A statement lock precedes row locks, including direct legacy enrollment and
-- slot RPCs. Short roster/status transactions share one lock order. Metadata-only
-- refreshes do not take this lock. No persistent lock rows or extra API calls.
CREATE FUNCTION public.lock_tournament_membership() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(120,113);
  RETURN NULL;
END $$;
CREATE TRIGGER serialize_team_membership
BEFORE DELETE OR INSERT OR UPDATE OF active,reserve_active,ht_team_id,tournament_id,reapply_season_number
ON public.teams FOR EACH STATEMENT EXECUTE FUNCTION public.lock_tournament_membership();
CREATE TRIGGER serialize_tournament_commitment
BEFORE UPDATE OF status ON public.tournaments
FOR EACH STATEMENT EXECUTE FUNCTION public.lock_tournament_membership();

CREATE FUNCTION public.enforce_tournament_membership() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target public.tournaments%ROWTYPE; conflict_name text;
BEGIN
  IF NOT COALESCE(NEW.active,false) OR COALESCE(NEW.reserve_active,false)
    OR COALESCE(NEW.is_placeholder,false) OR NEW.ht_team_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.active IS NOT DISTINCT FROM NEW.active
    AND OLD.reserve_active IS NOT DISTINCT FROM NEW.reserve_active
    AND OLD.ht_team_id IS NOT DISTINCT FROM NEW.ht_team_id
    AND OLD.tournament_id IS NOT DISTINCT FROM NEW.tournament_id THEN RETURN NEW; END IF;
  SELECT * INTO target FROM public.tournaments WHERE id=NEW.tournament_id;
  IF COALESCE(target.is_test,false) OR target.registration_type='sandbox' THEN RETURN NEW; END IF;
  SELECT t.name INTO conflict_name FROM public.teams tm JOIN public.tournaments t ON t.id=tm.tournament_id
    WHERE tm.ht_team_id=NEW.ht_team_id AND tm.tournament_id<>NEW.tournament_id
      AND tm.active AND NOT COALESCE(tm.reserve_active,false)
      AND public.tournament_is_exclusive(t.status,t.is_test,t.registration_type) LIMIT 1;
  IF conflict_name IS NOT NULL AND current_setting('ht120.membership_bypass',true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'This team is already committed to tournament "%"',conflict_name USING ERRCODE='23505';
  END IF;
  IF target.max_teams > 0 AND (SELECT count(*) FROM public.teams tm WHERE tm.tournament_id=NEW.tournament_id
    AND tm.active AND NOT COALESCE(tm.reserve_active,false) AND tm.id<>NEW.id) >= target.max_teams THEN
    RAISE EXCEPTION 'This tournament is full' USING ERRCODE='23505'; END IF;
  IF public.tournament_is_exclusive(target.status,target.is_test,target.registration_type) THEN
    UPDATE public.teams tm SET active=false,reapply_season_number=NULL
      FROM public.tournaments t WHERE t.id=tm.tournament_id AND t.status='planning'
      AND tm.tournament_id<>NEW.tournament_id AND tm.ht_team_id=NEW.ht_team_id
      AND (tm.active OR tm.reapply_season_number IS NOT NULL)
      AND NOT COALESCE(t.is_test,false) AND t.registration_type IS DISTINCT FROM 'sandbox';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER enforce_team_commitment
BEFORE INSERT OR UPDATE OF active,reserve_active,ht_team_id,tournament_id
ON public.teams FOR EACH ROW EXECUTE FUNCTION public.enforce_tournament_membership();

CREATE FUNCTION public.enforce_tournament_commitment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE(NEW.is_test,false) OR NEW.registration_type='sandbox' THEN RETURN NEW; END IF;
  IF NEW.status IN ('open','waiting') THEN NEW.status := 'planning'; END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status='planning' AND EXISTS (SELECT 1 FROM public.rounds r WHERE r.tournament_id=NEW.id
      AND r.season_number=COALESCE(NEW.season,1)) THEN
    RAISE EXCEPTION 'Return to planning through the current-season reset action' USING ERRCODE='55000';
  END IF;
  IF OLD.status='planning' AND NEW.status='active' THEN
    RAISE EXCEPTION 'Publish the tournament before generating a schedule' USING ERRCODE='55000';
  END IF;
  IF public.tournament_is_exclusive(NEW.status,NEW.is_test,NEW.registration_type) THEN
    -- Publication drops stale conflicting registrations; never edits the other
    -- committed tournament or its fixtures. Auto-start uses the same boundary.
    UPDATE public.teams tm SET active=false,reapply_season_number=NULL
      WHERE tm.tournament_id=NEW.id AND tm.active AND NOT COALESCE(tm.reserve_active,false)
      AND EXISTS (SELECT 1 FROM public.teams other_tm JOIN public.tournaments t ON t.id=other_tm.tournament_id
        WHERE other_tm.ht_team_id=tm.ht_team_id AND other_tm.tournament_id<>NEW.id
          AND other_tm.active AND NOT COALESCE(other_tm.reserve_active,false)
          AND public.tournament_is_exclusive(t.status,t.is_test,t.registration_type));
    UPDATE public.teams tm SET active=false,reapply_season_number=NULL FROM public.tournaments t
      WHERE t.id=tm.tournament_id AND t.status='planning' AND t.id<>NEW.id
      AND NOT COALESCE(t.is_test,false) AND t.registration_type IS DISTINCT FROM 'sandbox'
      AND (tm.active OR tm.reapply_season_number IS NOT NULL)
      AND EXISTS (SELECT 1 FROM public.teams committed WHERE committed.tournament_id=NEW.id
        AND committed.active AND NOT COALESCE(committed.reserve_active,false)
        AND NOT COALESCE(committed.is_placeholder,false) AND committed.ht_team_id=tm.ht_team_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER enforce_tournament_commitment
BEFORE UPDATE OF status ON public.tournaments FOR EACH ROW EXECUTE FUNCTION public.enforce_tournament_commitment();

CREATE TRIGGER serialize_round_creation BEFORE INSERT ON public.rounds
FOR EACH STATEMENT EXECUTE FUNCTION public.lock_tournament_membership();
CREATE FUNCTION public.require_published_schedule() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id=NEW.tournament_id AND t.status='planning'
    AND NOT COALESCE(t.is_test,false) AND t.registration_type IS DISTINCT FROM 'sandbox') THEN
    RAISE EXCEPTION 'Publish the tournament before generating a schedule' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER require_published_schedule BEFORE INSERT ON public.rounds
FOR EACH ROW EXECUTE FUNCTION public.require_published_schedule();
REVOKE ALL ON FUNCTION public.require_published_schedule() FROM PUBLIC,anon,authenticated;

CREATE TRIGGER serialize_tournament_removal BEFORE DELETE ON public.tournaments
FOR EACH STATEMENT EXECUTE FUNCTION public.lock_tournament_membership();

-- Backfill only real, ungenerated rosters. Tests retain their legacy states.
UPDATE public.tournaments SET status='planning'
WHERE status IN ('open','waiting') AND NOT COALESCE(is_test,false) AND registration_type IS DISTINCT FROM 'sandbox';
UPDATE public.teams tm SET active=false,reapply_season_number=NULL FROM public.tournaments target
WHERE target.id=tm.tournament_id AND target.status='planning' AND NOT COALESCE(target.is_test,false)
  AND target.registration_type IS DISTINCT FROM 'sandbox'
  AND (tm.active OR tm.reapply_season_number IS NOT NULL)
  AND EXISTS (SELECT 1 FROM public.teams other_tm JOIN public.tournaments t ON t.id=other_tm.tournament_id
    WHERE other_tm.ht_team_id=tm.ht_team_id AND other_tm.tournament_id<>tm.tournament_id
      AND other_tm.active AND NOT COALESCE(other_tm.reserve_active,false)
      AND public.tournament_is_exclusive(t.status,t.is_test,t.registration_type));
ALTER TABLE public.tournaments ALTER COLUMN status SET DEFAULT 'planning';
CREATE FUNCTION public.initialize_tournament_lifecycle() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT COALESCE(NEW.is_test,false) AND NEW.registration_type IS DISTINCT FROM 'sandbox' THEN
    NEW.status := 'planning';
  ELSIF NEW.status='planning' OR NEW.status IS NULL THEN
    NEW.status := 'open';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER initialize_tournament_lifecycle BEFORE INSERT ON public.tournaments
FOR EACH ROW EXECUTE FUNCTION public.initialize_tournament_lifecycle();
REVOKE ALL ON FUNCTION public.initialize_tournament_lifecycle() FROM PUBLIC,anon,authenticated;

DO $$
DECLARE definition text;
BEGIN
  definition := pg_get_functiondef('public.reset_current_season_to_planning(uuid,integer)'::regprocedure);
  IF strpos(definition,'OR m.finished_at IS NOT NULL')=0
    OR strpos(definition,'OR m.home_goals IS NOT NULL')=0
    OR strpos(definition,'OR m.away_goals IS NOT NULL')=0
    OR strpos(definition,'OR (m.scheduled_for IS NOT NULL AND m.scheduled_for <= v_now)')=0
    OR strpos(definition,'Only an ongoing season can be reset to planning')=0 THEN
    RAISE EXCEPTION 'Current-season reset guard changed; inspect before applying';
  END IF;
END $$;

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
  PERFORM pg_catalog.pg_advisory_xact_lock(120,113);
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
  IF v_season.status NOT IN ('planned','ongoing') THEN
    RAISE EXCEPTION 'Only the current unfinished season can return to planning' USING ERRCODE = '22023';
  END IF;

  -- Serialize the safety check with fixture refresh/result writes. If a
  -- refresh commits an ongoing/finished state first, this transaction sees it
  -- and rejects; if reset wins first, the refresh finds no current fixtures.
  PERFORM 1
  FROM public.matches m
  JOIN public.rounds r ON r.id = m.round_id
  WHERE r.tournament_id = p_tournament_id
    AND COALESCE(r.season_number,1) = p_season_number
  FOR UPDATE OF m;

  IF EXISTS (
    SELECT 1
    FROM public.matches m
    JOIN public.rounds r ON r.id = m.round_id
    WHERE r.tournament_id = p_tournament_id
      AND COALESCE(r.season_number,1) = p_season_number
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
    AND COALESCE(r.season_number,1) = p_season_number;

  SELECT count(*) INTO v_round_count
  FROM public.rounds
  WHERE tournament_id = p_tournament_id
    AND COALESCE(season_number,1) = p_season_number;

  -- Delete fixtures before slot rows because matches retain slot references.
  DELETE FROM public.matches m
  USING public.rounds r
  WHERE r.id = m.round_id
    AND r.tournament_id = p_tournament_id
    AND COALESCE(r.season_number,1) = p_season_number;

  DELETE FROM public.tournament_season_slot_assignments a
  USING public.tournament_season_slots s
  WHERE s.id = a.tournament_season_slot_id
    AND s.tournament_season_id = v_season.id;

  DELETE FROM public.tournament_season_slots
  WHERE tournament_season_id = v_season.id;

  DELETE FROM public.rounds
  WHERE tournament_id = p_tournament_id
    AND COALESCE(season_number,1) = p_season_number;

  v_next_tournament_status := CASE
    WHEN COALESCE(v_tournament.is_test,false) OR v_tournament.registration_type='sandbox' THEN
      CASE WHEN v_tournament.registration_closed_at IS NULL THEN 'open' ELSE 'active' END
    ELSE 'planning' END;

  UPDATE public.tournament_seasons
  SET status = 'planned',
      started_at = NULL,
      finished_at = NULL,
      snapshot_json = NULL,
      fixtures_snapshot_json = NULL,
      planned_start_slot = CASE WHEN v_next_tournament_status='planning' THEN NULL ELSE v_tournament.schedule_start_slot END,
      schedule_plan_json = NULL, ranking_snapshot_json = NULL,
      champion_slot_id = NULL, champion_team_id = NULL, champion_decided_at = NULL,
      updated_at = now()
  WHERE id = v_season.id;

  -- Real planning returns to an open, uncommitted roster. Test resets retain
  -- their existing registration behavior.
  UPDATE public.tournaments
  SET status = v_next_tournament_status,
      schedule_locked_at = NULL,
      schedule_generated_at = NULL,
      schedule_start_slot = CASE WHEN v_next_tournament_status='planning' THEN NULL ELSE schedule_start_slot END,
      registration_closed_at = CASE WHEN v_next_tournament_status='planning' THEN NULL ELSE registration_closed_at END
  WHERE id = p_tournament_id;

  RETURN jsonb_build_object(
    'season_number', p_season_number,
    'tournament_status', v_next_tournament_status,
    'round_count', v_round_count,
    'match_count', v_match_count,
    'registration_closed_at', CASE WHEN v_next_tournament_status='planning' THEN NULL ELSE v_tournament.registration_closed_at END
  );
END;
$$;


CREATE FUNCTION public.transition_tournament_publication(p_tournament_id uuid,p_season_number integer,p_target text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target public.tournaments%ROWTYPE; dropped jsonb; affected jsonb; reset_result jsonb;
BEGIN
  IF p_target NOT IN ('planning','recruiting') THEN RAISE EXCEPTION 'Invalid tournament state' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(120,113);
  SELECT * INTO target FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(target.season,1)<>p_season_number THEN RAISE EXCEPTION 'The current season changed' USING ERRCODE='22023'; END IF;
  IF COALESCE(target.is_test,false) OR target.registration_type='sandbox' OR target.is_archived
    OR target.status IN ('finished','stopped','archived') THEN RAISE EXCEPTION 'This tournament cannot change publication state' USING ERRCODE='22023'; END IF;
  IF target.status=p_target THEN RETURN jsonb_build_object('status',p_target,'dropped_teams','[]'::jsonb,'tournament_ids',jsonb_build_array(p_tournament_id)); END IF;
  IF p_target='recruiting' AND target.status<>'planning' THEN RAISE EXCEPTION 'Only a planning tournament can be published' USING ERRCODE='22023'; END IF;
  IF p_target='planning' THEN
    -- A season row is optional before any schedule is created.
    IF EXISTS (SELECT 1 FROM public.tournament_seasons WHERE tournament_id=p_tournament_id AND season_number=p_season_number) THEN
      reset_result := public.reset_current_season_to_planning(p_tournament_id,p_season_number);
    ELSE
      IF EXISTS (SELECT 1 FROM public.rounds WHERE tournament_id=p_tournament_id AND season_number=p_season_number) THEN
        RAISE EXCEPTION 'Current-season record is missing' USING ERRCODE='55000'; END IF;
      UPDATE public.tournaments SET status='planning',schedule_start_slot=NULL,schedule_locked_at=NULL,
        schedule_generated_at=NULL,registration_closed_at=NULL WHERE id=p_tournament_id;
    END IF;
    RETURN jsonb_build_object('status','planning','dropped_teams','[]'::jsonb,'tournament_ids',jsonb_build_array(p_tournament_id),'reset',reset_result);
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',tm.id,'name',tm.name,'ht_team_id',tm.ht_team_id)),'[]'::jsonb)
    INTO dropped FROM public.teams tm WHERE tm.tournament_id=p_tournament_id AND tm.active AND NOT COALESCE(tm.reserve_active,false)
    AND EXISTS (SELECT 1 FROM public.teams other_tm JOIN public.tournaments t ON t.id=other_tm.tournament_id
      WHERE other_tm.ht_team_id=tm.ht_team_id AND other_tm.tournament_id<>p_tournament_id AND other_tm.active
        AND NOT COALESCE(other_tm.reserve_active,false) AND public.tournament_is_exclusive(t.status,t.is_test,t.registration_type));
  SELECT COALESCE(jsonb_agg(DISTINCT tm.tournament_id),'[]'::jsonb) INTO affected
    FROM public.teams tm JOIN public.tournaments t ON t.id=tm.tournament_id
    WHERE t.status='planning' AND EXISTS (SELECT 1 FROM public.teams roster WHERE roster.tournament_id=p_tournament_id AND roster.active
      AND NOT COALESCE(roster.reserve_active,false) AND roster.ht_team_id=tm.ht_team_id);
  UPDATE public.tournaments SET status='recruiting',registration_closed_at=NULL WHERE id=p_tournament_id;
  RETURN jsonb_build_object('status','recruiting','dropped_teams',dropped,'tournament_ids',affected || jsonb_build_array(p_tournament_id));
END $$;

-- Service-only enrollment write preserves the existing verified administrator
-- exception. The bypass setting cannot be supplied through browser PostgREST.
CREATE FUNCTION public.save_verified_tournament_registration(p_values jsonb,p_existing_id uuid DEFAULT NULL,p_skip_membership boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE saved_id uuid; field_list text; value_list text; update_list text; target public.tournaments%ROWTYPE; existing public.teams%ROWTYPE;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(120,113);
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_values) AS keys(k) WHERE k NOT IN
    ('tournament_id','ht_team_id','name','ht_team_name','manager_name','hattrick_user_id','country_id','country_name',
    'league_id','gender_id','league_level','team_rank','power_rating','power_global_rank','power_league_rank','power_region_rank',
    'logo_url','oauth_token','oauth_token_secret','joined_via_oauth','active','reserve_active','reserve_joined_at',
    'reapply_season_number','replacement_for_team_id','join_story')) THEN
    RAISE EXCEPTION 'Invalid registration fields' USING ERRCODE='22023'; END IF;
  IF p_existing_id IS NOT NULL THEN
    SELECT * INTO existing FROM public.teams WHERE id=p_existing_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Registration changed; refresh and try again' USING ERRCODE='40001'; END IF;
    IF p_values ? 'tournament_id' AND (p_values->>'tournament_id')::uuid<>existing.tournament_id THEN
      RAISE EXCEPTION 'Registration tournament changed' USING ERRCODE='22023'; END IF;
  END IF;
  SELECT * INTO target FROM public.tournaments WHERE id=COALESCE(existing.tournament_id,(p_values->>'tournament_id')::uuid) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tournament not found' USING ERRCODE='P0002'; END IF;
  IF NOT COALESCE(target.is_test,false) AND target.registration_type IS DISTINCT FROM 'sandbox'
    AND NOT COALESCE(existing.active,false)
    AND (target.registration_closed_at IS NOT NULL OR target.status IN ('stopped','finished','archived')) THEN
    RAISE EXCEPTION 'Tournament registration is closed' USING ERRCODE='55000'; END IF;
  PERFORM set_config('ht120.membership_bypass',CASE WHEN p_skip_membership THEN 'true' ELSE 'false' END,true);
  SELECT string_agg(format('%I',k),','),string_agg(format('r.%I',k),','),string_agg(format('%I=r.%I',k,k),',')
    INTO field_list,value_list,update_list FROM jsonb_object_keys(p_values) AS keys(k);
  IF p_existing_id IS NULL THEN
    EXECUTE format('INSERT INTO public.teams (%s) SELECT %s FROM jsonb_populate_record(NULL::public.teams,$1) r RETURNING id',field_list,value_list)
      INTO saved_id USING p_values;
  ELSE
    EXECUTE format('UPDATE public.teams t SET %s FROM jsonb_populate_record(NULL::public.teams,$1) r WHERE t.id=$2 RETURNING t.id',update_list)
      INTO saved_id USING p_values,p_existing_id;
  END IF;
  PERFORM set_config('ht120.membership_bypass','false',true);
  RETURN saved_id;
END $$;
REVOKE ALL ON FUNCTION public.save_verified_tournament_registration(jsonb,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_verified_tournament_registration(jsonb,uuid,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.transition_tournament_publication(uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.transition_tournament_publication(uuid,integer,text) TO service_role;
REVOKE ALL ON FUNCTION public.reset_current_season_to_planning(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reset_current_season_to_planning(uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION public.lock_tournament_membership(),public.enforce_tournament_membership(),public.enforce_tournament_commitment() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.register_creation_roster(p_tournament_id uuid,p_rows jsonb,p_skip_membership boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE item jsonb;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(120,113);
  IF EXISTS (SELECT 1 FROM public.teams WHERE tournament_id=p_tournament_id) THEN
    RAISE EXCEPTION 'The creation roster has already been registered' USING ERRCODE='40001'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF item->>'tournament_id' IS DISTINCT FROM p_tournament_id::text THEN
      RAISE EXCEPTION 'Invalid tournament roster' USING ERRCODE='22023'; END IF;
    PERFORM public.save_verified_tournament_registration(item,NULL,p_skip_membership);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.register_creation_roster(uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_creation_roster(uuid,jsonb,boolean) TO service_role;

CREATE FUNCTION public.planning_membership_tournament_ids(p_tournament_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(DISTINCT tm.tournament_id),'[]'::jsonb)
  FROM public.teams tm JOIN public.tournaments t ON t.id=tm.tournament_id
  WHERE t.status='planning' AND NOT COALESCE(t.is_test,false) AND tm.tournament_id<>p_tournament_id
    AND EXISTS (SELECT 1 FROM public.teams roster WHERE roster.tournament_id=p_tournament_id AND roster.ht_team_id=tm.ht_team_id);
$$;
REVOKE ALL ON FUNCTION public.planning_membership_tournament_ids(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.planning_membership_tournament_ids(uuid) TO service_role;

CREATE FUNCTION public.start_tournament_season_with_commitment(p_tournament_id uuid,p_next_season_number integer,
  p_mode text,p_fixtures_snapshot jsonb,p_planned_start_slot timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE affected jsonb; dropped jsonb; new_season jsonb;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(120,113);
  affected := public.planning_membership_tournament_ids(p_tournament_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('name',tm.name,'ht_team_id',tm.ht_team_id)),'[]'::jsonb)
    INTO dropped FROM public.teams tm WHERE p_mode='auto' AND
    EXISTS (SELECT 1 FROM public.tournaments target WHERE target.id=p_tournament_id AND NOT COALESCE(target.is_test,false) AND target.registration_type IS DISTINCT FROM 'sandbox') AND tm.tournament_id=p_tournament_id AND tm.active
    AND NOT COALESCE(tm.reserve_active,false)
    AND EXISTS (SELECT 1 FROM public.teams other_tm JOIN public.tournaments t ON t.id=other_tm.tournament_id
      WHERE other_tm.ht_team_id=tm.ht_team_id AND other_tm.tournament_id<>p_tournament_id AND other_tm.active
        AND NOT COALESCE(other_tm.reserve_active,false) AND public.tournament_is_exclusive(t.status,t.is_test,t.registration_type));
  SELECT to_jsonb(season) INTO new_season FROM public.start_tournament_season(p_tournament_id,p_next_season_number,p_mode,p_fixtures_snapshot,p_planned_start_slot) season;
  RETURN jsonb_build_object('season',new_season,'dropped_teams',dropped,'tournament_ids',affected || jsonb_build_array(p_tournament_id));
END $$;
REVOKE ALL ON FUNCTION public.start_tournament_season_with_commitment(uuid,integer,text,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_tournament_season_with_commitment(uuid,integer,text,jsonb,timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.start_tournament_season(uuid,integer,text,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_tournament_season(uuid,integer,text,jsonb,timestamptz) TO service_role;

-- Patch an explicit signature manifest; abort on missing functions or source drift.
DO $$
DECLARE
  patch record;
  function_oid regprocedure;
  definition text;
  patched text;
  body text;
  previous text;
  replacement text;
  occurrences integer;
  lock_statement constant text := '  PERFORM pg_catalog.pg_advisory_xact_lock(120,113);';
BEGIN
  FOR patch IN SELECT * FROM (VALUES
    ('public.generate_length_tournament_schedule(uuid,integer,jsonb)', 'length'),
    ('public.start_tournament_season(uuid,integer,text,jsonb,timestamptz)', 'season'),
    ('public.generate_tournament_schedule(uuid,text,jsonb,text,timestamptz,boolean)', 'legacy'),
    ('public.replace_known_team_in_current_season(uuid,integer,uuid,bigint)', 'membership'),
    ('public.swap_current_season_team_with_reserve(uuid,integer,uuid,uuid)', 'membership'),
    ('public.fill_vacant_current_season_slot_with_reserve(uuid,integer,uuid)', 'lock'),
    ('public.fill_vacant_team_slot_in_current_season(uuid,integer,uuid,bigint)', 'membership'),
    ('public.admit_length_schedule_reserves(uuid,integer,uuid,uuid,uuid[],jsonb,boolean)', 'admission'),
    ('public.replace_or_fill_known_team_in_current_season(uuid,integer,uuid,bigint)', 'lock'),
    ('public.vacate_team_slot_in_current_season(uuid,integer,uuid)', 'lock'),
    ('public.move_inactive_team_to_reserve(uuid,integer,uuid)', 'lock'),
    ('public.remove_unused_tournament_reserve(uuid,uuid)', 'lock')
  ) AS required(signature, kind) LOOP
    function_oid := to_regprocedure(patch.signature);
    IF function_oid IS NULL THEN
      RAISE EXCEPTION 'Required function missing: %', patch.signature;
    END IF;
    IF (SELECT count(*) FROM pg_proc candidate JOIN pg_namespace namespace ON namespace.oid=candidate.pronamespace
      WHERE namespace.nspname='public' AND candidate.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc routine JOIN pg_language language ON language.oid=routine.prolang
        WHERE routine.oid=function_oid AND routine.prokind='f' AND language.lanname='plpgsql') THEN
      RAISE EXCEPTION 'Unexpected overload or function language in %', patch.signature;
    END IF;
    SELECT prosrc INTO body FROM pg_proc WHERE oid=function_oid;
    definition := pg_get_functiondef(function_oid);
    previous := NULL;
    replacement := NULL;
    CASE patch.kind
      WHEN 'length' THEN
        previous := $guard$IF v_tournament.status NOT IN ('open', 'waiting', 'active') THEN$guard$;
        replacement := $guard$IF v_tournament.status NOT IN ('recruiting', 'active')
    AND NOT ((COALESCE(v_tournament.is_test,false) OR v_tournament.registration_type='sandbox') AND v_tournament.status IN ('open','waiting')) THEN$guard$;
      WHEN 'season' THEN
        previous := $guard$v_next_status := CASE WHEN p_mode = 'auto' THEN 'active' ELSE 'waiting' END;$guard$;
        replacement := $guard$v_next_status := CASE WHEN p_mode='auto' THEN 'active'
    WHEN COALESCE(v_tournament.is_test,false) OR v_tournament.registration_type='sandbox' THEN 'waiting' ELSE 'planning' END;$guard$;
      WHEN 'legacy' THEN
        previous := $guard$v_tournament.status IS DISTINCT FROM 'open' AND v_tournament.status IS DISTINCT FROM 'waiting'$guard$;
        IF strpos(body,previous)=0 THEN
          previous := $guard$v_tournament.status IS DISTINCT FROM 'open'
    AND v_tournament.status IS DISTINCT FROM 'waiting'$guard$;
        END IF;
        replacement := $guard$v_tournament.status IS DISTINCT FROM 'recruiting' AND NOT ((COALESCE(v_tournament.is_test,false) OR v_tournament.registration_type='sandbox') AND v_tournament.status IN ('open','waiting'))$guard$;
      WHEN 'admission' THEN
        previous := $guard$ot.status NOT IN ('finished','stopped')$guard$;
        replacement := $guard$public.tournament_is_exclusive(ot.status,ot.is_test,ot.registration_type)$guard$;
      WHEN 'membership' THEN
        previous := $guard$other_tournament.status IN ('open', 'waiting', 'active', 'paused')$guard$;
        replacement := $guard$public.tournament_is_exclusive(other_tournament.status,other_tournament.is_test,other_tournament.registration_type)$guard$;
      WHEN 'lock' THEN
        -- These wrappers/removal RPCs have no membership guard to replace.
        IF body ~ '(other_tournament|ot)[.]status' THEN
          RAISE EXCEPTION 'Unexpected membership guard in %', patch.signature;
        END IF;
      ELSE RAISE EXCEPTION 'Unexpected patch kind: %', patch.kind;
    END CASE;
    IF previous IS NOT NULL THEN
      occurrences := (length(body)-length(replace(body,previous,'')))/length(previous);
      IF occurrences<>1 OR strpos(body,replacement)>0 THEN
        RAISE EXCEPTION 'Expected exactly one original guard in %; found %', patch.signature, occurrences;
      END IF;
      patched := replace(definition,previous,replacement);
      IF patched=definition OR strpos(patched,previous)>0 THEN
        RAISE EXCEPTION 'Guard replacement failed in %', patch.signature;
      END IF;
      definition := patched;
    END IF;
    -- Admission already has one per-team lock. Preserve only that exact known
    -- statement; the new global lock still precedes every row and per-team lock.
    IF patch.kind='admission' THEN
      previous := 'PERFORM pg_advisory_xact_lock(member.ht_team_id);';
      IF (length(body)-length(replace(body,previous,'')))/length(previous)<>1
        OR strpos(replace(body,previous,''),'pg_advisory_xact_lock')>0 THEN
        RAISE EXCEPTION 'Unexpected reserve-admission advisory locks in %', patch.signature;
      END IF;
      -- Restore the membership guard for the installed-guard verification below.
      previous := $guard$ot.status NOT IN ('finished','stopped')$guard$;
    ELSIF strpos(body,'pg_advisory_xact_lock')>0 THEN
      RAISE EXCEPTION 'Unexpected existing advisory lock in %', patch.signature;
    END IF;
    IF strpos(body,E'\nBEGIN\n')=0 THEN
      RAISE EXCEPTION 'Unexpected outer block in %', patch.signature;
    END IF;
    patched := regexp_replace(definition,E'\nBEGIN\n',E'\nBEGIN\n'||lock_statement||E'\n');
    IF patched=definition THEN
      RAISE EXCEPTION 'Advisory lock insertion failed in %', patch.signature;
    END IF;
    EXECUTE patched;
    SELECT prosrc INTO body FROM pg_proc WHERE oid=function_oid;
    IF strpos(body,E'\nBEGIN\n'||lock_statement||E'\n')<>strpos(body,E'\nBEGIN\n')
      OR (length(body)-length(replace(body,lock_statement,'')))/length(lock_statement)<>1 THEN
      RAISE EXCEPTION 'Advisory lock is not the first outer-block statement in %', patch.signature;
    END IF;
    IF patch.kind='admission' AND
      (length(body)-length(replace(body,'PERFORM pg_advisory_xact_lock(member.ht_team_id);','')))
        /length('PERFORM pg_advisory_xact_lock(member.ht_team_id);')<>1 THEN
      RAISE EXCEPTION 'Reserve-admission per-team lock was not preserved in %', patch.signature;
    END IF;
    IF previous IS NOT NULL AND (strpos(body,previous)>0 OR
      (length(body)-length(replace(body,replacement,'')))/length(replacement)<>1) THEN
      RAISE EXCEPTION 'Installed guard verification failed in %', patch.signature;
    END IF;
  END LOOP;
END $$;
SELECT public.mark_public_snapshot_dirty('home:directory',1);
COMMIT;

-- applied!