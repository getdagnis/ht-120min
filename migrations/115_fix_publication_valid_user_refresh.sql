-- Defer per-team valid_users writes while publication changes multiple teams.
-- The existing row trigger otherwise updates the tournament row repeatedly
-- while that same row is being changed from planning to recruiting.
BEGIN;

DO $$
DECLARE
  refresh_definition text;
  commitment_definition text;
  publication_definition text;
BEGIN
  IF to_regprocedure('public.refresh_tournament_valid_users()') IS NULL
    OR to_regprocedure('public.enforce_tournament_commitment()') IS NULL
    OR to_regprocedure('public.transition_tournament_publication(uuid,integer,text)') IS NULL THEN
    RAISE EXCEPTION 'Required tournament publication functions are missing; inspect the installed schema';
  END IF;

  refresh_definition := pg_get_functiondef('public.refresh_tournament_valid_users()'::regprocedure);
  commitment_definition := pg_get_functiondef('public.enforce_tournament_commitment()'::regprocedure);
  publication_definition := pg_get_functiondef('public.transition_tournament_publication(uuid,integer,text)'::regprocedure);

  IF strpos(refresh_definition, 'teams.joined_via_oauth IS TRUE') = 0
    OR strpos(refresh_definition, 'teams.active IS TRUE') = 0 THEN
    RAISE EXCEPTION 'Unexpected valid_users refresh definition; inspect before applying';
  END IF;
  IF strpos(commitment_definition, 'UPDATE public.teams tm SET active=false,reapply_season_number=NULL') = 0
    OR strpos(commitment_definition, 'public.tournament_is_exclusive(NEW.status,NEW.is_test,NEW.registration_type)') = 0 THEN
    RAISE EXCEPTION 'Unexpected tournament commitment definition; inspect before applying';
  END IF;
  IF strpos(publication_definition, 'PERFORM pg_catalog.pg_advisory_xact_lock(120,113);') = 0
    OR strpos(publication_definition, 'FOR UPDATE') = 0 THEN
    RAISE EXCEPTION 'Unexpected publication function or lock order; inspect before applying';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_tournament_valid_users()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_tournament_id UUID;
BEGIN
  IF current_setting('ht120.defer_valid_users_refresh', true) = 'true' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
    affected_tournament_id := OLD.tournament_id;
    IF affected_tournament_id IS NOT NULL THEN
      UPDATE public.tournaments
      SET valid_users = (
        SELECT COUNT(DISTINCT teams.hattrick_user_id)::INTEGER
        FROM public.teams
        WHERE teams.tournament_id = affected_tournament_id
          AND teams.active IS TRUE
          AND teams.is_placeholder IS NOT TRUE
          AND teams.joined_via_oauth IS TRUE
          AND teams.hattrick_user_id IS NOT NULL
      )
      WHERE id = affected_tournament_id;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    affected_tournament_id := NEW.tournament_id;
    IF affected_tournament_id IS NOT NULL THEN
      UPDATE public.tournaments
      SET valid_users = (
        SELECT COUNT(DISTINCT teams.hattrick_user_id)::INTEGER
        FROM public.teams
        WHERE teams.tournament_id = affected_tournament_id
          AND teams.active IS TRUE
          AND teams.is_placeholder IS NOT TRUE
          AND teams.joined_via_oauth IS TRUE
          AND teams.hattrick_user_id IS NOT NULL
      )
      WHERE id = affected_tournament_id;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_tournament_commitment() RETURNS trigger
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
  IF public.tournament_is_exclusive(NEW.status,NEW.is_test,NEW.registration_type)
    AND current_setting('ht120.publication_rpc_manages_membership',true) IS DISTINCT FROM 'true' THEN
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

CREATE OR REPLACE FUNCTION public.transition_tournament_publication(p_tournament_id uuid,p_season_number integer,p_target text)
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

  -- These changes run before the status row is updated. Suppress per-team count
  -- writes, then refresh each affected tournament once after publication.
  PERFORM set_config('ht120.defer_valid_users_refresh','true',true);
  PERFORM set_config('ht120.publication_rpc_manages_membership','true',true);
  UPDATE public.teams tm SET active=false,reapply_season_number=NULL
    WHERE tm.tournament_id=p_tournament_id AND tm.active AND NOT COALESCE(tm.reserve_active,false)
    AND EXISTS (SELECT 1 FROM public.teams other_tm JOIN public.tournaments t ON t.id=other_tm.tournament_id
      WHERE other_tm.ht_team_id=tm.ht_team_id AND other_tm.tournament_id<>p_tournament_id AND other_tm.active
        AND NOT COALESCE(other_tm.reserve_active,false) AND public.tournament_is_exclusive(t.status,t.is_test,t.registration_type));
  UPDATE public.teams tm SET active=false,reapply_season_number=NULL FROM public.tournaments t
    WHERE t.id=tm.tournament_id AND t.status='planning' AND t.id<>p_tournament_id
    AND NOT COALESCE(t.is_test,false) AND t.registration_type IS DISTINCT FROM 'sandbox'
    AND (tm.active OR tm.reapply_season_number IS NOT NULL)
    AND EXISTS (SELECT 1 FROM public.teams committed WHERE committed.tournament_id=p_tournament_id
      AND committed.active AND NOT COALESCE(committed.reserve_active,false)
      AND NOT COALESCE(committed.is_placeholder,false) AND committed.ht_team_id=tm.ht_team_id);
  UPDATE public.tournaments SET status='recruiting',registration_closed_at=NULL WHERE id=p_tournament_id;
  PERFORM set_config('ht120.publication_rpc_manages_membership','false',true);
  PERFORM set_config('ht120.defer_valid_users_refresh','false',true);

  UPDATE public.tournaments t
  SET valid_users=(
    SELECT COUNT(DISTINCT teams.hattrick_user_id)::INTEGER FROM public.teams
    WHERE teams.tournament_id=t.id AND teams.active IS TRUE AND teams.is_placeholder IS NOT TRUE
      AND teams.joined_via_oauth IS TRUE AND teams.hattrick_user_id IS NOT NULL
  )
  WHERE t.id=p_tournament_id OR t.id IN (SELECT value::uuid FROM jsonb_array_elements_text(affected));

  RETURN jsonb_build_object('status','recruiting','dropped_teams',dropped,'tournament_ids',affected || jsonb_build_array(p_tournament_id));
END $$;

COMMIT;


-- applied!