-- Slot checks are private observations, not booking guarantees or scan jobs.
-- Requires 149. Owner applies separately; no applied marker is added here.
BEGIN;
CREATE TABLE public.tournament_slot_checks (
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  season_number integer NOT NULL CHECK(season_number > 0),
  slot_id text NOT NULL,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  checked_at timestamptz NOT NULL,
  observation jsonb NOT NULL CHECK(jsonb_typeof(observation)='object'),
  verification_id uuid,
  proposal_hash text,
  actor_id bigint NOT NULL,
  PRIMARY KEY(tournament_id,season_number,slot_id,team_id)
);
ALTER TABLE public.tournament_slot_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tournament_slot_checks FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.tournament_slot_checks TO service_role;

-- Update one collection under a profile-row lock. Do not put a full multi-club
-- profile JSON value into an optimistic URL filter or overwrite sibling clubs.
CREATE FUNCTION public.save_team_flag_snapshot(p_manager_id bigint,p_team_id bigint,p_patch jsonb,p_missing_team jsonb DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE snapshot jsonb; team_index integer;
BEGIN
 IF p_manager_id<=0 OR p_team_id<=0 OR jsonb_typeof(p_patch) IS DISTINCT FROM 'object'
   OR p_patch-ARRAY['homeFlagLeagueIds','awayFlagLeagueIds','homeFlagsUnknown','awayFlagsUnknown','flagsFetchedAt','leagueId','countryId']<>'{}'::jsonb
   OR jsonb_typeof(p_patch->'homeFlagLeagueIds') IS DISTINCT FROM 'array'
   OR jsonb_typeof(p_patch->'awayFlagLeagueIds') IS DISTINCT FROM 'array'
   OR jsonb_typeof(p_patch->'homeFlagsUnknown') IS DISTINCT FROM 'boolean'
   OR jsonb_typeof(p_patch->'awayFlagsUnknown') IS DISTINCT FROM 'boolean'
   OR p_patch->>'flagsFetchedAt' IS NULL THEN RAISE EXCEPTION 'Invalid flag snapshot'; END IF;
 PERFORM (p_patch->>'flagsFetchedAt')::timestamptz;
 SELECT COALESCE(teams_json::jsonb,'[]'::jsonb) INTO snapshot FROM public.profiles WHERE hattrick_user_id=p_manager_id FOR UPDATE;
 IF NOT FOUND OR jsonb_typeof(snapshot)<>'array' THEN RAISE EXCEPTION 'Manager profile unavailable'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(snapshot) entry WHERE entry->>'teamId'=p_team_id::text)>1 THEN
   RAISE EXCEPTION 'Duplicate profile team identity'; END IF;
 SELECT (ordinality-1)::integer INTO team_index FROM jsonb_array_elements(snapshot) WITH ORDINALITY entry
   WHERE value->>'teamId'=p_team_id::text;
 IF team_index IS NULL THEN
   IF p_missing_team IS NULL OR p_missing_team->>'teamId' IS DISTINCT FROM p_team_id::text THEN RAISE EXCEPTION 'Team is missing from manager profile'; END IF;
   snapshot:=snapshot||jsonb_build_array(jsonb_build_object('teamId',p_team_id,'teamName',p_missing_team->>'teamName')||p_patch);
 ELSE
   snapshot:=jsonb_set(snapshot,ARRAY[team_index::text],(snapshot->team_index)||p_patch);
 END IF;
 UPDATE public.profiles SET teams_json=snapshot WHERE hattrick_user_id=p_manager_id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.save_team_flag_snapshot(bigint,bigint,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_team_flag_snapshot(bigint,bigint,jsonb,jsonb) TO service_role;

-- The separate 151 milestone enables saved repair. The editor can ship first.
CREATE FUNCTION public.organizer_saved_repair_enabled()
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$ SELECT false $$;
REVOKE ALL ON FUNCTION public.organizer_saved_repair_enabled() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_saved_repair_enabled() TO service_role;

-- Include ownership/country changes in the stale-context fingerprint.
CREATE OR REPLACE FUNCTION public.get_organizer_round_context(p_tournament_id uuid,p_season_number integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
WITH payload AS (SELECT jsonb_build_object(
 'teams',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'ht_team_id',t.ht_team_id,'active',t.active,'reserve_active',t.reserve_active,
    'lobby_status',t.lobby_status,'country_name',t.country_name,'league_level',t.league_level,'team_rank',t.team_rank,
    'power_rating',t.power_rating,'is_placeholder',t.is_placeholder,'hattrick_user_id',t.hattrick_user_id,
    'manager_name',t.manager_name,'country_id',t.country_id,'league_id',t.league_id,'gender_id',t.gender_id) ORDER BY t.id) FROM public.teams t WHERE t.tournament_id=p_tournament_id),'[]'),
 'rounds',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'round_number',r.round_number,'phase',r.phase,
    'phase_status',r.phase_status,'round_source',r.round_source,'reserved_slot_id',r.reserved_slot_id,'reserved_slot_date',r.reserved_slot_date)
    ORDER BY r.round_number) FROM public.rounds r WHERE r.tournament_id=p_tournament_id AND r.season_number=p_season_number),'[]'),
 'history',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'round_id',m.round_id,'home_team_id',m.home_team_id,'away_team_id',m.away_team_id,
    'completed',m.completed,'status',m.status,'schedule_resolution',m.schedule_resolution,'scheduled_for',m.scheduled_for,'ht_match_id',m.ht_match_id,
    'home_goals',m.home_goals,'away_goals',m.away_goals,'finished_at',m.finished_at,'chpp_match_date',m.chpp_match_date) ORDER BY m.id)
    FROM public.matches m JOIN public.rounds r ON r.id=m.round_id WHERE r.tournament_id=p_tournament_id AND r.season_number=p_season_number AND r.phase='regular'),'[]')
) AS value)
SELECT value||jsonb_build_object('rosterVersion',md5(value::text)) FROM payload;
$$;
REVOKE ALL ON FUNCTION public.get_organizer_round_context(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_organizer_round_context(uuid,integer) TO service_role;


CREATE FUNCTION public.save_verified_organizer_round(
 p_tournament_id uuid,p_season_number integer,p_roster_version text,p_slot jsonb,
 p_roster jsonb,p_matches jsonb,p_override boolean,p_round_id uuid,
 p_verification_id uuid,p_proposal_hash text,p_actor_id bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t public.tournaments%ROWTYPE;
 selected uuid[]; seen uuid[]; row jsonb; result jsonb;
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
   RAISE EXCEPTION 'Saved-round repair is not enabled yet';
 END IF;
 UPDATE public.tournament_slot_checks SET verification_id=NULL,proposal_hash=NULL
   WHERE tournament_id=t.id AND season_number=p_season_number AND slot_id=p_slot->>'id' AND verification_id=p_verification_id;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_verified_organizer_round(uuid,integer,text,jsonb,jsonb,jsonb,boolean,uuid,uuid,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_verified_organizer_round(uuid,integer,text,jsonb,jsonb,jsonb,boolean,uuid,uuid,text,bigint) TO service_role;
COMMIT;

-- applied!