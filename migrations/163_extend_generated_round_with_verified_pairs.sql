-- Admit Lobby teams and replace only future unbooked fixtures in one transaction.
-- The migration is required only for the new Add fixtures to an existing generated round workflow. Without it, the UI can offer that operation, but the final database save fails.
-- It does not replace the original schedule generator. 
-- Commit: https://github.com/getdagnis/ht-120min/commit/0682759b86b954633b4ba1f023923f1df48b356e?utm_source=chatgpt.com

BEGIN;
CREATE FUNCTION public.extend_generated_round_with_verified_pairs(
 p_tournament_id uuid, p_season_number integer, p_round_id uuid, p_request_id uuid,
 p_team_ids uuid[], p_dummy_matches jsonb, p_matches jsonb, p_roster_version text,
 p_verification_id uuid, p_proposal_hash text, p_actor_id bigint,
 p_override boolean, p_raise_limit boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t public.tournaments%ROWTYPE; r public.rounds%ROWTYPE; protected_match public.matches%ROWTYPE;
 row jsonb; home_id uuid; away_id uuid; seen uuid[]:='{}'; expected uuid[];
 unlocked jsonb:='[]'::jsonb; observation jsonb; candidate_id uuid; opponent_ht bigint;
 result jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(120,113);
 SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id AND COALESCE(season,1)=p_season_number FOR UPDATE;
 SELECT * INTO r FROM public.rounds WHERE id=p_round_id AND tournament_id=p_tournament_id AND season_number=p_season_number FOR UPDATE;
 IF t.id IS NULL OR t.schedule_mode<>'length' OR COALESCE(t.is_archived,false) OR t.status IN ('finished','stopped','archived','cancelled')
   OR r.id IS NULL OR r.phase<>'regular' OR r.phase_status<>'materialized' OR r.round_source<>'scheduled'
   OR r.reserved_slot_id IS NULL OR r.reserved_slot_date IS NULL THEN
   RAISE EXCEPTION 'Choose an available generated regular round'; END IF;
 PERFORM 1 FROM public.matches WHERE round_id=r.id ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.matches WHERE round_id=r.id AND (completed OR status IN ('ongoing','finished')
   OR finished_at IS NOT NULL OR scheduled_for<=now())) THEN RAISE EXCEPTION 'The round has started'; END IF;
 IF (public.get_organizer_round_context(t.id,p_season_number)->>'rosterVersion') IS DISTINCT FROM p_roster_version THEN
   RAISE EXCEPTION 'The round changed. Reload and review.' USING ERRCODE='40001'; END IF;
 IF p_request_id IS NULL OR p_verification_id IS NULL OR p_proposal_hash IS NULL OR p_actor_id IS NULL
   OR cardinality(p_team_ids)<2 OR cardinality(p_team_ids)%2<>0 OR
   (SELECT count(DISTINCT x) FROM unnest(p_team_ids) x)<>cardinality(p_team_ids)
   OR jsonb_typeof(p_matches)<>'array' THEN RAISE EXCEPTION 'Invalid admission proposal'; END IF;
 SELECT array_agg(id ORDER BY id) INTO expected FROM (
   SELECT home_team_id id FROM public.matches WHERE round_id=r.id AND home_team_id IS NOT NULL
   UNION ALL SELECT away_team_id FROM public.matches WHERE round_id=r.id AND away_team_id IS NOT NULL
   UNION ALL SELECT unnest(p_team_ids)
 ) participants;
 IF expected IS DISTINCT FROM (SELECT array_agg(id ORDER BY id) FROM (SELECT DISTINCT unnest(expected) id) x) THEN
   RAISE EXCEPTION 'An existing participant is duplicated'; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(p_matches) LOOP
   home_id:=NULLIF(row->>'home_team_id','')::uuid; away_id:=NULLIF(row->>'away_team_id','')::uuid;
   IF home_id IS NULL AND away_id IS NULL OR home_id IS NOT NULL AND home_id=away_id
      OR row->>'scheduled_for' IS NULL THEN RAISE EXCEPTION 'Invalid proposed fixture'; END IF;
   FOREACH candidate_id IN ARRAY ARRAY[home_id,away_id] LOOP
     IF candidate_id IS NOT NULL THEN
       IF candidate_id=ANY(seen) THEN RAISE EXCEPTION 'A team appears twice'; END IF;
       seen:=seen||candidate_id;
     END IF;
   END LOOP;
 END LOOP;
 IF (SELECT array_agg(id ORDER BY id) FROM unnest(seen) id) IS DISTINCT FROM expected THEN
   RAISE EXCEPTION 'Every existing and incoming team must appear once'; END IF;
 FOR protected_match IN SELECT * FROM public.matches WHERE round_id=r.id AND (ht_match_id IS NOT NULL OR status='arranged') LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_matches) x WHERE
     (x->>'home_team_id')::uuid IS NOT DISTINCT FROM protected_match.home_team_id AND
     (x->>'away_team_id')::uuid IS NOT DISTINCT FROM protected_match.away_team_id AND
     (x->>'scheduled_for')::timestamptz IS NOT DISTINCT FROM protected_match.scheduled_for) THEN
     RAISE EXCEPTION 'A booked fixture changed'; END IF;
 END LOOP;
 FOR row IN SELECT value FROM jsonb_array_elements(p_matches) LOOP
   home_id:=NULLIF(row->>'home_team_id','')::uuid; away_id:=NULLIF(row->>'away_team_id','')::uuid;
   IF EXISTS(SELECT 1 FROM public.matches m WHERE m.round_id=r.id AND (m.ht_match_id IS NOT NULL OR m.status='arranged')
       AND m.home_team_id IS NOT DISTINCT FROM home_id AND m.away_team_id IS NOT DISTINCT FROM away_id) THEN CONTINUE; END IF;
   IF (row->>'scheduled_for')::timestamptz<=now() OR
     abs(extract(epoch FROM ((row->>'scheduled_for')::timestamptz-r.reserved_slot_date)))>3*86400 THEN
     RAISE EXCEPTION 'A proposed kickoff is outside the future round'; END IF;
   FOREACH candidate_id IN ARRAY ARRAY[home_id,away_id] LOOP
     IF candidate_id IS NULL THEN CONTINUE; END IF;
     SELECT c.observation INTO observation FROM public.tournament_slot_checks c
       WHERE c.tournament_id=t.id AND c.season_number=p_season_number AND c.slot_id=r.reserved_slot_id
       AND c.team_id=candidate_id AND c.verification_id=p_verification_id
       AND c.proposal_hash=p_proposal_hash AND c.actor_id=p_actor_id FOR UPDATE;
     SELECT ht_team_id INTO opponent_ht FROM public.teams WHERE id=CASE WHEN candidate_id=home_id THEN away_id ELSE home_id END;
     IF observation IS NULL OR observation->>'state'<>'free' OR observation->>'challengesKnown'<>'true'
       OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE(observation->'pendingOpponentIds','[]'::jsonb)) v
         WHERE NOT EXISTS(SELECT 1 FROM public.matches old WHERE old.round_id=r.id
           AND old.home_team_id IS NOT DISTINCT FROM home_id AND old.away_team_id IS NOT DISTINCT FROM away_id)
           OR v::bigint IS DISTINCT FROM opponent_ht) THEN
       RAISE EXCEPTION 'Final availability or challenge verification is incomplete'; END IF;
   END LOOP;
   unlocked:=unlocked||jsonb_build_array(row);
 END LOOP;
 IF p_override THEN
   result:=public.admit_length_schedule_reserves_as_site_admin(p_tournament_id,p_season_number,p_round_id,p_request_id,p_team_ids,p_dummy_matches);
 ELSE
   result:=public.admit_length_schedule_reserves(p_tournament_id,p_season_number,p_round_id,p_request_id,p_team_ids,p_dummy_matches,p_raise_limit);
 END IF;
 PERFORM public.repair_length_schedule_round(p_tournament_id,p_season_number,p_round_id,unlocked);
 UPDATE public.fixture_warnings SET active=false WHERE round_id=r.id AND team_id IN (
   SELECT DISTINCT id FROM (
     SELECT NULLIF(value->>'home_team_id','')::uuid id FROM jsonb_array_elements(unlocked)
     UNION ALL
     SELECT NULLIF(value->>'away_team_id','')::uuid id FROM jsonb_array_elements(unlocked)
   ) changed WHERE id IS NOT NULL
 );
 UPDATE public.tournament_slot_checks SET verification_id=NULL,proposal_hash=NULL
   WHERE tournament_id=t.id AND season_number=p_season_number AND slot_id=r.reserved_slot_id AND verification_id=p_verification_id;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.extend_generated_round_with_verified_pairs(uuid,integer,uuid,uuid,uuid[],jsonb,jsonb,text,uuid,text,bigint,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.extend_generated_round_with_verified_pairs(uuid,integer,uuid,uuid,uuid[],jsonb,jsonb,text,uuid,text,bigint,boolean,boolean) TO service_role;
COMMIT;


-- applied!