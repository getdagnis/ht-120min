-- Prepared only. Apply before deploying automatic fixture rating sharing.
BEGIN;

ALTER TABLE public.fixture_predicted_rating_shares
  ADD COLUMN share_source text NOT NULL DEFAULT 'manual'
  CHECK (share_source IN ('manual','automatic'));

CREATE TABLE public.tournament_team_rating_preferences (
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  hattrick_user_id bigint NOT NULL CHECK (hattrick_user_id > 0),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, team_id, hattrick_user_id)
);
CREATE TABLE public.fixture_rating_automation (
  fixture_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  ht_match_id bigint NOT NULL CHECK (ht_match_id > 0),
  suppressed boolean NOT NULL DEFAULT false,
  claim_id uuid,
  claim_expires_at timestamptz,
  retry_after timestamptz,
  PRIMARY KEY (fixture_id, team_id, ht_match_id)
);
ALTER TABLE public.tournament_team_rating_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixture_rating_automation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tournament_team_rating_preferences, public.fixture_rating_automation FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.tournament_team_rating_preferences, public.fixture_rating_automation TO service_role;

CREATE FUNCTION public.set_team_rating_sharing(p_tournament_id uuid, p_team_id uuid, p_manager_id bigint, p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rating-share:' || p_tournament_id || ':' || p_team_id, 0));
  IF p_enabled IS NULL OR NOT EXISTS (SELECT 1 FROM public.teams tm JOIN public.tournaments t ON t.id=tm.tournament_id
    WHERE tm.id=p_team_id AND tm.tournament_id=p_tournament_id AND tm.hattrick_user_id=p_manager_id
      AND tm.active AND NOT COALESCE(tm.reserve_active,false) AND NOT COALESCE(tm.is_placeholder,false)
      AND NOT COALESCE(t.is_archived,false) AND t.status NOT IN ('finished','archived','cancelled','stopped')) THEN
    RAISE EXCEPTION 'This team is not available for rating sharing' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.tournament_team_rating_preferences(tournament_id,team_id,hattrick_user_id,enabled)
    VALUES(p_tournament_id,p_team_id,p_manager_id,p_enabled)
    ON CONFLICT(tournament_id,team_id,hattrick_user_id) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now();
  IF NOT p_enabled THEN
    DELETE FROM public.fixture_predicted_rating_shares WHERE team_id=p_team_id AND share_source='automatic';
    -- Re-enabling later cannot revive a CHPP fetch that was already in flight.
    UPDATE public.fixture_rating_automation SET claim_id=NULL,claim_expires_at=NULL WHERE team_id=p_team_id;
  END IF;
END $$;

-- All sharing mutations use the same team lock as the preference write. No lock
-- is held during CHPP requests. A claim plus final eligibility recheck protects
-- automatic publication; existing row IDs protect clicked updates from Remove.
CREATE FUNCTION public.fixture_rating_sharing_action(
  p_fixture_id uuid, p_team_id uuid, p_manager_id bigint, p_ht_match_id bigint, p_action text,
  p_claim_id uuid DEFAULT NULL, p_payload jsonb DEFAULT NULL, p_existing_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  fixture public.matches%ROWTYPE;
  club public.teams%ROWTYPE;
  competition public.tournaments%ROWTYPE;
  season_number integer;
  state public.fixture_rating_automation%ROWTYPE;
  share public.fixture_predicted_rating_shares%ROWTYPE;
  values_row public.fixture_predicted_rating_shares%ROWTYPE;
  enabled boolean;
  token uuid;
  checked_at timestamptz;
BEGIN
  SELECT t.* INTO competition FROM public.matches m JOIN public.rounds r ON r.id=m.round_id
    JOIN public.tournaments t ON t.id=r.tournament_id WHERE m.id=p_fixture_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fixture not found' USING ERRCODE='P0002'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rating-share:' || competition.id || ':' || p_team_id, 0));
  SELECT * INTO competition FROM public.tournaments WHERE id=competition.id FOR SHARE;
  -- Match the lifecycle's parent-before-child lock order; lock both clubs in a
  -- stable order before the fixture so roster changes cannot race publication.
  PERFORM 1 FROM public.teams tm JOIN public.matches m ON tm.id IN (m.home_team_id,m.away_team_id)
    WHERE m.id=p_fixture_id ORDER BY tm.id FOR SHARE OF tm;
  -- Lock the fixture so its identity/kickoff cannot change between validation and write.
  SELECT * INTO fixture FROM public.matches WHERE id=p_fixture_id FOR UPDATE;
  checked_at := clock_timestamp();
  SELECT * INTO club FROM public.teams WHERE id=p_team_id;
  IF club.id IS NULL OR club.tournament_id<>competition.id OR club.hattrick_user_id IS DISTINCT FROM p_manager_id
    OR (p_team_id IS DISTINCT FROM fixture.home_team_id AND p_team_id IS DISTINCT FROM fixture.away_team_id) THEN
    RAISE EXCEPTION 'You do not manage this fixture club' USING ERRCODE='42501';
  END IF;
  SELECT * INTO share FROM public.fixture_predicted_rating_shares WHERE fixture_id=p_fixture_id AND team_id=p_team_id;
  SELECT COALESCE((SELECT pref.enabled FROM public.tournament_team_rating_preferences pref
    WHERE pref.tournament_id=competition.id AND pref.team_id=p_team_id AND pref.hattrick_user_id=p_manager_id),true) INTO enabled;

  IF p_action='remove' THEN
    IF fixture.ht_match_id IS DISTINCT FROM p_ht_match_id THEN
      RAISE EXCEPTION 'The fixture changed while ratings were loading' USING ERRCODE='40001'; END IF;
    IF p_ht_match_id > 0 THEN
      INSERT INTO public.fixture_rating_automation(fixture_id,team_id,ht_match_id,suppressed)
        VALUES(p_fixture_id,p_team_id,p_ht_match_id,true)
        ON CONFLICT(fixture_id,team_id,ht_match_id) DO UPDATE SET suppressed=true,claim_id=NULL,claim_expires_at=NULL;
    END IF;
    DELETE FROM public.fixture_predicted_rating_shares WHERE fixture_id=p_fixture_id AND team_id=p_team_id;
    RETURN NULL;
  END IF;
  SELECT * INTO state FROM public.fixture_rating_automation
    WHERE fixture_id=p_fixture_id AND team_id=p_team_id AND ht_match_id=p_ht_match_id;
  IF p_action='release' THEN
    UPDATE public.fixture_rating_automation SET claim_id=NULL,claim_expires_at=NULL,retry_after=checked_at+interval '5 minutes'
      WHERE fixture_id=p_fixture_id AND team_id=p_team_id AND ht_match_id=p_ht_match_id AND claim_id=p_claim_id;
    RETURN NULL;
  END IF;
  SELECT r.season_number INTO season_number FROM public.rounds r WHERE r.id=fixture.round_id;
  IF fixture.ht_match_id IS DISTINCT FROM p_ht_match_id OR fixture.status IS DISTINCT FROM 'arranged'
    OR fixture.completed IS DISTINCT FROM false OR fixture.scheduled_for IS NULL OR fixture.scheduled_for<=checked_at
    OR COALESCE(competition.is_archived,false) OR competition.status IN ('finished','archived','cancelled','stopped')
    OR season_number IS DISTINCT FROM competition.season OR NOT COALESCE(club.active,false)
    OR COALESCE(club.is_placeholder,false) OR club.ht_team_id IS NULL OR club.ht_team_id<=0 OR NOT EXISTS (
      SELECT 1 FROM public.teams other WHERE other.id=CASE WHEN fixture.home_team_id=p_team_id THEN fixture.away_team_id ELSE fixture.home_team_id END
        AND other.active AND NOT COALESCE(other.is_placeholder,false) AND other.ht_team_id>0 AND other.ht_team_id<>club.ht_team_id
    ) THEN
    IF p_action IN ('claim','automatic') THEN RETURN NULL; END IF;
    RAISE EXCEPTION 'The fixture changed while ratings were loading' USING ERRCODE='40001';
  END IF;
  IF p_action='claim' THEN
    IF NOT enabled OR COALESCE(state.suppressed,false) OR (share.id IS NOT NULL AND share.ht_match_id=p_ht_match_id)
      OR state.claim_expires_at>checked_at OR state.retry_after>checked_at THEN RETURN NULL; END IF;
    token := gen_random_uuid();
    INSERT INTO public.fixture_rating_automation(fixture_id,team_id,ht_match_id,claim_id,claim_expires_at)
      VALUES(p_fixture_id,p_team_id,p_ht_match_id,token,checked_at+interval '2 minutes')
      ON CONFLICT(fixture_id,team_id,ht_match_id) DO UPDATE SET claim_id=EXCLUDED.claim_id,claim_expires_at=EXCLUDED.claim_expires_at;
    RETURN jsonb_build_object('claim_id',token);
  END IF;
  IF p_action='automatic' THEN
    IF NOT enabled OR COALESCE(state.suppressed,false) OR state.claim_id IS DISTINCT FROM p_claim_id
      OR state.claim_id IS NULL OR state.claim_expires_at<=checked_at
      OR (share.id IS NOT NULL AND share.ht_match_id=p_ht_match_id) THEN RETURN NULL; END IF;
  ELSIF p_action IN ('share','update') THEN
    IF p_existing_id IS NOT NULL AND share.id IS DISTINCT FROM p_existing_id THEN
      RAISE EXCEPTION 'Sharing was removed while ratings were loading' USING ERRCODE='40001'; END IF;
    IF p_action='update' AND (share.id IS NULL OR (share.share_source='automatic' AND NOT enabled)) THEN
      RAISE EXCEPTION 'Sharing was removed while ratings were loading' USING ERRCODE='40001'; END IF;
    IF p_action='share' AND p_existing_id IS NULL AND share.id IS NOT NULL THEN
      RAISE EXCEPTION 'This club has already shared ratings' USING ERRCODE='23505'; END IF;
  ELSE RAISE EXCEPTION 'Invalid rating sharing action' USING ERRCODE='22023'; END IF;

  -- A fixture can be replaced during the network fetch without changing its
  -- MatchID immediately. Check both club rows and Hattrick identities, too.
  IF fixture.home_team_id IS DISTINCT FROM (p_payload->'fixture_context'->>'home_team_id')::uuid
    OR fixture.away_team_id IS DISTINCT FROM (p_payload->'fixture_context'->>'away_team_id')::uuid
    OR (SELECT ht_team_id FROM public.teams WHERE id=fixture.home_team_id)
      IS DISTINCT FROM (p_payload->'fixture_context'->>'home_ht_team_id')::bigint
    OR (SELECT ht_team_id FROM public.teams WHERE id=fixture.away_team_id)
      IS DISTINCT FROM (p_payload->'fixture_context'->>'away_ht_team_id')::bigint THEN
    IF p_action='automatic' THEN RETURN NULL; END IF;
    RAISE EXCEPTION 'The fixture changed while ratings were loading' USING ERRCODE='40001';
  END IF;

  values_row := jsonb_populate_record(NULL::public.fixture_predicted_rating_shares,p_payload);
  INSERT INTO public.fixture_predicted_rating_shares AS saved(
    fixture_id,team_id,ht_match_id,left_attack,centre_attack,right_attack,midfield,left_defence,centre_defence,right_defence,
    formation,tactic,tactic_skill,coach_modifier,set_pieces_skill,specialty_positions,fetched_at,share_source
  ) VALUES(p_fixture_id,p_team_id,p_ht_match_id,values_row.left_attack,values_row.centre_attack,values_row.right_attack,
    values_row.midfield,values_row.left_defence,values_row.centre_defence,values_row.right_defence,
    values_row.formation,values_row.tactic,values_row.tactic_skill,values_row.coach_modifier,values_row.set_pieces_skill,
    values_row.specialty_positions,values_row.fetched_at,
    CASE WHEN p_action='automatic' THEN 'automatic' WHEN p_action='update' THEN share.share_source ELSE 'manual' END)
  ON CONFLICT(fixture_id,team_id) DO UPDATE SET ht_match_id=EXCLUDED.ht_match_id,
    left_attack=EXCLUDED.left_attack,centre_attack=EXCLUDED.centre_attack,right_attack=EXCLUDED.right_attack,midfield=EXCLUDED.midfield,
    left_defence=EXCLUDED.left_defence,centre_defence=EXCLUDED.centre_defence,right_defence=EXCLUDED.right_defence,
    formation=EXCLUDED.formation,tactic=EXCLUDED.tactic,tactic_skill=EXCLUDED.tactic_skill,coach_modifier=EXCLUDED.coach_modifier,
    set_pieces_skill=EXCLUDED.set_pieces_skill,specialty_positions=EXCLUDED.specialty_positions,fetched_at=EXCLUDED.fetched_at,
    share_source=EXCLUDED.share_source;
  INSERT INTO public.fixture_rating_automation(fixture_id,team_id,ht_match_id)
    VALUES(p_fixture_id,p_team_id,p_ht_match_id)
    ON CONFLICT(fixture_id,team_id,ht_match_id) DO UPDATE SET suppressed=false,claim_id=NULL,claim_expires_at=NULL,retry_after=NULL;
  RETURN jsonb_build_object('saved',true);
END $$;

REVOKE ALL ON FUNCTION public.set_team_rating_sharing(uuid,uuid,bigint,boolean),
  public.fixture_rating_sharing_action(uuid,uuid,bigint,bigint,text,uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_team_rating_sharing(uuid,uuid,bigint,boolean),
  public.fixture_rating_sharing_action(uuid,uuid,bigint,bigint,text,uuid,jsonb,uuid) TO service_role;
COMMIT;

-- applied!