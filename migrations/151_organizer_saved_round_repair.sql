-- Separate higher-risk milestone. Requires 150; owner applies after validation.
BEGIN;
CREATE OR REPLACE FUNCTION public.organizer_saved_repair_enabled()
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$ SELECT true $$;
REVOKE ALL ON FUNCTION public.organizer_saved_repair_enabled() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_saved_repair_enabled() TO service_role;

CREATE OR REPLACE FUNCTION public.save_verified_organizer_round(
 p_tournament_id uuid,p_season_number integer,p_roster_version text,p_slot jsonb,
 p_roster jsonb,p_matches jsonb,p_override boolean,p_round_id uuid,
 p_verification_id uuid,p_proposal_hash text,p_actor_id bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t public.tournaments%ROWTYPE; r public.rounds%ROWTYPE; m public.matches%ROWTYPE;
 selected uuid[]; seen uuid[]; row jsonb; old_id uuid; result jsonb; changed_teams uuid[];
 tid uuid; observation jsonb; home_ht bigint; away_ht bigint;
 previous_write text:=current_setting('ht120.membership_write',true);
BEGIN
 PERFORM pg_advisory_xact_lock(120,113);
 SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id AND COALESCE(season,1)=p_season_number FOR UPDATE;
 IF NOT FOUND OR t.schedule_mode IS DISTINCT FROM 'length' OR COALESCE(t.is_archived,false)
   OR t.status IN ('finished','archived','cancelled','stopped') THEN RAISE EXCEPTION 'Choose an ongoing staged season'; END IF;
 IF (public.get_organizer_round_context(t.id,p_season_number)->>'rosterVersion') IS DISTINCT FROM p_roster_version THEN
   RAISE EXCEPTION 'The roster or fixtures changed. Reload and review.' USING ERRCODE='40001'; END IF;
 IF jsonb_typeof(p_roster) IS DISTINCT FROM 'array' OR jsonb_array_length(p_roster)<2
   OR jsonb_typeof(p_matches) IS DISTINCT FROM 'array' OR jsonb_array_length(p_matches)=0 THEN
   RAISE EXCEPTION 'Choose a roster and pairings'; END IF;
 SELECT array_agg((x->>'teamId')::uuid ORDER BY x->>'teamId') INTO selected FROM jsonb_array_elements(p_roster) x;
 IF cardinality(selected)<>(SELECT count(DISTINCT x) FROM unnest(selected) x) OR EXISTS(
   SELECT 1 FROM unnest(selected) x LEFT JOIN public.teams tm ON tm.id=x AND tm.tournament_id=t.id
   WHERE tm.id IS NULL OR COALESCE(tm.is_placeholder,false)) THEN RAISE EXCEPTION 'Invalid round roster'; END IF;
 SELECT array_agg(x ORDER BY x) INTO seen FROM (
   SELECT (x->>'home_team_id')::uuid x FROM jsonb_array_elements(p_matches) x WHERE x->>'home_team_id' IS NOT NULL
   UNION ALL SELECT (x->>'away_team_id')::uuid FROM jsonb_array_elements(p_matches) x WHERE x->>'away_team_id' IS NOT NULL) q;
 IF seen IS DISTINCT FROM selected THEN RAISE EXCEPTION 'Every participant must appear exactly once'; END IF;
 IF p_round_id IS NOT NULL THEN PERFORM 1 FROM public.matches WHERE round_id=p_round_id FOR UPDATE; END IF;
 -- Lock observations so another scan cannot replace a final-check receipt
 -- between checking coverage and committing the fixture changes.
 PERFORM 1 FROM public.tournament_slot_checks WHERE tournament_id=t.id AND season_number=p_season_number
   AND slot_id=p_slot->>'id' AND team_id=ANY(selected) FOR UPDATE;
 IF p_verification_id IS NULL OR p_proposal_hash IS NULL OR EXISTS(
   SELECT 1 FROM unnest(selected) AS chosen(team_uuid) LEFT JOIN public.tournament_slot_checks c
     ON c.tournament_id=t.id AND c.season_number=p_season_number AND c.slot_id=p_slot->>'id' AND c.team_id=chosen.team_uuid
   WHERE c.verification_id IS DISTINCT FROM p_verification_id OR c.proposal_hash IS DISTINCT FROM p_proposal_hash
     OR c.actor_id IS DISTINCT FROM p_actor_id) THEN RAISE EXCEPTION 'Final verification is incomplete or was replaced. Recheck.'; END IF;

 -- Revalidate observation contents under the same lock, including concurrent
 -- retries of the same batch/run. Coverage alone is not sufficient evidence.
 FOR row IN SELECT x FROM jsonb_array_elements(p_matches) x LOOP
   IF p_round_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.matches m WHERE m.round_id=p_round_id
     AND m.home_team_id IS NOT DISTINCT FROM (row->>'home_team_id')::uuid
     AND m.away_team_id IS NOT DISTINCT FROM (row->>'away_team_id')::uuid
     AND (m.completed OR m.ht_match_id IS NOT NULL OR m.status IN ('arranged','ongoing','finished')
       OR m.finished_at IS NOT NULL OR m.scheduled_for<=now())) THEN CONTINUE; END IF;
   SELECT ht_team_id INTO home_ht FROM public.teams WHERE id=(row->>'home_team_id')::uuid;
   SELECT ht_team_id INTO away_ht FROM public.teams WHERE id=(row->>'away_team_id')::uuid;
   FOR tid IN SELECT x FROM unnest(ARRAY[(row->>'home_team_id')::uuid,(row->>'away_team_id')::uuid]) x WHERE x IS NOT NULL LOOP
     SELECT c.observation INTO observation FROM public.tournament_slot_checks c WHERE c.tournament_id=t.id
       AND c.season_number=p_season_number AND c.slot_id=p_slot->>'id' AND c.team_id=tid;
     IF observation->>'state'='free' AND observation->>'challengesKnown'='true'
       AND jsonb_array_length(observation->'pendingOpponentIds')=0 THEN CONTINUE; END IF;
     IF observation->>'state'='free' AND observation->>'challengesKnown'='true' AND p_round_id IS NOT NULL
       AND EXISTS(SELECT 1 FROM public.matches m WHERE m.round_id=p_round_id
         AND m.home_team_id IS NOT DISTINCT FROM (row->>'home_team_id')::uuid
         AND m.away_team_id IS NOT DISTINCT FROM (row->>'away_team_id')::uuid)
       AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(observation->'pendingOpponentIds') opponent
         WHERE opponent::bigint IS DISTINCT FROM CASE WHEN tid=(row->>'home_team_id')::uuid THEN away_ht ELSE home_ht END)
       THEN CONTINUE; END IF;
     IF observation->>'state'='booked' AND (observation->'booking'->>'homeId')::bigint=home_ht
       AND (observation->'booking'->>'awayId')::bigint=away_ht AND p_round_id IS NULL THEN CONTINUE; END IF;
     RAISE EXCEPTION 'Availability or pending offers changed. Review and recheck.';
   END LOOP;
 END LOOP;

 IF p_round_id IS NULL THEN
   result:=public.create_organizer_regular_round(t.id,p_season_number,p_roster_version,p_slot,p_roster,p_matches,p_override);
 ELSE
   SELECT * INTO r FROM public.rounds WHERE id=p_round_id AND tournament_id=t.id AND season_number=p_season_number FOR UPDATE;
   IF NOT FOUND OR r.round_source<>'organizer' OR r.phase<>'regular' OR r.phase_status<>'materialized'
     OR r.reserved_slot_id IS DISTINCT FROM p_slot->>'id' THEN RAISE EXCEPTION 'Choose a materialized organizer-added round'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_roster) x WHERE NOT EXISTS(
     SELECT 1 FROM public.round_participants rp WHERE rp.round_id=r.id AND rp.team_id=(x->>'teamId')::uuid
       AND rp.participation=x->>'participation')) THEN RAISE EXCEPTION 'Repair cannot add participants or change admissions'; END IF;
   PERFORM 1 FROM public.matches WHERE round_id=r.id FOR UPDATE;
   FOR m IN SELECT * FROM public.matches WHERE round_id=r.id LOOP
     IF m.completed OR m.ht_match_id IS NOT NULL OR m.status IN ('arranged','ongoing','finished')
       OR m.finished_at IS NOT NULL OR m.scheduled_for<=now() THEN
       IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_matches) x WHERE
         (x->>'home_team_id')::uuid IS NOT DISTINCT FROM m.home_team_id AND
         (x->>'away_team_id')::uuid IS NOT DISTINCT FROM m.away_team_id AND
         (x->>'scheduled_for')::timestamptz IS NOT DISTINCT FROM m.scheduled_for) THEN
         RAISE EXCEPTION 'A protected fixture changed. Reload the round.'; END IF;
     END IF;
   END LOOP;
   -- Delete only replaced unbooked rows. Unchanged fixtures keep their IDs and
   -- all linked data. FK cascades clear ratings/shares on replaced fixtures.
   SELECT array_agg(DISTINCT changed.team_uuid) INTO changed_teams FROM public.matches m,
     LATERAL unnest(ARRAY[m.home_team_id,m.away_team_id]) AS changed(team_uuid)
     WHERE m.round_id=r.id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_matches) x WHERE
       (x->>'home_team_id')::uuid IS NOT DISTINCT FROM m.home_team_id AND
       (x->>'away_team_id')::uuid IS NOT DISTINCT FROM m.away_team_id);
   DELETE FROM public.matches m WHERE m.round_id=r.id AND NOT EXISTS(
     SELECT 1 FROM jsonb_array_elements(p_matches) x WHERE (x->>'home_team_id')::uuid IS NOT DISTINCT FROM m.home_team_id
       AND (x->>'away_team_id')::uuid IS NOT DISTINCT FROM m.away_team_id);
   UPDATE public.fixture_warnings SET active=false WHERE round_id=r.id AND team_id=ANY(changed_teams);
   PERFORM set_config('ht120.membership_write','true',true);
   DELETE FROM public.round_participants WHERE round_id=r.id AND NOT(team_id=ANY(selected));
   FOR row IN SELECT x FROM jsonb_array_elements(p_matches) x LOOP
     SELECT id INTO old_id FROM public.matches m WHERE m.round_id=r.id
       AND m.home_team_id IS NOT DISTINCT FROM (row->>'home_team_id')::uuid
       AND m.away_team_id IS NOT DISTINCT FROM (row->>'away_team_id')::uuid;
     IF old_id IS NULL THEN
       IF row->>'scheduled_for' IS NULL OR (row->>'scheduled_for')::timestamptz<=now()
         OR abs(extract(epoch FROM ((row->>'scheduled_for')::timestamptz-r.reserved_slot_date)))>3*86400 THEN
         RAISE EXCEPTION 'A repaired fixture has an invalid kickoff'; END IF;
       INSERT INTO public.matches(round_id,home_team_id,away_team_id,venue_type,status,completed,went_120,total_minutes,
         scheduled_for,schedule_slot_type,schedule_resolution)
       VALUES(r.id,(row->>'home_team_id')::uuid,(row->>'away_team_id')::uuid,'home_away','not_arranged',false,false,0,
         (row->>'scheduled_for')::timestamptz,r.reserved_slot_kind,'pending');
     END IF;
   END LOOP;
   PERFORM set_config('ht120.membership_write',COALESCE(previous_write,'false'),true);
   result:=jsonb_build_object('ok',true,'roundId',r.id,'roundNumber',r.round_number);
 END IF;
 UPDATE public.tournament_slot_checks SET verification_id=NULL,proposal_hash=NULL
   WHERE tournament_id=t.id AND season_number=p_season_number AND slot_id=p_slot->>'id' AND verification_id=p_verification_id;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_verified_organizer_round(uuid,integer,text,jsonb,jsonb,jsonb,boolean,uuid,uuid,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_verified_organizer_round(uuid,integer,text,jsonb,jsonb,jsonb,boolean,uuid,uuid,text,bigint) TO service_role;
COMMIT;
