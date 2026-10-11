-- Preflight: confirm 107 functions and season-slot constraints in the target database;
-- inspect pg_get_functiondef and pg_constraint before applying this additive extension.
-- Prepared locally. Apply after 107; no live database application is implied.
BEGIN;
ALTER TABLE public.tournament_season_slot_assignments
  ADD COLUMN IF NOT EXISTS admission_request_id uuid,
  ADD COLUMN IF NOT EXISTS entry_round_id uuid REFERENCES public.rounds(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ranking_source text CHECK (ranking_source IN ('team_rank', 'power_rating')),
  ADD COLUMN IF NOT EXISTS ranking_value numeric;
ALTER TABLE public.tournament_season_slot_assignments DROP CONSTRAINT IF EXISTS tournament_season_slot_assignments_reason_check;
ALTER TABLE public.tournament_season_slot_assignments ADD CONSTRAINT tournament_season_slot_assignments_reason_check CHECK(reason IN ('schedule_backfill','admin_replace','reserve_admission'));
CREATE INDEX IF NOT EXISTS season_assignment_admission_request ON public.tournament_season_slot_assignments(admission_request_id) WHERE admission_request_id IS NOT NULL;

-- Private candidate lookup; cached ownership is only a hint for a fresh CHPP check.
CREATE OR REPLACE FUNCTION public.find_known_team_managers(p_ht_team_id integer)
RETURNS TABLE(hattrick_user_id bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; cached jsonb;
BEGIN
  RETURN QUERY SELECT DISTINCT t.hattrick_user_id::bigint FROM teams t
    WHERE t.ht_team_id=p_ht_team_id AND t.hattrick_user_id IS NOT NULL;
  FOR r IN SELECT p.hattrick_user_id, p.teams_json FROM profiles p WHERE p.teams_json IS NOT NULL LOOP
    BEGIN
      cached := CASE WHEN jsonb_typeof(r.teams_json)='string' THEN (r.teams_json#>>'{}')::jsonb ELSE r.teams_json END;
      IF jsonb_typeof(cached)='array' THEN
        IF EXISTS(SELECT 1 FROM jsonb_array_elements(cached) x WHERE x->>'teamId'=p_ht_team_id::text) THEN
          hattrick_user_id := r.hattrick_user_id; RETURN NEXT;
        END IF;
      END IF;
    EXCEPTION WHEN invalid_text_representation THEN CONTINUE;
    END;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.find_known_team_managers(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_known_team_managers(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.admit_length_schedule_reserves(
  p_tournament_id uuid, p_season_number integer, p_round_id uuid,
  p_request_id uuid, p_team_ids uuid[], p_matches jsonb, p_raise_limit boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t tournaments%ROWTYPE; s tournament_seasons%ROWTYPE; r rounds%ROWTYPE;
  member teams%ROWTYPE; fixture jsonb; team_id uuid; slot_id uuid; assignment_id uuid;
  home_id uuid; away_id uuid; home_slot uuid; away_slot uuid; home_assignment uuid; away_assignment uuid;
  seen uuid[] := '{}'; slot_index_next integer; box integer; field integer; source text;
  repeated integer; new_count integer := cardinality(p_team_ids);
BEGIN
  IF p_request_id IS NULL OR new_count IS NULL OR new_count<2 OR new_count%2<>0
    OR (SELECT count(DISTINCT x) FROM unnest(p_team_ids) x)<>new_count OR array_position(p_team_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Select an even number of at least two reserves' USING ERRCODE='22023';
  END IF;
  SELECT * INTO t FROM tournaments WHERE id=p_tournament_id FOR UPDATE;
  IF NOT FOUND OR t.schedule_mode IS DISTINCT FROM 'length' OR COALESCE(t.season,1)<>p_season_number OR COALESCE(t.is_archived,false) OR t.status IN ('finished','stopped','archived') THEN
    RAISE EXCEPTION 'This season is unavailable for reserve admission' USING ERRCODE='22023'; END IF;
  SELECT * INTO s FROM tournament_seasons WHERE tournament_id=t.id AND season_number=p_season_number FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Season not found' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM rounds WHERE id=p_round_id AND tournament_id=t.id AND season_number=p_season_number FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Round not found' USING ERRCODE='22023'; END IF;
  SELECT count(*) INTO repeated FROM tournament_season_slot_assignments a JOIN tournament_season_slots ss ON ss.id=a.tournament_season_slot_id
    WHERE a.admission_request_id=p_request_id AND ss.tournament_season_id=s.id;
  IF repeated>0 THEN
    IF repeated<>new_count OR EXISTS(SELECT 1 FROM tournament_season_slot_assignments a JOIN tournament_season_slots ss ON ss.id=a.tournament_season_slot_id
      WHERE a.admission_request_id=p_request_id AND ss.tournament_season_id=s.id AND (a.entry_round_id<>r.id OR NOT a.team_id=ANY(p_team_ids))) THEN
      RAISE EXCEPTION 'Admission request does not match its original selection' USING ERRCODE='22023'; END IF;
    RETURN jsonb_build_object('admitted',new_count,'already_applied',true,'round_id',r.id);
  END IF;
  IF r.phase IS DISTINCT FROM 'regular' OR r.phase_status IS DISTINCT FROM 'materialized' OR EXISTS(SELECT 1 FROM rounds WHERE tournament_id=t.id AND season_number=p_season_number AND phase='postseason' AND phase_status<>'pending') THEN
    RAISE EXCEPTION 'Choose the current regular round before playoffs begin' USING ERRCODE='22023'; END IF;
  FOR member IN SELECT * FROM teams WHERE id=ANY(p_team_ids) ORDER BY ht_team_id LOOP
    PERFORM pg_advisory_xact_lock(member.ht_team_id);
  END LOOP;
  PERFORM 1 FROM teams WHERE id=ANY(p_team_ids) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM tournament_season_slots WHERE tournament_season_id=s.id FOR UPDATE;
  PERFORM 1 FROM matches WHERE round_id=r.id FOR UPDATE;
  IF (SELECT count(*) FROM teams WHERE id=ANY(p_team_ids) AND tournament_id=t.id AND active=false AND reserve_active=true AND COALESCE(is_placeholder,false)=false)<>new_count THEN
    RAISE EXCEPTION 'The selected reserve list changed; refresh and check again' USING ERRCODE='40001'; END IF;
  IF EXISTS(SELECT 1 FROM teams incoming JOIN teams other ON other.ht_team_id=incoming.ht_team_id JOIN tournaments ot ON ot.id=other.tournament_id
      WHERE incoming.id=ANY(p_team_ids) AND other.tournament_id<>t.id AND other.active=true AND COALESCE(other.reserve_active,false)=false
      AND ot.status NOT IN ('finished','stopped') AND COALESCE(ot.is_test,false)=false AND COALESCE(ot.registration_type,'')<>'sandbox') THEN
    RAISE EXCEPTION 'A selected team participates in another active tournament' USING ERRCODE='40001'; END IF;
  IF EXISTS(SELECT 1 FROM tournament_season_slots WHERE tournament_season_id=s.id AND current_team_id=ANY(p_team_ids)) OR
     EXISTS(SELECT 1 FROM matches WHERE round_id=r.id AND (home_team_id=ANY(p_team_ids) OR away_team_id=ANY(p_team_ids) OR reserve_team_id=ANY(p_team_ids))) THEN
    RAISE EXCEPTION 'A selected reserve already has a slot or fixture' USING ERRCODE='40001'; END IF;
  SELECT count(*)+new_count INTO field FROM tournament_season_slots WHERE tournament_season_id=s.id AND current_team_id IS NOT NULL;
  IF t.max_teams IS NOT NULL AND field>t.max_teams THEN
    IF NOT p_raise_limit THEN RAISE EXCEPTION 'Confirm increasing the team limit' USING ERRCODE='22023'; END IF;
    UPDATE tournaments SET max_teams=field WHERE id=t.id;
  END IF;
  IF jsonb_typeof(p_matches)<>'array' OR jsonb_array_length(p_matches)<>new_count/2 THEN RAISE EXCEPTION 'Invalid reserve pairs' USING ERRCODE='22023'; END IF;
  FOR fixture IN SELECT value FROM jsonb_array_elements(p_matches) LOOP
    home_id := (fixture->>'home_team_id')::uuid; away_id := (fixture->>'away_team_id')::uuid;
    IF home_id IS NULL OR away_id IS NULL OR home_id=away_id OR NOT home_id=ANY(p_team_ids) OR NOT away_id=ANY(p_team_ids)
      OR home_id=ANY(seen) OR away_id=ANY(seen) OR NULLIF(fixture->>'scheduled_for','') IS NULL THEN
      RAISE EXCEPTION 'Invalid or duplicate reserve participant' USING ERRCODE='22023'; END IF;
    seen := seen || ARRAY[home_id,away_id];
  END LOOP;
  source := CASE WHEN t.league_category='hfi' THEN 'team_rank' ELSE 'power_rating' END;
  SELECT COALESCE(max(slot_index),0) INTO slot_index_next FROM tournament_season_slots WHERE tournament_season_id=s.id;
  box := slot_index_next+new_count;
  UPDATE tournament_season_slots SET box_size=box WHERE tournament_season_id=s.id;
  FOREACH team_id IN ARRAY p_team_ids LOOP
    SELECT * INTO member FROM teams WHERE id=team_id;
    IF source='team_rank' AND COALESCE(member.team_rank,0)<=0 THEN RAISE EXCEPTION 'Update HFI ranks before admission' USING ERRCODE='22023'; END IF;
    slot_index_next := slot_index_next+1;
    INSERT INTO tournament_season_slots(tournament_season_id,slot_index,box_size,current_team_id)
      VALUES(s.id,slot_index_next,box,team_id) RETURNING id INTO slot_id;
    INSERT INTO tournament_season_slot_assignments(tournament_season_slot_id,team_id,reason,team_name,ht_team_id,manager_name,hattrick_user_id,logo_url,
        admission_request_id,entry_round_id,ranking_source,ranking_value)
      VALUES(slot_id,team_id,'reserve_admission',member.name,member.ht_team_id,member.manager_name,member.hattrick_user_id,member.logo_url,
        p_request_id,r.id,source,CASE WHEN source='team_rank' THEN member.team_rank ELSE member.power_rating END) RETURNING id INTO assignment_id;
    UPDATE teams SET active=true,reserve_active=false,reserve_joined_at=NULL WHERE id=team_id;
  END LOOP;
  FOR fixture IN SELECT value FROM jsonb_array_elements(p_matches) LOOP
    home_id := (fixture->>'home_team_id')::uuid; away_id := (fixture->>'away_team_id')::uuid;
    SELECT ss.id,a.id INTO home_slot,home_assignment FROM tournament_season_slots ss JOIN tournament_season_slot_assignments a ON a.tournament_season_slot_id=ss.id AND a.released_at IS NULL WHERE ss.tournament_season_id=s.id AND ss.current_team_id=home_id;
    SELECT ss.id,a.id INTO away_slot,away_assignment FROM tournament_season_slots ss JOIN tournament_season_slot_assignments a ON a.tournament_season_slot_id=ss.id AND a.released_at IS NULL WHERE ss.tournament_season_id=s.id AND ss.current_team_id=away_id;
    INSERT INTO matches(round_id,home_team_id,away_team_id,home_slot_id,away_slot_id,home_slot_assignment_id,away_slot_assignment_id,
      venue_type,scheduled_for,schedule_slot_type,status,completed,schedule_resolution)
    VALUES(r.id,home_id,away_id,home_slot,away_slot,home_assignment,away_assignment,'home_away',(fixture->>'scheduled_for')::timestamptz,r.reserved_slot_kind,'not_arranged',false,'pending');
  END LOOP;
  RETURN jsonb_build_object('admitted',new_count,'already_applied',false,'round_id',r.id);
END $$;
REVOKE ALL ON FUNCTION public.admit_length_schedule_reserves(uuid,integer,uuid,uuid,uuid[],jsonb,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_length_schedule_reserves(uuid,integer,uuid,uuid,uuid[],jsonb,boolean) TO service_role;
CREATE OR REPLACE FUNCTION public.get_length_reserve_admission_receipt(p_tournament_id uuid,p_round_id uuid,p_request_id uuid,p_team_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ids uuid[]; target uuid;
BEGIN
  SELECT array_agg(a.team_id ORDER BY a.team_id), min(a.entry_round_id::text)::uuid INTO ids,target
    FROM tournament_season_slot_assignments a JOIN tournament_season_slots ss ON ss.id=a.tournament_season_slot_id
    JOIN tournament_seasons se ON se.id=ss.tournament_season_id
    WHERE a.admission_request_id=p_request_id AND se.tournament_id=p_tournament_id;
  IF ids IS NULL THEN RETURN NULL; END IF;
  IF ids IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(p_team_ids) x) OR target IS DISTINCT FROM p_round_id THEN
    RAISE EXCEPTION 'Admission request does not match its original selection' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('admitted',cardinality(ids),'already_applied',true,'round_id',target);
END $$;
REVOKE ALL ON FUNCTION public.get_length_reserve_admission_receipt(uuid,uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_length_reserve_admission_receipt(uuid,uuid,uuid,uuid[]) TO service_role;
COMMIT;

-- applied!