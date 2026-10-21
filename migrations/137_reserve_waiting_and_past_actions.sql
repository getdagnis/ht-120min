-- Phase 1: Active / Waiting / Past. Applied 134-136 stay immutable.
-- Run docs/team-membership-preflight.sql first. No historical fixture rewrite.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.teams WHERE active IS TRUE AND (reserve_active IS TRUE OR pending_entry_round_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'Contradictory team membership: review the membership preflight before 137';
  END IF;
END $$;
ALTER TABLE public.teams ADD COLUMN actively_waiting boolean NOT NULL DEFAULT false;
DROP TRIGGER set_team_reserve_origin ON public.teams;
ALTER TABLE public.teams ADD CONSTRAINT teams_membership_consistent CHECK (NOT (active IS TRUE AND reserve_active IS TRUE));
ALTER TABLE public.teams ADD CONSTRAINT teams_waiting_intent_consistent CHECK (
  NOT actively_waiting OR (active IS FALSE AND reserve_active IS TRUE AND NOT COALESCE(is_placeholder,false)));
CREATE INDEX teams_ready_waiting_idx ON public.teams(tournament_id,id) WHERE actively_waiting;
-- Normalize exactly the old Reserve-list predicate plus old pending entrants.
-- Complete table DDL first: legacy deferred country/FK triggers may be queued by
-- the UPDATE. This is an unchecked state conversion, not a new admission.
SELECT set_config('ht120.pending_join_write','true',true);
SELECT set_config('ht120.membership_bypass','true',true);
UPDATE public.teams SET active=false,reserve_active=true,pending_entry_round_id=NULL
 WHERE NOT COALESCE(is_placeholder,false) AND (reserve_active IS TRUE OR pending_entry_round_id IS NOT NULL);
SELECT set_config('ht120.pending_join_write','false',true);
SELECT set_config('ht120.membership_bypass','false',true);

-- All staged membership mutations are authorized service operations. Keep the
-- old guard name/trigger so old clients cannot bypass it through legacy flags.
CREATE OR REPLACE FUNCTION public.guard_pending_team_writes() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE gated boolean; tournament_id_to_check uuid;
BEGIN
  tournament_id_to_check:=CASE WHEN TG_OP='DELETE' THEN OLD.tournament_id ELSE NEW.tournament_id END;
  SELECT schedule_mode='length' AND schedule_generated_at IS NOT NULL INTO gated
    FROM public.tournaments WHERE id=tournament_id_to_check;
  IF current_setting('ht120.membership_write',true)='true' THEN
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP='DELETE' THEN
    IF OLD.pending_entry_round_id IS NOT NULL OR OLD.actively_waiting THEN
      RAISE EXCEPTION 'Waiting membership requires the authorized service route' USING ERRCODE='42501';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.pending_entry_round_id IS NOT NULL OR NEW.actively_waiting OR
      (COALESCE(gated,false) AND (NEW.active IS TRUE OR NEW.reserve_active IS TRUE)) THEN
      RAISE EXCEPTION 'Tournament membership requires the authorized service route' USING ERRCODE='42501';
    END IF;
  ELSIF NEW.pending_entry_round_id IS DISTINCT FROM OLD.pending_entry_round_id
    OR NEW.actively_waiting IS DISTINCT FROM OLD.actively_waiting
    OR (COALESCE(gated,false) AND (NEW.active IS DISTINCT FROM OLD.active OR NEW.reserve_active IS DISTINCT FROM OLD.reserve_active)) THEN
    RAISE EXCEPTION 'Tournament membership requires the authorized service route' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.guard_pending_next_round_joins() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.phase_status='materialized' AND OLD.phase_status='pending'
    AND current_setting('ht120.membership_transition',true) IS DISTINCT FROM 'true'
    AND EXISTS (SELECT 1 FROM public.teams WHERE tournament_id=NEW.tournament_id AND actively_waiting) THEN
    RAISE EXCEPTION 'Round progression requires the updated membership-aware application' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;

-- Returns only a public-safe reason; tokens and private identities never leave SQL.
CREATE FUNCTION public.waiting_team_admission_error(p_tournament_id uuid,p_team_id uuid,p_selected uuid[] DEFAULT '{}',p_departing uuid[] DEFAULT '{}')
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t public.tournaments%ROWTYPE; candidate public.teams%ROWTYPE; small_count integer; large_count integer;
BEGIN
  SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id;
  SELECT * INTO candidate FROM public.teams WHERE id=p_team_id AND tournament_id=p_tournament_id;
  IF candidate.id IS NULL OR candidate.active IS DISTINCT FROM false OR candidate.reserve_active IS DISTINCT FROM true
    OR COALESCE(candidate.is_placeholder,false) THEN RETURN 'This team is not on the Waiting list'; END IF;
  IF t.status IN ('finished','stopped','archived') OR COALESCE(t.is_archived,false) THEN RETURN 'The tournament is not active'; END IF;
  IF candidate.ht_team_id IS NULL OR candidate.hattrick_user_id IS NULL OR NOT COALESCE(candidate.joined_via_oauth,false)
    OR NULLIF(candidate.oauth_token,'') IS NULL OR NULLIF(candidate.oauth_token_secret,'') IS NULL THEN
    RETURN 'Ask the manager to reconnect with Hattrick to verify their team'; END IF;
  IF candidate.league_id IS NULL OR (t.league_category='hfi') IS DISTINCT FROM (candidate.league_id=3000) THEN
    RETURN 'This team is not eligible for the tournament category'; END IF;
  IF t.country_limit IS NOT NULL AND t.country_limit<>'' AND
    (CASE WHEN t.country_limit ~ '^[0-9]+$' THEN
      (CASE WHEN t.country_limit_format='country_id' THEN candidate.country_id ELSE candidate.league_id END)
        IS DISTINCT FROM t.country_limit::integer
      ELSE candidate.country_name IS DISTINCT FROM t.country_limit END) THEN RETURN 'This team does not meet the country restriction'; END IF;
  IF t.league_category='hfi' AND COALESCE(candidate.team_rank,0)<=0 THEN RETURN 'The HFI team ranking needs verification'; END IF;
  IF public.tournament_is_exclusive(t.status,t.is_test,t.registration_type) AND EXISTS (SELECT 1 FROM public.teams other JOIN public.tournaments ot ON ot.id=other.tournament_id
    WHERE other.ht_team_id=candidate.ht_team_id AND other.tournament_id<>t.id
      AND ((other.active AND NOT COALESCE(other.reserve_active,false) AND public.tournament_is_exclusive(ot.status,ot.is_test,ot.registration_type))
        OR other.actively_waiting)) THEN RETURN 'This team participates or is actively waiting in another tournament'; END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_season_slots s JOIN public.tournament_seasons se ON se.id=s.tournament_season_id
    WHERE se.tournament_id=t.id AND se.season_number=COALESCE(t.season,1) AND s.current_team_id=candidate.id)
    OR EXISTS (SELECT 1 FROM public.tournament_season_slot_assignments a JOIN public.tournament_season_slots s ON s.id=a.tournament_season_slot_id
      JOIN public.tournament_seasons se ON se.id=s.tournament_season_id
      WHERE se.tournament_id=t.id AND se.season_number=COALESCE(t.season,1) AND a.team_id=candidate.id AND a.released_at IS NULL)
    OR EXISTS (SELECT 1 FROM public.matches m JOIN public.rounds r ON r.id=m.round_id
      WHERE r.tournament_id=t.id AND r.season_number=COALESCE(t.season,1)
        AND candidate.id IN (m.home_team_id,m.away_team_id,m.reserve_team_id)
        AND m.completed IS DISTINCT FROM true AND m.status IS DISTINCT FROM 'finished'
        AND (m.schedule_resolution IS DISTINCT FROM 'finalized_unplayed' OR m.ht_match_id IS NOT NULL OR m.status IN ('arranged','ongoing'))) THEN
    RETURN 'This team still has a live season assignment or unfinished fixture commitment'; END IF;
  IF t.max_country_active_teams IS NOT NULL AND COALESCE(public.country_size_snapshot_count(candidate.country_id)>t.max_country_active_teams,true) THEN
    SELECT count(*) FILTER (WHERE public.country_size_snapshot_count(country_id)<=t.max_country_active_teams),
      count(*) FILTER (WHERE COALESCE(public.country_size_snapshot_count(country_id)>t.max_country_active_teams,true))
      INTO small_count,large_count FROM public.teams
      WHERE tournament_id=t.id AND hattrick_user_id=candidate.hattrick_user_id AND id<>candidate.id AND NOT(id=ANY(p_departing))
        AND ((active AND NOT COALESCE(reserve_active,false)) OR id=ANY(p_selected));
    IF NOT COALESCE(t.allow_manager_country_size_exception,false) OR small_count<=large_count THEN
      RETURN 'The country-size registration allowance is unavailable'; END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.waiting_team_admission_error(uuid,uuid,uuid[],uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waiting_team_admission_error(uuid,uuid,uuid[],uuid[]) TO service_role;

CREATE FUNCTION public.get_waiting_admission_plan(p_tournament_id uuid,p_season_number integer,p_for_transition boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t public.tournaments%ROWTYPE; candidate public.teams%ROWTYPE; accepted uuid[]:='{}'; current_ids uuid[];
  rejected jsonb:='[]'; reason text; field_count integer; departing uuid[]:='{}'; current_round public.rounds%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(120,113);
  SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id AND COALESCE(season,1)=p_season_number FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tournament season changed' USING ERRCODE='40001'; END IF;
  SELECT COALESCE(array_agg(id ORDER BY id),'{}'::uuid[]) INTO current_ids FROM public.teams
    WHERE tournament_id=t.id AND active IS TRUE AND reserve_active IS NOT TRUE AND NOT COALESCE(is_placeholder,false);
  SELECT * INTO current_round FROM public.rounds WHERE tournament_id=t.id AND season_number=p_season_number
    AND phase_status='materialized' ORDER BY round_number LIMIT 1;
  -- Account for accepted Leave-after-round requests before generating the next
  -- regular field. Protected later commitments continue to require review.
  IF p_for_transition AND EXISTS(SELECT 1 FROM public.rounds WHERE tournament_id=t.id AND season_number=p_season_number
    AND round_number=current_round.round_number+1 AND phase='regular' AND phase_status='pending') THEN
    SELECT COALESCE(array_agg(d.team_id ORDER BY d.team_id),'{}'::uuid[]) INTO departing
    FROM public.tournament_team_departures d WHERE d.after_round_id=current_round.id AND d.team_id=ANY(current_ids)
      AND EXISTS(SELECT 1 FROM public.tournament_season_slots sl JOIN public.tournament_seasons se ON se.id=sl.tournament_season_id
        WHERE se.tournament_id=t.id AND se.season_number=p_season_number AND sl.current_team_id=d.team_id)
      AND NOT EXISTS(SELECT 1 FROM public.matches m JOIN public.rounds r ON r.id=m.round_id
        WHERE r.tournament_id=t.id AND r.season_number=p_season_number AND r.round_number>current_round.round_number
          AND d.team_id IN(m.home_team_id,m.away_team_id,m.reserve_team_id)
          AND (m.ht_match_id IS NOT NULL OR m.status IN('arranged','ongoing','finished')
            OR m.finished_at IS NOT NULL OR m.home_goals IS NOT NULL OR m.away_goals IS NOT NULL OR m.match_event_details IS NOT NULL
            OR m.scheduled_for IS NULL OR m.scheduled_for<=now()));
  END IF;
  field_count:=cardinality(current_ids)-cardinality(departing);
  -- Admit qualifying small-country entries before dependent larger entries.
  FOR candidate IN SELECT * FROM public.teams WHERE tournament_id=t.id AND active=false AND reserve_active=true
    ORDER BY COALESCE(public.country_size_snapshot_count(country_id)>t.max_country_active_teams,false),reserve_joined_at NULLS LAST,id FOR UPDATE LOOP
    reason:=public.waiting_team_admission_error(t.id,candidate.id,accepted,departing);
    IF reason IS NULL AND t.schedule_generated_at IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.rounds WHERE tournament_id=t.id AND season_number=p_season_number AND phase='regular' AND phase_status='pending'
    ) THEN reason:='There is no future regular round available'; END IF;
    IF reason IS NULL AND t.max_teams>0 AND field_count+cardinality(accepted)>=t.max_teams THEN
      reason:='The team limit is reached; waiting for a place'; END IF;
    IF reason IS NULL THEN
      IF candidate.actively_waiting THEN accepted:=array_append(accepted,candidate.id); END IF;
    ELSE rejected:=rejected||jsonb_build_array(jsonb_build_object('teamId',candidate.id,'reason',reason)); END IF;
  END LOOP;
  RETURN jsonb_build_object('activeTeamIds',current_ids,'departingTeamIds',departing,'teamIds',accepted,'rejected',rejected,
    'rosterVersion',(SELECT md5(departing::text||COALESCE(jsonb_agg(jsonb_build_array(id,active,reserve_active,actively_waiting,
      hattrick_user_id,ht_team_id,league_id,country_id,team_rank,power_rating) ORDER BY id)::text,''))
      FROM public.teams WHERE tournament_id=t.id AND NOT COALESCE(is_placeholder,false)));
END $$;
REVOKE ALL ON FUNCTION public.get_waiting_admission_plan(uuid,integer,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_waiting_admission_plan(uuid,integer,boolean) TO service_role;

-- Shared season integration: a normal participant, never someone else's place.
CREATE FUNCTION public.activate_waiting_team(p_tournament_id uuid,p_team_id uuid,p_override boolean DEFAULT false,p_entry_round_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t public.tournaments%ROWTYPE; candidate public.teams%ROWTYPE; season_id uuid; slot_id uuid; box integer; reason text;
  previous_write text:=current_setting('ht120.membership_write',true);
  previous_bypass text:=current_setting('ht120.membership_bypass',true);
  previous_limit text:=current_setting('ht120.site_admin_team_limit_bypass',true);
BEGIN
  PERFORM pg_advisory_xact_lock(120,113);
  SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
  SELECT * INTO candidate FROM public.teams WHERE id=p_team_id AND tournament_id=t.id FOR UPDATE;
  IF candidate.active AND NOT candidate.reserve_active THEN RETURN; END IF;
  IF candidate.id IS NULL OR candidate.active IS DISTINCT FROM false OR candidate.reserve_active IS DISTINCT FROM true
    OR COALESCE(candidate.is_placeholder,false) THEN RAISE EXCEPTION 'Choose a Waiting team' USING ERRCODE='40001'; END IF;
  IF t.status IN ('finished','stopped','archived') OR COALESCE(t.is_archived,false) THEN RAISE EXCEPTION 'Tournament is not active' USING ERRCODE='55000'; END IF;
  IF NOT p_override THEN
    reason:=public.waiting_team_admission_error(t.id,candidate.id);
    IF reason IS NOT NULL THEN RAISE EXCEPTION '%',reason USING ERRCODE='23514'; END IF;
    IF t.max_teams>0 AND (SELECT count(*) FROM public.teams WHERE tournament_id=t.id AND active AND NOT COALESCE(reserve_active,false) AND NOT COALESCE(is_placeholder,false))>=t.max_teams THEN
      RAISE EXCEPTION 'The team limit is reached' USING ERRCODE='23505'; END IF;
  END IF;
  -- Even the override cannot create two live assignments or rewrite fixtures.
  IF EXISTS(SELECT 1 FROM public.tournament_season_slot_assignments a JOIN public.tournament_season_slots s ON s.id=a.tournament_season_slot_id
    JOIN public.tournament_seasons se ON se.id=s.tournament_season_id WHERE se.tournament_id=t.id AND se.season_number=COALESCE(t.season,1)
    AND a.team_id=candidate.id AND a.released_at IS NULL)
    OR EXISTS(SELECT 1 FROM public.tournament_season_slots s JOIN public.tournament_seasons se ON se.id=s.tournament_season_id
      WHERE se.tournament_id=t.id AND se.season_number=COALESCE(t.season,1) AND s.current_team_id=candidate.id)
    OR EXISTS(SELECT 1 FROM public.matches m JOIN public.rounds r ON r.id=m.round_id
      WHERE r.tournament_id=t.id AND r.season_number=COALESCE(t.season,1)
        AND candidate.id IN (m.home_team_id,m.away_team_id,m.reserve_team_id)
        AND m.completed IS DISTINCT FROM true AND m.status IS DISTINCT FROM 'finished'
        AND (m.schedule_resolution IS DISTINCT FROM 'finalized_unplayed' OR m.ht_match_id IS NOT NULL OR m.status IN ('arranged','ongoing'))) THEN
    RAISE EXCEPTION 'This team still has a live assignment or unfinished fixture commitment' USING ERRCODE='55000'; END IF;
  PERFORM set_config('ht120.membership_write','true',true);
  PERFORM set_config('ht120.membership_bypass',CASE WHEN p_override THEN 'true' ELSE 'false' END,true);
  PERFORM set_config('ht120.site_admin_team_limit_bypass',CASE WHEN p_override THEN 'true' ELSE 'false' END,true);
  IF t.schedule_generated_at IS NOT NULL THEN
    IF t.schedule_mode IS DISTINCT FROM 'length' THEN RAISE EXCEPTION 'Use the existing fixed-schedule replacement operation' USING ERRCODE='55000'; END IF;
    SELECT id INTO season_id FROM public.tournament_seasons WHERE tournament_id=t.id AND season_number=COALESCE(t.season,1) FOR UPDATE;
    IF season_id IS NULL THEN RAISE EXCEPTION 'Current season is missing' USING ERRCODE='55000'; END IF;
    PERFORM 1 FROM public.tournament_season_slots WHERE tournament_season_id=season_id FOR UPDATE;
    SELECT COALESCE(max(slot_index),0)+2 INTO box FROM public.tournament_season_slots WHERE tournament_season_id=season_id;
    IF box%2<>0 THEN RAISE EXCEPTION 'Season slot box is inconsistent' USING ERRCODE='55000'; END IF;
    UPDATE public.tournament_season_slots SET box_size=box WHERE tournament_season_id=season_id;
    INSERT INTO public.tournament_season_slots(tournament_season_id,slot_index,box_size,current_team_id)
      VALUES(season_id,box-1,box,candidate.id) RETURNING id INTO slot_id;
    INSERT INTO public.tournament_season_slots(tournament_season_id,slot_index,box_size) VALUES(season_id,box,box);
    INSERT INTO public.tournament_season_slot_assignments(tournament_season_slot_id,team_id,reason,team_name,ht_team_id,manager_name,hattrick_user_id,logo_url,admission_request_id,entry_round_id,ranking_source,ranking_value)
      VALUES(slot_id,candidate.id,'reserve_admission',candidate.name,candidate.ht_team_id,candidate.manager_name,candidate.hattrick_user_id,candidate.logo_url,gen_random_uuid(),p_entry_round_id,
        CASE WHEN t.league_category='hfi' THEN 'team_rank' ELSE 'power_rating' END,
        CASE WHEN t.league_category='hfi' THEN candidate.team_rank ELSE candidate.power_rating END);
  END IF;
  -- Overrides are only reachable through service RPCs after API role verification.
  PERFORM set_config('ht120.membership_bypass',CASE WHEN p_override THEN 'true' ELSE 'false' END,true);
  PERFORM set_config('ht120.site_admin_team_limit_bypass',CASE WHEN p_override THEN 'true' ELSE 'false' END,true);
  UPDATE public.teams SET active=true,reserve_active=false,actively_waiting=false,pending_entry_round_id=NULL,
    reserve_joined_at=NULL,reserve_origin=NULL,reapply_season_number=NULL WHERE id=candidate.id;
  PERFORM set_config('ht120.membership_bypass',COALESCE(previous_bypass,'false'),true);
  PERFORM set_config('ht120.site_admin_team_limit_bypass',COALESCE(previous_limit,'false'),true);
  PERFORM set_config('ht120.membership_write',COALESCE(previous_write,'false'),true);
END $$;
REVOKE ALL ON FUNCTION public.activate_waiting_team(uuid,uuid,boolean,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.activate_waiting_team(uuid,uuid,boolean,uuid) TO service_role;

CREATE FUNCTION public.process_ready_waiting_teams(p_tournament_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE plan jsonb; team_id uuid; season_number integer;
BEGIN
  SELECT COALESCE(season,1) INTO season_number FROM public.tournaments WHERE id=p_tournament_id;
  plan:=public.get_waiting_admission_plan(p_tournament_id,season_number);
  FOR team_id IN SELECT value::uuid FROM jsonb_array_elements_text(plan->'teamIds') LOOP
    PERFORM public.activate_waiting_team(p_tournament_id,team_id,false);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.process_ready_waiting_teams(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_ready_waiting_teams(uuid) TO service_role;

CREATE FUNCTION public.change_tournament_team_membership(p_tournament_id uuid,p_team_id uuid,p_action text,p_ready boolean DEFAULT NULL,p_override boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t public.tournaments%ROWTYPE; candidate public.teams%ROWTYPE; season_id uuid; freed boolean:=false;
  previous_write text:=current_setting('ht120.membership_write',true);
  previous_bypass text:=current_setting('ht120.membership_bypass',true);
BEGIN
  PERFORM pg_advisory_xact_lock(120,113);
  SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tournament not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO candidate FROM public.teams WHERE id=p_team_id AND tournament_id=t.id FOR UPDATE;
  IF NOT FOUND OR COALESCE(candidate.is_placeholder,false) THEN RAISE EXCEPTION 'Team not found' USING ERRCODE='P0002'; END IF;
  PERFORM set_config('ht120.membership_write','true',true);
  -- Moving between inactive lists does not admit a team. Eligibility is checked
  -- by activate_waiting_team before participation, rather than legacy reserve rules.
  PERFORM set_config('ht120.membership_bypass','true',true);
  IF p_action='promote' THEN
    PERFORM public.activate_waiting_team(t.id,candidate.id,p_override);
  ELSIF p_action='ready' THEN
    IF candidate.active IS DISTINCT FROM false OR candidate.reserve_active IS DISTINCT FROM true OR p_ready IS NULL THEN
      RAISE EXCEPTION 'Choose a Waiting team and checkbox value' USING ERRCODE='40001'; END IF;
    UPDATE public.teams SET actively_waiting=p_ready,pending_entry_round_id=NULL WHERE id=candidate.id;
  ELSIF p_action='return' THEN
    IF candidate.active IS DISTINCT FROM false OR candidate.reserve_active IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'Only Past teams can return to Waiting' USING ERRCODE='40001'; END IF;
    UPDATE public.teams SET reserve_active=true,actively_waiting=true,pending_entry_round_id=NULL,reserve_joined_at=now(),reapply_season_number=NULL WHERE id=candidate.id;
  ELSIF p_action IN ('to_waiting','remove') THEN
    IF p_action='to_waiting' AND candidate.active IS DISTINCT FROM true THEN RAISE EXCEPTION 'Choose an Active team' USING ERRCODE='40001'; END IF;
    IF candidate.active THEN
      PERFORM 1 FROM public.matches m JOIN public.rounds r ON r.id=m.round_id
        WHERE r.tournament_id=t.id AND r.season_number=COALESCE(t.season,1)
          AND candidate.id IN (m.home_team_id,m.away_team_id,m.reserve_team_id) FOR UPDATE OF m;
      IF EXISTS(SELECT 1 FROM public.matches m JOIN public.rounds r ON r.id=m.round_id
        WHERE r.tournament_id=t.id AND r.season_number=COALESCE(t.season,1)
          AND candidate.id IN (m.home_team_id,m.away_team_id,m.reserve_team_id)
          AND m.completed IS DISTINCT FROM true
          AND (m.ht_match_id IS NOT NULL OR m.status IN ('arranged','ongoing','finished')
            OR m.finished_at IS NOT NULL OR m.home_goals IS NOT NULL OR m.away_goals IS NOT NULL
            OR m.match_event_details IS NOT NULL OR m.scheduled_for IS NULL
            OR (m.scheduled_for<=now() AND m.schedule_resolution IS DISTINCT FROM 'finalized_unplayed'))) THEN
        RAISE EXCEPTION 'A booked or started fixture, partial result or unresolved kickoff must be resolved before moving this team; use Leave after this round where appropriate' USING ERRCODE='55000';
      END IF;
      SELECT id INTO season_id FROM public.tournament_seasons WHERE tournament_id=t.id AND season_number=COALESCE(t.season,1);
      IF EXISTS(SELECT 1 FROM public.tournament_season_slots WHERE tournament_season_id=season_id AND current_team_id=candidate.id) THEN
        PERFORM public.vacate_team_slot_in_current_season(t.id,COALESCE(t.season,1),candidate.id);
      ELSIF EXISTS(SELECT 1 FROM public.tournament_season_slot_assignments a JOIN public.tournament_season_slots s ON s.id=a.tournament_season_slot_id
        WHERE s.tournament_season_id=season_id AND a.team_id=candidate.id AND a.released_at IS NULL) THEN
        RAISE EXCEPTION 'The current season assignment needs repair before moving this team' USING ERRCODE='55000';
      ELSIF EXISTS(SELECT 1 FROM public.matches m JOIN public.rounds r ON r.id=m.round_id WHERE r.tournament_id=t.id AND r.season_number=COALESCE(t.season,1)
        AND candidate.id IN (m.home_team_id,m.away_team_id,m.reserve_team_id) AND m.completed IS DISTINCT FROM true AND m.status IS DISTINCT FROM 'finished'
        AND (m.schedule_resolution IS DISTINCT FROM 'finalized_unplayed' OR m.ht_match_id IS NOT NULL OR m.status IN ('arranged','ongoing'))) THEN
        RAISE EXCEPTION 'Resolve the unfinished fixture commitment before moving this team' USING ERRCODE='55000';
      END IF;
      freed:=true;
    END IF;
    UPDATE public.teams SET active=false,reserve_active=(p_action='to_waiting'),actively_waiting=false,pending_entry_round_id=NULL,
      reserve_joined_at=CASE WHEN p_action='to_waiting' THEN now() ELSE NULL END,reapply_season_number=NULL WHERE id=candidate.id;
  ELSE RAISE EXCEPTION 'Invalid membership action' USING ERRCODE='22023'; END IF;
  IF freed AND t.schedule_mode='length' AND t.status='active' THEN PERFORM public.process_ready_waiting_teams(t.id); END IF;
  PERFORM set_config('ht120.membership_bypass',COALESCE(previous_bypass,'false'),true);
  PERFORM set_config('ht120.membership_write',COALESCE(previous_write,'false'),true);
  RETURN jsonb_build_object('ok',true,'teamId',candidate.id);
END $$;
REVOKE ALL ON FUNCTION public.change_tournament_team_membership(uuid,uuid,text,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.change_tournament_team_membership(uuid,uuid,text,boolean,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.request_next_round_tournament_join(p_tournament_id uuid, p_values jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t public.tournaments%ROWTYPE;
  candidate public.teams%ROWTYPE;
  existing public.teams%ROWTYPE;
  saved_id uuid;
BEGIN
  IF p_values IS NULL OR jsonb_typeof(p_values) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid next-round registration fields' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_values) AS keys(k) WHERE k NOT IN
    ('ht_team_id','name','ht_team_name','hattrick_user_id','manager_name','country_id','country_name',
     'league_id','gender_id','league_level','team_rank','power_rating','power_global_rank',
     'power_league_rank','power_region_rank','logo_url','join_story','oauth_token','oauth_token_secret')) THEN
    RAISE EXCEPTION 'Invalid next-round registration fields' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO candidate FROM jsonb_populate_record(NULL::public.teams, p_values);
  IF candidate.ht_team_id IS NULL OR candidate.ht_team_id <= 0
    OR candidate.hattrick_user_id IS NULL OR candidate.hattrick_user_id <= 0
    OR NULLIF(candidate.name, '') IS NULL OR NULLIF(candidate.oauth_token, '') IS NULL
    OR NULLIF(candidate.oauth_token_secret, '') IS NULL THEN
    RAISE EXCEPTION 'Verified team and manager credentials are required' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(120,113);
  SELECT * INTO t FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND OR t.schedule_mode IS DISTINCT FROM 'length' OR t.status IS DISTINCT FROM 'active'
    OR t.schedule_generated_at IS NULL OR t.registration_closed_at IS NOT NULL
    OR COALESCE(t.is_archived, false) OR COALESCE(t.is_test, false)
    OR t.registration_type = 'sandbox' THEN
    RAISE EXCEPTION 'Participant registration is closed for this season' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.rounds current_round JOIN public.rounds next_round
      ON next_round.tournament_id=current_round.tournament_id AND next_round.season_number=current_round.season_number
      AND next_round.round_number=current_round.round_number+1
    WHERE current_round.tournament_id=t.id AND current_round.season_number=COALESCE(t.season,1)
      AND current_round.phase='regular' AND current_round.phase_status='materialized'
      AND next_round.phase='regular' AND next_round.phase_status='pending') THEN
    RAISE EXCEPTION 'There is no next regular round available for registration' USING ERRCODE='55000';
  END IF;
  PERFORM pg_advisory_xact_lock(candidate.ht_team_id);
  SELECT * INTO existing FROM public.teams
    WHERE tournament_id = t.id AND ht_team_id = candidate.ht_team_id FOR UPDATE;
  IF existing.active THEN RAISE EXCEPTION 'This team is already participating' USING ERRCODE='23505'; END IF;
  IF COALESCE(existing.is_placeholder,false) THEN RAISE EXCEPTION 'Resolve the placeholder before joining' USING ERRCODE='55000'; END IF;
  PERFORM set_config('ht120.membership_write', 'true', true);
  PERFORM set_config('ht120.membership_bypass','true',true);
  IF existing.id IS NULL THEN
    INSERT INTO public.teams(tournament_id, ht_team_id, name, ht_team_name, hattrick_user_id,
      manager_name, country_id, country_name, league_id, gender_id, league_level, team_rank,
      power_rating, power_global_rank, power_league_rank, power_region_rank, logo_url, join_story,
      oauth_token, oauth_token_secret, joined_via_oauth, active, reserve_active, actively_waiting, pending_entry_round_id,reserve_joined_at)
    VALUES(t.id, candidate.ht_team_id, candidate.name, candidate.ht_team_name,
      candidate.hattrick_user_id, candidate.manager_name, candidate.country_id, candidate.country_name,
      candidate.league_id, candidate.gender_id, candidate.league_level, candidate.team_rank,
      candidate.power_rating, candidate.power_global_rank, candidate.power_league_rank,
      candidate.power_region_rank, candidate.logo_url, candidate.join_story,
      candidate.oauth_token, candidate.oauth_token_secret, true, false, true, true, NULL,now())
    RETURNING id INTO saved_id;
  ELSE
    UPDATE public.teams SET name = candidate.name, ht_team_name = candidate.ht_team_name,
      hattrick_user_id = candidate.hattrick_user_id, manager_name = candidate.manager_name,
      country_id = candidate.country_id, country_name = candidate.country_name,
      league_id = candidate.league_id, gender_id = candidate.gender_id,
      league_level = candidate.league_level, team_rank = candidate.team_rank,
      power_rating = candidate.power_rating, power_global_rank = candidate.power_global_rank,
      power_league_rank = candidate.power_league_rank, power_region_rank = candidate.power_region_rank,
      logo_url = candidate.logo_url, join_story = candidate.join_story,
      oauth_token = candidate.oauth_token, oauth_token_secret = candidate.oauth_token_secret,
      joined_via_oauth = true, active=false, reserve_active=true, actively_waiting=true,
      reserve_joined_at=COALESCE(existing.reserve_joined_at,now()),reserve_origin=NULL,pending_entry_round_id=NULL
      WHERE id = existing.id RETURNING id INTO saved_id;
  END IF;
  -- Checked Waiting records may provide a manager's small-country allowance;
  -- final admission recomputes it from the actual eligible admission set.
  DECLARE reason text; selected uuid[]; BEGIN
    SELECT COALESCE(array_agg(id),'{}'::uuid[]) INTO selected FROM public.teams
      WHERE tournament_id=t.id AND actively_waiting AND id<>saved_id;
    reason:=public.waiting_team_admission_error(t.id,saved_id,selected);
    IF reason IS NOT NULL THEN RAISE EXCEPTION '%',reason USING ERRCODE='23514'; END IF;
  END;
  PERFORM set_config('ht120.membership_write', 'false', true);
  PERFORM set_config('ht120.membership_bypass','false',true);
  RETURN saved_id;
END $$;
REVOKE ALL ON FUNCTION public.request_next_round_tournament_join(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_next_round_tournament_join(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.save_verified_tournament_registration(
  p_values jsonb,
  p_existing_id uuid DEFAULT NULL,
  p_skip_membership boolean DEFAULT false
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE saved_id uuid; field_list text; value_list text; update_list text; target public.tournaments%ROWTYPE; existing public.teams%ROWTYPE;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(120,113);
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_values) AS keys(k) WHERE k NOT IN
    ('tournament_id','ht_team_id','name','ht_team_name','manager_name','hattrick_user_id','country_id','country_name',
    'league_id','gender_id','league_level','team_rank','power_rating','power_global_rank','power_league_rank','power_region_rank',
    'logo_url','oauth_token','oauth_token_secret','joined_via_oauth','active','reserve_active','reserve_joined_at',
    'reserve_origin','actively_waiting','reapply_season_number','replacement_for_team_id','join_story')) THEN
    RAISE EXCEPTION 'Invalid registration fields' USING ERRCODE='22023'; END IF;
  IF p_existing_id IS NOT NULL THEN
    SELECT * INTO existing FROM public.teams WHERE id=p_existing_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Registration changed; refresh and try again' USING ERRCODE='40001'; END IF;
    IF p_values ? 'tournament_id' AND (p_values->>'tournament_id')::uuid<>existing.tournament_id THEN
      RAISE EXCEPTION 'Registration tournament changed' USING ERRCODE='22023'; END IF;
  END IF;
  SELECT * INTO target FROM public.tournaments WHERE id=COALESCE(existing.tournament_id,(p_values->>'tournament_id')::uuid) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tournament not found' USING ERRCODE='P0002'; END IF;
  IF NOT p_skip_membership AND NOT COALESCE(target.is_test,false) AND target.registration_type IS DISTINCT FROM 'sandbox'
    AND NOT COALESCE(existing.active,false)
    AND (target.status IN ('stopped','finished','archived')
      OR target.registration_closed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Tournament registration is closed' USING ERRCODE='55000'; END IF;
  PERFORM set_config('ht120.membership_write','true',true);
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
  IF (p_values->>'actively_waiting')::boolean IS TRUE THEN
    DECLARE reason text; BEGIN
      reason:=public.waiting_team_admission_error(target.id,saved_id);
      IF reason IS NOT NULL THEN RAISE EXCEPTION '%',reason USING ERRCODE='23514'; END IF;
    END;
  END IF;
  PERFORM set_config('ht120.membership_bypass','false',true);
  PERFORM set_config('ht120.membership_write','false',true);
  RETURN saved_id;
END $$;

REVOKE ALL ON FUNCTION public.save_verified_tournament_registration(jsonb,uuid,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_verified_tournament_registration(jsonb,uuid,boolean)
  TO service_role;

-- Manager withdrawal is Leave -> Past, not checkbox-off -> Waiting.
CREATE OR REPLACE FUNCTION public.withdraw_next_round_tournament_join(p_tournament_id uuid,p_team_id uuid,p_manager_id bigint)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(120,113);
  PERFORM 1 FROM public.teams WHERE id=p_team_id AND tournament_id=p_tournament_id AND hattrick_user_id=p_manager_id
    AND active=false AND reserve_active=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Waiting team not found' USING ERRCODE='P0002'; END IF;
  PERFORM public.change_tournament_team_membership(p_tournament_id,p_team_id,'remove');
  RETURN p_team_id;
END $$;
CREATE OR REPLACE FUNCTION public.cancel_next_round_tournament_join(p_tournament_id uuid,p_team_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.change_tournament_team_membership(p_tournament_id,p_team_id,'ready',false);
  RETURN p_team_id;
END $$;

-- Retain old API contracts as delegates, not independent membership rules.
CREATE FUNCTION public.queue_tournament_reserve_for_next_round(p_tournament_id uuid,p_team_id uuid,p_round_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.change_tournament_team_membership(p_tournament_id,p_team_id,'ready',true);
  RETURN p_team_id;
END $$;
CREATE FUNCTION public.move_tournament_reserve_to_past(p_tournament_id uuid,p_team_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.change_tournament_team_membership(p_tournament_id,p_team_id,'remove');
  RETURN p_team_id;
END $$;
REVOKE ALL ON FUNCTION public.queue_tournament_reserve_for_next_round(uuid,uuid,uuid),public.move_tournament_reserve_to_past(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_tournament_reserve_for_next_round(uuid,uuid,uuid),public.move_tournament_reserve_to_past(uuid,uuid) TO service_role;

CREATE FUNCTION public.apply_length_round_transition_with_membership(
  p_tournament_id uuid,p_season_number integer,p_completed_round_id uuid,p_next_round_id uuid,
  p_matches jsonb,p_pending_team_ids uuid[],p_active_team_ids uuid[],p_roster_version text,p_champion_team_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE plan jsonb; accepted uuid[]; current_ids uuid[]; selected_ids uuid[]; v_team_id uuid; result jsonb;
  previous_write text:=current_setting('ht120.membership_write',true);
  previous_transition text:=current_setting('ht120.membership_transition',true);
BEGIN
  PERFORM pg_advisory_xact_lock(120,113);
  plan:=public.get_waiting_admission_plan(p_tournament_id,p_season_number,true);
  IF p_roster_version IS DISTINCT FROM plan->>'rosterVersion' THEN RAISE EXCEPTION 'Tournament membership changed; regenerate pairings' USING ERRCODE='40001'; END IF;
  SELECT COALESCE(array_agg(value::uuid ORDER BY value::uuid),'{}'::uuid[]) INTO current_ids FROM jsonb_array_elements_text(plan->'activeTeamIds');
  SELECT COALESCE(array_agg(value::uuid ORDER BY value::uuid),'{}'::uuid[]) INTO accepted FROM jsonb_array_elements_text(plan->'teamIds');
  IF p_next_round_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.rounds WHERE id=p_next_round_id AND phase='regular') THEN accepted:='{}'; END IF;
  SELECT COALESCE(array_agg(value ORDER BY value),'{}'::uuid[]) INTO selected_ids FROM unnest(p_pending_team_ids) value;
  IF accepted IS DISTINCT FROM selected_ids OR current_ids IS DISTINCT FROM
    (SELECT COALESCE(array_agg(value ORDER BY value),'{}'::uuid[]) FROM unnest(p_active_team_ids) value) THEN
    RAISE EXCEPTION 'Tournament membership changed; regenerate pairings' USING ERRCODE='40001';
  END IF;
  PERFORM set_config('ht120.membership_write','true',true);
  PERFORM set_config('ht120.membership_transition','true',true);
  FOR v_team_id IN SELECT value::uuid FROM jsonb_array_elements_text(plan->'departingTeamIds') LOOP
    PERFORM public.vacate_team_slot_in_current_season(p_tournament_id,p_season_number,v_team_id);
    DELETE FROM public.tournament_team_departures d WHERE d.team_id=v_team_id;
  END LOOP;
  -- Country-size dependencies were ordered by the plan; keep that order.
  FOR v_team_id IN SELECT value::uuid FROM jsonb_array_elements_text(plan->'teamIds') WHERE value::uuid=ANY(accepted) LOOP
    PERFORM public.activate_waiting_team(p_tournament_id,v_team_id,false,p_next_round_id);
  END LOOP;
  result:=public.apply_length_round_transition(p_tournament_id,p_season_number,p_completed_round_id,p_next_round_id,p_matches,p_champion_team_id);
  IF (cardinality(accepted)>0 OR jsonb_array_length(plan->'departingTeamIds')>0) AND result->>'next_round_materialized' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Round is not ready; membership remains unchanged' USING ERRCODE='40001'; END IF;
  PERFORM set_config('ht120.membership_write',COALESCE(previous_write,'false'),true);
  PERFORM set_config('ht120.membership_transition',COALESCE(previous_transition,'false'),true);
  RETURN result||jsonb_build_object('waiting',plan->'rejected');
END $$;
REVOKE ALL ON FUNCTION public.apply_length_round_transition_with_membership(uuid,integer,uuid,uuid,jsonb,uuid[],uuid[],text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_length_round_transition_with_membership(uuid,integer,uuid,uuid,jsonb,uuid[],uuid[],text,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.apply_length_round_transition_with_joins(
  p_tournament_id uuid,
  p_season_number integer,
  p_completed_round_id uuid,
  p_next_round_id uuid,
  p_matches jsonb,
  p_pending_team_ids uuid[],
  p_champion_team_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Round progression requires the updated membership-aware application' USING ERRCODE='55000'; END $$;

CREATE OR REPLACE FUNCTION public.process_tournament_team_departures() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_team_id uuid;
  previous_write text:=current_setting('ht120.membership_write',true);
BEGIN
  PERFORM set_config('ht120.membership_write','true',true);
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
            OR m.finished_at IS NOT NULL OR m.home_goals IS NOT NULL OR m.away_goals IS NOT NULL OR m.match_event_details IS NOT NULL
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
  PERFORM set_config('ht120.membership_write',COALESCE(previous_write,'false'),true);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.process_tournament_team_departures()
  FROM PUBLIC, anon, authenticated;


DO $$ BEGIN
 IF to_regprocedure('public.admit_length_schedule_reserves(uuid,integer,uuid,uuid,uuid[],jsonb,boolean)') IS NOT NULL THEN
   ALTER FUNCTION public.admit_length_schedule_reserves(uuid,integer,uuid,uuid,uuid[],jsonb,boolean) RENAME TO admit_length_schedule_reserves_before_137;
   EXECUTE $wrapper$CREATE FUNCTION public.admit_length_schedule_reserves(p_tournament_id uuid,p_season_number integer,p_round_id uuid,p_request_id uuid,p_team_ids uuid[],p_matches jsonb,p_raise_limit boolean) RETURNS jsonb
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $body$
     DECLARE result jsonb; previous_write text:=current_setting('ht120.membership_write',true);
     BEGIN
       PERFORM pg_advisory_xact_lock(120,113);
       PERFORM set_config('ht120.membership_write','true',true);
       UPDATE public.teams SET actively_waiting=false,pending_entry_round_id=NULL WHERE tournament_id=p_tournament_id AND id=ANY(p_team_ids) AND reserve_active;
       result:=public.admit_length_schedule_reserves_before_137(p_tournament_id,p_season_number,p_round_id,p_request_id,p_team_ids,p_matches,p_raise_limit);
       PERFORM set_config('ht120.membership_write',COALESCE(previous_write,'false'),true);
       RETURN result;
     END $body$ $wrapper$;
   REVOKE ALL ON FUNCTION public.admit_length_schedule_reserves(uuid,integer,uuid,uuid,uuid[],jsonb,boolean) FROM PUBLIC,anon,authenticated;
   GRANT EXECUTE ON FUNCTION public.admit_length_schedule_reserves(uuid,integer,uuid,uuid,uuid[],jsonb,boolean) TO service_role;
 END IF;
END $$;

DO $$ BEGIN
 IF to_regprocedure('public.admit_length_schedule_reserves_as_site_admin(uuid,integer,uuid,uuid,uuid[],jsonb)') IS NOT NULL THEN
   ALTER FUNCTION public.admit_length_schedule_reserves_as_site_admin(uuid,integer,uuid,uuid,uuid[],jsonb) RENAME TO admit_length_schedule_reserves_as_site_admin_before_137;
   EXECUTE $wrapper$CREATE FUNCTION public.admit_length_schedule_reserves_as_site_admin(p_tournament_id uuid,p_season_number integer,p_round_id uuid,p_request_id uuid,p_team_ids uuid[],p_matches jsonb) RETURNS jsonb
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $body$
     DECLARE result jsonb; previous_write text:=current_setting('ht120.membership_write',true);
     BEGIN
       PERFORM pg_advisory_xact_lock(120,113);
       PERFORM set_config('ht120.membership_write','true',true);
       UPDATE public.teams SET actively_waiting=false,pending_entry_round_id=NULL WHERE tournament_id=p_tournament_id AND id=ANY(p_team_ids) AND reserve_active;
       result:=public.admit_length_schedule_reserves_as_site_admin_before_137(p_tournament_id,p_season_number,p_round_id,p_request_id,p_team_ids,p_matches);
       PERFORM set_config('ht120.membership_write',COALESCE(previous_write,'false'),true);
       RETURN result;
     END $body$ $wrapper$;
   REVOKE ALL ON FUNCTION public.admit_length_schedule_reserves_as_site_admin(uuid,integer,uuid,uuid,uuid[],jsonb) FROM PUBLIC,anon,authenticated;
   GRANT EXECUTE ON FUNCTION public.admit_length_schedule_reserves_as_site_admin(uuid,integer,uuid,uuid,uuid[],jsonb) TO service_role;
 END IF;
END $$;

-- Preserve authorized fixed-format replacement and lifecycle operations.
DO $$ BEGIN
 IF to_regprocedure('public.fill_vacant_current_season_slot_with_reserve(uuid,integer,uuid)') IS NOT NULL THEN
   ALTER FUNCTION public.fill_vacant_current_season_slot_with_reserve(uuid,integer,uuid) RENAME TO fill_vacant_current_season_slot_with_reserve_before_137;
   EXECUTE $wrapper$CREATE FUNCTION public.fill_vacant_current_season_slot_with_reserve(p_tournament_id uuid,p_season_number integer,p_incoming_reserve_team_id uuid) RETURNS TABLE(slot_id uuid,incoming_assignment_id uuid,updated_match_count integer)
     LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $body$
     DECLARE previous_write text:=current_setting('ht120.membership_write',true);
     BEGIN
       PERFORM pg_advisory_xact_lock(120,113);
       PERFORM set_config('ht120.membership_write','true',true);
       UPDATE public.teams SET actively_waiting=false,pending_entry_round_id=NULL
         WHERE tournament_id=p_tournament_id AND id=p_incoming_reserve_team_id AND reserve_active;
       RETURN QUERY SELECT * FROM public.fill_vacant_current_season_slot_with_reserve_before_137(p_tournament_id,p_season_number,p_incoming_reserve_team_id);
       PERFORM set_config('ht120.membership_write',COALESCE(previous_write,'false'),true);
     END $body$ $wrapper$;
   REVOKE ALL ON FUNCTION public.fill_vacant_current_season_slot_with_reserve(uuid,integer,uuid) FROM PUBLIC,anon,authenticated;
   GRANT EXECUTE ON FUNCTION public.fill_vacant_current_season_slot_with_reserve(uuid,integer,uuid) TO service_role;
 END IF;
END $$;
DO $$ BEGIN
 IF to_regprocedure('public.swap_current_season_team_with_reserve(uuid,integer,uuid,uuid)') IS NOT NULL THEN
   ALTER FUNCTION public.swap_current_season_team_with_reserve(uuid,integer,uuid,uuid) RENAME TO swap_current_season_team_with_reserve_before_137;
   EXECUTE $wrapper$CREATE FUNCTION public.swap_current_season_team_with_reserve(p_tournament_id uuid,p_season_number integer,p_former_team_id uuid,p_incoming_reserve_team_id uuid) RETURNS TABLE(slot_id uuid,former_assignment_id uuid,incoming_assignment_id uuid,updated_match_count integer)
     LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $body$
     DECLARE previous_write text:=current_setting('ht120.membership_write',true);
     BEGIN
       PERFORM pg_advisory_xact_lock(120,113);
       PERFORM set_config('ht120.membership_write','true',true);
       UPDATE public.teams SET actively_waiting=false,pending_entry_round_id=NULL
         WHERE tournament_id=p_tournament_id AND id=p_incoming_reserve_team_id AND reserve_active;
       RETURN QUERY SELECT * FROM public.swap_current_season_team_with_reserve_before_137(p_tournament_id,p_season_number,p_former_team_id,p_incoming_reserve_team_id);
       PERFORM set_config('ht120.membership_write',COALESCE(previous_write,'false'),true);
     END $body$ $wrapper$;
   REVOKE ALL ON FUNCTION public.swap_current_season_team_with_reserve(uuid,integer,uuid,uuid) FROM PUBLIC,anon,authenticated;
   GRANT EXECUTE ON FUNCTION public.swap_current_season_team_with_reserve(uuid,integer,uuid,uuid) TO service_role;
 END IF;
END $$;
DO $$ BEGIN
 IF to_regprocedure('public.fill_past_team_slot_with_reserve(uuid,integer,uuid,uuid)') IS NOT NULL THEN
   ALTER FUNCTION public.fill_past_team_slot_with_reserve(uuid,integer,uuid,uuid) RENAME TO fill_past_team_slot_with_reserve_before_137;
   EXECUTE $wrapper$CREATE FUNCTION public.fill_past_team_slot_with_reserve(p_tournament_id uuid,p_season_number integer,p_former_team_id uuid,p_incoming_reserve_team_id uuid) RETURNS TABLE(slot_id uuid,incoming_assignment_id uuid,updated_match_count integer)
     LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $body$
     DECLARE previous_write text:=current_setting('ht120.membership_write',true);
     BEGIN
       PERFORM pg_advisory_xact_lock(120,113);
       PERFORM set_config('ht120.membership_write','true',true);
       UPDATE public.teams SET actively_waiting=false,pending_entry_round_id=NULL
         WHERE tournament_id=p_tournament_id AND id=p_incoming_reserve_team_id AND reserve_active;
       RETURN QUERY SELECT * FROM public.fill_past_team_slot_with_reserve_before_137(p_tournament_id,p_season_number,p_former_team_id,p_incoming_reserve_team_id);
       PERFORM set_config('ht120.membership_write',COALESCE(previous_write,'false'),true);
     END $body$ $wrapper$;
   REVOKE ALL ON FUNCTION public.fill_past_team_slot_with_reserve(uuid,integer,uuid,uuid) FROM PUBLIC,anon,authenticated;
   GRANT EXECUTE ON FUNCTION public.fill_past_team_slot_with_reserve(uuid,integer,uuid,uuid) TO service_role;
 END IF;
END $$;
DO $$ BEGIN
 IF to_regprocedure('public.start_tournament_season_with_commitment(uuid,integer,text,jsonb,timestamp with time zone)') IS NOT NULL THEN
   ALTER FUNCTION public.start_tournament_season_with_commitment(uuid,integer,text,jsonb,timestamp with time zone) RENAME TO start_tournament_season_with_commitment_before_137;
   EXECUTE $wrapper$CREATE FUNCTION public.start_tournament_season_with_commitment(p_tournament_id uuid,p_next_season_number integer,p_mode text,p_fixtures_snapshot jsonb,p_planned_start_slot timestamptz DEFAULT NULL) RETURNS jsonb
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $body$
     DECLARE result jsonb; previous_write text:=current_setting('ht120.membership_write',true);
     BEGIN
       PERFORM pg_advisory_xact_lock(120,113);
       PERFORM set_config('ht120.membership_write','true',true);
       result:=public.start_tournament_season_with_commitment_before_137(p_tournament_id,p_next_season_number,p_mode,p_fixtures_snapshot,p_planned_start_slot);
       PERFORM set_config('ht120.membership_write',COALESCE(previous_write,'false'),true);
       RETURN result;
     END $body$ $wrapper$;
   REVOKE ALL ON FUNCTION public.start_tournament_season_with_commitment(uuid,integer,text,jsonb,timestamp with time zone) FROM PUBLIC,anon,authenticated;
   GRANT EXECUTE ON FUNCTION public.start_tournament_season_with_commitment(uuid,integer,text,jsonb,timestamp with time zone) TO service_role;
 END IF;
END $$;
DO $$ BEGIN
 IF to_regprocedure('public.reset_current_season_to_planning(uuid,integer)') IS NOT NULL THEN
   ALTER FUNCTION public.reset_current_season_to_planning(uuid,integer) RENAME TO reset_current_season_to_planning_before_137;
   EXECUTE $wrapper$CREATE FUNCTION public.reset_current_season_to_planning(p_tournament_id uuid,p_season_number integer) RETURNS jsonb
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $body$
     DECLARE result jsonb; previous_write text:=current_setting('ht120.membership_write',true);
     BEGIN
       PERFORM pg_advisory_xact_lock(120,113);
       PERFORM set_config('ht120.membership_write','true',true);
       result:=public.reset_current_season_to_planning_before_137(p_tournament_id,p_season_number);
       PERFORM set_config('ht120.membership_write',COALESCE(previous_write,'false'),true);
       RETURN result;
     END $body$ $wrapper$;
   REVOKE ALL ON FUNCTION public.reset_current_season_to_planning(uuid,integer) FROM PUBLIC,anon,authenticated;
   GRANT EXECUTE ON FUNCTION public.reset_current_season_to_planning(uuid,integer) TO service_role;
 END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
