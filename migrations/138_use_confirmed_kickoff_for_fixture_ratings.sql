-- Ratings use only the confirmed Hattrick kickoff for arranged fixtures.
-- Applied 118/119 remain immutable; this migration preserves their access contract.
BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='matches' AND column_name='chpp_match_date'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='fixture_rating_automation' AND column_name='orders_given'
  ) OR to_regprocedure('public.fixture_rating_sharing_action(uuid,uuid,bigint,bigint,text,uuid,jsonb,uuid)') IS NULL
    OR to_regprocedure('public.record_fixture_order_status(uuid,uuid,bigint,bigint,uuid,boolean,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Apply and verify the confirmed-date and ratings migrations before 138';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fixture_rating_sharing_action(
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
    OR fixture.completed IS DISTINCT FROM false OR fixture.chpp_match_date IS NULL OR fixture.chpp_match_date<=checked_at
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

CREATE OR REPLACE FUNCTION public.record_fixture_order_status(
  p_fixture_id uuid, p_team_id uuid, p_manager_id bigint, p_ht_match_id bigint,
  p_claim_id uuid, p_orders_given boolean, p_fixture_context jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE competition_id uuid; saved boolean;
BEGIN
  SELECT tm.tournament_id INTO competition_id FROM public.teams tm WHERE tm.id=p_team_id;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rating-share:' || competition_id || ':' || p_team_id,0));
  UPDATE public.fixture_rating_automation a
    SET orders_given=p_orders_given,orders_checked_at=clock_timestamp(),orders_fixture_context=p_fixture_context
    FROM public.matches m, public.teams tm, public.teams opponent, public.rounds r, public.tournaments t
    WHERE a.fixture_id=p_fixture_id AND a.team_id=p_team_id AND a.ht_match_id=p_ht_match_id
      AND a.claim_id=p_claim_id AND a.claim_expires_at>clock_timestamp()
      AND m.id=a.fixture_id AND m.ht_match_id=p_ht_match_id AND m.status='arranged'
      AND NOT m.completed AND m.chpp_match_date>clock_timestamp()
      AND r.id=m.round_id AND t.id=r.tournament_id AND r.season_number=t.season
      AND NOT COALESCE(t.is_archived,false) AND t.status NOT IN ('finished','archived','cancelled','stopped')
      AND tm.id=a.team_id AND tm.tournament_id=t.id AND tm.hattrick_user_id=p_manager_id
      AND tm.active AND NOT COALESCE(tm.is_placeholder,false)
      AND opponent.id=CASE WHEN m.home_team_id=tm.id THEN m.away_team_id WHEN m.away_team_id=tm.id THEN m.home_team_id END
      AND opponent.active AND NOT COALESCE(opponent.is_placeholder,false)
      AND m.home_team_id=(p_fixture_context->>'home_team_id')::uuid
      AND m.away_team_id=(p_fixture_context->>'away_team_id')::uuid
      AND tm.ht_team_id=(p_fixture_context->>CASE WHEN m.home_team_id=tm.id THEN 'home_ht_team_id' ELSE 'away_ht_team_id' END)::bigint
      AND opponent.ht_team_id=(p_fixture_context->>CASE WHEN m.home_team_id=opponent.id THEN 'home_ht_team_id' ELSE 'away_ht_team_id' END)::bigint;
  saved := FOUND;
  RETURN saved;
END $$;

CREATE OR REPLACE VIEW public.fixture_predicted_rating_share_status WITH (security_barrier=true) AS
SELECT m.id AS fixture_id, tm.id AS team_id, m.ht_match_id,
  (s.id IS NOT NULL) AS shared,
  COALESCE(pref.enabled,true) AS auto_sharing_enabled,
  CASE WHEN a.orders_checked_at>now()-interval '15 minutes'
    AND a.orders_fixture_context->>'home_team_id'=m.home_team_id::text
    AND a.orders_fixture_context->>'away_team_id'=m.away_team_id::text
    AND (a.orders_fixture_context->>'home_ht_team_id')::bigint=home.ht_team_id
    AND (a.orders_fixture_context->>'away_ht_team_id')::bigint=away.ht_team_id
    THEN a.orders_given ELSE NULL END AS orders_given,
  a.orders_checked_at
FROM public.matches m
JOIN public.rounds r ON r.id=m.round_id
JOIN public.tournaments t ON t.id=r.tournament_id
JOIN public.teams home ON home.id=m.home_team_id
JOIN public.teams away ON away.id=m.away_team_id
JOIN public.teams tm ON tm.id IN (m.home_team_id,m.away_team_id)
LEFT JOIN public.fixture_predicted_rating_shares s ON s.fixture_id=m.id AND s.team_id=tm.id AND s.ht_match_id=m.ht_match_id
LEFT JOIN public.tournament_team_rating_preferences pref ON pref.tournament_id=t.id AND pref.team_id=tm.id AND pref.hattrick_user_id=tm.hattrick_user_id
LEFT JOIN public.fixture_rating_automation a ON a.fixture_id=m.id AND a.team_id=tm.id AND a.ht_match_id=m.ht_match_id
WHERE m.status='arranged' AND m.completed IS FALSE AND m.chpp_match_date>now() AND m.ht_match_id>0
  AND r.season_number=t.season AND NOT COALESCE(t.is_archived,false)
  AND t.status NOT IN ('finished','archived','cancelled','stopped')
  AND home.active AND away.active AND NOT COALESCE(home.is_placeholder,false) AND NOT COALESCE(away.is_placeholder,false)
  AND home.ht_team_id>0 AND away.ht_team_id>0 AND home.ht_team_id<>away.ht_team_id;
REVOKE ALL ON FUNCTION public.fixture_rating_sharing_action(uuid,uuid,bigint,bigint,text,uuid,jsonb,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fixture_rating_sharing_action(uuid,uuid,bigint,bigint,text,uuid,jsonb,uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.record_fixture_order_status(uuid,uuid,bigint,bigint,uuid,boolean,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_fixture_order_status(uuid,uuid,bigint,bigint,uuid,boolean,jsonb)
  TO service_role;
REVOKE ALL ON public.fixture_predicted_rating_share_status FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.fixture_predicted_rating_share_status TO anon,authenticated,service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- applied!