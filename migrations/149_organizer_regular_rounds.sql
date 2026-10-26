-- Additional counted regular rounds own an explicit roster, independently of
-- continuing membership. Existing reserved round numbers and pairing plans stay intact.
BEGIN;
ALTER TABLE public.rounds ADD COLUMN round_source text NOT NULL DEFAULT 'scheduled'
  CHECK(round_source IN ('scheduled','organizer'));
-- Old browser clients may still create scheduled rounds, but explicit roster
-- rounds can only be created through the service transaction below.
CREATE FUNCTION public.guard_organizer_round_source() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF ((TG_OP='INSERT' AND NEW.round_source='organizer') OR
   (TG_OP='UPDATE' AND NEW.round_source IS DISTINCT FROM OLD.round_source))
   AND current_setting('ht120.membership_write',true) IS DISTINCT FROM 'true' THEN
   RAISE EXCEPTION 'Organizer rounds require the authorized service route' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_organizer_round_source BEFORE INSERT OR UPDATE ON public.rounds
FOR EACH ROW EXECUTE FUNCTION public.guard_organizer_round_source();
CREATE TABLE public.round_participants (
  round_id uuid NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id),
  participation text NOT NULL CHECK(participation IN ('round_only','admit')),
  PRIMARY KEY(round_id,team_id)
);
ALTER TABLE public.round_participants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.round_participants FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.round_participants TO anon,authenticated;
GRANT ALL ON public.round_participants TO service_role;
CREATE POLICY round_participants_public_read ON public.round_participants FOR SELECT TO anon,authenticated
USING(EXISTS(SELECT 1 FROM public.rounds r WHERE r.id=round_id));

CREATE FUNCTION public.get_organizer_round_context(p_tournament_id uuid,p_season_number integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
WITH payload AS (SELECT jsonb_build_object(
 'teams',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'ht_team_id',t.ht_team_id,'active',t.active,'reserve_active',t.reserve_active,
    'lobby_status',t.lobby_status,'country_name',t.country_name,'league_level',t.league_level,'team_rank',t.team_rank,
    'power_rating',t.power_rating,'is_placeholder',t.is_placeholder) ORDER BY t.id) FROM public.teams t WHERE t.tournament_id=p_tournament_id),'[]'),
 'rounds',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'round_number',r.round_number,'phase',r.phase,
    'phase_status',r.phase_status,'round_source',r.round_source,'reserved_slot_id',r.reserved_slot_id,'reserved_slot_date',r.reserved_slot_date)
    ORDER BY r.round_number) FROM public.rounds r WHERE r.tournament_id=p_tournament_id AND r.season_number=p_season_number),'[]'),
 'history',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'home_team_id',m.home_team_id,'away_team_id',m.away_team_id,
    'completed',m.completed,'status',m.status,'schedule_resolution',m.schedule_resolution,'scheduled_for',m.scheduled_for,'ht_match_id',m.ht_match_id,
    'home_goals',m.home_goals,'away_goals',m.away_goals) ORDER BY m.id)
    FROM public.matches m JOIN public.rounds r ON r.id=m.round_id WHERE r.tournament_id=p_tournament_id AND r.season_number=p_season_number AND r.phase='regular'),'[]')
) AS value)
SELECT value||jsonb_build_object('rosterVersion',md5(value::text)) FROM payload;
$$;
REVOKE ALL ON FUNCTION public.get_organizer_round_context(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_organizer_round_context(uuid,integer) TO service_role;

CREATE FUNCTION public.create_organizer_regular_round(
 p_tournament_id uuid,p_season_number integer,p_roster_version text,p_slot jsonb,p_roster jsonb,p_matches jsonb,p_override boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t public.tournaments%ROWTYPE; round_id uuid:=gen_random_uuid(); number integer; row jsonb; tid uuid; reason text;
 selected uuid[]; fixture_ids uuid[]; previous_write text:=current_setting('ht120.membership_write',true);
BEGIN
 PERFORM pg_advisory_xact_lock(120,113);
 SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id AND COALESCE(season,1)=p_season_number FOR UPDATE;
 IF NOT FOUND OR t.schedule_mode IS DISTINCT FROM 'length' OR t.schedule_generated_at IS NULL OR COALESCE(t.is_archived,false)
   OR t.status IN ('finished','archived','cancelled','stopped') THEN RAISE EXCEPTION 'Choose an ongoing staged season' USING ERRCODE='40001'; END IF;
 IF (public.get_organizer_round_context(t.id,p_season_number)->>'rosterVersion') IS DISTINCT FROM p_roster_version THEN
   RAISE EXCEPTION 'The roster or fixtures changed. Reload and review pairings.' USING ERRCODE='40001'; END IF;
 IF jsonb_typeof(p_slot) IS DISTINCT FROM 'object' OR p_slot->>'kind' IS NULL OR p_slot->>'date' IS NULL OR p_slot->>'kind' NOT IN ('midweek_friendly','weekend_friendly')
   OR NULLIF(p_slot->>'id','') IS NULL OR (p_slot->>'date')::timestamptz<=now()-interval '3 days' THEN RAISE EXCEPTION 'Choose a future friendly slot'; END IF;
 IF EXISTS(SELECT 1 FROM public.rounds WHERE tournament_id=t.id AND season_number=p_season_number AND reserved_slot_id=p_slot->>'id') THEN
   RAISE EXCEPTION 'This calendar slot already has a round' USING ERRCODE='23505'; END IF;
 IF EXISTS(SELECT 1 FROM public.rounds WHERE tournament_id=t.id AND season_number=p_season_number AND phase='postseason'
   AND (phase_status<>'pending' OR reserved_slot_date<=(p_slot->>'date')::timestamptz)) THEN
   RAISE EXCEPTION 'Add regular rounds before the reserved playoffs; an existing bracket cannot be reseeded'; END IF;
 IF jsonb_typeof(p_roster) IS DISTINCT FROM 'array' OR jsonb_array_length(p_roster)<2 OR jsonb_typeof(p_matches) IS DISTINCT FROM 'array'
   OR jsonb_array_length(p_matches)=0 THEN RAISE EXCEPTION 'Choose a roster and pairings'; END IF;
 SELECT array_agg((x->>'teamId')::uuid ORDER BY x->>'teamId') INTO selected FROM jsonb_array_elements(p_roster) x;
 IF cardinality(selected)<>(SELECT count(DISTINCT x) FROM unnest(selected) x) OR EXISTS(
   SELECT 1 FROM unnest(selected) x LEFT JOIN public.teams tm ON tm.id=x AND tm.tournament_id=t.id
   WHERE tm.id IS NULL OR COALESCE(tm.is_placeholder,false)) THEN RAISE EXCEPTION 'Choose distinct existing tournament teams'; END IF;
 IF EXISTS(SELECT ht_team_id FROM public.teams WHERE id=ANY(selected) AND ht_team_id>0 GROUP BY ht_team_id HAVING count(*)>1) THEN
   RAISE EXCEPTION 'Choose each Hattrick club once'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_roster) x WHERE x->>'participation' IS NULL OR x->>'participation' NOT IN ('round_only','admit')) THEN
   RAISE EXCEPTION 'Invalid participation choice'; END IF;
 SELECT array_agg(x ORDER BY x) INTO fixture_ids FROM (
   SELECT (m->>'home_team_id')::uuid x FROM jsonb_array_elements(p_matches) m WHERE m->>'home_team_id' IS NOT NULL
   UNION ALL SELECT (m->>'away_team_id')::uuid FROM jsonb_array_elements(p_matches) m WHERE m->>'away_team_id' IS NOT NULL) q;
 IF fixture_ids IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(selected) x) THEN
   RAISE EXCEPTION 'Each selected team must appear exactly once'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_matches) m WHERE
   (m->>'home_team_id' IS NULL AND m->>'away_team_id' IS NULL) OR m->>'scheduled_for' IS NULL OR (m->>'scheduled_for')::timestamptz<=now()
   OR abs(extract(epoch FROM ((m->>'scheduled_for')::timestamptz-(p_slot->>'date')::timestamptz)))>3*86400) THEN
   RAISE EXCEPTION 'A fixture has an invalid planned kickoff'; END IF;
 SELECT COALESCE(max(round_number),0)+1 INTO number FROM public.rounds WHERE tournament_id=t.id AND season_number=p_season_number;
 PERFORM set_config('ht120.membership_write','true',true);
 -- Admissions happen before match creation, so the new one-round commitment
 -- cannot be mistaken for a pre-existing unfinished membership commitment.
 FOR row IN SELECT x FROM jsonb_array_elements(p_roster) x LOOP
   tid:=(row->>'teamId')::uuid;
   IF row->>'participation'='admit' AND EXISTS(SELECT 1 FROM public.teams WHERE id=tid AND active IS NOT TRUE) THEN
     PERFORM set_config('ht120.membership_write','true',true);
     IF EXISTS(SELECT 1 FROM public.teams WHERE id=tid AND reserve_active IS NOT TRUE) THEN
       PERFORM public.change_tournament_team_membership(t.id,tid,'return'); END IF;
     PERFORM public.activate_waiting_team(t.id,tid,p_override);
   END IF;
 END LOOP;
 INSERT INTO public.rounds(id,tournament_id,season_number,round_number,phase,phase_round_number,phase_status,
   reserved_slot_id,reserved_slot_kind,reserved_slot_date,reserved_display_date,materialized_at,round_source)
 VALUES(round_id,t.id,p_season_number,number,'regular',number,'materialized',p_slot->>'id',p_slot->>'kind',
   (p_slot->>'date')::timestamptz,(p_slot->>'date')::timestamptz,now(),'organizer');
 INSERT INTO public.round_participants SELECT round_id,(x->>'teamId')::uuid,x->>'participation' FROM jsonb_array_elements(p_roster) x;
 FOR row IN SELECT x FROM jsonb_array_elements(p_matches) x LOOP
   INSERT INTO public.matches(round_id,home_team_id,away_team_id,venue_type,status,completed,went_120,total_minutes,
      scheduled_for,schedule_slot_type,schedule_resolution)
   VALUES(round_id,(row->>'home_team_id')::uuid,(row->>'away_team_id')::uuid,'home_away','not_arranged',false,false,0,
      (row->>'scheduled_for')::timestamptz,p_slot->>'kind','pending');
 END LOOP;
 PERFORM set_config('ht120.membership_write',COALESCE(previous_write,'false'),true);
 RETURN jsonb_build_object('ok',true,'roundId',round_id,'roundNumber',number);
END $$;
REVOKE ALL ON FUNCTION public.create_organizer_regular_round(uuid,integer,text,jsonb,jsonb,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_organizer_regular_round(uuid,integer,text,jsonb,jsonb,jsonb,boolean) TO service_role;
-- Keep the existing transition algorithm, but serialize added-round completion
-- and prevent qualification/season completion while counted rounds remain open.
ALTER FUNCTION public.apply_length_round_transition(uuid,integer,uuid,uuid,jsonb,uuid)
 RENAME TO apply_length_round_transition_before_organizer;
REVOKE ALL ON FUNCTION public.apply_length_round_transition_before_organizer(uuid,integer,uuid,uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.apply_length_round_transition(p_tournament_id uuid,p_season_number integer,p_completed_round_id uuid,
 p_next_round_id uuid,p_matches jsonb,p_champion_team_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE source text;
BEGIN
 PERFORM pg_advisory_xact_lock(120,113);
 PERFORM 1 FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 SELECT round_source INTO source FROM public.rounds WHERE id=p_completed_round_id AND tournament_id=p_tournament_id AND season_number=p_season_number;
 IF source='organizer' AND p_next_round_id IS NOT NULL THEN RAISE EXCEPTION 'An organizer round cannot advance reserved pairings'; END IF;
 IF source IS DISTINCT FROM 'organizer' AND (p_next_round_id IS NULL OR EXISTS(SELECT 1 FROM public.rounds WHERE id=p_next_round_id AND phase='postseason'))
   AND EXISTS(SELECT 1 FROM public.rounds WHERE tournament_id=p_tournament_id AND season_number=p_season_number
     AND round_source='organizer' AND phase_status<>'completed') THEN
   RETURN jsonb_build_object('advanced',false,'reason','additional_regular_round_unresolved'); END IF;
 RETURN public.apply_length_round_transition_before_organizer(p_tournament_id,p_season_number,p_completed_round_id,p_next_round_id,p_matches,p_champion_team_id);
END $$;
REVOKE ALL ON FUNCTION public.apply_length_round_transition(uuid,integer,uuid,uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_length_round_transition(uuid,integer,uuid,uuid,jsonb,uuid) TO service_role;
COMMIT;

-- applied!