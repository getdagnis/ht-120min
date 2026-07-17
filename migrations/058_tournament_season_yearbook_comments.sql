-- Immutable, participant-authored yearbook comments for finished tournament seasons.

CREATE TABLE IF NOT EXISTS public.tournament_season_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES public.tournament_seasons(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  team_id UUID NOT NULL,
  hattrick_user_id BIGINT NOT NULL,
  team_name TEXT NOT NULL,
  manager_name TEXT,
  comment TEXT NOT NULL CHECK (char_length(btrim(comment)) BETWEEN 1 AND 480),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (season_id, team_id)
);

CREATE INDEX IF NOT EXISTS tournament_season_comments_season_created_idx
  ON public.tournament_season_comments(season_id, created_at);

ALTER TABLE public.tournament_season_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view tournament season comments" ON public.tournament_season_comments;
CREATE POLICY "Anyone can view tournament season comments"
  ON public.tournament_season_comments
  FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT ON public.tournament_season_comments TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.tournament_season_comments FROM anon, authenticated;

-- MIGRATION APPLIED!