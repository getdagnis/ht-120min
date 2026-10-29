-- Manual, server-side booking worker audit and overlap guard. No scheduler is installed.
CREATE TABLE public.forge_booking_worker_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  season_number integer NOT NULL CHECK (season_number > 0),
  round_id uuid NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  fixture_id uuid REFERENCES public.matches(id) ON DELETE SET NULL,
  mode text NOT NULL CHECK (mode IN ('dry_run', 'real')),
  status text NOT NULL CHECK (status IN ('running', 'dry_run', 'booked', 'pending', 'skipped', 'failed')),
  outcome jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE UNIQUE INDEX forge_booking_worker_one_active_run
  ON public.forge_booking_worker_runs (tournament_id, season_number)
  WHERE status = 'running';

ALTER TABLE public.forge_booking_worker_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.forge_booking_worker_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.forge_booking_worker_runs TO service_role;

-- applied!