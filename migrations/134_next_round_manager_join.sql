-- Pending manager joins are inactive team registrations until the next regular
-- round is atomically materialized. Apply before deploying the matching API.
BEGIN;

DO $$ BEGIN
  IF to_regprocedure('public.apply_length_round_transition(uuid,integer,uuid,uuid,jsonb,uuid)') IS NULL
    OR to_regprocedure('public.country_size_snapshot_count(bigint)') IS NULL
    OR to_regprocedure('public.tournament_is_exclusive(text,boolean,text)') IS NULL THEN
    RAISE EXCEPTION 'Apply the existing length-schedule and membership migrations before 134';
  END IF;
END $$;

ALTER TABLE public.teams
  ADD COLUMN pending_entry_round_id uuid REFERENCES public.rounds(id) ON DELETE SET NULL;
CREATE INDEX teams_pending_entry_round_idx ON public.teams(pending_entry_round_id)
  WHERE pending_entry_round_id IS NOT NULL;

-- The existing teams Data API policies predate this column. Pending state and
-- its team snapshot are service-RPC owned, including withdrawal and admission.
CREATE FUNCTION public.guard_pending_team_writes() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.pending_entry_round_id IS NOT NULL
      AND current_setting('ht120.pending_join_write', true) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Pending round registration requires the authorized service route' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF (TG_OP = 'INSERT' AND NEW.pending_entry_round_id IS NOT NULL)
    OR (TG_OP = 'UPDATE' AND (OLD.pending_entry_round_id IS NOT NULL OR NEW.pending_entry_round_id IS NOT NULL)) THEN
    IF current_setting('ht120.pending_join_write', true) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Pending round registration requires the authorized service route' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_pending_team_writes
BEFORE INSERT OR UPDATE OR DELETE ON public.teams FOR EACH ROW
EXECUTE FUNCTION public.guard_pending_team_writes();
REVOKE ALL ON FUNCTION public.guard_pending_team_writes() FROM PUBLIC, anon, authenticated;

-- An old application instance must fail closed if it tries to materialize a
-- round without admitting its pending roster first.
CREATE FUNCTION public.guard_pending_next_round_joins() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.phase_status = 'materialized' AND OLD.phase_status = 'pending'
    AND EXISTS (SELECT 1 FROM public.teams WHERE pending_entry_round_id = NEW.id) THEN
    RAISE EXCEPTION 'Pending next-round joins require the updated round transition' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_pending_next_round_joins
BEFORE UPDATE OF phase_status ON public.rounds FOR EACH ROW
EXECUTE FUNCTION public.guard_pending_next_round_joins();
REVOKE ALL ON FUNCTION public.guard_pending_next_round_joins() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.request_next_round_tournament_join(p_tournament_id uuid, p_values jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t public.tournaments%ROWTYPE;
  current_round public.rounds%ROWTYPE;
  next_round public.rounds%ROWTYPE;
  candidate public.teams%ROWTYPE;
  existing public.teams%ROWTYPE;
  saved_id uuid;
  occupied_count integer;
  pending_count integer;
  small_count integer;
  large_count integer;
  small_active_count integer;
  large_active_count integer;
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
  SELECT * INTO current_round FROM public.rounds
    WHERE tournament_id = t.id AND season_number = COALESCE(t.season,1)
      AND phase_status = 'materialized' ORDER BY round_number DESC LIMIT 1 FOR UPDATE;
  SELECT * INTO next_round FROM public.rounds
    WHERE tournament_id = t.id AND season_number = COALESCE(t.season,1)
      AND phase = 'regular' AND phase_status = 'pending'
      AND round_number = current_round.round_number + 1 FOR UPDATE;
  IF current_round.id IS NULL OR current_round.phase IS DISTINCT FROM 'regular' OR next_round.id IS NULL THEN
    RAISE EXCEPTION 'There is no next regular round open for joining' USING ERRCODE = '55000';
  END IF;
  PERFORM pg_advisory_xact_lock(candidate.ht_team_id);
  SELECT * INTO existing FROM public.teams
    WHERE tournament_id = t.id AND ht_team_id = candidate.ht_team_id FOR UPDATE;
  IF existing.active OR existing.reserve_active OR existing.pending_entry_round_id IS NOT NULL THEN
    RAISE EXCEPTION 'This team is already participating or registered' USING ERRCODE = '23505';
  END IF;
  IF existing.id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.tournament_season_slot_assignments a
      JOIN public.tournament_season_slots s ON s.id = a.tournament_season_slot_id
      JOIN public.tournament_seasons se ON se.id = s.tournament_season_id
      WHERE se.tournament_id = t.id AND se.season_number = COALESCE(t.season,1)
        AND a.team_id = existing.id)
    OR EXISTS (SELECT 1 FROM public.tournament_season_slots s JOIN public.tournament_seasons se
      ON se.id = s.tournament_season_id WHERE se.tournament_id = t.id
      AND se.season_number = COALESCE(t.season,1) AND s.current_team_id = existing.id)
    OR EXISTS (SELECT 1 FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
      WHERE r.tournament_id = t.id AND r.season_number = COALESCE(t.season,1)
      AND (m.home_team_id = existing.id OR m.away_team_id = existing.id OR m.reserve_team_id = existing.id)
      AND m.completed IS DISTINCT FROM true AND m.status IS DISTINCT FROM 'finished')) THEN
    RAISE EXCEPTION 'This team already has current-season history or a fixture commitment' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.teams other JOIN public.tournaments ot ON ot.id = other.tournament_id
    WHERE other.ht_team_id = candidate.ht_team_id AND other.tournament_id <> t.id
      AND ((other.active AND NOT COALESCE(other.reserve_active,false)
        AND public.tournament_is_exclusive(ot.status, ot.is_test, ot.registration_type))
        OR other.pending_entry_round_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'This team participates in another active tournament' USING ERRCODE = '23505';
  END IF;
  IF (t.league_category = 'hfi') IS DISTINCT FROM (candidate.league_id = 3000)
    OR (t.country_limit IS NOT NULL AND t.country_limit <> '' AND
      (CASE WHEN t.country_limit ~ '^[0-9]+$' THEN
        (CASE WHEN t.country_limit_format = 'country_id' THEN candidate.country_id
          ELSE candidate.league_id END) IS DISTINCT FROM t.country_limit::integer
       ELSE candidate.country_name IS DISTINCT FROM t.country_limit END)) THEN
    RAISE EXCEPTION 'This team is not eligible for this tournament' USING ERRCODE = '23514';
  END IF;
  IF t.max_country_active_teams IS NOT NULL
    AND COALESCE(public.country_size_snapshot_count(candidate.country_id) > t.max_country_active_teams,true) THEN
    SELECT count(*) FILTER (WHERE public.country_size_snapshot_count(country_id) <= t.max_country_active_teams),
      count(*) FILTER (WHERE COALESCE(public.country_size_snapshot_count(country_id) > t.max_country_active_teams,true)),
      count(*) FILTER (WHERE (active OR pending_entry_round_id IS NOT NULL)
        AND public.country_size_snapshot_count(country_id) <= t.max_country_active_teams),
      count(*) FILTER (WHERE (active OR pending_entry_round_id IS NOT NULL)
        AND COALESCE(public.country_size_snapshot_count(country_id) > t.max_country_active_teams,true))
      INTO small_count, large_count, small_active_count, large_active_count FROM public.teams
      WHERE tournament_id = t.id AND hattrick_user_id = candidate.hattrick_user_id
        AND id IS DISTINCT FROM existing.id AND (active OR reserve_active OR pending_entry_round_id IS NOT NULL);
    IF NOT COALESCE(t.allow_manager_country_size_exception,false)
      OR small_count <= large_count OR small_active_count <= large_active_count THEN
      RAISE EXCEPTION 'The country-size registration allowance is unavailable' USING ERRCODE = '23514';
    END IF;
  END IF;
  SELECT count(*) INTO occupied_count FROM public.tournament_season_slots s
    JOIN public.tournament_seasons se ON se.id = s.tournament_season_id
    WHERE se.tournament_id = t.id AND se.season_number = COALESCE(t.season,1)
      AND s.current_team_id IS NOT NULL;
  SELECT count(*) INTO pending_count FROM public.teams
    WHERE tournament_id = t.id AND pending_entry_round_id = next_round.id;
  IF t.max_teams > 0 AND occupied_count + pending_count >= t.max_teams THEN
    RAISE EXCEPTION 'This tournament is full' USING ERRCODE = '23505';
  END IF;
  PERFORM set_config('ht120.pending_join_write', 'true', true);
  IF existing.id IS NULL THEN
    INSERT INTO public.teams(tournament_id, ht_team_id, name, ht_team_name, hattrick_user_id,
      manager_name, country_id, country_name, league_id, gender_id, league_level, team_rank,
      power_rating, power_global_rank, power_league_rank, power_region_rank, logo_url, join_story,
      oauth_token, oauth_token_secret, joined_via_oauth, active, reserve_active, pending_entry_round_id)
    VALUES(t.id, candidate.ht_team_id, candidate.name, candidate.ht_team_name,
      candidate.hattrick_user_id, candidate.manager_name, candidate.country_id, candidate.country_name,
      candidate.league_id, candidate.gender_id, candidate.league_level, candidate.team_rank,
      candidate.power_rating, candidate.power_global_rank, candidate.power_league_rank,
      candidate.power_region_rank, candidate.logo_url, candidate.join_story,
      candidate.oauth_token, candidate.oauth_token_secret, true, false, false, next_round.id)
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
      joined_via_oauth = true, pending_entry_round_id = next_round.id
      WHERE id = existing.id RETURNING id INTO saved_id;
  END IF;
  PERFORM set_config('ht120.pending_join_write', 'false', true);
  RETURN saved_id;
END $$;
REVOKE ALL ON FUNCTION public.request_next_round_tournament_join(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_next_round_tournament_join(uuid,jsonb) TO service_role;

CREATE FUNCTION public.withdraw_next_round_tournament_join(
  p_tournament_id uuid, p_team_id uuid, p_manager_id bigint
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE saved_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(120,113);
  PERFORM 1 FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tournament not found' USING ERRCODE='P0002'; END IF;
  PERFORM set_config('ht120.pending_join_write','true',true);
  UPDATE public.teams SET pending_entry_round_id=NULL
    WHERE id=p_team_id AND tournament_id=p_tournament_id
      AND hattrick_user_id=p_manager_id AND pending_entry_round_id IS NOT NULL
      AND active=false AND reserve_active=false
    RETURNING id INTO saved_id;
  PERFORM set_config('ht120.pending_join_write','false',true);
  IF saved_id IS NULL THEN RAISE EXCEPTION 'Pending registration not found' USING ERRCODE='P0002'; END IF;
  RETURN saved_id;
END $$;
REVOKE ALL ON FUNCTION public.withdraw_next_round_tournament_join(uuid,uuid,bigint)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_next_round_tournament_join(uuid,uuid,bigint) TO service_role;

CREATE FUNCTION public.apply_length_round_transition_with_joins(
  p_tournament_id uuid,
  p_season_number integer,
  p_completed_round_id uuid,
  p_next_round_id uuid,
  p_matches jsonb,
  p_pending_team_ids uuid[],
  p_champion_team_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tournament public.tournaments%ROWTYPE;
  v_season public.tournament_seasons%ROWTYPE;
  v_next public.rounds%ROWTYPE;
  v_pending public.teams%ROWTYPE;
  v_pending_ids uuid[];
  v_slot_index integer;
  v_box_size integer;
  v_occupied_count integer;
  v_slot_id uuid;
  v_small_count integer;
  v_large_count integer;
  v_small_active_count integer;
  v_large_active_count integer;
  v_result jsonb;
BEGIN
  -- Match the membership trigger's lock order. A manager request or withdrawal
  -- cannot change the paired roster between the check and the old transition.
  PERFORM pg_advisory_xact_lock(120,113);
  SELECT * INTO v_tournament FROM public.tournaments
    WHERE id=p_tournament_id AND COALESCE(season,1)=p_season_number
      AND schedule_mode='length' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Length-scheduled tournament not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_season FROM public.tournament_seasons
    WHERE tournament_id=p_tournament_id AND season_number=p_season_number FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tournament season not found' USING ERRCODE='P0002'; END IF;

  IF p_next_round_id IS NOT NULL THEN
    SELECT * INTO v_next FROM public.rounds WHERE id=p_next_round_id
      AND tournament_id=p_tournament_id AND season_number=p_season_number FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Next reserved round is invalid' USING ERRCODE='22023'; END IF;
  END IF;
  IF p_next_round_id IS NOT NULL THEN
    PERFORM 1 FROM public.teams WHERE pending_entry_round_id=p_next_round_id FOR UPDATE;
    SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::uuid[]) INTO v_pending_ids
      FROM public.teams WHERE pending_entry_round_id=p_next_round_id;
  ELSE
    v_pending_ids := ARRAY[]::uuid[];
  END IF;
  IF v_pending_ids IS DISTINCT FROM COALESCE(
    (SELECT array_agg(team_id ORDER BY team_id) FROM unnest(p_pending_team_ids) AS team_id), ARRAY[]::uuid[])
    OR array_position(p_pending_team_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Pending next-round roster changed; retry progression' USING ERRCODE='40001';
  END IF;

  IF cardinality(v_pending_ids)>0 THEN
    IF v_next.phase IS DISTINCT FROM 'regular' OR v_next.phase_status IS DISTINCT FROM 'pending'
      OR v_tournament.status IS DISTINCT FROM 'active'
      OR v_tournament.registration_closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Next-round participant registration is closed' USING ERRCODE='55000';
    END IF;
    SELECT count(*) INTO v_occupied_count FROM public.tournament_season_slots
      WHERE tournament_season_id=v_season.id AND current_team_id IS NOT NULL;
    IF v_tournament.max_teams>0 AND v_occupied_count+cardinality(v_pending_ids)>v_tournament.max_teams THEN
      RAISE EXCEPTION 'Next-round participant limit changed' USING ERRCODE='23505';
    END IF;
    SELECT COALESCE(max(slot_index),0) INTO v_slot_index FROM public.tournament_season_slots
      WHERE tournament_season_id=v_season.id;
    v_box_size:=v_slot_index+2*cardinality(v_pending_ids);
    IF v_box_size%2<>0 THEN RAISE EXCEPTION 'Season slot box is inconsistent' USING ERRCODE='22023'; END IF;

    -- This entire function and the existing transition are one transaction.
    -- Any failed eligibility, assignment, pairing or unresolved-round check
    -- rolls back every new slot, team activation and fixture together.
    PERFORM set_config('ht120.pending_join_write','true',true);
    UPDATE public.tournament_season_slots SET box_size=v_box_size
      WHERE tournament_season_id=v_season.id;
    FOR v_pending IN SELECT * FROM public.teams
      WHERE pending_entry_round_id=v_next.id ORDER BY ht_team_id FOR UPDATE LOOP
      IF v_pending.tournament_id<>p_tournament_id OR v_pending.active OR v_pending.reserve_active
        OR COALESCE(v_pending.is_placeholder,false)
        OR (v_tournament.league_category='hfi') IS DISTINCT FROM (v_pending.league_id=3000)
        OR (v_tournament.country_limit IS NOT NULL AND v_tournament.country_limit<>'' AND
          (CASE WHEN v_tournament.country_limit ~ '^[0-9]+$' THEN
            (CASE WHEN v_tournament.country_limit_format='country_id' THEN v_pending.country_id
              ELSE v_pending.league_id END) IS DISTINCT FROM v_tournament.country_limit::integer
           ELSE v_pending.country_name IS DISTINCT FROM v_tournament.country_limit END)) THEN
        RAISE EXCEPTION 'Pending team eligibility changed; review registration' USING ERRCODE='23514';
      END IF;
      IF EXISTS (SELECT 1 FROM public.teams other JOIN public.tournaments ot ON ot.id=other.tournament_id
        WHERE other.ht_team_id=v_pending.ht_team_id AND other.tournament_id<>p_tournament_id
          AND ((other.active AND NOT COALESCE(other.reserve_active,false)
            AND public.tournament_is_exclusive(ot.status,ot.is_test,ot.registration_type))
            OR other.pending_entry_round_id IS NOT NULL)) THEN
        RAISE EXCEPTION 'Pending team now participates in another tournament' USING ERRCODE='23505';
      END IF;
      IF v_tournament.max_country_active_teams IS NOT NULL
        AND COALESCE(public.country_size_snapshot_count(v_pending.country_id)>v_tournament.max_country_active_teams,true) THEN
        SELECT count(*) FILTER (WHERE public.country_size_snapshot_count(country_id)<=v_tournament.max_country_active_teams),
          count(*) FILTER (WHERE COALESCE(public.country_size_snapshot_count(country_id)>v_tournament.max_country_active_teams,true)),
          count(*) FILTER (WHERE (active OR pending_entry_round_id IS NOT NULL)
            AND public.country_size_snapshot_count(country_id)<=v_tournament.max_country_active_teams),
          count(*) FILTER (WHERE (active OR pending_entry_round_id IS NOT NULL)
            AND COALESCE(public.country_size_snapshot_count(country_id)>v_tournament.max_country_active_teams,true))
          INTO v_small_count,v_large_count,v_small_active_count,v_large_active_count FROM public.teams
          WHERE tournament_id=p_tournament_id AND hattrick_user_id=v_pending.hattrick_user_id
            AND id<>v_pending.id AND (active OR reserve_active OR pending_entry_round_id IS NOT NULL);
        IF NOT COALESCE(v_tournament.allow_manager_country_size_exception,false)
          OR v_small_count<=v_large_count OR v_small_active_count<=v_large_active_count THEN
          RAISE EXCEPTION 'Pending team country-size eligibility changed' USING ERRCODE='23514';
        END IF;
      END IF;
      v_slot_index:=v_slot_index+1;
      INSERT INTO public.tournament_season_slots(tournament_season_id,slot_index,box_size,current_team_id)
        VALUES(v_season.id,v_slot_index,v_box_size,v_pending.id) RETURNING id INTO v_slot_id;
      INSERT INTO public.tournament_season_slot_assignments(
        tournament_season_slot_id,team_id,reason,team_name,ht_team_id,manager_name,hattrick_user_id,
        logo_url,admission_request_id,entry_round_id,ranking_source,ranking_value)
        VALUES(v_slot_id,v_pending.id,'reserve_admission',v_pending.name,v_pending.ht_team_id,
          v_pending.manager_name,v_pending.hattrick_user_id,v_pending.logo_url,gen_random_uuid(),v_next.id,
          CASE WHEN v_tournament.league_category='hfi' THEN 'team_rank' ELSE 'power_rating' END,
          CASE WHEN v_tournament.league_category='hfi' THEN v_pending.team_rank ELSE v_pending.power_rating END);
      v_slot_index:=v_slot_index+1;
      INSERT INTO public.tournament_season_slots(tournament_season_id,slot_index,box_size)
        VALUES(v_season.id,v_slot_index,v_box_size);
      UPDATE public.teams SET active=true,reserve_active=false,pending_entry_round_id=NULL
        WHERE id=v_pending.id;
    END LOOP;
    PERFORM set_config('ht120.pending_join_write','false',true);
  END IF;

  v_result:=public.apply_length_round_transition(
    p_tournament_id,p_season_number,p_completed_round_id,p_next_round_id,p_matches,p_champion_team_id);
  IF cardinality(v_pending_ids)>0 AND v_result->>'next_round_materialized' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Next-round admission could not complete; pending teams remain queued' USING ERRCODE='55000';
  END IF;
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.apply_length_round_transition_with_joins(uuid,integer,uuid,uuid,jsonb,uuid[],uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_length_round_transition_with_joins(uuid,integer,uuid,uuid,jsonb,uuid[],uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
