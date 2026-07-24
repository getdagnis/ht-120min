-- Enforce the one co-organizer and one press officer limits at database level.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS tournament_roles_one_co_organizer_idx
  ON public.tournament_roles(tournament_id)
  WHERE role = 'co_organizer';

CREATE UNIQUE INDEX IF NOT EXISTS tournament_roles_one_press_officer_idx
  ON public.tournament_roles(tournament_id)
  WHERE role = 'press_officer';

COMMIT;

-- Migration prepared locally; verify application separately before recording it as applied.
