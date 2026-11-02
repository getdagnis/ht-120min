-- Prepared locally. Apply only after reviewing the complete repair flow and
-- testing against a disposable PostgreSQL database. No live application implied.
BEGIN;

CREATE OR REPLACE FUNCTION public.apply_reviewed_length_round_repair(
  p_tournament_id uuid, p_season_number integer, p_round_id uuid,
  p_expected_match_ids uuid[], p_expected_matches jsonb, p_kept_match_ids uuid[],
  p_lobby_team_ids uuid[], p_matches jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  t public.tournaments%ROWTYPE;
  season public.tournament_seasons%ROWTYPE;
  round_row public.rounds%ROWTYPE;
  team_row public.teams%ROWTYPE;
  fixture jsonb;
  team_id uuid;
  home_id uuid;
  away_id uuid;
  home_slot uuid;
  away_slot uuid;
  home_assignment uuid;
  away_assignment uuid;
  seen uuid[] := '{}';
  expected uuid[];
  present uuid[];
  present_matches jsonb;
  next_index integer;
  new_box integer;
  slot_box integer;
  new_slot uuid;
  source text;
  previous_write text := current_setting('ht120.membership_write',true);
  deleted_count integer;
BEGIN
  IF p_round_id IS NULL OR p_tournament_id IS NULL OR p_season_number < 1 OR
    jsonb_typeof(p_matches) IS DISTINCT FROM 'array' OR jsonb_typeof(p_expected_matches) IS DISTINCT FROM 'array' OR
    p_expected_match_ids IS NULL OR p_kept_match_ids IS NULL OR p_lobby_team_ids IS NULL OR
    cardinality(p_expected_match_ids) > 256 OR cardinality(p_lobby_team_ids) > 256 OR
    (SELECT count(DISTINCT x) FROM unnest(p_lobby_team_ids) x) <> cardinality(p_lobby_team_ids) THEN
    RAISE EXCEPTION 'Invalid round repair request' USING ERRCODE='22023';
  END IF;
  SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
  IF NOT FOUND OR t.schedule_mode IS DISTINCT FROM 'length' OR COALESCE(t.season,1)<>p_season_number
     OR COALESCE(t.is_archived,false) OR t.status IN ('finished','stopped','archived') THEN
    RAISE EXCEPTION 'This tournament cannot be repaired' USING ERRCODE='22023';
  END IF;
  SELECT * INTO season FROM public.tournament_seasons
    WHERE tournament_id=t.id AND season_number=p_season_number FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Season not found' USING ERRCODE='22023'; END IF;
  SELECT * INTO round_row FROM public.rounds
    WHERE id=p_round_id AND tournament_id=t.id AND season_number=p_season_number FOR UPDATE;
  IF NOT FOUND OR round_row.phase IS DISTINCT FROM 'regular' OR round_row.phase_status IS DISTINCT FROM 'materialized'
    OR round_row.round_source = 'organizer' OR COALESCE(round_row.is_unscored,false) THEN
    RAISE EXCEPTION 'Round is no longer repairable' USING ERRCODE='22023';
  END IF;
  IF round_row.reserved_slot_date IS NULL OR now() >=
    ((date_trunc('week',round_row.reserved_slot_date AT TIME ZONE 'Europe/Stockholm') + interval '1 day')
      AT TIME ZONE 'Europe/Stockholm') THEN
    RAISE EXCEPTION 'Round management closed after Monday 23:59 Hattrick time' USING ERRCODE='55000';
  END IF;
  PERFORM 1 FROM public.matches WHERE round_id=p_round_id ORDER BY id FOR UPDATE;
  SELECT array_agg(id ORDER BY id) INTO present FROM public.matches WHERE round_id=p_round_id;
  IF COALESCE(present,'{}'::uuid[]) IS DISTINCT FROM COALESCE((SELECT array_agg(x ORDER BY x) FROM unnest(p_expected_match_ids) x),'{}'::uuid[]) THEN
    RAISE EXCEPTION 'The round changed. Review the repair again.' USING ERRCODE='40001';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',m.id,'home_team_id',m.home_team_id,
    'away_team_id',m.away_team_id,'ht_match_id',m.ht_match_id,'status',m.status,
    'schedule_resolution',m.schedule_resolution) ORDER BY m.id),'[]'::jsonb)
    INTO present_matches FROM public.matches m WHERE m.round_id=p_round_id;
  IF present_matches IS DISTINCT FROM p_expected_matches THEN
    RAISE EXCEPTION 'The round changed. Review the repair again.' USING ERRCODE='40001';
  END IF;
  IF EXISTS(SELECT 1 FROM public.matches WHERE round_id=p_round_id AND
    (completed OR status IN ('ongoing','finished') OR finished_at IS NOT NULL OR scheduled_for<=now())) THEN
    RAISE EXCEPTION 'The round has started' USING ERRCODE='55000';
  END IF;
  IF EXISTS(SELECT 1 FROM public.matches WHERE round_id=p_round_id AND
    (ht_match_id IS NOT NULL OR status='arranged') AND NOT id=ANY(p_kept_match_ids)) OR
    EXISTS(SELECT 1 FROM unnest(p_kept_match_ids) x WHERE NOT x=ANY(p_expected_match_ids)) THEN
    RAISE EXCEPTION 'A protected or unknown fixture was selected' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM public.matches m WHERE m.round_id=p_round_id AND NOT m.id=ANY(p_kept_match_ids) AND
    (m.ht_match_id IS NOT NULL OR m.completed OR COALESCE(m.status,'not_arranged') IN ('arranged','ongoing','finished')
      OR m.schedule_resolution IS DISTINCT FROM 'pending' OR m.reserve_team_id IS NOT NULL
      OR EXISTS(SELECT 1 FROM public.match_120m_ratings x WHERE x.match_id=m.id)
      OR EXISTS(SELECT 1 FROM public.fixture_predicted_rating_shares x WHERE x.fixture_id=m.id)
      OR EXISTS(SELECT 1 FROM public.fixture_rating_automation x WHERE x.fixture_id=m.id)
      OR EXISTS(SELECT 1 FROM public.forge_booking_worker_runs x WHERE x.fixture_id=m.id))) THEN
    RAISE EXCEPTION 'A fixture has dependent records or is no longer replaceable' USING ERRCODE='55000';
  END IF;
  PERFORM 1 FROM public.teams WHERE tournament_id=t.id AND (active OR id=ANY(p_lobby_team_ids)) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM public.teams WHERE id=ANY(p_lobby_team_ids) AND tournament_id=t.id AND
      active=false AND reserve_active=true AND COALESCE(is_placeholder,false)=false)<>cardinality(p_lobby_team_ids) THEN
    RAISE EXCEPTION 'A selected Lobby team changed' USING ERRCODE='40001';
  END IF;
  PERFORM 1 FROM public.tournament_season_slots WHERE tournament_season_id=season.id ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.tournament_season_slots WHERE tournament_season_id=season.id AND current_team_id=ANY(p_lobby_team_ids)) THEN
    RAISE EXCEPTION 'A selected Lobby team already has a season slot' USING ERRCODE='40001';
  END IF;
  SELECT count(*)+cardinality(p_lobby_team_ids) INTO new_box FROM public.tournament_season_slots
    WHERE tournament_season_id=season.id AND current_team_id IS NOT NULL;
  IF t.max_teams>0 AND new_box>t.max_teams THEN
    RAISE EXCEPTION 'Increase the team limit before admitting these Lobby teams' USING ERRCODE='22023';
  END IF;
  SELECT COALESCE(max(slot_index),0) INTO next_index FROM public.tournament_season_slots WHERE tournament_season_id=season.id;
  source := CASE WHEN t.league_category='hfi' THEN 'team_rank' ELSE 'power_rating' END;
  FOREACH team_id IN ARRAY p_lobby_team_ids LOOP
    SELECT * INTO team_row FROM public.teams WHERE id=team_id;
    IF source='team_rank' AND COALESCE(team_row.team_rank,0)<=0 THEN
      RAISE EXCEPTION 'Update HFI ranks before admission' USING ERRCODE='22023';
    END IF;
    IF EXISTS(SELECT 1 FROM public.teams other JOIN public.tournaments ot ON ot.id=other.tournament_id
      WHERE other.ht_team_id=team_row.ht_team_id AND other.tournament_id<>t.id AND other.active=true
      AND COALESCE(other.reserve_active,false)=false AND ot.status NOT IN ('finished','stopped')
      AND COALESCE(ot.is_test,false)=false AND COALESCE(ot.registration_type,'')<>'sandbox') THEN
      RAISE EXCEPTION 'A selected Lobby team is active elsewhere' USING ERRCODE='40001';
    END IF;
  END LOOP;
  -- Every Active and newly admitted participant must appear exactly once,
  -- either in a kept fixture or in the replacement proposal.
  SELECT array_agg(id ORDER BY id) INTO expected FROM (
    SELECT id FROM public.teams WHERE tournament_id=t.id AND active=true AND COALESCE(reserve_active,false)=false
      AND COALESCE(is_placeholder,false)=false
    UNION ALL SELECT unnest(p_lobby_team_ids)
  ) roster;
  SELECT array_agg(id ORDER BY id) INTO seen FROM (
    SELECT home_team_id id FROM public.matches WHERE round_id=p_round_id AND id=ANY(p_kept_match_ids) AND home_team_id IS NOT NULL
    UNION ALL SELECT away_team_id FROM public.matches WHERE round_id=p_round_id AND id=ANY(p_kept_match_ids) AND away_team_id IS NOT NULL
  ) kept;
  seen := COALESCE(seen,'{}'::uuid[]);
  FOR fixture IN SELECT value FROM jsonb_array_elements(p_matches) LOOP
    home_id:=NULLIF(fixture->>'home_team_id','')::uuid;
    away_id:=NULLIF(fixture->>'away_team_id','')::uuid;
    IF (home_id IS NULL AND away_id IS NULL) OR home_id=away_id OR
      NULLIF(fixture->>'scheduled_for','') IS NULL OR
      (fixture->>'scheduled_for')::timestamptz<=now() OR
      abs(extract(epoch FROM ((fixture->>'scheduled_for')::timestamptz-round_row.reserved_slot_date)))>3*86400 OR
      (fixture ? 'ht_match_id' AND ((fixture->>'ht_match_id')::bigint<=0 OR
        (fixture->>'match_type')::integer NOT IN (4,5,8,9) OR home_id IS NULL OR away_id IS NULL)) OR
      COALESCE(fixture->>'schedule_resolution','pending') NOT IN ('pending','finalized_unplayed') THEN
      RAISE EXCEPTION 'Invalid proposed fixture' USING ERRCODE='22023';
    END IF;
    IF home_id IS NOT NULL THEN seen:=seen||home_id; END IF;
    IF away_id IS NOT NULL THEN seen:=seen||away_id; END IF;
  END LOOP;
  IF (SELECT array_agg(x ORDER BY x) FROM unnest(seen) x) IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Every participant must appear exactly once' USING ERRCODE='22023';
  END IF;
  FOREACH team_id IN ARRAY p_lobby_team_ids LOOP
    SELECT * INTO team_row FROM public.teams WHERE id=team_id;
    SELECT s.id INTO new_slot FROM public.tournament_season_slots s
      WHERE s.tournament_season_id=season.id AND s.current_team_id IS NULL
        AND NOT EXISTS(SELECT 1 FROM public.tournament_season_slot_assignments a WHERE a.tournament_season_slot_id=s.id)
        AND NOT EXISTS(SELECT 1 FROM public.matches m WHERE m.home_slot_id=s.id OR m.away_slot_id=s.id)
      ORDER BY s.slot_index LIMIT 1;
    IF new_slot IS NULL THEN
      next_index:=next_index+2;
      slot_box:=next_index;
      IF slot_box<2 OR slot_box%2<>0 THEN RAISE EXCEPTION 'Season slot box is inconsistent'; END IF;
      UPDATE public.tournament_season_slots SET box_size=slot_box WHERE tournament_season_id=season.id;
      INSERT INTO public.tournament_season_slots(tournament_season_id,slot_index,box_size,current_team_id)
        VALUES(season.id,slot_box-1,slot_box,team_id) RETURNING id INTO new_slot;
      INSERT INTO public.tournament_season_slots(tournament_season_id,slot_index,box_size)
        VALUES(season.id,slot_box,slot_box);
    ELSE
      UPDATE public.tournament_season_slots SET current_team_id=team_id WHERE id=new_slot;
    END IF;
    INSERT INTO public.tournament_season_slot_assignments(
      tournament_season_slot_id,team_id,reason,team_name,ht_team_id,manager_name,hattrick_user_id,logo_url,
      admission_request_id,entry_round_id,ranking_source,ranking_value)
      VALUES(new_slot,team_id,'reserve_admission',team_row.name,team_row.ht_team_id,team_row.manager_name,
        team_row.hattrick_user_id,team_row.logo_url,gen_random_uuid(),p_round_id,source,
        CASE WHEN source='team_rank' THEN team_row.team_rank ELSE team_row.power_rating END);
    PERFORM set_config('ht120.membership_write','true',true);
    UPDATE public.teams SET active=true,reserve_active=false,reserve_joined_at=NULL WHERE id=team_id;
    PERFORM set_config('ht120.membership_write',COALESCE(previous_write,'false'),true);
  END LOOP;
  DELETE FROM public.matches WHERE round_id=p_round_id AND NOT id=ANY(p_kept_match_ids);
  GET DIAGNOSTICS deleted_count=ROW_COUNT;
  FOR fixture IN SELECT value FROM jsonb_array_elements(p_matches) LOOP
    home_id:=NULLIF(fixture->>'home_team_id','')::uuid;
    away_id:=NULLIF(fixture->>'away_team_id','')::uuid;
    SELECT s.id,a.id INTO home_slot,home_assignment FROM public.tournament_season_slots s
      JOIN public.tournament_season_slot_assignments a ON a.tournament_season_slot_id=s.id AND a.released_at IS NULL
      WHERE s.tournament_season_id=season.id AND s.current_team_id=home_id;
    SELECT s.id,a.id INTO away_slot,away_assignment FROM public.tournament_season_slots s
      JOIN public.tournament_season_slot_assignments a ON a.tournament_season_slot_id=s.id AND a.released_at IS NULL
      WHERE s.tournament_season_id=season.id AND s.current_team_id=away_id;
    IF (home_id IS NOT NULL AND home_slot IS NULL) OR (away_id IS NOT NULL AND away_slot IS NULL) THEN
      RAISE EXCEPTION 'A participant has no current season slot' USING ERRCODE='40001';
    END IF;
    INSERT INTO public.matches(round_id,home_team_id,away_team_id,home_slot_id,away_slot_id,
      home_slot_assignment_id,away_slot_assignment_id,venue_type,scheduled_for,schedule_slot_type,
      status,completed,schedule_resolution,ht_match_id,match_type,chpp_match_date,
      actual_ht_home_team_id,actual_ht_away_team_id)
    VALUES(p_round_id,home_id,away_id,home_slot,away_slot,home_assignment,away_assignment,
      'home_away',(fixture->>'scheduled_for')::timestamptz,round_row.reserved_slot_kind,
      CASE WHEN fixture ? 'ht_match_id' THEN 'arranged'
        WHEN fixture->>'schedule_resolution'='finalized_unplayed' THEN 'misarranged' ELSE 'not_arranged' END,
      false,COALESCE(fixture->>'schedule_resolution','pending'),
      NULLIF(fixture->>'ht_match_id','')::bigint,
      CASE WHEN fixture ? 'ht_match_id' THEN (fixture->>'match_type')::integer ELSE NULL END,
      CASE WHEN fixture ? 'ht_match_id' THEN (fixture->>'scheduled_for')::timestamptz ELSE NULL END,
      CASE WHEN fixture ? 'ht_match_id' THEN (SELECT ht_team_id FROM public.teams WHERE id=home_id) ELSE NULL END,
      CASE WHEN fixture ? 'ht_match_id' THEN (SELECT ht_team_id FROM public.teams WHERE id=away_id) ELSE NULL END);
  END LOOP;
  UPDATE public.fixture_warnings warning SET active=false WHERE warning.round_id=p_round_id AND warning.team_id IN (
    SELECT NULLIF(value->>'home_team_id','')::uuid FROM jsonb_array_elements(p_matches) WHERE value ? 'ht_match_id'
    UNION SELECT NULLIF(value->>'away_team_id','')::uuid FROM jsonb_array_elements(p_matches) WHERE value ? 'ht_match_id'
  );
  RETURN jsonb_build_object('round_id',p_round_id,'fixtures_replaced',deleted_count,
    'fixtures_inserted',jsonb_array_length(p_matches),'admitted',cardinality(p_lobby_team_ids));
END $$;
REVOKE ALL ON FUNCTION public.apply_reviewed_length_round_repair(uuid,integer,uuid,uuid[],jsonb,uuid[],uuid[],jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_reviewed_length_round_repair(uuid,integer,uuid,uuid[],jsonb,uuid[],uuid[],jsonb)
  TO service_role;
COMMIT;

