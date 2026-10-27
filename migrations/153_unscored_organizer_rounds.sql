-- Private organizer action creates bookable fixtures that do not count in the season.
BEGIN;
ALTER TABLE public.rounds ADD COLUMN is_unscored boolean NOT NULL DEFAULT false;
-- Migration 151 declares a record named m and also uses m as a table alias.
-- Resolve qualified SQL references as columns; record references outside SQL remain unchanged.
DO $fix$
DECLARE
 original text;
 patched text;
BEGIN
 original := pg_get_functiondef(
   'public.save_verified_organizer_round(uuid,integer,text,jsonb,jsonb,jsonb,boolean,uuid,uuid,text,bigint)'::regprocedure
 );
 IF position('AS $function$' IN original) = 0 THEN
   RAISE EXCEPTION 'Unexpected function format; aborting migration';
 END IF;
 patched := replace(original, 'AS $function$', E'AS $function$\n#variable_conflict use_column');
 EXECUTE patched;
END
$fix$;
CREATE FUNCTION public.guard_unscored_round() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF ((TG_OP='INSERT' AND NEW.is_unscored) OR (TG_OP='UPDATE' AND NEW.is_unscored IS DISTINCT FROM OLD.is_unscored))
   AND current_setting('ht120.membership_write',true) IS DISTINCT FROM 'true' THEN
   RAISE EXCEPTION 'Unscored rounds require the authorized service operation' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_unscored_round BEFORE INSERT OR UPDATE ON public.rounds FOR EACH ROW EXECUTE FUNCTION public.guard_unscored_round();

CREATE FUNCTION public.save_unscored_verified_organizer_round(
 p_tournament_id uuid,p_season_number integer,p_roster_version text,p_slot jsonb,
 p_roster jsonb,p_matches jsonb,p_override boolean,p_verification_id uuid,p_proposal_hash text,p_actor_id bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; previous_write text:=current_setting('ht120.membership_write',true);
BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_roster) x LEFT JOIN public.teams t
   ON t.id=(x->>'teamId')::uuid AND t.tournament_id=p_tournament_id
   WHERE t.id IS NULL OR t.active IS NOT TRUE OR t.reserve_active IS TRUE OR COALESCE(t.is_placeholder,false)) THEN
   RAISE EXCEPTION 'Only current active teams can play this round';
 END IF;
 result:=public.save_verified_organizer_round(p_tournament_id,p_season_number,p_roster_version,p_slot,p_roster,p_matches,p_override,NULL,p_verification_id,p_proposal_hash,p_actor_id);
 PERFORM set_config('ht120.membership_write','true',true);
 UPDATE public.rounds SET is_unscored=true WHERE id=(result->>'roundId')::uuid AND tournament_id=p_tournament_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Created round not found'; END IF;
 PERFORM set_config('ht120.membership_write',COALESCE(previous_write,'false'),true);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_unscored_verified_organizer_round(uuid,integer,text,jsonb,jsonb,jsonb,boolean,uuid,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_unscored_verified_organizer_round(uuid,integer,text,jsonb,jsonb,jsonb,boolean,uuid,text,bigint) TO service_role;

-- Unscored extras never delay a normal season transition.
CREATE OR REPLACE FUNCTION public.apply_length_round_transition(p_tournament_id uuid,p_season_number integer,p_completed_round_id uuid,
 p_next_round_id uuid,p_matches jsonb,p_champion_team_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE source text; unscored boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(120,113);
 PERFORM 1 FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 SELECT round_source,is_unscored INTO source,unscored FROM public.rounds WHERE id=p_completed_round_id AND tournament_id=p_tournament_id AND season_number=p_season_number;
 IF unscored THEN RAISE EXCEPTION 'Unscored rounds cannot advance the season'; END IF;
 IF source='organizer' AND p_next_round_id IS NOT NULL THEN RAISE EXCEPTION 'An organizer round cannot advance reserved pairings'; END IF;
 IF source IS DISTINCT FROM 'organizer' AND (p_next_round_id IS NULL OR EXISTS(SELECT 1 FROM public.rounds WHERE id=p_next_round_id AND phase='postseason'))
   AND EXISTS(SELECT 1 FROM public.rounds WHERE tournament_id=p_tournament_id AND season_number=p_season_number
     AND round_source='organizer' AND NOT is_unscored AND phase_status<>'completed') THEN
   RETURN jsonb_build_object('advanced',false,'reason','additional_regular_round_unresolved'); END IF;
 RETURN public.apply_length_round_transition_before_organizer(p_tournament_id,p_season_number,p_completed_round_id,p_next_round_id,p_matches,p_champion_team_id);
END $$;
REVOKE ALL ON FUNCTION public.apply_length_round_transition(uuid,integer,uuid,uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_length_round_transition(uuid,integer,uuid,uuid,jsonb,uuid) TO service_role;
COMMIT;

-- applied!