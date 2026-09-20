-- One low-stakes, season-scoped prediction vote per Hattrick manager.
CREATE TABLE IF NOT EXISTS public.tournament_season_poll_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES public.tournament_seasons(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  voter_ht_user_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tournament_season_poll_votes_one_vote_per_manager UNIQUE (season_id, voter_ht_user_id)
);

CREATE INDEX IF NOT EXISTS idx_tournament_season_poll_votes_season_id
  ON public.tournament_season_poll_votes (season_id);

ALTER TABLE public.tournament_season_poll_votes ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.tournament_season_poll_votes TO anon, authenticated;

CREATE POLICY "Anyone can view tournament season poll votes"
ON public.tournament_season_poll_votes
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "Anyone can cast a tournament season poll vote for MVP"
ON public.tournament_season_poll_votes
FOR INSERT
TO anon, authenticated
WITH CHECK (true);
