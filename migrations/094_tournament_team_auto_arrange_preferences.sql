CREATE TABLE IF NOT EXISTS public.tournament_team_auto_arrange_preferences (
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL CHECK (season_number > 0),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  hattrick_user_id BIGINT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tournament_team_auto_arrange_preferences_unique
    UNIQUE (tournament_id, season_number, team_id, hattrick_user_id)
);

ALTER TABLE public.tournament_team_auto_arrange_preferences ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tournament_team_auto_arrange_preferences FROM anon, authenticated;
GRANT ALL ON TABLE public.tournament_team_auto_arrange_preferences TO service_role;

-- applied!