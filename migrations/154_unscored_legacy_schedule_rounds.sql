-- Unscored extras use the same verified save for legacy generated schedules.
-- Requires 153. No existing tournament mode, round or fixture is rewritten.
BEGIN;

-- Keep the existing roster, receipt, availability and fixture validation.
-- The private unscored wrapper supplies a transaction-local creation context;
-- direct counted saves retain the staged-season restriction.
DO $patch$
DECLARE
 signature text;
 original text;
 patched text;
 mode_guard constant text := 't.schedule_mode IS DISTINCT FROM ''length''';
 playoff_guard constant text := 'IF EXISTS(SELECT 1 FROM public.rounds WHERE tournament_id=t.id AND season_number=p_season_number AND phase=''postseason''';
BEGIN
 FOREACH signature IN ARRAY ARRAY[
   'public.create_organizer_regular_round(uuid,integer,text,jsonb,jsonb,jsonb,boolean)',
   'public.save_verified_organizer_round(uuid,integer,text,jsonb,jsonb,jsonb,boolean,uuid,uuid,text,bigint)'
 ] LOOP
   original := pg_get_functiondef(signature::regprocedure);
   IF position(mode_guard IN original) = 0 THEN
     RAISE EXCEPTION 'Unexpected schedule guard in %; aborting migration', signature;
   END IF;
   patched := replace(original, mode_guard,
     '(t.schedule_mode IS DISTINCT FROM ''length'' AND NOT (COALESCE(current_setting(''ht120.unscored_round'',true),''false'')=''true'' AND t.schedule_mode IN (''single'',''double'',''recurring'')))');
   IF signature LIKE 'public.create_organizer_regular_round(%' THEN
     IF position(playoff_guard IN patched) = 0 THEN
       RAISE EXCEPTION 'Unexpected playoff guard; aborting migration';
     END IF;
     patched := replace(patched, playoff_guard,
       'IF COALESCE(current_setting(''ht120.unscored_round'',true),''false'')<>''true'' AND EXISTS(SELECT 1 FROM public.rounds WHERE tournament_id=t.id AND season_number=p_season_number AND phase=''postseason''');
   END IF;
   EXECUTE patched;
 END LOOP;
END
$patch$;

CREATE OR REPLACE FUNCTION public.save_unscored_verified_organizer_round(
 p_tournament_id uuid,p_season_number integer,p_roster_version text,p_slot jsonb,
 p_roster jsonb,p_matches jsonb,p_override boolean,p_verification_id uuid,p_proposal_hash text,p_actor_id bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
 previous_write text:=current_setting('ht120.membership_write',true);
 previous_unscored text:=current_setting('ht120.unscored_round',true);
BEGIN
 -- Only actual pairs of current Active teams; this operation cannot admit a
 -- reserve, create a BYE or include the preview's unmatched team.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_roster) x LEFT JOIN public.teams t
   ON t.id=(x->>'teamId')::uuid AND t.tournament_id=p_tournament_id
   WHERE t.id IS NULL OR t.active IS NOT TRUE OR t.reserve_active IS TRUE OR COALESCE(t.is_placeholder,false)
     OR x->>'participation' IS DISTINCT FROM 'round_only') THEN
   RAISE EXCEPTION 'Only current active teams can play this round';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_matches) x
   WHERE x->>'home_team_id' IS NULL OR x->>'away_team_id' IS NULL) THEN
   RAISE EXCEPTION 'Unscored extras require complete pairs';
 END IF;
 PERFORM set_config('ht120.unscored_round','true',true);
 result:=public.save_verified_organizer_round(p_tournament_id,p_season_number,p_roster_version,p_slot,p_roster,p_matches,p_override,NULL,p_verification_id,p_proposal_hash,p_actor_id);
 PERFORM set_config('ht120.membership_write','true',true);
 UPDATE public.rounds SET is_unscored=true WHERE id=(result->>'roundId')::uuid AND tournament_id=p_tournament_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Created round not found'; END IF;
 PERFORM set_config('ht120.membership_write',COALESCE(previous_write,'false'),true);
 PERFORM set_config('ht120.unscored_round',COALESCE(previous_unscored,'false'),true);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_unscored_verified_organizer_round(uuid,integer,text,jsonb,jsonb,jsonb,boolean,uuid,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_unscored_verified_organizer_round(uuid,integer,text,jsonb,jsonb,jsonb,boolean,uuid,text,bigint) TO service_role;
COMMIT;

-- applied!