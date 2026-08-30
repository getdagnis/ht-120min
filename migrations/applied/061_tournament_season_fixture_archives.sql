-- Immutable fixture display snapshots for past seasons, plus the pending reapplication marker
-- used when an organizer opens a fresh season with the prior roster visible as suggestions.

ALTER TABLE public.tournament_seasons
  ADD COLUMN IF NOT EXISTS fixtures_snapshot_json JSONB;

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS reapply_season_number INTEGER;

CREATE INDEX IF NOT EXISTS idx_teams_tournament_reapply_season
  ON public.teams(tournament_id, reapply_season_number)
  WHERE reapply_season_number IS NOT NULL;

-- MIGRATION APPLIED!
