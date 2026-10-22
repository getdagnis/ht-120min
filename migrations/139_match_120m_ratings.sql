-- Per-participant, per-fixture preparation rating. Apply before deploying callers.
BEGIN;

CREATE TABLE public.match_120m_ratings (
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('home', 'away')),
  -- Keep the original participant identity even if its team row is later removed.
  team_id uuid NOT NULL,
  ht_team_id bigint NOT NULL CHECK (ht_team_id > 0),
  score smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  grade text NOT NULL CHECK (grade IN ('A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','E+','E','E-','F+','F','F-')),
  formula_version smallint NOT NULL CHECK (formula_version > 0),
  has_set_pieces_skill boolean NOT NULL,
  has_specialties boolean NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, side)
);
CREATE INDEX match_120m_ratings_team_idx ON public.match_120m_ratings (team_id);
ALTER TABLE public.match_120m_ratings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.match_120m_ratings FROM anon, authenticated;
GRANT SELECT ON public.match_120m_ratings TO anon, authenticated;
GRANT ALL ON public.match_120m_ratings TO service_role;
CREATE POLICY match_120m_ratings_public_read ON public.match_120m_ratings
  FOR SELECT TO anon, authenticated USING (true);

CREATE FUNCTION public.clear_stale_match_120m_ratings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.completed IS DISTINCT FROM NEW.completed
    OR OLD.match_event_details IS DISTINCT FROM NEW.match_event_details
    OR OLD.home_team_id IS DISTINCT FROM NEW.home_team_id
    OR OLD.away_team_id IS DISTINCT FROM NEW.away_team_id
    OR OLD.reserve_team_id IS DISTINCT FROM NEW.reserve_team_id
    OR OLD.reserve_replaces_team_id IS DISTINCT FROM NEW.reserve_replaces_team_id
    OR OLD.actual_ht_home_team_id IS DISTINCT FROM NEW.actual_ht_home_team_id
    OR OLD.actual_ht_away_team_id IS DISTINCT FROM NEW.actual_ht_away_team_id
    OR OLD.round_id IS DISTINCT FROM NEW.round_id
    OR OLD.ht_match_id IS DISTINCT FROM NEW.ht_match_id THEN
    DELETE FROM public.match_120m_ratings WHERE match_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER clear_stale_match_120m_ratings_after_update
AFTER UPDATE ON public.matches FOR EACH ROW EXECUTE FUNCTION public.clear_stale_match_120m_ratings();

-- The service passes calculated scores. This transaction verifies the source snapshot
-- and participant identities under a row lock before replacing both sides.
CREATE FUNCTION public.replace_match_120m_ratings(
  p_match_id uuid, p_details jsonb, p_home jsonb, p_away jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  fixture public.matches%ROWTYPE;
  mode text;
  current_season integer;
  fixture_season integer;
  expected_home_id uuid;
  expected_away_id uuid;
  expected_home_ht bigint;
  expected_away_ht bigint;
  actual_home_ht bigint;
  actual_away_ht bigint;
  side_name text;
  payload jsonb;
  expected_id uuid;
  expected_ht bigint;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO fixture FROM public.matches WHERE id=p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fixture not found' USING ERRCODE='P0002'; END IF;
  IF fixture.match_event_details IS DISTINCT FROM p_details THEN
    RAISE EXCEPTION 'Fixture performance changed' USING ERRCODE='40001';
  END IF;
  SELECT t.scoring_mode, t.season, r.season_number INTO mode, current_season, fixture_season
    FROM public.rounds r JOIN public.tournaments t ON t.id=r.tournament_id WHERE r.id=fixture.round_id;
  DELETE FROM public.match_120m_ratings WHERE match_id=p_match_id;
  IF fixture.completed IS DISTINCT FROM true OR fixture_season IS DISTINCT FROM current_season
    OR mode NOT IN ('120m','120min','average120','appg') OR p_details IS NULL THEN RETURN; END IF;
  expected_home_id := CASE WHEN fixture.reserve_replaces_team_id=fixture.home_team_id
    THEN fixture.reserve_team_id ELSE fixture.home_team_id END;
  expected_away_id := CASE WHEN fixture.reserve_replaces_team_id=fixture.away_team_id
    THEN fixture.reserve_team_id ELSE fixture.away_team_id END;
  SELECT ht_team_id INTO expected_home_ht FROM public.teams WHERE id=expected_home_id;
  SELECT ht_team_id INTO expected_away_ht FROM public.teams WHERE id=expected_away_id;
  actual_home_ht := COALESCE(fixture.actual_ht_home_team_id, NULLIF(p_details->>'actualHomeTeamId','')::bigint);
  actual_away_ht := COALESCE(fixture.actual_ht_away_team_id, NULLIF(p_details->>'actualAwayTeamId','')::bigint);
  IF expected_home_id IS NULL OR expected_away_id IS NULL OR expected_home_id=expected_away_id
    OR expected_home_ht IS NULL OR expected_away_ht IS NULL OR expected_home_ht=expected_away_ht
    OR NOT ((actual_home_ht=expected_home_ht AND actual_away_ht=expected_away_ht)
      OR (actual_home_ht=expected_away_ht AND actual_away_ht=expected_home_ht)) THEN RETURN; END IF;
  FOR side_name, payload IN SELECT 'home', p_home UNION ALL SELECT 'away', p_away LOOP
    IF payload IS NULL THEN CONTINUE; END IF;
    expected_id := CASE WHEN side_name='home' THEN expected_home_id ELSE expected_away_id END;
    expected_ht := CASE WHEN side_name='home' THEN expected_home_ht ELSE expected_away_ht END;
    IF (payload->>'team_id')::uuid IS DISTINCT FROM expected_id
      OR (payload->>'ht_team_id')::bigint IS DISTINCT FROM expected_ht THEN
      RAISE EXCEPTION 'Fixture participant changed' USING ERRCODE='40001';
    END IF;
    INSERT INTO public.match_120m_ratings
      (match_id, side, team_id, ht_team_id, score, grade, formula_version, has_set_pieces_skill, has_specialties)
    VALUES (p_match_id, side_name, expected_id, expected_ht,
      (payload->>'score')::smallint, payload->>'grade', (payload->>'formula_version')::smallint,
      (payload->>'has_set_pieces_skill')::boolean, (payload->>'has_specialties')::boolean);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.replace_match_120m_ratings(uuid,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_match_120m_ratings(uuid,jsonb,jsonb,jsonb) TO service_role;

COMMIT;

-- applied!