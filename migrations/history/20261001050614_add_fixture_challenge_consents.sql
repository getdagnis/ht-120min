-- Persist per-team, per-tournament consent for the future challenge automation flow.
-- This migration stores intent only. It does not create a worker or perform CHPP actions.

CREATE TABLE IF NOT EXISTS public.tournament_challenge_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  auto_send_challenge BOOLEAN NOT NULL DEFAULT FALSE,
  auto_accept_challenge BOOLEAN NOT NULL DEFAULT FALSE,
  consented_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tournament_challenge_consents_team_unique UNIQUE (tournament_id, team_id)
);

CREATE INDEX IF NOT EXISTS tournament_challenge_consents_team_idx
  ON public.tournament_challenge_consents (team_id);

ALTER TABLE public.tournament_challenge_consents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tournament_challenge_consents FROM anon, authenticated;
GRANT ALL ON TABLE public.tournament_challenge_consents TO service_role;

--APPLIED!