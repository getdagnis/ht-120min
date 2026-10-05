CREATE TABLE public.fixture_predicted_rating_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  ht_match_id BIGINT NOT NULL CHECK (ht_match_id > 0),
  left_attack NUMERIC(5,2) NOT NULL,
  centre_attack NUMERIC(5,2) NOT NULL,
  right_attack NUMERIC(5,2) NOT NULL,
  midfield NUMERIC(5,2) NOT NULL,
  left_defence NUMERIC(5,2) NOT NULL,
  centre_defence NUMERIC(5,2) NOT NULL,
  right_defence NUMERIC(5,2) NOT NULL,
  formation TEXT NOT NULL,
  tactic TEXT NOT NULL,
  tactic_skill INTEGER,
  set_pieces_skill INTEGER,
  fetched_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fixture_predicted_rating_shares_fixture_team_key UNIQUE (fixture_id, team_id),
  CONSTRAINT fixture_predicted_rating_shares_tactic_skill_valid CHECK (tactic_skill IS NULL OR tactic_skill BETWEEN 0 AND 30),
  CONSTRAINT fixture_predicted_rating_shares_set_pieces_skill_valid CHECK (set_pieces_skill IS NULL OR set_pieces_skill BETWEEN 0 AND 30)
);

CREATE INDEX fixture_predicted_rating_shares_team_idx ON public.fixture_predicted_rating_shares (team_id);

ALTER TABLE public.fixture_predicted_rating_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fixture_predicted_rating_shares FROM anon, authenticated;
GRANT SELECT ON public.fixture_predicted_rating_shares TO anon, authenticated;
GRANT ALL ON public.fixture_predicted_rating_shares TO service_role;

CREATE POLICY fixture_predicted_rating_shares_public_read
  ON public.fixture_predicted_rating_shares FOR SELECT TO anon, authenticated
  USING (true);

-- applied!