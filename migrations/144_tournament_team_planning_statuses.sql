-- Store manually refreshed Hattrick planning checks for each team and tournament round.
BEGIN;

CREATE TABLE public.tournament_team_planning_statuses (
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  season_number integer NOT NULL CHECK (season_number > 0),
  round_number integer NOT NULL CHECK (round_number > 0),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  in_cup boolean,
  booked_outside_tournament boolean,
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, season_number, round_number, team_id)
);

ALTER TABLE public.tournament_team_planning_statuses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tournament_team_planning_statuses FROM anon, authenticated;
GRANT ALL ON public.tournament_team_planning_statuses TO service_role;

COMMIT;

-- applied!