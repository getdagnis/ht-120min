CREATE TABLE IF NOT EXISTS public.sandbox_tournaments (
  tournament_id uuid PRIMARY KEY REFERENCES public.tournaments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  team_id_min integer NOT NULL DEFAULT 40000,
  team_id_max integer NOT NULL DEFAULT 330000
);

ALTER TABLE public.sandbox_tournaments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read sandbox tournament metadata" ON public.sandbox_tournaments;
CREATE POLICY "Anyone can read sandbox tournament metadata"
ON public.sandbox_tournaments
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Anyone can create sandbox tournament metadata" ON public.sandbox_tournaments;
CREATE POLICY "Anyone can create sandbox tournament metadata"
ON public.sandbox_tournaments
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- MIGRATION APPLIED!
