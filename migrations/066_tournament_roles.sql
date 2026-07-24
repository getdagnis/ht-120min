-- Delegated tournament roles for the lean tournament-access MVP.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tournament_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  hattrick_user_id bigint NOT NULL,
  role text NOT NULL CHECK (role IN ('co_organizer', 'admin', 'press_officer')),
  added_by_ht_user_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, hattrick_user_id)
);

CREATE INDEX IF NOT EXISTS tournament_roles_tournament_role_idx
  ON public.tournament_roles(tournament_id, role);

ALTER TABLE public.tournament_roles ENABLE ROW LEVEL SECURITY;

-- Role data is read and changed through the server-side consolidated app route.
-- No browser role is granted direct access to this table.

COMMIT;

-- Migration prepared locally; verify application separately before recording it as applied.
