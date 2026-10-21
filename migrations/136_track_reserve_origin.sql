BEGIN;

ALTER TABLE public.teams
  ADD COLUMN reserve_origin text;

ALTER TABLE public.teams
  ADD CONSTRAINT teams_reserve_origin_check
  CHECK (reserve_origin IS NULL OR reserve_origin IN (
    'organizer_added', 'manager_joined', 'participant_departure', 'legacy_unknown'
  ));

-- Historical rows do not record how they became reserves. Mark that gap
-- explicitly instead of inferring origin from CHPP validation or timestamps.
UPDATE public.teams
SET reserve_origin = 'legacy_unknown'
WHERE reserve_active IS TRUE;

CREATE FUNCTION public.set_team_reserve_origin() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.reserve_active IS TRUE THEN
    IF TG_OP = 'UPDATE' AND OLD.active IS TRUE AND NEW.active IS DISTINCT FROM TRUE THEN
      NEW.reserve_origin := 'participant_departure';
    ELSIF TG_OP = 'UPDATE' AND OLD.reserve_active IS TRUE AND NEW.reserve_active IS TRUE
      AND NEW.reserve_origin IS NULL THEN
      NEW.reserve_origin := OLD.reserve_origin;
    END IF;
    IF NEW.reserve_origin IS NULL THEN
      NEW.reserve_origin := 'legacy_unknown';
    END IF;
  ELSE
    NEW.reserve_origin := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_team_reserve_origin
BEFORE INSERT OR UPDATE OF active, reserve_active, reserve_origin ON public.teams
FOR EACH ROW EXECUTE FUNCTION public.set_team_reserve_origin();

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
    'reserve_origin','reapply_season_number','replacement_for_team_id','join_story')) THEN
    RAISE EXCEPTION 'Invalid registration fields' USING ERRCODE='22023'; END IF;
  IF p_existing_id IS NOT NULL THEN
    SELECT * INTO existing FROM public.teams WHERE id=p_existing_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Registration changed; refresh and try again' USING ERRCODE='40001'; END IF;
    IF p_values ? 'tournament_id' AND (p_values->>'tournament_id')::uuid<>existing.tournament_id THEN
      RAISE EXCEPTION 'Registration tournament changed' USING ERRCODE='22023'; END IF;
  END IF;
  SELECT * INTO target FROM public.tournaments WHERE id=COALESCE(existing.tournament_id,(p_values->>'tournament_id')::uuid) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tournament not found' USING ERRCODE='P0002'; END IF;
  IF NOT COALESCE(target.is_test,false) AND target.registration_type IS DISTINCT FROM 'sandbox'
    AND NOT COALESCE(existing.active,false)
    AND (target.status IN ('stopped','finished','archived')
      OR (target.registration_closed_at IS NOT NULL
        AND NOT (p_values @> '{"active": false, "reserve_active": true}'::jsonb))) THEN
    RAISE EXCEPTION 'Tournament registration is closed' USING ERRCODE='55000'; END IF;
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
  PERFORM set_config('ht120.membership_bypass','false',true);
  RETURN saved_id;
END $$;

REVOKE ALL ON FUNCTION public.save_verified_tournament_registration(jsonb,uuid,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_verified_tournament_registration(jsonb,uuid,boolean)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- applied!